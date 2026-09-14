import os
from pathlib import Path

import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from stable_audio_3 import StableAudioModel

from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app)


class Request(BaseModel):
    operation: str = "generate"
    prompt: str
    params: dict = Field(default_factory=dict)
    references: list[dict] = Field(default_factory=list)
    outputDir: str


def load():
    if os.getenv("STABLE_AUDIO_3_LICENSE_ACCEPTED") != "1":
        raise HTTPException(403, "Stable Audio 3 license has not been accepted")
    return runtime.load("StableAudio", lambda: StableAudioModel.from_pretrained(os.getenv("STABLE_AUDIO_MODEL", "medium"), device="cuda"))


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, synthesize)


def synthesize(value: Request):
    model = load()
    duration = max(1, min(300, float(value.params.get("seconds", 30))))
    arguments = {"prompt": value.prompt, "duration": duration, "steps": int(value.params.get("steps", 8)), "cfg_scale": float(value.params.get("cfgScale", 1)), "seed": int(value.params.get("seed", -1)), "batch_size": 1}
    if value.operation != "generate":
        if not value.references:
            raise HTTPException(400, "audio editing requires a reference audio")
        source = torchaudio.load(value.references[0]["path"])
        if value.operation == "transform":
            arguments.update(init_audio=source, init_noise_level=float(value.params.get("strength", .6)))
        else:
            start = float(value.params.get("inpaintStart", value.params.get("sourceSeconds", 0)))
            end = float(value.params.get("inpaintEnd", duration))
            arguments.update(inpaint_audio=source, inpaint_mask_start_seconds=start, inpaint_mask_end_seconds=end)
    audio = model.generate(**arguments)
    waveform = audio[0] if getattr(audio, "ndim", 0) == 3 else audio
    target = Path(value.outputDir) / "stable-audio.wav"
    torchaudio.save(str(target), waveform.detach().to(torch.float32).cpu(), 44100)
    return {"files": [{"path": str(target), "mimeType": "audio/wav"}]}


@app.get("/health")
def health():
    return {"ok": os.getenv("STABLE_AUDIO_3_LICENSE_ACCEPTED") == "1"}
