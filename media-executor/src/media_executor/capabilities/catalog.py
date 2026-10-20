"""Runtime-backed, bounded capability descriptions and shared preflight."""
import hashlib
from pathlib import Path

from . import h3, music, qwen_image, video_quality
from .. import qwen, indextts

COMFY_MODELS = {*h3.MODELS, music.MODEL, qwen_image.MODEL, *video_quality.MODELS}


def describe(runtime):
    features = runtime.get("comfyFeatures", {})
    items = [qwen_image.describe(bool(features.get("qwenImage21")))]
    items.extend(video_quality.describe(features))
    for model, mode in h3.MODELS.items():
        available = features.get("h3Ref2va" if mode == "ref2va" else "h3Fl2va", False)
        native = mode == "ref2va" and bool(runtime.get("h3Runtime"))
        items.append({"id": model, "version": h3.VERSION, "output": "video", "available": available,
                      "modes": [mode], "operations": ["generate", "extend"] if native else ["generate"],
                      "inputs": ["text", "image", "video", "audio"],
                      "referenceLimits": {"image": 9, "video": 3, "audio": 3, "total": 12} if mode == "ref2va" else {"image": 2, "video": 0, "audio": 0, "total": 4},
                      "temporalGuides": {"max": 4 if features.get("temporalGuides") else 0, "kinds": ["image", "video", "audio"], "exclusiveWithEndpoints": mode == "fl2va"},
                      "duration": {"min": 4, "max": 15, "extendMax": 340 / 24 if native else None}, "fps": 24, "resolutions": ["480p", "768p"],
                      "recipes": ["base", "pdd-ref8"] if mode == "ref2va" and runtime.get("h3PddRuntime") else ["base"],
                      "defaultRecipePolicy": "inherit continuation source; prefer PDD for Ref2VA without audio references when available; otherwise base",
                      "nativeAudio": True, "qualityAccepted": False, "skill": "media-generation"})
    items.append({"id": music.MODEL, "version": "1", "output": "audio", "available": bool(features.get("music3")), "modes": ["music"], "operations": ["generate"], "inputs": ["text"], "duration": {"min": 1, "max": 300}, "referenceLimits": {"total": 0}, "recipes": ["base"], "skill": "media-generation", "qualityAccepted": False})
    for model, definition in runtime.get("models", {}).items():
        if model not in COMFY_MODELS:
            available = runtime.get("runtimes", {}).get(definition.get("engine")) or runtime.get("configuredRuntimes", {}).get(definition.get("engine"))
            if definition.get("engine") == "qwen":
                available = runtime.get("modelReadiness", {}).get(model, False)
            items.append({"id": model, "version": "1", "output": "audio", **definition, "available": bool(available), "qualityAccepted": False, "skill": "media-generation"})
    return {"version": "2", "capabilities": items}


def input_path(root: Path, file_id: str):
    path = (root / file_id).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        raise ValueError("input file is missing or outside executor storage")
    return path


def prepare(request, runtime, files: Path):
    if any(key.startswith("__") for key in request.get("params", {})):
        raise ValueError("private application metadata is not an execution parameter")
    seed = request.get("params", {}).get("seed")
    if seed is not None and (type(seed) is not int or not 0 <= seed <= 2**53 - 1):
        raise ValueError("seed must be a non-negative safe integer")
    definition = next((x for x in describe(runtime)["capabilities"] if x["id"] == request["model"]), None)
    if not definition or not definition["available"]:
        raise ValueError("requested model capability is unavailable")
    if request["model"] != indextts.MODEL and any(ref.get("role") == "emotion" for ref in request.get("references", [])):
        raise ValueError("emotion references are only supported by IndexTTS")
    for ref in request.get("references", []): input_path(files, ref["fileId"])
    if request["model"] in h3.MODELS:
        state = request.get("continuation")
        previous = h3.state_context(input_path(files, state["fileId"]), state["sha256"]) if state else None
        plan = h3.prepare(request, runtime, previous)
        if any(r.get("frameIndex") is not None for r in request.get("references", [])) and not runtime.get("comfyFeatures", {}).get("temporalGuides"):
            raise ValueError("temporal guides are unavailable")
    elif request["model"] == qwen_image.MODEL:
        plan = qwen_image.prepare(request, files)
    elif request["model"] in video_quality.MODELS:
        plan = video_quality.prepare(request, files)
    elif request["model"] == music.MODEL:
        plan = music.prepare(request)
    else:
        if request["mode"] not in definition["modes"] or request["operation"] not in definition["operations"] or request.get("continuation"):
            raise ValueError("model capability mismatch")
        if any(ref["kind"] not in definition["inputs"] for ref in request.get("references", [])) or len(request.get("references", [])) > definition.get("maxReferenceAudios", 0):
            raise ValueError("audio reference capability mismatch")
        if definition.get("engine") == "qwen":
            qwen.validate(request["model"], request.get("prompt", ""), request.get("params", {}), request.get("references", []))
        if definition.get("engine") == "index":
            indextts.validate(request.get("prompt", ""), request.get("params", {}), request.get("references", []))
            for ref in request.get("references", []):
                indextts.validate_audio(input_path(files, ref["fileId"]))
        if definition.get("engine") == "asr":
            if len(request.get("references", [])) != 1:
                raise ValueError("ASR requires exactly one audio file")
            if request["operation"] == "align" and not request.get("prompt", "").strip():
                raise ValueError("alignment requires reference text")
            if set(request.get("params", {})) - {"language", "timestamps", "seed"}:
                raise ValueError("unsupported ASR parameter")
            if "timestamps" in request.get("params", {}) and type(request["params"]["timestamps"]) is not bool:
                raise ValueError("timestamps must be a boolean")
        if definition.get("engine") == "vox":
            params = request.get("params", {})
            if not request.get("prompt", "").strip():
                raise ValueError("speech text is required")
            if request["operation"] == "clone" and not request.get("references"):
                raise ValueError("voice cloning requires reference audio")
            if params.get("ultimateClone") and (not request.get("references") or not (request["references"][0].get("transcript") or params.get("referenceTranscript"))):
                raise ValueError("ultimate voice cloning requires a reference transcript")
            for key, low, high in (("cfgValue", 1, 5), ("steps", 4, 50), ("maxLength", 256, 8192)):
                if key in params and (type(params[key]) not in (int, float) or not low <= params[key] <= high):
                    raise ValueError(f"invalid VoxCPM parameter: {key}")
        plan = {"capabilityVersion": "1", "mode": request["mode"]}
    plan["seed"] = seed if seed is not None else int(hashlib.sha256(request["id"].encode()).hexdigest()[:13], 16)
    return plan
