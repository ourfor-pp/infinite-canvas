"""Lifecycle and durable synchronous execution shared by native GPU services."""
import gc
import hashlib
import json
import os
import threading
import time
from pathlib import Path

from fastapi import HTTPException


class Runtime:
    def __init__(self):
        self.models = {}
        self.lock = threading.RLock()
        self.active = None
        self.loads = 0
        self.load_seconds = 0
        self.phase = "idle"

    def load(self, name, factory):
        if name not in self.models:
            self.phase = "loading"
            started = time.monotonic()
            self.models[name] = factory()
            self.loads += 1
            self.load_seconds += time.monotonic() - started
        self.phase = "inference"
        return self.models[name]

    def status(self):
        return {"pids": [os.getpid()], "busy": self.active is not None, "jobId": self.active,
                "loaded": list(self.models), "loads": self.loads, "loadSeconds": self.load_seconds, "phase": self.phase}

    def free(self, unload=False):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(409, "runtime is busy")
        try:
            if self.active:
                raise HTTPException(409, "runtime is busy")
            if unload:
                self.models.clear()
            gc.collect()
            import torch
            if torch.cuda.is_initialized():
                torch.cuda.synchronize()
                torch.cuda.empty_cache()
            return self.status()
        finally:
            self.lock.release()

    def routes(self, app, external_gpu=False):
        @app.middleware("http")
        async def loopback(request, call_next):
            if request.client and request.client.host not in ("127.0.0.1", "::1", "testclient"):
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "runtime accepts loopback requests only"}, status_code=403)
            return await call_next(request)

        app.get("/runtime")(self.status)
        def free(unload=False):
            if external_gpu:
                raise HTTPException(501, "external engine requires managed service stop")
            return self.free(unload)
        app.post("/runtime/clear-cache")(lambda: free())
        app.post("/runtime/unload")(lambda: free(unload=True))

    def run(self, value, generate):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(409, "runtime is busy")
        try:
            request = value.model_dump()
            folder = Path(request["outputDir"])
            folder.mkdir(parents=True, exist_ok=True)
            journal = folder / ".runtime-job.json"
            digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
            if journal.exists():
                previous = json.loads(journal.read_text())
                if previous["requestHash"] != digest:
                    raise HTTPException(409, "runtime job request changed")
                if previous["status"] == "succeeded":
                    return previous["result"]
                raise HTTPException(409, {"status": previous["status"], "error": previous.get("error", "Previous execution interrupted; explicit recovery required")})

            def save(status, **fields):
                temporary = journal.with_suffix(".tmp")
                with temporary.open("w") as stream:
                    json.dump({"requestHash": digest, "status": status, **fields}, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                temporary.replace(journal)

            self.active = folder.name
            self.phase = "loading"
            save("running")
            try:
                result = generate(value)
                save("succeeded", result=result)
                return result
            except Exception as error:
                save("failed", error=str(error), errorType=type(error).__name__)
                if isinstance(error, HTTPException):
                    raise
                raise HTTPException(500, {"error": str(error), "errorType": type(error).__name__}) from error
            finally:
                self.active = None
                self.phase = "idle"
        finally:
            self.lock.release()
