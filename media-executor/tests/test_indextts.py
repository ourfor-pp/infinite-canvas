import copy
import math
import wave

import pytest

from media_executor import indextts
from media_executor.capabilities.catalog import prepare


def reference(role="reference"):
    return {"fileId": role + ".wav", "kind": "audio", "role": role}


@pytest.mark.parametrize("params", [
    {"durationFactor": 0.4}, {"durationFactor": True}, {"durationFactor": math.nan},
    {"intervalSilence": -1}, {"intervalSilence": 2001}, {"language": "Auto"},
    {"instructions": "慢一点"}, {"speed": .8}, {"emoText": "平静"},
    {"emotionVector": [0] * 7}, {"emotionVector": [1] * 8},
    {"emotionVector": [math.inf] + [0] * 7}, {"emotionVector": None},
    {"emotionStrength": .5}, {"seed": True},
])
def test_invalid_controls_are_rejected(params):
    with pytest.raises(ValueError):
        indextts.validate("台词", params, [reference()])


def test_emotion_reference_is_explicit_and_exclusive():
    refs = [reference("emotion"), reference()]
    indextts.validate("台词", {"emotionStrength": .5}, refs)
    with pytest.raises(ValueError, match="mutually exclusive"):
        indextts.validate("台词", {"emotionVector": [0] * 8}, refs)
    for invalid in ([], [reference("emotion")], [reference(), reference()], [reference("first-frame")]):
        with pytest.raises(ValueError, match="voice reference"):
            indextts.validate("台词", {}, invalid)


def test_preflight_checks_actual_reference_duration_and_mode(tmp_path):
    path = tmp_path / "reference.wav"
    def audio(seconds):
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(8000)
            wav.writeframes(b"\x01\x00" * int(seconds * 8000))
    audio(1)
    runtime = {"models": {indextts.MODEL: indextts.describe()}, "configuredRuntimes": {"index": True}}
    request = {"id": "test", "model": indextts.MODEL, "mode": "speech", "operation": "clone", "prompt": "台词", "params": {"durationFactor": 1.2}, "references": [reference()]}
    assert prepare(request, runtime, tmp_path)["seed"] >= 0
    invalid = copy.deepcopy(request)
    invalid["operation"] = "generate"
    with pytest.raises(ValueError, match="capability mismatch"):
        prepare(invalid, runtime, tmp_path)
    audio(15.1)
    with pytest.raises(ValueError, match="15 seconds"):
        prepare(request, runtime, tmp_path)


def test_other_models_do_not_silently_ignore_emotion_reference(tmp_path):
    request = {"id": "test", "model": "other", "mode": "speech", "operation": "clone", "references": [reference("emotion")]}
    runtime = {"models": {"other": {"engine": "vox"}}, "configuredRuntimes": {"vox": True}}
    with pytest.raises(ValueError, match="only supported by IndexTTS"):
        prepare(request, runtime, tmp_path)
