from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from .capabilities.catalog import COMFY_MODELS as CAPABILITY_COMFY_MODELS, describe as describe_capabilities, prepare as prepare_model
from . import comfy_jobs, native_jobs
from .gpu import Nvml, Scheduler, PeakMonitor, profile_key
from .lifecycle import ManagedRuntime
from .worker_runtime import WorkerRuntime, RUNTIME_FOLDERS, RUNTIME_ROOT
from . import qwen, indextts

ROOT = Path(os.getenv("MEDIA_EXECUTOR_DATA_DIR", "./data")).resolve()
FILES = ROOT / "files"
RESULTS = ROOT / "results"
DB_PATH = ROOT / "jobs.db"
TOKEN = os.getenv("MEDIA_EXECUTOR_TOKEN", "").strip()
TEMP_FILE_TTL_SECONDS = max(3600, int(os.getenv("MEDIA_EXECUTOR_TEMP_FILE_TTL_SECONDS", "86400")))
COMFY_IDLE_TIMEOUT_SECONDS = max(30, int(os.getenv("MEDIA_EXECUTOR_COMFY_IDLE_TIMEOUT_SECONDS", "3600")))

SYSTEMCTL = shutil.which("systemctl") or "systemctl"
SUDO = shutil.which("sudo") or "sudo"
WORKER_THREAD: threading.Thread | None = None
SCHEDULER = None
COMFY_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8189").rstrip("/")
MODELS = {
    "qwen3-asr-1.7b-local": {"engine": "asr", "output": "text", "modes": ["transcription"], "operations": ["transcribe", "align"], "inputs": ["text", "audio"], "maxReferenceAudios": 1, "default": True},
    "qwen3-asr-0.6b-local": {"engine": "asr", "output": "text", "modes": ["transcription"], "operations": ["transcribe", "align"], "inputs": ["text", "audio"], "maxReferenceAudios": 1},
    "voxcpm2-local": {"engine": "vox", "modes": ["speech"], "operations": ["generate", "clone"], "inputs": ["text", "audio"], "maxReferenceAudios": 1},
    "moss-soundeffect-v2-local": {"engine": "moss", "modes": ["ambient", "sfx"], "operations": ["generate"], "inputs": ["text"], "maxDurationSeconds": 30},
}
MODELS.update({model: qwen.describe(model) for model in qwen.MODELS})
if os.getenv("INDEX_TTS_ENABLED") == "1":
    MODELS[indextts.MODEL] = indextts.describe()
if os.getenv("ACE_STEP_ENABLED") == "1":
    MODELS["ace-step-v15-xl-sft-local"] = {"engine": "ace", "modes": ["music"], "operations": ["generate", "cover", "remix"], "inputs": ["text", "audio"], "maxReferenceAudios": 1}
if os.getenv("STABLE_AUDIO_3_LICENSE_ACCEPTED") == "1":
    MODELS["stable-audio-3-medium-local"] = {"engine": "stable", "modes": ["ambient", "sfx"], "operations": ["generate", "transform", "extend", "inpaint"], "inputs": ["text", "audio"], "maxReferenceAudios": 1}


class Reference(BaseModel):
    fileId: str
    kind: Literal["image", "video", "audio"] = "audio"
    transcript: str | None = None
    role: Literal["reference", "first-frame", "last-frame", "continuation", "emotion"] = "reference"
    frameIndex: int | None = None
    includeAudio: bool = True


class Continuation(BaseModel):
    fileId: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class JobInput(BaseModel):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    model: str
    mode: str
    operation: str = "generate"
    prompt: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    references: list[Reference] = Field(default_factory=list)
    continuation: Continuation | None = None


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
        db.execute("UPDATE jobs SET status='queued' WHERE status='running'")
        db.execute("CREATE TABLE IF NOT EXISTS native_executions (job_id TEXT PRIMARY KEY, submitted INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS gpu_diagnostics (job_id TEXT PRIMARY KEY, detail TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS runtime_catalog (revision TEXT PRIMARY KEY, detail TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS proxy_executions (id TEXT PRIMARY KEY, graph_hash TEXT NOT NULL, prompt_id TEXT, finished INTEGER NOT NULL DEFAULT 0)")
        db.execute("""CREATE TABLE IF NOT EXISTS comfy_executions (
          job_id TEXT PRIMARY KEY, plan TEXT NOT NULL, graph TEXT,
          submitted INTEGER NOT NULL DEFAULT 0, prompt_id TEXT, history TEXT)""")
        referenced = {
            str(reference.get("fileId", ""))
            for row in db.execute("SELECT request FROM jobs WHERE status IN ('queued','running','succeeded')")
            for reference in (json.loads(row["request"]).get("references", []) + ([json.loads(row["request"])["continuation"]] if json.loads(row["request"]).get("continuation") else []))
        }
    cutoff = time.time() - TEMP_FILE_TTL_SECONDS
    for path in FILES.iterdir():
        if path.is_file() and path.name not in referenced and path.stat().st_mtime < cutoff:
            path.unlink()


def authorize(authorization: Annotated[str | None, Header()] = None, x_media_protocol: Annotated[str | None, Header()] = None) -> None:
    if not TOKEN:
        raise HTTPException(503, "MEDIA_EXECUTOR_TOKEN is not configured")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "invalid executor token")
    if x_media_protocol != "2":
        raise HTTPException(426, "media protocol 2 required; update the application and executor together")


def row_payload(row: sqlite3.Row) -> dict[str, Any]:
    with connect() as db:
        diagnostic = db.execute("SELECT detail FROM gpu_diagnostics WHERE job_id=?", (row["id"],)).fetchone()
    return {
        "diagnostics": json.loads(diagnostic[0]) if diagnostic else {"phase": row["status"]},
        "id": row["id"], "status": row["status"], "progress": row["progress"],
        "result": json.loads(row["result"]) if row["result"] else None, "error": row["error"],
    }


def runtime_for(model: str) -> str:
    definition = MODELS.get(model)
    if not definition:
        raise RuntimeError(f"unsupported executor model: {model}")
    return str(definition["engine"])


def cleanup_job_files(job_id: str, request: dict[str, Any]) -> None:
    with connect() as db:
        others = [json.loads(row["request"]) for row in db.execute("SELECT request FROM jobs WHERE id<>? AND status IN ('queued','running')", (job_id,))]
    retained = {ref["fileId"] for other in others for ref in other.get("references", []) + ([other["continuation"]] if other.get("continuation") else [])}
    for reference in request.get("references", []) + ([request["continuation"]] if request.get("continuation") else []):
        path = (FILES / str(reference.get("fileId", ""))).resolve()
        if reference.get("fileId") not in retained and path.is_file() and FILES in path.parents:
            path.unlink()
    shutil.rmtree(RESULTS / job_id, ignore_errors=True)


def service_command(scope: str, action: str, units: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str] | None:
    if not units:
        return None
    prefix = [SYSTEMCTL, "--user"] if scope == "user" else [SUDO, "-n", SYSTEMCTL]
    return subprocess.run([*prefix, action, *units], check=check, capture_output=True, text=True, timeout=90)


def canceled(job_id):
    with connect() as db:
        row = db.execute("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,)).fetchone()
    return bool(row and row[0])


def report(job_id, detail):
    with connect() as db:
        row = db.execute("SELECT detail FROM gpu_diagnostics WHERE job_id=?", (job_id,)).fetchone()
        previous = json.loads(row[0]) if row else {}
        phases = previous.get("phases", [])
        if detail.get("phase") != previous.get("phase"):
            phases.append({"phase": detail.get("phase"), "at": time.time()})
        detail = {**previous, **detail, "phases": phases}
        db.execute("INSERT INTO gpu_diagnostics VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET detail=excluded.detail", (job_id, json.dumps(detail)))


def scheduler():
    global SCHEDULER
    if SCHEDULER is None:
        memory = Nvml().read
        runtimes = {}
        for name in [*RUNTIME_FOLDERS, "comfy"]:
            configured = os.getenv(f"MEDIA_EXECUTOR_{name.upper()}_UNITS", "") if name in ("comfy", "ace") else ""
            units = [tuple(item.split(":", 1)) for item in configured.split(",") if item]
            if any(scope not in ("system", "user") or not unit.endswith(".service") for scope, unit in units):
                raise RuntimeError("invalid managed runtime unit")
            if name == "comfy":
                if units:
                    runtimes[name] = ManagedRuntime(COMFY_URL, units, service_command, memory, "comfy")
            elif (RUNTIME_ROOT / RUNTIME_FOLDERS[name] / ".venv/bin/python").is_file():
                runtimes[name] = WorkerRuntime(name, ROOT / "workers", memory, units, service_command)
        SCHEDULER = Scheduler(connect, memory, runtimes)
    return SCHEDULER


def run_job(job_id: str, request: dict[str, Any]) -> None:
    import sys
    gpu = scheduler()
    target = "comfy" if request["model"] in CAPABILITY_COMFY_MODELS else runtime_for(request["model"])
    if target not in gpu.runtimes:
        raise RuntimeError(f"Runtime {target} has no installed worker or managed engine configured")
    while not gpu.acquire(job_id):
        if canceled(job_id):
            raise RuntimeError("canceled")
        report(job_id, {"phase": "queued", "reason": "gpu_busy"})
        time.sleep(.5)
    try:
        runtime = gpu.runtimes[target]
        runtime.start()
        initial_load_seconds = runtime.status().get("loadSeconds", 0)
        if target == "comfy":
            with connect() as db:
                stored = db.execute("SELECT plan FROM comfy_executions WHERE job_id=?", (job_id,)).fetchone()
            saved_plan = json.loads(stored[0]) if stored else {}
            if saved_plan.get("context"):
                identity_key = "h3PddRuntime" if saved_plan.get("recipe") == "pdd-ref8" else "h3Runtime"
                deadline = time.monotonic() + 180
                while not health().get(identity_key):
                    if canceled(job_id):
                        raise RuntimeError("canceled")
                    if time.monotonic() >= deadline:
                        raise RuntimeError("H3 runtime identity did not become ready")
                    report(job_id, {"phase": "loading", "reason": "runtime_fingerprint"})
                    time.sleep(.5)
        plan = prepare_capability(request)
        request = {**request, "params": {**request.get("params", {}), "seed": plan["seed"]}}
        shape = {**request, "references": []}
        for ref in request.get("references", []):
            path = FILES / ref["fileId"]
            import hashlib
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            shape["references"].append({**ref, "sha256": digest})
        runtime_revision = os.getenv(f"MEDIA_EXECUTOR_{target.upper()}_REVISION")
        profile_plan = {k: v for k, v in plan.items() if k not in ("seed", "context", "previous")}
        revision = {"plan": profile_plan, "runtimeRevision": runtime_revision or job_id}
        key = profile_key(shape, revision)
        with connect() as db:
            upstream = db.execute("SELECT submitted FROM comfy_executions WHERE job_id=?", (job_id,)).fetchone() if target == "comfy" else db.execute("SELECT submitted FROM native_executions WHERE job_id=?", (job_id,)).fetchone()
        recovering = bool(upstream and upstream[0])
        for attempt in range(2):
            if not recovering:
                gpu.prepare(job_id, target, key, lambda: canceled(job_id), lambda detail: report(job_id, detail), force=attempt == 1)
            try:
                with PeakMonitor(gpu.memory, runtime.pids) as monitor:
                    report(job_id, {"phase": "inference", "attempt": attempt + 1})
                    if target == "comfy":
                        comfy_jobs.run(sys.modules[__name__], job_id, request)
                    else:
                        native_jobs.run(sys.modules[__name__], job_id, request, runtime)
                state = runtime.status()
                memory = gpu.memory()
                resident = sum(memory.processes.get(pid, 0) for pid in state["pids"])
                load_seconds = state.get("loadSeconds", 0) - initial_load_seconds
                if monitor.error is None and runtime_revision:
                    gpu.record(target, key, monitor.peak, resident, load_seconds)
                report(job_id, {"phase": "completed", "peakBytes": monitor.peak, "residentBytes": resident, "loadSeconds": load_seconds, "runtime": state, "attempt": attempt + 1})
                with connect() as db:
                    db.execute("UPDATE jobs SET status=CASE WHEN cancel_requested=1 THEN 'canceled' ELSE 'succeeded' END,updated_at=? WHERE id=?", (time.time(), job_id))
                if canceled(job_id):
                    cleanup_job_files(job_id, request)

                return
            except Exception as error:
                report(job_id, {"phase": "failed", "error": str(error), "attempt": attempt + 1})
                if attempt or canceled(job_id) or not ("cuda out of memory" in str(error).lower() or "torch.cuda.OutOfMemoryError" in str(error)):
                    raise
                if runtime.status().get("busy"):
                    raise
                shutil.rmtree(RESULTS / job_id, ignore_errors=True)
                with connect() as db:
                    db.execute("UPDATE comfy_executions SET submitted=0,prompt_id=NULL,history=NULL WHERE job_id=?", (job_id,))
                    db.execute("UPDATE native_executions SET submitted=0 WHERE job_id=?", (job_id,))
                runtime.clear_cache()
                recovering = False
    finally:
        while True:
            try:
                if not gpu.runtimes[target].status().get("busy"):
                    break
            except httpx.HTTPError:
                pass
            time.sleep(1)
        gpu.release(job_id)


def worker() -> None:
    while True:
        try:
            with connect() as db:
                row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY CASE WHEN id IN (SELECT job_id FROM comfy_executions WHERE submitted=1) OR id IN (SELECT job_id FROM native_executions WHERE submitted=1) THEN 0 ELSE 1 END, created_at LIMIT 1").fetchone()
                if row:
                    db.execute("UPDATE jobs SET status='running', progress=.02, updated_at=? WHERE id=?", (time.time(), row["id"]))
        except sqlite3.OperationalError:
            logging.exception("Cannot read media job queue; retrying")
            time.sleep(1)
            continue
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
    global WORKER_THREAD
    init_db()
    if os.getenv("MEDIA_EXECUTOR_DISABLE_WORKER") != "1":
        with connect() as db:
            pending = db.execute("SELECT * FROM proxy_executions WHERE finished=0").fetchall()
        if len(pending) > 1:
            raise RuntimeError("conflicting persisted proxy leases")
        for proxy in pending:
            scheduler().acquire(proxy["id"])
            threading.Thread(target=observe_proxy, args=(proxy["id"], proxy["prompt_id"]), daemon=True).start()
        WORKER_THREAD = threading.Thread(target=worker, daemon=True, name="gpu-job-worker")
        WORKER_THREAD.start()
    yield


app = FastAPI(title="Infinite Media Executor", lifespan=lifespan)


@app.get("/health")
def health(_: None = Depends(authorize)):
    if os.getenv("MEDIA_EXECUTOR_DISABLE_WORKER") != "1" and (WORKER_THREAD is None or not WORKER_THREAD.is_alive()):
        raise HTTPException(503, "Media job worker is not running")
    try:
        with connect() as db:
            db.execute("SELECT 1 FROM jobs LIMIT 1").fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(503, "Media job queue is unavailable") from exc
    runtimes = {}
    if os.getenv("MEDIA_EXECUTOR_DISABLE_RUNTIME_HEALTH") != "1":
        for name in RUNTIME_FOLDERS:
            runtime = WorkerRuntime(name, ROOT / "workers", None)
            try:
                runtimes[name] = bool(runtime.pid()) and runtime.request("GET", "/health", timeout=.8).get("ok", False)
            except httpx.HTTPError:
                runtimes[name] = False
    comfy_features = {"temporalGuides": False, "turboPreview": False, "pddRef8": False, "music3": False}
    h3_runtime = None
    h3_pdd_runtime = None
    info = {}
    try:
        with httpx.Client(timeout=httpx.Timeout(2, connect=.5), trust_env=False) as client:
            info = client.get(f"{COMFY_URL}/object_info").json()
        comfy_features = {
            "temporalGuides": "MiniMaxH3AddGuide" in info,
            "turboPreview": "MiniMaxH3TurboLoRA" in info and "MiniMaxH3TurboSampler" in info,
            "pddRef8": "MiniMax-H3-Ref2VA-Acc-8Step.safetensors" in info.get("MiniMaxH3PDDAccApply", {}).get("input", {}).get("required", {}).get("pdd_file", [[]])[0],
        }
        music_models = (("UNETLoader", "unet_name", "minimax_music3_dit_fp16.safetensors"), ("CLIPLoader", "clip_name", "minimax_music3_text_encoder_pruned_int8_convrot.safetensors"), ("VAELoader", "vae_name", "minimax_music3_dav.safetensors"))
        comfy_features["music3"] = {"MiniMaxMusic3TextEncode", "EmptyMiniMaxMusic3LatentAudio", "ConditioningZeroOut", "KSampler", "VAEDecodeAudio", "SaveAudio"}.issubset(info) and all(name in info.get(loader, {}).get("input", {}).get("required", {}).get(field, [[]])[0] for loader, field, name in music_models)
        required = {"H3SaveContinuationState", "H3LoadContinuationState", "H3NewAVSegment", "MiniMaxH3GuidedContinuationWindow", "MiniMaxH3LatentTailGuide", "MiniMaxH3AppendContinuation"}
        comfy_features["nativeState"] = required.issubset(info)
        if comfy_features["nativeState"]:
            with httpx.Client(timeout=httpx.Timeout(2, connect=.5), trust_env=False) as client:
                response = client.get(f"{COMFY_URL}/h3/runtime")
            identity = response.json() if response.status_code == 200 else {}
            if identity.get("ready") is True:
                h3_runtime = identity

        if comfy_features.get("nativeState") and comfy_features["pddRef8"]:
            with httpx.Client(timeout=httpx.Timeout(2, connect=.5), trust_env=False) as client:
                response = client.get(f"{COMFY_URL}/h3/runtime?recipe=pdd-ref8")
            identity = response.json() if response.status_code == 200 else {}
            if identity.get("ready") is True and ":pdd-ref8:" in identity.get("modelRevision", ""):
                h3_pdd_runtime = identity

    except (httpx.HTTPError, ValueError):
        pass
    for mode in ("ref2va", "fl2va"):
        needed = {"UNETLoader", "CLIPLoader", "VAELoader", "BasicGuider", "KSamplerSelect", "BasicScheduler", "RandomNoise", "SamplerCustomAdvanced", "VAEDecode", "VAEDecodeAudio", "CreateVideo", "SaveVideo", "PathchSageAttentionKJ", "MiniMaxH3ReferenceToVideo" if mode == "ref2va" else "MiniMaxH3ImageToVideo"}
        weights = [("UNETLoader", "unet_name", f"minimax_h3_{mode}_pruned_int8_convrot.safetensors"), ("CLIPLoader", "clip_name", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"), ("VAELoader", "vae_name", "minimax_h3_video_vae_fp16.safetensors"), ("VAELoader", "vae_name", "minimax_h3_audio_vae_fp32.safetensors")]
        comfy_features["h3Ref2va" if mode == "ref2va" else "h3Fl2va"] = needed.issubset(info) and all(name in info.get(loader, {}).get("input", {}).get("required", {}).get(field, [[]])[0] for loader, field, name in weights)
    revision = os.getenv("MEDIA_EXECUTOR_COMFY_REVISION")
    if revision:
        with connect() as db:
            if info and (not comfy_features.get("nativeState") or h3_runtime and (not comfy_features.get("pddRef8") or h3_pdd_runtime)):
                db.execute("INSERT INTO runtime_catalog VALUES(?,?) ON CONFLICT(revision) DO UPDATE SET detail=excluded.detail", (revision, json.dumps({"features": comfy_features, "h3": h3_runtime, "pdd": h3_pdd_runtime})))
            elif not info and os.getenv("MEDIA_EXECUTOR_COMFY_UNITS"):
                cached = db.execute("SELECT detail FROM runtime_catalog WHERE revision=?", (revision,)).fetchone()
                if cached:
                    saved = json.loads(cached[0])
                    comfy_features, h3_runtime, h3_pdd_runtime = saved["features"], saved["h3"], saved["pdd"]
    configured = {name: bool((RUNTIME_ROOT / folder / ".venv/bin/python").is_file() and os.getenv(f"MEDIA_EXECUTOR_{name.upper()}_REVISION")) for name, folder in RUNTIME_FOLDERS.items()}
    return {"ok": True, "protocolVersion": "2", "models": MODELS, "runtimes": runtimes, "configuredRuntimes": configured, "modelReadiness": qwen.readiness(ROOT, Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models")), RUNTIME_ROOT), "maintenance": (ROOT / "maintenance").exists(), "comfyUrl": bool(COMFY_URL), "comfyFeatures": comfy_features, "h3Runtime": h3_runtime, "h3PddRuntime": h3_pdd_runtime}


def prepare_capability(request):
    try:
        return prepare_model(request, health(), FILES)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/v1/capabilities")
def capabilities(_: None = Depends(authorize)):
    return describe_capabilities(health())


@app.post("/v1/jobs/validate")
def validate_job(value: JobInput, _: None = Depends(authorize)):
    return {"valid": True, "plan": prepare_capability(value.model_dump())}


@app.post("/v1/files")
def upload_file(upload: Annotated[UploadFile, File()], _: None = Depends(authorize)):
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".safetensors"}: suffix = ""
    file_id = os.urandom(16).hex() + suffix
    target = FILES / file_id
    with target.open("wb") as output:
        shutil.copyfileobj(upload.file, output)
    return {"id": file_id, "name": upload.filename, "mimeType": upload.content_type}


def observe_proxy(owner, prompt_id=None):
    gpu = scheduler()
    with httpx.Client(base_url=COMFY_URL, timeout=30, trust_env=False) as client:
        while True:
            try:
                if not prompt_id:
                    prompt_id = comfy_jobs._recover_submission(client, owner)
                    with connect() as db:
                        db.execute("UPDATE proxy_executions SET prompt_id=? WHERE id=?", (prompt_id, owner))
                queue = comfy_jobs._observe_json(client, "/queue")
                if not any(p[1] == prompt_id for p in queue.get("queue_running", []) + queue.get("queue_pending", [])):
                    break
            except (httpx.HTTPError, RuntimeError):
                logging.exception("Cannot yet reconcile Comfy proxy submission %s", owner)
            time.sleep(2)
    with connect() as db:
        db.execute("UPDATE proxy_executions SET finished=1 WHERE id=?", (owner,))
    gpu.release(owner)


@app.api_route("/v1/comfy/{path:path}", methods=["GET", "POST"])
async def comfy_proxy(path: str, request: Request, _: None = Depends(authorize)):
    if path not in {"prompt", "upload/image", "queue", "interrupt", "system_stats", "object_info", "view"} and not path.startswith("history/"):
        raise HTTPException(404, "unsupported ComfyUI endpoint")
    body = await request.body()
    owner = None
    if path == "prompt" and request.method == "POST":
        graph = json.loads(body)
        client_id = graph.get("client_id")
        if not isinstance(client_id, str) or not client_id:
            raise HTTPException(400, "proxy submission requires a stable client_id")
        owner = "proxy-" + hashlib.sha256(client_id.encode()).hexdigest()
        digest = hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest()
        with connect() as db:
            previous = db.execute("SELECT * FROM proxy_executions WHERE id=?", (owner,)).fetchone()
        if previous:
            if previous["graph_hash"] != digest:
                raise HTTPException(409, "proxy client_id already belongs to a different graph")
            if previous["prompt_id"]:
                return Response(content=json.dumps({"prompt_id": previous["prompt_id"]}), media_type="application/json")
            raise HTTPException(409, "proxy submission is being reconciled", headers={"Retry-After": "2"})
        require_accepting_jobs()
        gpu = scheduler()
        if not gpu.acquire(owner):
            raise HTTPException(409, "GPU busy; keep the application task queued", headers={"Retry-After": "2"})
        try:
            graph["client_id"] = owner
            body = json.dumps(graph).encode()
            await asyncio.to_thread(gpu.runtimes["comfy"].start)
            # Arbitrary legacy graphs are uncalibrated and use conservative admission.
            await asyncio.to_thread(gpu.prepare, owner, "comfy", owner)
            with connect() as db:
                db.execute("INSERT INTO proxy_executions(id,graph_hash) VALUES(?,?)", (owner, digest))
        except Exception:
            gpu.release(owner)
            raise
    headers = {"content-type": value for key, value in request.headers.items() if key.lower() == "content-type"}
    if path in ("interrupt", "queue") and request.method == "POST":
        with connect() as db:
            active = db.execute("SELECT prompt_id FROM proxy_executions WHERE id=? AND finished=0", (scheduler().owner,)).fetchone()
        value = json.loads(body or b"{}")
        requested = [value.get("prompt_id")] if path == "interrupt" else value.get("delete", [])
        if not active or not active[0] or not requested or any(prompt != active[0] for prompt in requested):
            raise HTTPException(409, "only the active proxy prompt may be canceled")
    try:
        async with httpx.AsyncClient(timeout=None, trust_env=False) as client:
            upstream = await client.request(request.method, f"{COMFY_URL}/{path}", params=request.query_params, content=body, headers=headers)
    except httpx.HTTPError as exc:
        if owner:
            threading.Thread(target=observe_proxy, args=(owner,), daemon=True).start()
        raise HTTPException(502, f"ComfyUI is unavailable: {exc}") from exc
    if owner:
        if upstream.is_success and upstream.json().get("prompt_id"):
            prompt_id = upstream.json()["prompt_id"]
            with connect() as db:
                db.execute("UPDATE proxy_executions SET prompt_id=? WHERE id=?", (prompt_id, owner))
            threading.Thread(target=observe_proxy, args=(owner, prompt_id), daemon=True).start()
        elif 400 <= upstream.status_code < 500:
            with connect() as db:
                db.execute("UPDATE proxy_executions SET finished=1 WHERE id=?", (owner,))
            scheduler().release(owner)
        else:
            threading.Thread(target=observe_proxy, args=(owner,), daemon=True).start()
    return Response(content=upstream.content, status_code=upstream.status_code, media_type=upstream.headers.get("content-type"))


def require_accepting_jobs():
    if (ROOT / "maintenance").exists():
        raise HTTPException(503, "Media executor is under maintenance; retry after maintenance", headers={"Retry-After": "30"})


@app.post("/v1/jobs", status_code=202)
def create_job(value: JobInput, _: None = Depends(authorize)):
    request = value.model_dump()
    now = time.time()
    with connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (value.id,)).fetchone()
        if row:
            if json.loads(row["request"]) != request:
                raise HTTPException(409, "job id already belongs to another request")
            return row_payload(row)
    require_accepting_jobs()
    plan = prepare_capability(request)
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE id=?", (value.id,)).fetchone()
        if row:
            if json.loads(row["request"]) != request:
                raise HTTPException(409, "job id already belongs to another request")
            return row_payload(row)
        require_accepting_jobs()
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES(?,'queued',?,?,?)", (value.id, json.dumps(request), now, now))
        if value.model in CAPABILITY_COMFY_MODELS:
            db.execute("INSERT INTO comfy_executions(job_id,plan) VALUES(?,?)", (value.id, json.dumps(plan)))
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
            submitted = db.execute("SELECT 1 FROM comfy_executions WHERE job_id=? AND submitted=1 UNION SELECT 1 FROM native_executions WHERE job_id=? AND submitted=1", (job_id, job_id)).fetchone()
            immediate = row["status"] == "queued" and not submitted
            db.execute("UPDATE jobs SET cancel_requested=1,status=?,updated_at=? WHERE id=?", ("canceled" if immediate else row["status"], time.time(), job_id))
            if immediate:
                cleanup_job_files(job_id, json.loads(row["request"]))
    return get_job(job_id)


@app.get("/v1/jobs/{job_id}/files/{name}")
def result_file(job_id: str, name: str, _: None = Depends(authorize)):
    with connect() as db:
        row = db.execute("SELECT status,result FROM jobs WHERE id=?", (job_id,)).fetchone()
    result = json.loads(row["result"] or "{}") if row else {}
    names = {file["name"] for key in ("files", "continuationStates", "cumulativeVideos") for file in result.get(key, [])}
    if not row or row["status"] != "succeeded" or name not in names:
        raise HTTPException(404, "result file not found")
    path = (RESULTS / job_id / name).resolve()
    if not path.is_file() or (RESULTS / job_id).resolve() not in path.parents:
        raise HTTPException(404, "result file not found")
    return FileResponse(path)


@app.post("/v1/jobs/{job_id}/ack")
def acknowledge(job_id: str, _: None = Depends(authorize)):
    with connect() as db:
        row = db.execute("SELECT request,status FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row and row["status"] not in ("succeeded", "failed", "canceled"):
        raise HTTPException(409, "cannot acknowledge an unfinished job")
    if row:
        cleanup_job_files(job_id, json.loads(row["request"]))
    return {"id": job_id, "acknowledged": True}


def main() -> None:
    import uvicorn
    uvicorn.run("media_executor.app:app", host=os.getenv("MEDIA_EXECUTOR_HOST", "127.0.0.1"), port=int(os.getenv("MEDIA_EXECUTOR_PORT", "8290")))
