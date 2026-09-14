import concurrent.futures
import os
import stat
import sys
import time

import httpx
import pytest

from media_executor import worker_runtime


def worker(tmp_path, monkeypatch):
    folder = tmp_path / "qwen_tts"
    folder.mkdir()
    (folder / ".venv").symlink_to(sys.prefix, target_is_directory=True)
    (folder / "app.py").write_text('''
import time
from fastapi import FastAPI
from pydantic import BaseModel
from media_executor.runtime import Runtime
app = FastAPI()
runtime = Runtime()
runtime.routes(app)
@app.get('/health')
def health():
    return {'ok': True}
class Request(BaseModel):
    outputDir: str
    delay: float = 0
@app.post('/generate')
def generate(value: Request):
    def execute(value):
        time.sleep(value.delay)
        return {'files': [], 'pid': __import__('os').getpid()}
    return runtime.run(value, execute)
''')
    monkeypatch.setattr(worker_runtime, "RUNTIME_ROOT", tmp_path)
    return worker_runtime.WorkerRuntime("qwen", tmp_path / "ipc", lambda: None)


def test_private_socket_lazy_reuse_and_executor_reattachment(tmp_path, monkeypatch):
    runtime = worker(tmp_path, monkeypatch)
    assert runtime.status() == {"pids": [], "busy": False, "loaded": []}
    try:
        runtime.start()
        first = runtime.pid()
        assert first and stat.S_ISSOCK(runtime.socket.stat().st_mode)
        assert stat.S_IMODE(runtime.socket.stat().st_mode) & 0o077 == 0
        runtime.start()
        assert runtime.pid() == first
        attached = worker_runtime.WorkerRuntime("qwen", tmp_path / "ipc", lambda: None)
        attached.start()
        assert attached.pid() == first
        payload = {"outputDir": str(tmp_path / "result")}
        first_result = attached.request("POST", "/generate", json=payload)
        assert first_result == attached.request("POST", "/generate", json=payload)
        attached.stop()
        assert attached.pid() is None
    finally:
        runtime.stop()


def test_cancel_terminates_actual_worker_before_returning(tmp_path, monkeypatch):
    runtime = worker(tmp_path, monkeypatch)
    try:
        runtime.start()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            request = pool.submit(runtime.request, "POST", "/generate", json={"outputDir": str(tmp_path / "slow"), "delay": 30}, timeout=None)
            deadline = time.monotonic() + 5
            while not runtime.status()["busy"] and time.monotonic() < deadline:
                time.sleep(.05)
            assert runtime.status()["busy"] is True
            pid = runtime.pid()
            runtime.stop()
            assert not runtime.pids()
            with pytest.raises(ProcessLookupError):
                os.kill(pid, 0)
            with pytest.raises(httpx.HTTPError):
                request.result(timeout=5)
    finally:
        runtime.stop()


def test_adapter_waits_for_external_engine_health(tmp_path, monkeypatch):
    calls = []
    runtime = worker_runtime.WorkerRuntime("ace", tmp_path, None, [("user", "engine.service")], lambda *args: calls.append("start_engine"))
    monkeypatch.setattr(runtime, "pid", lambda: 123)
    monkeypatch.setattr(worker_runtime.time, "sleep", lambda _: None)
    def request(method, path):
        calls.append(path)
        if path == "/health" and calls.count(path) < 3:
            raise httpx.ConnectError("engine has not bound its socket yet")
        return {"ok": True} if path == "/health" else {"busy": False}
    monkeypatch.setattr(runtime, "request", request)
    assert runtime.start() == {"busy": False}
    assert calls == ["start_engine", "/health", "/health", "/health", "/runtime"]
