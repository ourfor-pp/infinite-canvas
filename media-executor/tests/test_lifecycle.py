import pytest
import httpx

from media_executor.gpu import GIB, Memory
from media_executor.lifecycle import ManagedRuntime


def test_comfy_free_accepts_empty_success_response(monkeypatch):
    real_client = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    monkeypatch.setattr("media_executor.lifecycle.httpx.Client", lambda **kwargs: real_client(**kwargs, transport=transport))
    runtime = ManagedRuntime("http://localhost", [], None, None)
    assert runtime.request("POST", "/free", json={"free_memory": True}) == {}


def test_unload_verifies_memory_and_keeps_healthy_daemon(monkeypatch):
    allocation = [4 * GIB]
    runtime = ManagedRuntime("http://localhost", [], None, lambda: Memory(32 * GIB, 0, {7: allocation[0]}))
    monkeypatch.setattr(runtime, "status", lambda: {"pids": [7], "busy": False, "loaded": ["model"] if allocation[0] else []})
    monkeypatch.setattr(runtime, "request", lambda *args, **kwargs: allocation.__setitem__(0, 0))
    monkeypatch.setattr(runtime, "stop", lambda: pytest.fail("healthy unload must retain daemon"))
    runtime.unload()
    assert allocation[0] == 0


def test_incomplete_unload_stops_only_managed_idle_service(monkeypatch):
    runtime = ManagedRuntime("http://localhost", [], None, lambda: Memory(32 * GIB, 0, {7: GIB}))
    monkeypatch.setattr(runtime, "status", lambda: {"pids": [7], "busy": False, "loaded": []})
    monkeypatch.setattr(runtime, "request", lambda *args, **kwargs: {})
    times = iter([0, 20])
    monkeypatch.setattr("media_executor.lifecycle.time.monotonic", lambda: next(times))
    stopped = []
    monkeypatch.setattr(runtime, "stop", lambda: stopped.append(True))
    runtime.unload()
    assert stopped == [True]


def test_busy_runtime_and_different_job_cannot_be_stopped(monkeypatch):
    runtime = ManagedRuntime("http://localhost", [], None, None)
    monkeypatch.setattr(runtime, "status", lambda: {"busy": True, "jobId": "other"})
    monkeypatch.setattr(runtime, "stop", lambda: pytest.fail("must protect executing job"))
    with pytest.raises(RuntimeError, match="busy"):
        runtime.unload()
    with pytest.raises(RuntimeError, match="different"):
        runtime.cancel("mine")
