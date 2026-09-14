import os
import re
import subprocess
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field
from voxcpm import VoxCPM

from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app)
MODEL_ROOT = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models"))


class Request(BaseModel):
    prompt: str
    operation: str = "generate"
    params: dict = Field(default_factory=dict)
    references: list[dict] = Field(default_factory=list)
    outputDir: str


def synthesize(value):
    params = value.params
    torch.manual_seed(int(params["seed"]))
    torch.cuda.manual_seed_all(int(params["seed"]))
    model = runtime.load("VoxCPM2", lambda: VoxCPM(voxcpm_model_path=str(MODEL_ROOT / "VoxCPM2"), enable_denoiser=False, optimize=False))
    control = re.sub(r"[()（）]", "", str(params.get("instructions", "自然、清晰、有感染力的中文旁白声音"))).strip()
    ultimate = params.get("ultimateClone", False)
    text = value.prompt.strip()
    if control and not ultimate:
        text = f"({control}){text}"
    kwargs = {"text": text, "cfg_value": params.get("cfgValue", 2), "inference_timesteps": params.get("steps", 10),
              "normalize": params.get("normalizeText", True), "denoise": False, "max_len": params.get("maxLength", 4096),
              "retry_badcase": params.get("retryBadcase", True)}
    root = Path(value.outputDir)
    if value.references:
        reference = value.references[0]
        audio = root / "reference.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", reference["path"], "-ac", "1", str(audio)], check=True)
        if params.get("denoiseReference", True):
            from voxcpm.zipenhancer import ZipEnhancer
            denoiser = runtime.load("ZipEnhancer", lambda: ZipEnhancer(str(MODEL_ROOT / "speech_zipenhancer_ans_multiloss_16k_base")))
            enhanced = root / "reference-enhanced.wav"
            denoiser.enhance(str(audio), output_path=str(enhanced))
            audio = enhanced
        kwargs["reference_wav_path"] = str(audio)
        if ultimate:
            transcript = reference.get("transcript") or params.get("referenceTranscript", "")
            if not transcript.strip():
                raise ValueError("ultimate voice cloning requires the reference transcript")
            kwargs.update(prompt_wav_path=str(audio), prompt_text=transcript.strip())
    elif value.operation == "clone" or ultimate:
        raise ValueError("voice cloning requires reference audio")
    runtime.phase = "inference"
    wav = model.generate(**kwargs)
    target = root / "speech.wav"
    sf.write(target, wav, model.tts_model.sample_rate)
    for name in ("reference.wav", "reference-enhanced.wav"):
        (root / name).unlink(missing_ok=True)
    return {"files": [{"path": str(target), "mimeType": "audio/wav"}]}


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, synthesize)


@app.get("/health")
def health():
    return {"ok": True}
