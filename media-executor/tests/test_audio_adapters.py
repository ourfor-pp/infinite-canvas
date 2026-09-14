"""Exercise adapter contracts without importing or loading GPU dependencies."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as NS

import numpy as np
import pytest


def adapter(name, monkeypatch, dependencies):
    for key, value in dependencies.items():
        monkeypatch.setitem(__import__("sys").modules, key, value)
    path = Path(__file__).parents[1] / "runtimes" / name / "app.py"
    spec = importlib.util.spec_from_file_location(f"test_{name}_adapter", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_vox_clone_passes_normalization_denoising_and_transcript(tmp_path, monkeypatch):
    generated = []
    enhanced = []
    model = NS(tts_model=NS(sample_rate=48000), generate=lambda **kw: generated.append(kw) or [0.1])
    module = adapter("voxcpm", monkeypatch, {
        "torch": NS(manual_seed=lambda _: None, cuda=NS(manual_seed_all=lambda _: None)),
        "soundfile": NS(write=lambda path, *_: path.write_bytes(b"audio")),
        "voxcpm": NS(VoxCPM=lambda **_: model),
        "voxcpm.zipenhancer": NS(ZipEnhancer=lambda _: NS(enhance=lambda *args, **kw: enhanced.append((args, kw)))),
    })
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kw: None)
    result = module.runtime.run(module.Request(prompt="新的台词", operation="clone", params={"seed": 42, "ultimateClone": True, "normalizeText": True},
        references=[{"path": "source.mp3", "transcript": "参考原文"}], outputDir=str(tmp_path)), module.synthesize)
    assert generated[0]["text"] == "新的台词"
    assert generated[0]["prompt_text"] == "参考原文"
    assert generated[0]["prompt_wav_path"] == generated[0]["reference_wav_path"] == str(tmp_path / "reference-enhanced.wav")
    assert generated[0]["normalize"] is True and generated[0]["denoise"] is False
    assert len(enhanced) == 1
    assert Path(result["files"][0]["path"]).read_bytes() == b"audio"
    with pytest.raises(ValueError, match="reference audio"):
        module.synthesize(module.Request(prompt="台词", operation="clone", params={"seed": 42}, outputDir=str(tmp_path)))


def test_asr_silence_does_not_load_gpu_and_alignment_marks_source(tmp_path, monkeypatch):
    loads = []
    aligner = NS(align=lambda **_: [[NS(text="你好", start_time=0.1, end_time=0.8)]])
    module = adapter("qwen_asr", monkeypatch, {
        "torch": NS(from_numpy=lambda x: x, bfloat16="bf16"),
        "qwen_asr": NS(Qwen3ASRModel=NS(from_pretrained=lambda *a, **kw: pytest.fail("silence must not load ASR")),
            Qwen3ForcedAligner=NS(from_pretrained=lambda *a, **kw: loads.append(a) or aligner)),
        "silero_vad": NS(load_silero_vad=lambda: NS(cpu=lambda: "cpu-vad"), get_speech_timestamps=lambda *a, **kw: []),
    })
    monkeypatch.setattr(module.subprocess, "check_output", lambda _: np.zeros(16000, dtype=np.float32).tobytes())
    request = module.Request(model="qwen3-asr-1.7b-local", references=[{"path": "silence.wav"}], outputDir=str(tmp_path))
    module.process(request)
    result = json.loads((tmp_path / "transcription.json").read_text())
    assert result["text"] == "" and result["segments"] == [] and loads == []
    module.process(request.model_copy(update={"operation": "align", "prompt": "你好", "params": {"language": "Chinese"}}))
    result = json.loads((tmp_path / "transcription.json").read_text())
    assert result["source"] == "reference-alignment"
    assert result["segments"][0]["timestampSource"] == "forced-alignment"
    assert result["segments"][0]["words"][0] == {"text": "你好", "start": 0.1, "end": 0.8}
    assert len(loads) == 1
