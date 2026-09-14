import os
import importlib.util
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel
from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app)
MODEL_ROOT = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models"))


class Request(BaseModel):
    model: str
    prompt: str
    params: dict = Field(default_factory=dict)
    references: list[dict] = Field(default_factory=list)
    outputDir: str


def load(model: str):
    folder = "Qwen3-TTS-12Hz-1.7B-Base" if "base" in model else "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    attention = "flash_attention_2" if importlib.util.find_spec("flash_attn") else "sdpa"
    return runtime.load(folder, lambda: Qwen3TTSModel.from_pretrained(str(MODEL_ROOT / folder), device_map="cuda:0", dtype=torch.bfloat16, attn_implementation=attention))


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, synthesize)


def synthesize(value: Request):
    torch.manual_seed(int(value.params.get("seed", 0)))
    torch.cuda.manual_seed_all(int(value.params.get("seed", 0)))
    model = load(value.model)
    language = str(value.params.get("language", "Auto"))
    if "base" in value.model:
        if not value.references:
            raise HTTPException(400, "voice clone requires reference audio")
        reference = value.references[0]
        transcript = str(reference.get("transcript") or "").strip()
        wavs, sample_rate = model.generate_voice_clone(text=value.prompt, language=language, ref_audio=reference["path"], **({"ref_text": transcript} if transcript else {"x_vector_only_mode": True}))
    else:
        wavs, sample_rate = model.generate_custom_voice(text=value.prompt, language=language, speaker=str(value.params.get("speaker", "Vivian")), instruct=str(value.params.get("instructions", "")))
    target = Path(value.outputDir) / "speech.wav"
    target.parent.mkdir(parents=True, exist_ok=True)
    sf.write(target, wavs[0], sample_rate)
    return {"files": [{"path": str(target), "mimeType": "audio/wav"}]}


@app.get("/health")
def health():
    return {"ok": True}
