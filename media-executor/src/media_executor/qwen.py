"""Qwen model contracts and verified, revision-bound readiness."""
import hashlib
import json
import os
from pathlib import Path

MODELS = {
    "qwen3-tts-1.7b-customvoice-local": ("Qwen3-TTS-12Hz-1.7B-CustomVoice", "generate_custom_voice"),
    "qwen3-tts-1.7b-base-local": ("Qwen3-TTS-12Hz-1.7B-Base", "generate_voice_clone"),
    "qwen3-tts-1.7b-voicedesign-local": ("Qwen3-TTS-12Hz-1.7B-VoiceDesign", "generate_voice_design"),
}
LANGUAGES = ["Auto", "Chinese", "English", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"]
SPEAKERS = ["Vivian", "Serena", "Ryan", "Aiden", "Dylan", "Eric", "Ono_Anna", "Sohee", "Uncle_Fu"]


def describe(model):
    method = MODELS[model][1]
    clone = method == "generate_voice_clone"
    parameters = ["language", "seed"] + ([] if clone else ["instructions"]) + (["speaker"] if method == "generate_custom_voice" else [])
    return {"engine": "qwen", "modes": ["speech"], "operations": ["clone" if clone else "generate"],
            "inputs": ["text", "audio"] if clone else ["text"], "maxReferenceAudios": int(clone),
            "parameters": parameters, "languages": LANGUAGES,
            "controls": {"instructions": not clone, "speed": "unsupported" if clone else "natural-language", "emotion": "unsupported" if clone else "natural-language", "numericSpeed": False},
            **({"speakers": SPEAKERS, "defaultSpeaker": "Vivian"} if method == "generate_custom_voice" else {}),
            **({"requiredParameters": ["instructions"]} if method == "generate_voice_design" else {})}


def validate(model, prompt, params, references):
    if model not in MODELS:
        raise ValueError("unknown Qwen model")
    definition = describe(model)
    unsupported = set(params) - set(definition["parameters"])
    if unsupported:
        raise ValueError(f"unsupported Qwen parameters for {model}: {', '.join(sorted(unsupported))}")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("speech text is required")
    if params.get("language", "Auto") not in LANGUAGES:
        raise ValueError("unsupported Qwen language")
    seed = params.get("seed", 0)
    if type(seed) is not int or not 0 <= seed <= 2**53 - 1:
        raise ValueError("seed must be a non-negative safe integer")
    if "instructions" in params and not isinstance(params["instructions"], str):
        raise ValueError("instructions must be a string")
    method = MODELS[model][1]
    if method == "generate_voice_design" and not params.get("instructions", "").strip():
        raise ValueError("VoiceDesign requires non-empty instructions")
    if method == "generate_custom_voice" and params.get("speaker", "Vivian") not in SPEAKERS:
        raise ValueError("unsupported Qwen speaker")
    if len(references) != definition["maxReferenceAudios"]:
        raise ValueError("Base requires exactly one reference audio" if definition["maxReferenceAudios"] else "this Qwen model does not accept references")


def fingerprint(model, model_root, runtime_root):
    """Cheap current inventory; certification hashes weights before signing this snapshot.

    ctime/mtime/inode/size catch replacement or edits without rehashing GBs per request.
    A changed inventory requires full verification and another smoke test.
    """
    folder = (model_root / MODELS[model][0]).resolve(strict=True)
    if not (folder / "config.json").is_file() or not list(folder.glob("*.safetensors")):
        raise ValueError("model weights or config missing")
    runtime = runtime_root / "qwen_tts"
    if not (runtime / ".venv/bin/python").is_file():
        raise ValueError("Qwen environment missing")
    paths = [p for p in folder.rglob("*") if p.is_file() and not any(x.startswith('.') for x in p.relative_to(folder).parts)]
    paths += [runtime / "app.py", runtime / "uv.lock", runtime / "pyproject.toml", Path(__file__), Path(__file__).with_name("runtime.py"), Path(__file__).with_name("worker.py")]
    for site in (runtime / ".venv/lib").glob("python*/site-packages"):
        paths += list(site.glob("*.dist-info/RECORD")) + list((site / "qwen_tts").rglob("*.py"))
    inventory = []
    for path in sorted(set(paths)):
        stat = path.stat()
        inventory.append([str(path.resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino])
    return hashlib.sha256(json.dumps(inventory).encode()).hexdigest()


def readiness(root, model_root, runtime_root):
    result = {}
    for model in MODELS:
        try:
            record = json.loads((root / "qwen-readiness" / (model + ".json")).read_text())
            result[model] = record["fingerprint"] == fingerprint(model, model_root, runtime_root) and record["smokePassed"] is True
        except (OSError, ValueError, KeyError, TypeError):
            result[model] = False
    return result
