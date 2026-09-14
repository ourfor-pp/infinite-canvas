import os
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel, Field
import soundfile as sf
import torch
from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app)
MODEL_ROOT = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models"))


class Request(BaseModel):
    prompt: str
    params: dict = Field(default_factory=dict)
    outputDir: str


def load():
    from moss_soundeffect_v2 import MossSoundEffectPipeline
    return runtime.load("MOSS-SoundEffect-v2.0", lambda: MossSoundEffectPipeline.from_pretrained(str(MODEL_ROOT / "MOSS-SoundEffect-v2.0"), torch_dtype=torch.bfloat16, device="cuda"))


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, synthesize)


def synthesize(value: Request):
    pipe = load()
    seconds = max(1, min(30, float(value.params.get("seconds", 10))))
    audio = pipe(
        prompt=value.prompt,
        seconds=seconds,
        num_inference_steps=int(value.params.get("steps", 100)),
        cfg_scale=float(value.params.get("cfgScale", 4)),
        sigma_shift=float(value.params.get("sigmaShift", 5)),
        seed=int(value.params.get("seed", 0)),
        negative_prompt=str(value.params.get("negativePrompt", "")),
    )
    target = Path(value.outputDir) / "sound.wav"
    target.parent.mkdir(parents=True, exist_ok=True)
    wav = audio[0].detach().float().cpu().numpy()
    sf.write(target, wav.T, pipe.sample_rate)
    return {"files": [{"path": str(target), "mimeType": "audio/wav"}]}


@app.get("/health")
def health():
    return {"ok": True}
