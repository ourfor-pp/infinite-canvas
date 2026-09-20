import os
import random
import subprocess
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import numpy as np
import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field
from indextts.infer_v2_5 import IndexTTS2

from media_executor import indextts
from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app)
MODEL_ROOT = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models")) / "IndexTTS-2.5"


class Request(BaseModel):
    prompt: str
    params: dict = Field(default_factory=dict)
    references: list[dict] = Field(default_factory=list)
    outputDir: str


def synthesize(value):
    params = value.params
    indextts.validate(value.prompt, params, value.references)
    root = Path(value.outputDir)
    inputs = {}
    for ref in value.references:
        indextts.validate_audio(ref["path"])
        role = ref.get("role", "reference")
        audio = root / f"input-{role}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", ref["path"], "-map", "0:a:0", "-ac", "1", "-ar", "24000", str(audio)], check=True)
        inputs[role] = str(audio)
    # Prevent the upstream loader from attempting implicit auxiliary downloads.
    for name in ("config.yaml", "hf_cache/w2v-bert-2.0/model.safetensors", "hf_cache/bigvgan/bigvgan_generator.pt", "hf_cache/campplus_cn_common.bin"):
        if not (MODEL_ROOT / name).is_file():
            raise ValueError(f"IndexTTS model installation incomplete: {name}")
    torch.set_num_threads(8)
    torch.backends.cuda.enable_cudnn_sdp(False)
    model = runtime.load("IndexTTS-2.5", lambda: IndexTTS2(cfg_path=str(MODEL_ROOT / "config.yaml"), model_dir=str(MODEL_ROOT), use_bf16=True, use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False))
    seed = params["seed"]
    random.seed(seed)
    np.random.seed(seed % 2**32)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    target = root / "speech.wav"
    model.infer(spk_audio_prompt=inputs["reference"], text=value.prompt, output_path=str(target), lang=params.get("language", "ZH"),
                duration_factor=params.get("durationFactor", 1), interval_silence=params.get("intervalSilence", 200),
                emo_audio_prompt=inputs.get("emotion"), emo_vector=params.get("emotionVector"), emo_alpha=params.get("emotionStrength", 1),
                use_emo_text=False, use_random=False)
    for audio in inputs.values():
        Path(audio).unlink(missing_ok=True)
    return {"files": [{"path": str(target), "mimeType": "audio/wav"}]}


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, synthesize)


@app.get("/health")
def health():
    return {"ok": True}
