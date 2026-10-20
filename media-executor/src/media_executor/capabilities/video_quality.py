"""Video enhancement recipes; source timing and audio belong to the input video."""
import json
import subprocess
from fractions import Fraction

MODELS = {"flashvsr-turbo-local": "flash", "seedvr2-local": "seed"}
RECIPE = "sr-rife-v1"
RESOLUTIONS = {"1080p": 1920, "4k": 3840}


def describe(features):
    return [{"id": model, "version": "1", "output": "video", "available": bool(features.get(model)),
             "modes": ["enhance"], "operations": ["enhance"], "inputs": ["video"],
             "referenceLimits": {"video": 1, "total": 1}, "recipes": [RECIPE],
             "parameters": {"resolution": list(RESOLUTIONS), "fps": ["source", 48, 60]},
             "duration": {"max": 15}, "nativeAudio": False, "preserveAudio": True,
             "qualityAccepted": False, "skill": "media-generation"} for model in MODELS]


def source_info(path):
    try:
        probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_streams", "-show_frames", "-of", "json", str(path)], text=True, timeout=30))
        info = probe["streams"][0]
        fps = Fraction(info["avg_frame_rate"])
        width, height, frames = int(info["width"]), int(info["height"]), int(info["nb_read_frames"])
        if abs(int((info.get("side_data_list") or [{}])[0].get("rotation", 0))) % 180 == 90:
            width, height = height, width
        if not 1 <= fps <= 60 or fps != Fraction(info["r_frame_rate"]) or frames < 2 or frames / fps > 15 or width * height > 1920 * 1080:
            raise ValueError("source must be a constant-rate video, 2+ frames, at most 15 seconds, 60 FPS and 1080p area")
        times = [Fraction(frame["best_effort_timestamp_time"]) for frame in probe["frames"]]
        if len(times) != frames or any(abs(t - times[0] - Fraction(i) / fps) > Fraction(1, 10000) for i, t in enumerate(times)):
            raise ValueError("variable frame timing is not supported")
        return {"width": width, "height": height, "frames": frames, "fps": str(fps)}
    except (subprocess.SubprocessError, KeyError, IndexError, ZeroDivisionError, TypeError) as error:
        raise ValueError("cannot inspect source video") from error


def prepare(request, files):
    params, refs = request.get("params", {}), request.get("references", [])
    if request["mode"] != "enhance" or request["operation"] != "enhance" or request.get("continuation"):
        raise ValueError("video enhancement capability mismatch")
    if request.get("prompt", "").strip():
        raise ValueError("video enhancement does not accept a creative prompt")
    if len(refs) != 1 or refs[0]["kind"] != "video" or refs[0].get("role", "reference") != "reference" or refs[0].get("frameIndex") is not None:
        raise ValueError("video enhancement requires exactly one source video")
    if set(params) - {"resolution", "fps", "seed", "recipe"} or params.get("resolution", "1080p") not in RESOLUTIONS:
        raise ValueError("unsupported video enhancement parameter")
    if params.get("recipe", RECIPE) != RECIPE:
        raise ValueError("unsupported video enhancement recipe")
    target_fps = params.get("fps", 48)
    if target_fps != "source" and (type(target_fps) is not int or target_fps not in (48, 60)):
        raise ValueError("target FPS must be source, 48 or 60")
    source = source_info(files / refs[0]["fileId"])
    long_edge = RESOLUTIONS[params.get("resolution", "1080p")]
    scale = long_edge / max(source["width"], source["height"])
    width, height = (max(2, 2 * round(source[key] * scale / 2)) for key in ("width", "height"))
    fps = Fraction(source["fps"]) if target_fps == "source" else max(Fraction(source["fps"]), Fraction(target_fps))
    frames = round(Fraction(source["frames"]) * fps / Fraction(source["fps"]))
    return {"capabilityVersion": "1", "mode": "enhance", "recipe": RECIPE, "source": source,
            "width": width, "height": height, "fps": str(fps), "outputFrames": frames,
            "outputSeconds": float(Fraction(frames) / fps), "preserveAudio": True}


def graph(request, plan, uploads):
    return {"enhance": {"class_type": "InfiniteVideoEnhance", "inputs": {
        "file": uploads[request["references"][0]["fileId"]], "model": request["model"],
        "width": plan["width"], "height": plan["height"], "fps": plan["fps"],
        "seed": plan["seed"], "source_frames": plan["source"]["frames"],
        "source_fps": plan["source"]["fps"], "output_frames": plan["outputFrames"], "recipe": RECIPE}}}
