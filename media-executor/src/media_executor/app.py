from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

ROOT = Path(os.getenv("MEDIA_EXECUTOR_DATA_DIR", "./data")).resolve()
FILES = ROOT / "files"
RESULTS = ROOT / "results"
DB_PATH = ROOT / "jobs.db"
TOKEN = os.getenv("MEDIA_EXECUTOR_TOKEN", "").strip()
TEMP_FILE_TTL_SECONDS = max(3600, int(os.getenv("MEDIA_EXECUTOR_TEMP_FILE_TTL_SECONDS", "86400")))
COMFY_IDLE_TIMEOUT_SECONDS = max(30, int(os.getenv("MEDIA_EXECUTOR_COMFY_IDLE_TIMEOUT_SECONDS", "3600")))
RUNTIME_URLS = {
    "qwen": os.getenv("QWEN_TTS_URL", "http://127.0.0.1:8301"),
    "moss": os.getenv("MOSS_SFX_URL", "http://127.0.0.1:8302"),
    "ace": os.getenv("ACE_STEP_URL", "http://127.0.0.1:8303"),
    "stable": os.getenv("STABLE_AUDIO_URL", "http://127.0.0.1:8304"),
}
ACE_DRAIN_USER_UNITS = [value for value in os.getenv("MEDIA_EXECUTOR_ACE_DRAIN_USER_UNITS", "").split(",") if value]
ACE_DRAIN_SYSTEM_UNITS = [value for value in os.getenv("MEDIA_EXECUTOR_ACE_DRAIN_SYSTEM_UNITS", "").split(",") if value]
H3_DRAIN_USER_UNITS = [value for value in os.getenv("MEDIA_EXECUTOR_H3_DRAIN_USER_UNITS", os.getenv("MEDIA_EXECUTOR_ACE_DRAIN_USER_UNITS", "")).split(",") if value]
H3_DRAIN_SYSTEM_UNITS = [value for value in os.getenv("MEDIA_EXECUTOR_H3_DRAIN_SYSTEM_UNITS", "").split(",") if value]
ACE_USER_UNITS = ["infinite-ace-step.service", "infinite-ace-step-engine.service"]
SYSTEMCTL = shutil.which("systemctl") or "systemctl"
SUDO = shutil.which("sudo") or "sudo"
GPU_NATIVE_ACTIVE = threading.Event()
H3_ACTIVE = threading.Event()
GPU_STATE_LOCK = threading.Lock()
H3_DRAINED: tuple[list[str], list[str]] | None = None
H3_LAST_SUBMIT_AT = 0.0
COMFY_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8189").rstrip("/")
MODELS = {
    "qwen3-tts-1.7b-customvoice-local": {"engine": "qwen", "modes": ["speech"], "operations": ["generate"], "inputs": ["text"]},
    "qwen3-tts-1.7b-base-local": {"engine": "qwen", "modes": ["speech"], "operations": ["clone"], "inputs": ["text", "audio"], "maxReferenceAudios": 1},
    "moss-soundeffect-v2-local": {"engine": "moss", "modes": ["ambient", "sfx"], "operations": ["generate"], "inputs": ["text"], "maxDurationSeconds": 30},
}
if os.getenv("ACE_STEP_ENABLED") == "1":
    MODELS["ace-step-v15-xl-sft-local"] = {"engine": "ace", "modes": ["music"], "operations": ["generate", "cover", "remix"], "inputs": ["text", "audio"], "maxReferenceAudios": 1}
if os.getenv("STABLE_AUDIO_3_LICENSE_ACCEPTED") == "1":
    MODELS["stable-audio-3-medium-local"] = {"engine": "stable", "modes": ["ambient", "sfx"], "operations": ["generate", "transform", "extend", "inpaint"], "inputs": ["text", "audio"], "maxReferenceAudios": 1}


class Reference(BaseModel):
    fileId: str
    kind: str = "audio"
    transcript: str | None = None


class JobInput(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    model: str
    mode: str
    operation: str = "generate"
    prompt: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    references: list[Reference] = Field(default_factory=list)


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    return db


def init_db() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    FILES.mkdir(exist_ok=True)
    RESULTS.mkdir(exist_ok=True)
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, status TEXT NOT NULL, request TEXT NOT NULL,
          result TEXT, error TEXT, progress REAL NOT NULL DEFAULT 0,
          cancel_requested INTEGER NOT NULL DEFAULT 0,
          created_at REAL NOT NULL, updated_at REAL NOT NULL)""")
        db.execute("UPDATE jobs SET status='queued', progress=0 WHERE status='running'")
        referenced = {
            str(reference.get("fileId", ""))
            for row in db.execute("SELECT request FROM jobs WHERE status IN ('queued','running','succeeded')")
            for reference in json.loads(row["request"]).get("references", [])
        }
    cutoff = time.time() - TEMP_FILE_TTL_SECONDS
    for path in FILES.iterdir():
        if path.is_file() and path.name not in referenced and path.stat().st_mtime < cutoff:
            path.unlink()


def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
    if not TOKEN:
        raise HTTPException(503, "MEDIA_EXECUTOR_TOKEN is not configured")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "invalid executor token")


def row_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "status": row["status"], "progress": row["progress"],
        "result": json.loads(row["result"]) if row["result"] else None, "error": row["error"],
    }


def runtime_for(model: str) -> str:
    definition = MODELS.get(model)
    if not definition:
        raise RuntimeError(f"unsupported executor model: {model}")
    return str(definition["engine"])


def cleanup_job_files(job_id: str, request: dict[str, Any]) -> None:
    for reference in request.get("references", []):
        path = (FILES / str(reference.get("fileId", ""))).resolve()
        if path.is_file() and FILES in path.parents:
            path.unlink()
    shutil.rmtree(RESULTS / job_id, ignore_errors=True)


def service_command(scope: str, action: str, units: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str] | None:
    if not units:
        return None
    prefix = [SYSTEMCTL, "--user"] if scope == "user" else [SUDO, "-n", SYSTEMCTL]
    return subprocess.run([*prefix, action, *units], check=check, capture_output=True, text=True, timeout=90)


def active_units(scope: str, units: list[str]) -> list[str]:
    return [unit for unit in units if service_command(scope, "is-active", [unit], check=False).returncode == 0]


def wait_for_comfy_idle() -> None:
    deadline = time.monotonic() + COMFY_IDLE_TIMEOUT_SECONDS
    while True:
        try:
            queue = httpx.get(f"{COMFY_URL}/queue", timeout=3, trust_env=False).json()
            if not queue.get("queue_running") and not queue.get("queue_pending"):
                return
        except httpx.HTTPError:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("ComfyUI queue did not become idle before timeout")
        time.sleep(1)


def drain_for_ace() -> tuple[list[str], list[str]]:
    active_user = active_units("user", ACE_DRAIN_USER_UNITS)
    active_system = active_units("system", ACE_DRAIN_SYSTEM_UNITS)
    try:
        service_command("user", "stop", active_user)
        service_command("system", "stop", active_system)
    except Exception:
        service_command("system", "start", active_system, check=False)
        service_command("user", "start", active_user, check=False)
        raise
    return active_user, active_system


def restore_after_ace(active_user: list[str], active_system: list[str]) -> None:
    service_command("user", "stop", ACE_USER_UNITS, check=False)
    service_command("system", "start", active_system, check=False)
    service_command("user", "start", active_user, check=False)
    service_command("user", "start", list(reversed(ACE_USER_UNITS)), check=False)


def is_h3_prompt(body: bytes) -> bool:
    try:
        prompt = json.loads(body).get("prompt", {})
    except (AttributeError, json.JSONDecodeError):
        return False
    return any(
        str(node.get("inputs", {}).get("unet_name", "")).startswith("minimax_h3_")
        for node in prompt.values()
        if isinstance(node, dict) and node.get("class_type") == "UNETLoader"
    )


def begin_h3() -> bool:
    global H3_DRAINED, H3_LAST_SUBMIT_AT
    with GPU_STATE_LOCK:
        if GPU_NATIVE_ACTIVE.is_set():
            raise RuntimeError("GPU is running a native media task")
        H3_LAST_SUBMIT_AT = time.monotonic()
        if H3_ACTIVE.is_set():
            return False
        H3_ACTIVE.set()
        try:
            active_user = active_units("user", H3_DRAIN_USER_UNITS)
            active_system = active_units("system", H3_DRAIN_SYSTEM_UNITS)
            service_command("user", "stop", active_user)
            service_command("system", "stop", active_system)
            H3_DRAINED = (active_user, active_system)
            return True
        except Exception:
            H3_ACTIVE.clear()
            service_command("system", "start", locals().get("active_system", []), check=False)
            service_command("user", "start", locals().get("active_user", []), check=False)
            raise


def restore_after_h3_when_idle() -> None:
    global H3_DRAINED
    try:
        wait_for_comfy_idle()
        while time.monotonic() - H3_LAST_SUBMIT_AT < 2:
            time.sleep(.25)
        wait_for_comfy_idle()
    finally:
        with GPU_STATE_LOCK:
            drained = H3_DRAINED
            H3_DRAINED = None
            H3_ACTIVE.clear()
            if drained:
                service_command("system", "start", drained[1], check=False)
                service_command("user", "start", drained[0], check=False)


def run_job(job_id: str, request: dict[str, Any]) -> None:
    engine = runtime_for(request["model"])
    payload = {**request, "outputDir": str((RESULTS / job_id).resolve())}
    for ref in payload.get("references", []):
        path = (FILES / ref["fileId"]).resolve()
        if not path.is_file() or FILES not in path.parents:
            raise RuntimeError("reference file is missing")
        ref["path"] = str(path)
    output_dir = RESULTS / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    while True:
        with GPU_STATE_LOCK:
            if not H3_ACTIVE.is_set():
                GPU_NATIVE_ACTIVE.set()
                break
        time.sleep(.25)
    drained: tuple[list[str], list[str]] | None = None
    try:
        wait_for_comfy_idle()
        drained = drain_for_ace() if engine == "ace" else None
        with httpx.Client(timeout=None) as client:
            response = client.post(f"{RUNTIME_URLS[engine]}/generate", json=payload)
            response.raise_for_status()
            result = response.json()
    finally:
        if drained:
            restore_after_ace(*drained)
        GPU_NATIVE_ACTIVE.clear()
    files = []
    for value in result.get("files", []):
        path = Path(str(value.get("path", ""))).resolve()
        if not path.is_file() or output_dir not in path.parents:
            raise RuntimeError("runtime returned an invalid output path")
        files.append({"name": path.name, "mimeType": value.get("mimeType", "audio/wav")})
    if not files:
        raise RuntimeError("runtime returned no output files")
    with connect() as db:
        db.execute("UPDATE jobs SET status='succeeded', result=?, progress=1, updated_at=? WHERE id=? AND cancel_requested=0", (json.dumps({"files": files}), time.time(), job_id))


def worker() -> None:
    while True:
        with connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE status='queued' AND cancel_requested=0 ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='running', progress=.02, updated_at=? WHERE id=?", (time.time(), row["id"]))
        if not row:
            time.sleep(.25)
            continue
        try:
            run_job(row["id"], json.loads(row["request"]))
        except Exception as exc:
            with connect() as db:
                current = db.execute("SELECT cancel_requested FROM jobs WHERE id=?", (row["id"],)).fetchone()
                status = "canceled" if current and current["cancel_requested"] else "failed"
                db.execute("UPDATE jobs SET status=?, error=?, updated_at=? WHERE id=?", (status, str(exc)[:2000], time.time(), row["id"]))
        with connect() as db:
            current = db.execute("SELECT status FROM jobs WHERE id=?", (row["id"],)).fetchone()
        if current and current["status"] in ("canceled", "failed"):
            cleanup_job_files(row["id"], json.loads(row["request"]))


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if os.getenv("MEDIA_EXECUTOR_DISABLE_WORKER") != "1":
        thread = threading.Thread(target=worker, daemon=True, name="gpu-job-worker")
        thread.start()
    yield


app = FastAPI(title="Infinite Media Executor", lifespan=lifespan)


@app.get("/health")
def health(_: None = Depends(authorize)):
    runtimes = {}
    if os.getenv("MEDIA_EXECUTOR_DISABLE_RUNTIME_HEALTH") != "1":
        with httpx.Client(timeout=httpx.Timeout(.8, connect=.2), trust_env=False) as client:
            for name, url in RUNTIME_URLS.items():
                try:
                    runtimes[name] = client.get(f"{url}/health").is_success
                except httpx.HTTPError:
                    runtimes[name] = False
    comfy_features = {"temporalGuides": False, "turboPreview": False}
    try:
        with httpx.Client(timeout=httpx.Timeout(2, connect=.5), trust_env=False) as client:
            info = client.get(f"{COMFY_URL}/object_info").json()
        comfy_features = {
            "temporalGuides": "MiniMaxH3AddGuide" in info,
            "turboPreview": "MiniMaxH3TurboLoRA" in info and "MiniMaxH3TurboSampler" in info,
        }
    except (httpx.HTTPError, ValueError):
        pass
    return {"ok": True, "models": MODELS, "runtimes": runtimes, "comfyUrl": bool(COMFY_URL), "comfyFeatures": comfy_features}


@app.post("/v1/files")
def upload_file(upload: Annotated[UploadFile, File()], _: None = Depends(authorize)):
    file_id = os.urandom(16).hex()
    target = FILES / file_id
    with target.open("wb") as output:
        shutil.copyfileobj(upload.file, output)
    return {"id": file_id, "name": upload.filename, "mimeType": upload.content_type}


@app.api_route("/v1/comfy/{path:path}", methods=["GET", "POST"])
async def comfy_proxy(path: str, request: Request, _: None = Depends(authorize)):
    if path not in {"prompt", "upload/image", "queue", "interrupt", "system_stats", "object_info", "view"} and not path.startswith("history/"):
        raise HTTPException(404, "unsupported ComfyUI endpoint")
    body = await request.body()
    h3_prompt = path == "prompt" and is_h3_prompt(body)
    h3_owner = False
    if path == "prompt" and GPU_NATIVE_ACTIVE.is_set():
        raise HTTPException(409, "GPU is running a native media task")
    if h3_prompt:
        try:
            h3_owner = await asyncio.to_thread(begin_h3)
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
    headers = {"content-type": value for key, value in request.headers.items() if key.lower() == "content-type"}
    try:
        async with httpx.AsyncClient(timeout=None, trust_env=False) as client:
            upstream = await client.request(request.method, f"{COMFY_URL}/{path}", params=request.query_params, content=body, headers=headers)
    except httpx.HTTPError as exc:
        if h3_owner:
            threading.Thread(target=restore_after_h3_when_idle, daemon=True, name="h3-gpu-restore").start()
        raise HTTPException(502, f"ComfyUI is unavailable: {exc}") from exc
    if h3_owner:
        threading.Thread(target=restore_after_h3_when_idle, daemon=True, name="h3-gpu-restore").start()
    return Response(content=upstream.content, status_code=upstream.status_code, media_type=upstream.headers.get("content-type"))


@app.post("/v1/jobs", status_code=202)
def create_job(value: JobInput, _: None = Depends(authorize)):
    definition = MODELS.get(value.model)
    if not definition or value.mode not in definition["modes"] or value.operation not in definition["operations"]:
        raise HTTPException(400, "model capability mismatch")
    request = value.model_dump()
    now = time.time()
    with connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (value.id,)).fetchone()
        if row:
            if json.loads(row["request"]) != request:
                raise HTTPException(409, "job id already belongs to another request")
            return row_payload(row)
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES(?,'queued',?,?,?)", (value.id, json.dumps(request), now, now))
    return {"id": value.id, "status": "queued", "progress": 0}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str, _: None = Depends(authorize)):
    with connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, "job not found")
    return row_payload(row)


@app.delete("/v1/jobs/{job_id}")
def cancel_job(job_id: str, _: None = Depends(authorize)):
    with connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, "job not found")
        if row["status"] in ("queued", "running"):
            db.execute("UPDATE jobs SET cancel_requested=1,status='canceled',error='canceled',updated_at=? WHERE id=?", (time.time(), job_id))
            if row["status"] == "queued":
                cleanup_job_files(job_id, json.loads(row["request"]))
    return {"id": job_id, "status": "canceled"}


@app.get("/v1/jobs/{job_id}/files/{name}")
def result_file(job_id: str, name: str, _: None = Depends(authorize)):
    path = (RESULTS / job_id / name).resolve()
    if not path.is_file() or (RESULTS / job_id).resolve() not in path.parents:
        raise HTTPException(404, "result file not found")
    return FileResponse(path)


@app.post("/v1/jobs/{job_id}/ack")
def acknowledge(job_id: str, _: None = Depends(authorize)):
    with connect() as db:
        row = db.execute("SELECT request FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row:
        cleanup_job_files(job_id, json.loads(row["request"]))
    return {"id": job_id, "acknowledged": True}


def main() -> None:
    import uvicorn
    uvicorn.run("media_executor.app:app", host=os.getenv("MEDIA_EXECUTOR_HOST", "127.0.0.1"), port=int(os.getenv("MEDIA_EXECUTOR_PORT", "8290")))
