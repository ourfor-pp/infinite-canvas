import json
import os
import subprocess
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field
from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner
from silero_vad import get_speech_timestamps, load_silero_vad

from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app)
MODEL_ROOT = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models"))
ALIGN_LANGUAGES = {"Chinese", "English", "Cantonese", "French", "German", "Italian", "Japanese", "Korean", "Portuguese", "Russian", "Spanish"}
vad = None


class Request(BaseModel):
    model: str
    operation: str = "transcribe"
    prompt: str = ""
    params: dict = Field(default_factory=dict)
    references: list[dict]
    outputDir: str


def align(audio, text, language, offset=0):
    if language not in ALIGN_LANGUAGES:
        raise ValueError("ForcedAligner does not support the requested language")
    model = runtime.load("Qwen3-ForcedAligner-0.6B", lambda: Qwen3ForcedAligner.from_pretrained(
        str(MODEL_ROOT / "Qwen3-ForcedAligner-0.6B"), dtype=torch.bfloat16, device_map="cuda:0"))
    words = model.align(audio=(audio, 16000), text=text, language=language)[0]
    return [{"text": word.text, "start": float(word.start_time) + offset, "end": float(word.end_time) + offset} for word in words]


def process(value):
    global vad
    runtime.phase = "preprocessing"
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", value.references[0]["path"], "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"])
    audio = np.frombuffer(raw, dtype=np.float32).copy()
    duration = len(audio) / 16000
    language = value.params.get("language") or None
    timestamps = value.params.get("timestamps", True)
    segments = []
    if value.operation == "align":
        if not value.prompt.strip() or not 0 < duration <= 300:
            raise ValueError("alignment requires reference text and audio up to 300 seconds")
        language = language or "Chinese"
        words = align(audio, value.prompt, language)
        segments = [{"text": value.prompt, "start": words[0]["start"] if words else 0, "end": words[-1]["end"] if words else duration, "words": words, "language": language}]
        text = value.prompt
    else:
        if not 0 < duration <= 3600:
            raise ValueError("transcription requires audio up to 3600 seconds")
        if vad is None:
            vad = load_silero_vad().cpu()
        spans = get_speech_timestamps(torch.from_numpy(audio), vad, sampling_rate=16000, max_speech_duration_s=20, speech_pad_ms=150)
        if spans:
            folder = "Qwen3-ASR-0.6B" if "0.6b" in value.model else "Qwen3-ASR-1.7B"
            model = runtime.load(folder, lambda: Qwen3ASRModel.from_pretrained(
                str(MODEL_ROOT / folder), dtype=torch.bfloat16, device_map="cuda:0", max_inference_batch_size=1, max_new_tokens=1024))
            for span in spans:
                start, end = span["start"], span["end"]
                result = model.transcribe(audio=(audio[start:end], 16000), language=language)[0]
                if result.text.strip():
                    segments.append({"text": result.text, "language": result.language, "start": start / 16000, "end": end / 16000})
            # Transcription and alignment are explicit sequential GPU phases.
            for segment in segments:
                if timestamps and segment["language"] in ALIGN_LANGUAGES:
                    start, end = int(segment["start"] * 16000), int(segment["end"] * 16000)
                    segment["words"] = align(audio[start:end], segment["text"], segment["language"], segment["start"])
        text = "\n".join(segment["text"] for segment in segments)
    languages = list(dict.fromkeys(segment["language"] for segment in segments))
    result = {"version": 1, "source": "reference-alignment" if value.operation == "align" else "transcription",
              "model": value.model, "text": text, "language": languages[0] if len(languages) == 1 else language,
              "languages": languages, "duration": duration, "segments": segments}
    for index, segment in enumerate(segments):
        segment.update(index=index, timestampSource="forced-alignment" if "words" in segment else "vad")
    path = Path(value.outputDir) / "transcription.json"
    path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return {"files": [{"path": str(path), "mimeType": "application/json"}]}


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, process)


@app.get("/health")
def health():
    return {"ok": True}
