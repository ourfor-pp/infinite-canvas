import base64
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from media_executor import llm
from media_executor.runtime import Runtime

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "models/qwen-llm.json").read_text())
MODEL_ROOT = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models")) / MANIFEST["directory"]
ENGINE = ROOT / "third_party" / ("llama.cpp-" + MANIFEST["engineRevision"][:12]) / "bin/llama-server"


class Engine:
    def __init__(self):
        self.socket = Path(sys.argv[1]).with_suffix(".engine.sock")
        self.socket.unlink(missing_ok=True)
        self.client = httpx.Client(transport=httpx.HTTPTransport(uds=str(self.socket)), timeout=300, trust_env=False)
        command = [str(ENGINE), "-m", str(MODEL_ROOT / "Qwen3.5-4B-Q4_K_M.gguf"),
                   "--mmproj", str(MODEL_ROOT / "mmproj-F16.gguf"), "--host", str(self.socket),
                   "--alias", llm.MODEL, "-ngl", "99", "-c", "8192", "-b", "512", "-ub", "128",
                   "-np", "1", "-fa", "on", "--fit", "off", "--reasoning", "off", "--no-webui", "--image-max-tokens", "1024"]
        # Inherit the worker's process group: cancellation also stops this child.
        with self.socket.with_suffix(".log").open("ab") as log:
            self.process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 180
            while self.process.poll() is None:
                try:
                    if self.client.get("http://llm/health", timeout=1).is_success:
                        return
                except httpx.HTTPError:
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError("LLM startup timed out")
                time.sleep(.2)
            raise RuntimeError("LLM engine exited; inspect worker engine log")
        except Exception:
            self.close()
            raise

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        self.client.close()
        self.socket.unlink(missing_ok=True)


class LlmRuntime(Runtime):
    def free(self, unload=False):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(409, "runtime is busy")
        try:
            if self.active:
                raise HTTPException(409, "runtime is busy")
            if unload:
                for engine in self.models.values():
                    engine.close()
                self.models.clear()
            return self.status()
        finally:
            self.lock.release()


app = FastAPI()
runtime = LlmRuntime()
runtime.routes(app)


class Request(BaseModel):
    model: str
    mode: str = "text"
    operation: str = "generate"
    prompt: str
    params: dict = Field(default_factory=dict)
    references: list[dict] = Field(default_factory=list)
    outputDir: str


def process(value):
    if value.model != llm.MODEL:
        raise ValueError("unknown LLM model")
    llm.validate(value.model_dump())
    content = [{"type": "text", "text": value.prompt}]
    for ref in value.references:
        from PIL import Image, ImageOps
        with Image.open(ref["path"]) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((1024, 1024))
            data = io.BytesIO()
            image.save(data, format="PNG")
        content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(data.getvalue()).decode()}})
    params = value.params
    messages = ([{"role": "system", "content": params["systemPrompt"]}] if params.get("systemPrompt") else [])
    messages.append({"role": "user", "content": content})
    payload = {"model": llm.MODEL, "messages": messages, "temperature": params.get("temperature", .2),
               "max_tokens": params.get("maxTokens", 768), "seed": params.get("seed", 0) % (2**32),
               "chat_template_kwargs": {"enable_thinking": False}}
    if params.get("responseFormat") == "json_object":
        payload["response_format"] = {"type": "json_object"}
    engine = runtime.load(llm.MODEL, Engine)
    try:
        response = engine.client.post("http://llm/v1/chat/completions", json=payload)
    except httpx.TransportError:
        engine.close()
        runtime.models.pop(llm.MODEL, None)
        raise
    if not response.is_success:
        raise RuntimeError(f"LLM rejected input ({response.status_code}): {response.text[:1500]}")
    body = response.json()
    choice = body["choices"][0]
    text = choice["message"]["content"]
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("LLM returned empty text")
    result = {"model": llm.MODEL, "text": text, "finishReason": choice["finish_reason"], "usage": body.get("usage", {})}
    folder = Path(value.outputDir)
    (folder / "response.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    (folder / "response.txt").write_text(text, encoding="utf-8")
    return {**result, "files": [{"path": str(folder / "response.json"), "mimeType": "application/json"},
                               {"path": str(folder / "response.txt"), "mimeType": "text/plain"}]}


@app.post("/generate")
def generate(value: Request):
    return runtime.run(value, process)


@app.get("/health")
def health():
    return {"ok": ENGINE.is_file() and all((MODEL_ROOT / f["name"]).is_file() for f in MANIFEST["files"])}
