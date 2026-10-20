"""Bounded video enhancement in the existing managed ComfyUI process."""
import gc
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import uuid
from fractions import Fraction
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import folder_paths
import comfy.model_management as mm
import comfy.utils
from aiohttp import web
from server import PromptServer

CONFIG = Path(os.getenv("MEDIA_VIDEO_QUALITY_CONFIG", str(Path.home() / ".local/share/infinite-media-executor/video-quality/runtime.json")))
RECIPE = "sr-rife-v1"


def config():
    return json.loads(CONFIG.read_text())


def module(name, path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[str(path.parent)])
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


@PromptServer.instance.routes.get("/infinite/video-quality")
async def readiness(_request):
    try:
        settings = config()
        models = {model: all(Path(item["path"]).is_file() and Path(item["path"]).stat().st_size == item["bytes"] and Path(item["path"]).stat().st_mtime_ns == item["mtimeNs"] for item in paths) for model, paths in settings["required"].items()}
        return web.json_response({"recipe": RECIPE, "models": models})
    except (OSError, ValueError, KeyError):
        return web.json_response({"recipe": RECIPE, "models": {}})


class Flash:
    def __init__(self, settings, width, height, seed, fps):
        root = Path(settings["root"])
        for path in (root / "deps", root / "sources/flash-comfy", root / "sources/flash-comfy/operators/flashvsr_attn"):
            if str(path) not in sys.path:
                sys.path.insert(0, str(path))
        from flashvsr_plus import ModelPaths, build_inference_pipeline, stream_config_for_mode
        weights = Path(settings["weights"]) / "flashvsr-plus"
        paths = ModelPaths(dit=str(weights / "turbo/dit.safetensors"), lq_projection=str(weights / "turbo/lq_proj_in.safetensors"),
            tiny_decoder=str(weights / "TCDecoder.ckpt"), context=str(root / "sources/flash-comfy/flashvsr_plus/prompt_tensor/posi_prompt_plus.pth"))
        conf = stream_config_for_mode("turbo", seed=seed, attn_kernel="triton_block_sparse", tiny_decoder_mode="serial", decode_every=4, offload_original_cache=True)
        conf.stream_cache_pin_memory = False
        conf.stream_ffn_chunk_tokens = 32768
        self.pipeline = build_inference_pipeline(conf, paths)
        self.width, self.height, self.fps = width, height, fps

    def __call__(self, frames):
        from flashvsr_plus import InferenceRequest
        width, height = math.ceil(self.width / 128) * 128, math.ceil(self.height / 128) * 128
        n, sh, sw, _ = frames.shape
        scale = min(self.width / sw, self.height / sh)
        rw, rh = round(sw * scale), round(sh * scale)
        left, top = (width - rw) // 2, (height - rh) // 2
        lq = torch.full((1, 3, n, height, width), -1, dtype=torch.bfloat16)
        for i in range(n):
            frame = F.interpolate(frames[i:i + 1].movedim(-1, 1), size=(rh, rw), mode="bicubic", align_corners=False).clamp(0, 1)
            lq[:, :, i, top:top + rh, left:left + rw] = frame.mul(2).sub(1).to(torch.bfloat16)
        with torch.inference_mode():
            output = self.pipeline.infer(InferenceRequest(lq_video=lq, fps=self.fps)).video
            output = output[:, :, :, (height - self.height) // 2:(height - self.height) // 2 + self.height,
                (width - self.width) // 2:(width - self.width) // 2 + self.width]
            # Transfer one frame at a time; avoid a second full float32 GPU video.
            result = torch.empty((n, self.height, self.width, 3), dtype=torch.float32)
            if output.shape[2] != n:
                raise RuntimeError("FlashVSR returned an unexpected frame count")
            for i in range(n):
                result[i] = output[0, :, i].movedim(0, -1).add(1).mul(.5).clamp(0, 1).float().cpu()
        del output, lq
        mm.soft_empty_cache()
        return result


class Seed:
    def __init__(self, settings, width, height, seed, fps):
        root = Path(settings["root"])
        sys.path.insert(0, str(root / "deps"))
        module("infinite_seedvr2", root / "sources/seed-comfy/__init__.py")
        from infinite_seedvr2.src.interfaces.dit_model_loader import SeedVR2LoadDiTModel
        from infinite_seedvr2.src.interfaces.vae_model_loader import SeedVR2LoadVAEModel
        from infinite_seedvr2.src.interfaces.video_upscaler import SeedVR2VideoUpscaler
        folder_paths.add_model_folder_path("seedvr2", str(Path(settings["weights"]) / "seedvr2-comfy-official"))
        self.dit = SeedVR2LoadDiTModel.execute("evaluation_comfy_seedvr2_3b_fp16.safetensors", "cuda:0", offload_device="cpu", attention_mode="sdpa").result[0]
        self.vae = SeedVR2LoadVAEModel.execute("ema_vae_fp16.safetensors", "cuda:0", offload_device="cpu", encode_tiled=True,
            encode_tile_size=1024, encode_tile_overlap=128, decode_tiled=True, decode_tile_size=1024, decode_tile_overlap=128).result[0]
        self.node, self.width, self.height, self.seed = SeedVR2VideoUpscaler, width, height, seed

    def __call__(self, frames):
        return self.node.execute(frames, self.dit, self.vae, seed=self.seed, resolution=min(self.width, self.height),
            max_resolution=max(self.width, self.height), batch_size=9, uniform_batch_size=True, temporal_overlap=1,
            color_correction="lab", offload_device="cpu").result[0]


class Rife:
    def __init__(self):
        from comfy_extras.nodes_frame_interpolation import FrameInterpolationModelLoader
        self.patcher = FrameInterpolationModelLoader.execute("rife_v4.25.safetensors").result[0]

    def __call__(self, first, second, alpha):
        from comfy.ldm.common_dit import pad_to_patch_size
        patcher = self.patcher
        dtype, device = patcher.model_dtype(), patcher.load_device
        pair = torch.stack((first, second)).movedim(-1, 1).to(device=device, dtype=dtype)
        model = patcher.model
        mm.load_models_gpu([patcher], memory_required=model.memory_used_forward((2, *first.shape), dtype))
        pair = pad_to_patch_size(pair, (model.pad_align, model.pad_align), padding_mode="reflect")
        with torch.inference_mode():
            timestep = torch.full((1, 1, pair.shape[2], pair.shape[3]), alpha, dtype=dtype, device=device)
            result = model(pair[0:1], pair[1:2], timestep=timestep)
            return result[0, :, :first.shape[0], :first.shape[1]].movedim(0, -1).float().clamp(0, 1).cpu()


def fit(frame, width, height):
    """Small batches only; uniform scaling and letterboxing preserve source geometry."""
    sh, sw, _ = frame.shape
    scale = min(width / sw, height / sh)
    rw, rh = min(width, round(sw * scale)), min(height, round(sh * scale))
    frame = F.interpolate(frame[None].movedim(-1, 1), size=(rh, rw), mode="bicubic", align_corners=False)[0].movedim(0, -1).clamp(0, 1)
    result = torch.zeros((height, width, 3), dtype=torch.float32)
    left, top = (width - rw) // 2, (height - rh) // 2
    result[top:top + rh, left:left + rw] = frame
    return result


class InfiniteVideoEnhance:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"file": ("STRING",), "model": (["flashvsr-turbo-local", "seedvr2-local"],),
            "width": ("INT", {"min": 2, "max": 3840}), "height": ("INT", {"min": 2, "max": 3840}),
            "fps": ("STRING",), "seed": ("INT", {"default": 42}), "source_frames": ("INT",),
            "source_fps": ("STRING",), "output_frames": ("INT",), "recipe": ([RECIPE],)}}

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "InfiniteCanvas/video"

    def run(self, file, model, width, height, fps, seed, source_frames, source_fps, output_frames, recipe):
        settings = config()
        source = Path(folder_paths.get_annotated_filepath(file)).resolve()
        if Path(folder_paths.get_input_directory()).resolve() not in source.parents or not source.is_file():
            raise ValueError("source video is outside Comfy input storage")
        if source_frames < 2 or source_frames / float(Fraction(source_fps)) > 15 or max(width, height) > 3840:
            raise ValueError("video exceeds enhancement bounds")
        out_dir = Path(folder_paths.get_output_directory()) / "InfiniteCanvas/VideoQuality"
        out_dir.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}.mp4"
        final = out_dir / name
        mm.unload_all_models()
        mm.soft_empty_cache()
        engine = None
        try:
            with tempfile.TemporaryDirectory(prefix="video-quality-", dir=folder_paths.get_temp_directory()) as tmp:
                root = Path(tmp)
                probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", str(source)], timeout=30))
                stream = probe["streams"][0]
                sw, sh = stream["width"], stream["height"]
                if abs(int((stream.get("side_data_list") or [{}])[0].get("rotation", 0))) % 180 == 90:
                    sw, sh = sh, sw
                raw = root / "source.rgb"
                # Decode once to bounded disk storage; mmap windows do not materialize the whole video.
                decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-map", "0:v:0", "-an", "-vsync", "0", "-pix_fmt", "rgb24", "-f", "rawvideo", str(raw)], capture_output=True, timeout=120)
                if decoded.returncode or raw.stat().st_size != source_frames * sw * sh * 3:
                    raise RuntimeError("source frame count or dimensions changed after preflight")
                cuts_run = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(source), "-vf", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], capture_output=True, text=True, timeout=120)
                if cuts_run.returncode:
                    raise RuntimeError("scene-boundary detection failed")
                cuts = {round(float(t) * float(Fraction(source_fps))) for t in re.findall(r"pts_time:([\d.]+)", cuts_run.stderr)}
                frames = np.memmap(raw, dtype=np.uint8, mode="r", shape=(source_frames, sh, sw, 3))
                # SR runs before RIFE; retain overlap as context, and encode only each window's core.
                silent = root / "video.mp4"
                encoder = subprocess.Popen(["ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", fps,
                    "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "4", str(silent)], stdin=subprocess.PIPE, stderr=root.joinpath("encoder.log").open("wb"))
                previous, next_output, rife = None, 0, None
                source_rate, output_rate = Fraction(source_fps), Fraction(fps)
                progress = comfy.utils.ProgressBar(source_frames)

                def write(frame):
                    mm.throw_exception_if_processing_interrupted()
                    encoder.stdin.write(frame.mul(255).round().clamp(0, 255).to(torch.uint8).numpy().tobytes())

                try:
                    # Scene boundaries also isolate the temporal SR context.
                    boundaries = sorted({0, source_frames, *[c for c in cuts if 0 < c < source_frames]})
                    for scene_start, scene_end in zip(boundaries, boundaries[1:]):
                        for core in range(scene_start, scene_end, 41):
                            mm.throw_exception_if_processing_interrupted()
                            end = min(scene_end, core + 41)
                            start_ctx, end_ctx = max(scene_start, core - 4), min(scene_end, end + 4)
                            images = torch.from_numpy(np.array(frames[start_ctx:end_ctx])).float().div_(255)
                            mm.unload_all_models()
                            mm.soft_empty_cache()
                            engine = (Flash if model == "flashvsr-turbo-local" else Seed)(settings, width, height, seed, float(source_rate))
                            enhanced = engine(images)
                            engine = None
                            gc.collect()
                            mm.unload_all_models()
                            mm.soft_empty_cache()
                            if len(enhanced) != end_ctx - start_ctx:
                                raise RuntimeError("enhancement changed source frame count")
                            for index in range(core, end):
                                current = fit(enhanced[index - start_ctx].cpu(), width, height)
                                if previous is not None:
                                    while next_output < output_frames and Fraction(next_output) * source_rate / output_rate < index:
                                        position = Fraction(next_output) * source_rate / output_rate
                                        alpha = float(position - (index - 1))
                                        if alpha <= 0 or index in cuts:
                                            write(previous)
                                        else:
                                            if rife is None:
                                                rife = Rife()
                                            write(rife(previous, current, alpha))
                                        next_output += 1
                                previous = current
                                progress.update_absolute(index + 1, source_frames)
                            del enhanced, images
                            gc.collect()
                            mm.soft_empty_cache()
                    while next_output < output_frames:
                        write(previous)
                        next_output += 1
                    encoder.stdin.close()
                    if encoder.wait(timeout=120):
                        raise RuntimeError("enhanced video encoding failed: " + root.joinpath("encoder.log").read_text()[-1200:])
                finally:
                    if encoder.poll() is None:
                        encoder.kill()
                        encoder.wait()
                mux = subprocess.run(["ffmpeg", "-v", "error", "-i", str(silent), "-i", str(source), "-map", "0:v:0", "-map", "1:a?",
                    "-c", "copy", "-map_metadata", "-1", "-movflags", "+faststart", str(final)], capture_output=True, text=True, timeout=120)
                if mux.returncode:
                    raise RuntimeError("cannot preserve source audio in MP4: " + mux.stderr[-1200:])
                # Packet copy is mandatory; compare decoded audio to detect changes in timing or content.
                def pcm(path):
                    check = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a?", "-vn", "-c:a", "pcm_s32le", "-f", "hash", "-hash", "sha256", "-"], capture_output=True, timeout=120)
                    return check.returncode, check.stdout
                audio = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", str(source)], timeout=30))["streams"]
                source_pcm, output_pcm = pcm(source), pcm(final)
                if audio and (source_pcm[0] or output_pcm[0] or source_pcm != output_pcm):
                    raise RuntimeError("enhancement changed source audio")
            return {"ui": {"gifs": [{"filename": name, "subfolder": "InfiniteCanvas/VideoQuality", "type": "output", "format": "video/mp4"}]}}
        except BaseException:
            final.unlink(missing_ok=True)
            raise
        finally:
            del engine
            gc.collect()
            mm.unload_all_models()
            mm.soft_empty_cache()


NODE_CLASS_MAPPINGS = {"InfiniteVideoEnhance": InfiniteVideoEnhance}
