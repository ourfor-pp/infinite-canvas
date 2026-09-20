"""IndexTTS 2.5 contract; speaker assets remain owned by the caller."""
import math
import subprocess

MODEL = "indextts-2.5-local"
PARAMETERS = ["language", "durationFactor", "intervalSilence", "emotionVector", "emotionStrength", "seed"]
LANGUAGES = ["ZH", "EN", "JA", "ES", "AR"]


def describe():
    return {"engine": "index", "modes": ["speech"], "operations": ["clone"], "inputs": ["text", "audio"],
            "maxReferenceAudios": 2, "referenceRoles": {"reference": "voice (required)", "emotion": "emotion (optional)"},
            "maxReferenceSeconds": 15, "parameters": PARAMETERS, "languages": LANGUAGES,
            "controls": {"instructions": False, "durationFactor": {"min": 0.5, "max": 2, "default": 1},
                         "intervalSilence": {"min": 0, "max": 2000, "default": 200}, "emotion": ["vector", "audio"]}}


def validate(prompt, params, references):
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("speech text is required")
    if set(params) - set(PARAMETERS):
        raise ValueError("unsupported IndexTTS parameter")
    if params.get("language", "ZH") not in LANGUAGES:
        raise ValueError("unsupported IndexTTS language")
    for key, low, high in (("durationFactor", .5, 2), ("intervalSilence", 0, 2000), ("emotionStrength", 0, 1)):
        if key in params and (type(params[key]) not in (int, float) or not math.isfinite(params[key]) or not low <= params[key] <= high):
            raise ValueError(f"invalid IndexTTS parameter: {key}")
    seed = params.get("seed", 0)
    if type(seed) is not int or not 0 <= seed <= 2**53 - 1:
        raise ValueError("seed must be a non-negative safe integer")
    roles = [ref.get("role", "reference") for ref in references]
    if roles.count("reference") != 1 or roles.count("emotion") > 1 or any(role not in ("reference", "emotion") for role in roles) or any(ref.get("kind") != "audio" for ref in references):
        raise ValueError("IndexTTS requires one voice reference and at most one emotion reference")
    if any(ref.get("frameIndex") is not None or ref.get("includeAudio") is False for ref in references):
        raise ValueError("IndexTTS references must be complete audio inputs")
    vector = params.get("emotionVector")
    if "emotionVector" in params:
        if not isinstance(vector, list) or len(vector) != 8 or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in vector) or sum(vector) > 1:
            raise ValueError("emotionVector requires eight values in [0,1] with sum <= 1")
        if "emotion" in roles:
            raise ValueError("emotionVector and emotion audio are mutually exclusive")
    if "emotionStrength" in params and vector is None and "emotion" not in roles:
        raise ValueError("emotionStrength requires emotionVector or emotion audio")


def validate_audio(path):
    try:
        seconds = float(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", str(path)], timeout=15, stderr=subprocess.DEVNULL).decode().strip())
    except (ValueError, subprocess.SubprocessError) as error:
        raise ValueError("IndexTTS reference must be decodable audio with a known duration") from error
    if not math.isfinite(seconds) or not 0 < seconds <= 15:
        raise ValueError("IndexTTS reference must be at most 15 seconds; trim it explicitly before uploading")
