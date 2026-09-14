"""MiniMax H3 request validation and Comfy graphs. No project or shot semantics."""
import hashlib
import json
import math
from pathlib import Path

from safetensors import safe_open

VERSION = "1"
MODELS = {"minimax-h3-ref2va-local": "ref2va", "minimax-h3-fl2va-local": "fl2va"}
IDENTITY_KEYS = ("modelRevision", "videoVaeRevision", "audioVaeRevision", "width", "height", "fps")
STATE_KEYS = {*IDENTITY_KEYS, "schemaVersion", "sourceId", "frames"}


def round_positive(value):
    return math.floor(value + .5)


def dimensions(params):
    parts = str(params.get("ratio", "16:9")).split(":")
    if len(parts) != 2 or any(not math.isfinite(float(x)) or float(x) <= 0 for x in parts):
        raise ValueError("ratio must contain two positive numbers")
    ratio = float(parts[0]) / float(parts[1])
    resolution = params.get("resolution", "480p" if params.get("qualityPreset", "preview") == "preview" else "768p")
    if resolution not in ("480p", "768p"):
        raise ValueError("H3 resolution must be 480p or 768p")
    edge = 480 if resolution == "480p" else 768
    width, height = (edge * ratio, edge) if ratio >= 1 else (edge, edge / ratio)
    scale = min(1, math.sqrt(edge * (864 if edge == 480 else 1344) / (width * height)))
    return {"width": max(32, round_positive(width * scale / 32) * 32), "height": max(32, round_positive(height * scale / 32) * 32)}


def state_context(path: Path, sha256: str):
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != sha256:
        raise ValueError("continuation state hash mismatch")
    with safe_open(str(path), framework="numpy") as source:
        context = json.loads((source.metadata() or {}).get("h3_state", "{}"))
        if set(context) != STATE_KEYS or context["schemaVersion"] != 1 or context["fps"] != 24:
            raise ValueError("unsupported H3 state metadata")
        w, h, frames = (context[k] for k in ("width", "height", "frames"))
        if any(type(v) is not int or v <= 0 for v in (w, h, frames)) or w % 32 or h % 32 or frames < 5 or frames % 17 != 5:
            raise ValueError("invalid H3 state grid")
        expected = {"video": [1, 24, (frames - 5) // 17 * 5 + 2, h // 16, w // 16], "audio": [1, 32, 2, round(frames * 40 / 24)]}
        if set(source.keys()) != set(expected) or any(source.get_slice(k).get_shape() != shape for k, shape in expected.items()):
            raise ValueError("H3 AV shapes do not match state metadata")
        if any(not isinstance(context[k], str) or not context[k] for k in ("modelRevision", "videoVaeRevision", "audioVaeRevision", "sourceId")):
            raise ValueError("H3 state provenance is missing")
    return context


def prepare(request, runtime, previous=None):
    mode, params = MODELS[request["model"]], request.get("params", {})
    if request["mode"] != mode or request["operation"] not in ("generate", "extend"):
        raise ValueError("H3 mode or operation mismatch")
    if request["operation"] == "extend" and (mode != "ref2va" or previous is None):
        raise ValueError("native extension requires Ref2VA and a continuation state")
    if request["operation"] == "generate" and previous is not None:
        raise ValueError("continuation state requires extend operation")
    if not request["prompt"].strip():
        raise ValueError("H3 prompt is required")
    seconds = float(params.get("seconds", 5))
    if not math.isfinite(seconds) or not 4 <= seconds <= 15 or previous and seconds > 340 / 24:
        raise ValueError("H3 duration must be 4–15 seconds; native extension at most 14.167 seconds")
    preset = params.get("qualityPreset", "preview")
    if preset not in ("preview", "final"):
        raise ValueError("unknown H3 quality preset")
    refs = request.get("references", [])
    groups = {kind: [r for r in refs if r["kind"] == kind and r.get("frameIndex") is None] for kind in ("image", "video", "audio")}
    guides = [r for r in refs if r.get("frameIndex") is not None]
    if len(guides) > 4 or previous and guides:
        raise ValueError("H3 supports at most four guides; native extension uses its previous tail")
    if mode == "fl2va" and (groups["video"] or groups["audio"]):
        raise ValueError("FL2VA reference inputs accept image inputs only; audio/video require temporal guides")
    if mode == "fl2va" and guides and groups["image"]:
        raise ValueError("FL2VA uses endpoint images or temporal guides in one request")
    if mode == "fl2va" and (len(groups["image"]) > 2 or not groups["image"] and not guides):
        raise ValueError("first/last-frame generation needs one or two endpoint images")
    if mode == "ref2va" and (len(groups["image"]) > 9 or len(groups["video"]) > 3 or len(groups["audio"]) > 3 or len(refs) > 12):
        raise ValueError("Ref2VA reference budget exceeded")
    if mode == "ref2va" and groups["audio"] and not groups["image"] and not groups["video"]:
        raise ValueError("Ref2VA needs image or video references")
    requested = params.get("recipe", params.get("h3Recipe"))
    prior_recipe = "pdd-ref8" if previous and ":pdd-ref8:" in previous["modelRevision"] else "base"
    recipe = requested or (prior_recipe if previous else "pdd-ref8" if mode == "ref2va" and runtime.get("h3PddRuntime") and not groups["audio"] else "base")
    if recipe not in ("base", "pdd-ref8") or recipe == "pdd-ref8" and (mode != "ref2va" or not runtime.get("h3PddRuntime")):
        raise ValueError("requested H3 recipe is unavailable")
    if previous and recipe != prior_recipe:
        raise ValueError("extension must retain the source recipe")
    identity = runtime.get("h3PddRuntime" if recipe == "pdd-ref8" else "h3Runtime") if mode == "ref2va" else None
    if previous and not identity:
        raise ValueError("native H3 runtime is unavailable")
    turbo = mode == "fl2va" and preset == "preview" and params.get("allowTurbo") is True and runtime.get("comfyFeatures", {}).get("turboPreview", False)
    dims = dimensions(params)
    frames = round_positive(seconds * 24 / 17) * 17 if previous else math.ceil((round_positive(seconds * 24) - 5) / 17) * 17 + 5
    context = {"schemaVersion": 1, **{k: identity[k] for k in IDENTITY_KEYS[:3]}, **dims, "fps": 24, "frames": frames + (previous["frames"] if previous else 0), "sourceId": request["id"]} if identity else None
    if previous and any(previous[k] != context[k] for k in IDENTITY_KEYS):
        raise ValueError("continuation runtime or dimensions do not match the source")
    for guide in guides:
        if guide["frameIndex"] < -1 or guide["frameIndex"] >= frames:
            raise ValueError("temporal guide lies outside generation window")
    return {"capabilityVersion": VERSION, "mode": mode, "recipe": recipe, "turbo": turbo, "qualityPreset": preset, **dims, "fps": 24, "outputFrames": frames, "outputSeconds": frames / 24, "overlapFrames": 22 if previous else 0, "context": context, "previous": previous}


def graph(request, plan, uploads, state_name=None):
    def node(kind, **inputs):
        return {"class_type": kind, "inputs": inputs}
    ref = plan["mode"] == "ref2va"
    pdd = plan["recipe"] == "pdd-ref8"
    turbo = plan.get("turbo", False)
    params = request.get("params", {})
    seed = params["seed"]
    g = {
        "1": node("UNETLoader", unet_name=f"minimax_h3_{plan['mode']}_pruned_int8_convrot.safetensors", weight_dtype="default"),
        "2": node("CLIPLoader", clip_name="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type="minimax", device="default"),
        "3": node("VAELoader", vae_name="minimax_h3_video_vae_fp16.safetensors"),
        "4": node("VAELoader", vae_name="minimax_h3_audio_vae_fp32.safetensors"),
        "6": node("BasicGuider", model=["15", 0], conditioning=["5", 0]),
        "7": node("MiniMaxH3TurboSampler") if turbo else node("KSamplerSelect", sampler_name="euler" if pdd else "res_multistep"),
        "8": node("BasicScheduler", model=["15", 0], scheduler="beta" if ref and plan["qualityPreset"] == "final" else "simple", steps=8 if turbo else 20, denoise=1),
        "9": node("RandomNoise", noise_seed=seed),
        "10": node("SamplerCustomAdvanced", noise=["9", 0], guider=["6", 0], sampler=["7", 0], sigmas=["8", 0], latent_image=["5", 1]),
        "11": node("VAEDecode", samples=["10", 0], vae=["3", 0]),
        "12": node("VAEDecodeAudio", samples=["10", 0], vae=["4", 0]),
        "13": node("CreateVideo", images=["11", 0], audio=["12", 0], fps=24, bit_depth=8),
        "14": node("SaveVideo", video=["13", 0], filename_prefix="InfiniteCanvas/MiniMax-H3", format="auto", codec="auto"),
        "15": node("PathchSageAttentionKJ", model=["1", 0], sage_attention="sageattn_qk_int8_pv_fp16_cuda", allow_compile=False),
    }
    inputs = dict(clip=["2", 0], vae=["3", 0], prompt=request["prompt"], width=plan["width"], height=plan["height"], length=plan["outputFrames"])
    refs = [r for r in request.get("references", []) if r.get("frameIndex") is None]
    if ref:
        inputs.update(audio_vae=["4", 0], ref_image_size="max" if plan["qualityPreset"] == "final" and not pdd else "match")
        for kind, start in (("image", 21), ("audio", 41), ("video", 61)):
            for i, value in enumerate(r for r in refs if r["kind"] == kind):
                key = str(start + i * (2 if kind == "video" else 1))
                name = uploads[value["fileId"]]
                g[key] = node({"image": "LoadImage", "audio": "LoadAudio", "video": "LoadVideo"}[kind], **{{"image": "image", "audio": "audio", "video": "file"}[kind]: name})
                if kind == "video":
                    component = str(int(key) + 1)
                    g[component] = node("GetVideoComponents", video=[key, 0])
                    inputs[f"ref_videos.ref_video_{i}"] = [component, 0]
                    if value.get("includeAudio", True): inputs[f"ref_video_audios.ref_video_audio_{i}"] = [component, 1]
                else:
                    inputs[f"ref_{'images' if kind == 'image' else 'audios'}.ref_{kind}_{i}"] = [key, 0]
        g["5"] = node("MiniMaxH3ReferenceToVideo", **inputs)
    else:
        for i, value in enumerate(refs):
            key = str(20 + i)
            g[key] = node("LoadImage", image=uploads[value["fileId"]])
            inputs["last_frame" if value.get("role") == "last-frame" or i == 1 else "first_frame"] = [key, 0]
        g["5"] = node("MiniMaxH3ImageToVideo", **inputs)
    if turbo:
        g["16"] = node("MiniMaxH3TurboLoRA", model=["1", 0], lora_name="minimax_h3_turbo_v4_step600_ema.safetensors", strength=1, low_vram=False)
        g["15"]["inputs"]["model"] = ["16", 0]
    if pdd:
        g["16"] = node("MiniMaxH3PDDAccApply", model=["1", 0], pdd_file="MiniMax-H3-Ref2VA-Acc-8Step.safetensors", nfe="8", lora_strength=1, head_strength=1, on_off_grid="error", partition_check="error")
        g["15"]["inputs"]["model"] = ["16", 0]
        g["10"]["inputs"]["sigmas"] = ["16", 1]
        del g["8"]
    positive = ["5", 0]
    for i, guide in enumerate(r for r in request.get("references", []) if r.get("frameIndex") is not None):
        key, components, target = (str(100 + 3 * i + x) for x in range(3))
        kind, name = guide["kind"], uploads[guide["fileId"]]
        args = dict(positive=positive, latent=["5", 1], vae=["3", 0], audio_vae=["4", 0], frame_idx=guide["frameIndex"])
        g[key] = node({"image": "LoadImage", "video": "LoadVideo", "audio": "LoadAudio"}[kind], **{{"image": "image", "video": "file", "audio": "audio"}[kind]: name})
        if kind == "video":
            g[components] = node("GetVideoComponents", video=[key, 0])
            args["image"] = [components, 0]
            if guide.get("includeAudio", True): args["audio"] = [components, 1]
        else: args[kind] = [key, 0]
        g[target] = node("MiniMaxH3AddGuide", **args)
        positive = [target, 0]
    g["6"]["inputs"]["conditioning"] = positive
    if plan["context"]:
        previous, samples = plan["previous"], ["10", 0]
        if previous:
            g["80"] = node("H3LoadContinuationState", state_name=state_name, expected_context=json.dumps(previous))
            g["81"] = node("MiniMaxH3GuidedContinuationWindow", previous_av_latent=["80", 0], overlap_frames=22, extension_frames=plan["outputFrames"])
            g["5"]["inputs"]["length"] = ["81", 1]
            g["82"] = node("MiniMaxH3LatentTailGuide", positive=["5", 0], previous_av_latent=["80", 0], target_av_latent=["81", 0], overlap_video_tokens=["81", 2], overlap_audio_tokens=["81", 3])
            g["6"]["inputs"]["conditioning"] = ["82", 0]
            g["10"]["inputs"]["latent_image"] = ["81", 0]
            g["83"] = node("MiniMaxH3AppendContinuation", previous_av_latent=["80", 0], sampled_window=["10", 0], **{key: ["81", i + 2] for i, key in enumerate(("overlap_video_tokens", "overlap_audio_tokens", "transition_video_tokens", "transition_audio_tokens"))})
            samples = ["83", 0]
        g["70"] = node("H3SaveContinuationState", latent=samples, context=json.dumps(plan["context"]))
        g["11"]["inputs"]["samples"] = g["12"]["inputs"]["samples"] = ["70", 0]
        g["85"] = node("H3NewAVSegment", images=["11", 0], audio=["12", 0], previous_frames=previous["frames"] if previous else 0)
        g["13"]["inputs"].update(images=["85", 0], audio=["85", 1])
        g["86"] = node("H3NewAVSegment", images=["11", 0], audio=["12", 0], previous_frames=0)
        g["87"] = node("CreateVideo", images=["86", 0], audio=["86", 1], fps=24, bit_depth=8)
        g["h3_cumulative"] = node("SaveVideo", video=["87", 0], filename_prefix="InfiniteCanvas/H3-Cumulative", format="auto", codec="auto")
    return g
