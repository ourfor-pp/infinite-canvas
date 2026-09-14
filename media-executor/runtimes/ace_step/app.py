import os
import json
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from media_executor.runtime import Runtime

app = FastAPI()
runtime = Runtime()
runtime.routes(app, external_gpu=True)
ACE_API = os.getenv("ACE_STEP_INTERNAL_URL", "http://127.0.0.1:8001").rstrip("/")


class Request(BaseModel):
    operation: str = "generate"
    prompt: str
    params: dict = Field(default_factory=dict)
    references: list[dict] = Field(default_factory=list)
    outputDir: str


def build_payload(value: Request):
    is_reference_operation = value.operation in ("cover", "remix")
    lyrics = value.params.get("lyrics", "") or "[Instrumental]"
    payload = {"prompt": value.prompt, "lyrics": lyrics, "audio_duration": value.params.get("seconds", 60), "task_type": "cover" if is_reference_operation else "text2music", "model": "acestep-v15-xl-sft", "inference_steps": int(value.params.get("steps", 50)), "guidance_scale": float(value.params.get("cfgScale", 7)), "shift": float(value.params.get("shift", 1)), "thinking": True, "batch_size": 1, "audio_format": "wav", "lm_model_path": "acestep-5Hz-lm-1.7B", "lm_backend": "pt", "dcw_enabled": False, "audio_cover_strength": float(value.params.get("strength", .65)) if is_reference_operation else 0.0}
    if value.references:
        payload["src_audio_path" if value.operation in ("cover", "remix") else "reference_audio_path"] = value.references[0]["path"]
    return payload


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, synthesize)


def synthesize(value: Request):
    payload = build_payload(value)
    payload["seed"] = int(value.params["seed"])
    runtime.models["ACE-Step-XL-SFT"] = True
    with httpx.Client(timeout=None) as client:
        response = client.post(f"{ACE_API}/release_task", json=payload)
        if response.status_code >= 400:
            raise HTTPException(502, f"ACE-Step runtime failed: {response.text[:500]}")
        task_id = str(response.json().get("data", {}).get("task_id", ""))
        if not task_id:
            raise HTTPException(502, "ACE-Step returned no task id")
        (Path(value.outputDir) / ".ace-task.json").write_text(json.dumps({"taskId": task_id}))
        runtime.phase = "inference"
        for _ in range(3600):
            status = client.post(f"{ACE_API}/query_result", json={"task_id_list": [task_id]})
            status.raise_for_status()
            items = status.json().get("data") or []
            item = items[0] if items else {}
            if int(item.get("status", 0)) == 2:
                raise HTTPException(502, str(item.get("error", "ACE-Step generation failed")))
            if int(item.get("status", 0)) == 1:
                results = json.loads(item.get("result") or "[]")
                if not results:
                    raise HTTPException(502, "ACE-Step returned no audio result")
                audio = client.get(f"{ACE_API}{results[0]['file']}")
                audio.raise_for_status()
                target = Path(value.outputDir) / "music.wav"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(audio.content)
                break
            time.sleep(1)
        else:
            raise HTTPException(504, "ACE-Step generation timed out")
    return {"files": [{"path": str(target), "mimeType": "audio/wav"}]}


@app.get("/health")
def health():
    try:
        response = httpx.get(f"{ACE_API}/health", timeout=2)
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data", payload)
        if data.get("status") != "ok":
            raise HTTPException(503, "ACE-Step engine is not ready")
        return {"ok": True, "modelsInitialized": bool(data.get("models_initialized")), "llmInitialized": bool(data.get("llm_initialized"))}
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, f"ACE-Step engine is unavailable: {exc}") from exc
