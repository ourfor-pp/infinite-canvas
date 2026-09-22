"""Qwen Image 2.1 using the official ComfyUI recipe and pinned weights."""
import json
import math
import subprocess

MODEL = "qwen-image-2.1-local"
WEIGHTS = (
    ("UNETLoader", "unet_name", "qwen_image_2.1_int8_convrot.safetensors"),
    ("CLIPLoader", "clip_name", "qwen3vl_8b_int8_convrot.safetensors"),
    ("VAELoader", "vae_name", "qwen_image_2.1_vae_bf16.safetensors"),
)
NODES = {"TextEncodeQwenImage21", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage", "LoadImage", "JoinImageWithAlpha"}


def available(info):
    return NODES.issubset(info) and all(name in info.get(loader, {}).get("input", {}).get("required", {}).get(field, [[]])[0] for loader, field, name in WEIGHTS)


def describe(ready):
    return {"id": MODEL, "version": "1", "output": "image", "available": ready,
            "modes": ["text-to-image", "image-edit"], "operations": ["generate"],
            "inputs": ["text", "image"], "referenceLimits": {"image": 10, "total": 10},
            "recipes": ["int8-convrot"], "nativeTransparency": True,
            "parameters": {"steps": {"min": 1, "max": 100, "default": 40}, "width": {"min": 256, "max": 4096, "multiple": 32}, "height": {"min": 256, "max": 4096, "multiple": 32}, "referenceResolution": {"min": 256, "max": 2048, "multiple": 32, "default": 1024}},
            "qualityAccepted": False, "skill": "media-generation"}


def prepare(request, files):
    params, refs = request.get("params", {}), request.get("references", [])
    mode = request["mode"]
    if mode not in ("text-to-image", "image-edit") or request["operation"] != "generate" or request.get("continuation"):
        raise ValueError("Qwen Image 2.1 capability mismatch")
    if not request.get("prompt", "").strip():
        raise ValueError("image prompt is required")
    if len(refs) > 10 or any(r["kind"] != "image" or r.get("role", "reference") != "reference" or r.get("frameIndex") is not None for r in refs):
        raise ValueError("Qwen Image 2.1 accepts up to 10 image references")
    if bool(refs) != (mode == "image-edit"):
        raise ValueError("image-edit requires references; text-to-image accepts none")
    if set(params) - {"seed", "steps", "width", "height", "referenceResolution", "negativePrompt", "recipe"}:
        raise ValueError("unsupported Qwen Image 2.1 parameter")
    if params.get("recipe", "int8-convrot") != "int8-convrot" or not isinstance(params.get("negativePrompt", ""), str):
        raise ValueError("invalid image recipe or negative prompt")
    def integer(key, default, low, high, multiple=1):
        value = params.get(key, default)
        if type(value) is not int or not low <= value <= high or value % multiple:
            raise ValueError(f"invalid Qwen Image 2.1 parameter: {key}")
        return value
    steps = integer("steps", 40, 1, 100)
    resolution = integer("referenceResolution", 1024, 256, 2048, 32)
    if mode == "image-edit":
        if "width" in params or "height" in params:
            raise ValueError("image-edit follows the first reference aspect ratio; use referenceResolution")
        try:
            info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json", str(files / refs[0]["fileId"])], text=True, timeout=15))
            first = info["streams"][0]
            ratio = first["width"] / first["height"]
        except (subprocess.SubprocessError, KeyError, IndexError, ValueError, ZeroDivisionError) as error:
            raise ValueError("invalid first reference image") from error
        width, height = max(32, round(math.sqrt(resolution ** 2 * ratio) / 32) * 32), max(32, round(math.sqrt(resolution ** 2 / ratio) / 32) * 32)
    else:
        width, height = integer("width", 1024, 256, 4096, 32), integer("height", 1024, 256, 4096, 32)
    if width * height > 4_300_800 or max(width / height, height / width) > 8:
        raise ValueError("image size exceeds native 2K pixel budget or 8:1 aspect ratio")
    return {"capabilityVersion": "1", "mode": mode, "recipe": "int8-convrot", "width": width, "height": height, "steps": steps, "referenceResolution": resolution}


def graph(request, plan, uploads):
    def node(kind, **inputs): return {"class_type": kind, "inputs": inputs}
    graph = {str(i): node(loader, **{field: name}, **({"weight_dtype": "default"} if i == 1 else {"type": "qwen_image", "device": "default"} if i == 2 else {})) for i, (loader, field, name) in enumerate(WEIGHTS, 1)}
    encode = {"clip": ["2", 0], "prompt": request["prompt"], "negative_prompt": request.get("params", {}).get("negativePrompt", ""), "resolution": plan["referenceResolution"]}
    for i, ref in enumerate(request.get("references", []), 1):
        load, rgba = f"load_{i}", f"rgba_{i}"
        graph[load] = node("LoadImage", image=uploads[ref["fileId"]])
        graph[rgba] = node("JoinImageWithAlpha", image=[load, 0], alpha=[load, 1])
        encode[f"images.image_{i}"] = [rgba, 0]
        encode["vae"] = ["3", 0]
    graph.update({
        "4": node("TextEncodeQwenImage21", **encode),
        "5": node("EmptyLatentImage", width=plan["width"], height=plan["height"], batch_size=1),
        "6": node("KSampler", model=["1", 0], positive=["4", 0], negative=["4", 1], latent_image=["4", 2] if request.get("references") else ["5", 0], seed=plan["seed"], steps=plan["steps"], cfg=1, sampler_name="euler", scheduler="simple", denoise=1),
        "7": node("VAEDecode", samples=["6", 0], vae=["3", 0]),
        "8": node("SaveImage", images=["7", 0], filename_prefix="InfiniteCanvas/Qwen-Image-2.1"),
    })
    return graph
