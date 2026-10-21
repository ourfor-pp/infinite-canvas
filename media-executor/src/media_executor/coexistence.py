"""Reuse only locally qualified, revision-bound Qwen memory envelopes."""
import json
import os

from . import llm
from .capabilities import qwen_image


def profile(request, plan):
    if request["model"] == llm.MODEL:
        return "llm"
    params = request.get("params", {})
    if (request["model"] == qwen_image.MODEL and request["mode"] == "text-to-image"
            and not request.get("references") and not request.get("continuation")
            and len(request.get("prompt", "").encode()) <= 1024
            and not params.get("negativePrompt") and plan.get("steps") == 40
            and plan.get("width") == plan.get("height") and plan.get("width") in (1024, 2048)):
        return f"image-{plan['width']}"
    return None


def budget(root, request, plan):
    key = profile(request, plan)
    if not key:
        return None
    try:
        record = json.loads((root / "qwen-coexistence.json").read_text())
        revisions = {name: os.getenv(f"MEDIA_EXECUTOR_{name.upper()}_REVISION") for name in ("llm", "comfy")}
        if record["version"] != 1 or not all(revisions.values()) or record["revisions"] != revisions:
            return None
        value = record["budgets"][key]
        return value if type(value) is int and value > 0 else None
    except (OSError, ValueError, KeyError, TypeError):
        return None
