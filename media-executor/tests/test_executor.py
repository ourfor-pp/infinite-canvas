import importlib
import json

from fastapi.testclient import TestClient
import httpx


def test_auth_and_idempotency(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_RUNTIME_HEALTH", "1")
    import media_executor.app as module
    module = importlib.reload(module)
    with TestClient(module.app) as client:
        assert client.get("/health").status_code == 401
        headers = {"Authorization": "Bearer secret", "X-Media-Protocol": "2"}
        assert client.get("/health", headers={"Authorization": "Bearer secret"}).status_code == 426
        assert client.get("/health", headers={**headers, "X-Media-Protocol": "1"}).status_code == 426
        assert client.get("/health", headers=headers).status_code == 200
        monkeypatch.setattr(module, "health", lambda: {"models": module.MODELS, "runtimes": {"qwen": True}})
        job = {"id": "one", "model": "qwen3-tts-1.7b-customvoice-local", "mode": "speech", "operation": "generate", "prompt": "你好"}
        assert client.post("/v1/jobs", json=job, headers=headers).status_code == 202
        assert client.post("/v1/jobs", json=job, headers=headers).status_code == 202
        assert client.post("/v1/jobs", json={**job, "prompt": "不同"}, headers=headers).status_code == 409


def test_comfy_proxy_requires_auth_and_forwards(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    import media_executor.app as module
    module = importlib.reload(module)

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return None
        async def request(self, method, url, **kwargs):
            assert method == "POST" and url.endswith("/prompt")
            assert json.loads(kwargs["content"])["prompt"] == {"1": {}}
            return httpx.Response(200, json={"prompt_id": "proxied"})

    class GPU:
        owner = None
        runtimes = {"comfy": type("Runtime", (), {"start": lambda self: None})()}
        def acquire(self, owner):
            if self.owner: return False
            self.owner = owner
            return True
        def prepare(self, *args): pass
        def release(self, owner):
            assert self.owner == owner
            self.owner = None
    gpu = GPU()
    monkeypatch.setattr(module, "scheduler", lambda: gpu)
    monkeypatch.setattr(module, "observe_proxy", lambda *args: None)
    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **_: FakeClient())
    with TestClient(module.app) as client:
        assert client.post("/v1/comfy/prompt", json={}).status_code == 401
        response = client.post("/v1/comfy/prompt", json={"prompt": {"1": {}}, "client_id": "test-one"}, headers={"Authorization": "Bearer secret", "X-Media-Protocol": "2"})
        assert response.status_code == 200
        assert response.json() == {"prompt_id": "proxied"}
        assert gpu.owner.startswith("proxy-")
        duplicate = client.post("/v1/comfy/prompt", json={"prompt": {"1": {}}, "client_id": "test-one"}, headers={"Authorization": "Bearer secret", "X-Media-Protocol": "2"})
        assert duplicate.status_code == 200 and duplicate.json() == {"prompt_id": "proxied"}
        assert client.post("/v1/comfy/prompt", json={"prompt": {"2": {}}, "client_id": "test-one"}, headers={"Authorization": "Bearer secret", "X-Media-Protocol": "2"}).status_code == 409
        assert client.post("/v1/comfy/prompt", json={"prompt": {}, "client_id": "test-two"}, headers={"Authorization": "Bearer secret", "X-Media-Protocol": "2"}).status_code == 409
        gpu.owner = None


def test_worker_recovers_queue_read_error_without_resubmitting(tmp_path, monkeypatch):
    import sqlite3
    import pytest
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    import media_executor.app as module
    module = importlib.reload(module)
    module.init_db()
    connect = module.connect
    with connect() as db:
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES(?,?,?,?,?)", ("persisted", "queued", "{}", 1, 1))
    calls = 0
    generated = []

    def intermittent_connect():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise sqlite3.OperationalError("unable to open database file")
        return connect()

    class StopWorker(BaseException):
        pass

    def sleep(seconds):
        if seconds == .25:
            raise StopWorker()

    def generate(job_id, request):
        generated.append(job_id)
        with connect() as db:
            db.execute("UPDATE jobs SET status='succeeded' WHERE id=?", (job_id,))

    monkeypatch.setattr(module, "connect", intermittent_connect)
    monkeypatch.setattr(module, "run_job", generate)
    monkeypatch.setattr(module.time, "sleep", sleep)
    with pytest.raises(StopWorker):
        module.worker()
    assert generated == ["persisted"]
    with connect() as db:
        assert db.execute("SELECT status FROM jobs WHERE id='persisted'").fetchone()[0] == "succeeded"


def test_health_rejects_dead_enabled_worker(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    import media_executor.app as module
    module = importlib.reload(module)
    with TestClient(module.app) as client:
        monkeypatch.delenv("MEDIA_EXECUTOR_DISABLE_WORKER")
        response = client.get("/health", headers={"Authorization": "Bearer secret", "X-Media-Protocol": "2"})
        assert response.status_code == 503
        assert response.json()["detail"] == "Media job worker is not running"


def test_health_rejects_unavailable_queue(tmp_path, monkeypatch):
    import sqlite3
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    import media_executor.app as module
    module = importlib.reload(module)
    with TestClient(module.app) as client:
        def unavailable():
            raise sqlite3.OperationalError("unable to open database file")
        monkeypatch.setattr(module, "connect", unavailable)
        response = client.get("/health", headers={"Authorization": "Bearer secret", "X-Media-Protocol": "2"})
        assert response.status_code == 503
        assert response.json()["detail"] == "Media job queue is unavailable"


def test_h3_identity_requires_all_nodes_and_ready_fingerprint(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_RUNTIME_HEALTH", "1")
    import media_executor.app as module
    module = importlib.reload(module)
    module.init_db()
    info = {name: {} for name in ["H3SaveContinuationState", "H3LoadContinuationState", "H3NewAVSegment", "MiniMaxH3GuidedContinuationWindow", "MiniMaxH3LatentTailGuide", "MiniMaxH3AppendContinuation"]}
    identity = {"ready": False}
    class FakeClient:
        def __enter__(self): return self
        def __exit__(self, *_): return None
        def get(self, url):
            return httpx.Response(200, json=info if url.endswith('/object_info') else identity)
    monkeypatch.setattr(module.httpx, "Client", lambda **_: FakeClient())
    assert module.health()["h3Runtime"] is None
    assert module.health()["comfyFeatures"]["nativeState"] is True
    identity.update(ready=True, modelRevision="verified-model")
    assert module.health()["h3Runtime"] == identity
    del info["H3NewAVSegment"]
    assert module.health()["h3Runtime"] is None
    assert module.health()["comfyFeatures"]["pddRef8"] is False
    info["MiniMaxH3PDDAccApply"] = {"input": {"required": {"pdd_file": [[], {}]}}}
    assert module.health()["comfyFeatures"]["pddRef8"] is False
    info["MiniMaxH3PDDAccApply"]["input"]["required"]["pdd_file"][0].append("MiniMax-H3-Ref2VA-Acc-8Step.safetensors")
    assert module.health()["comfyFeatures"]["pddRef8"] is True
    info["H3NewAVSegment"] = {}
    assert module.health()["h3PddRuntime"] is None
    identity["modelRevision"] = "base:pdd-ref8:digest"
    assert module.health()["h3PddRuntime"] == identity
    identity["ready"] = False
    assert module.health()["h3PddRuntime"] is None


def test_music3_requires_nodes_and_all_weights(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_RUNTIME_HEALTH", "1")
    import media_executor.app as module
    module = importlib.reload(module)
    module.init_db()
    info = {name: {} for name in ("MiniMaxMusic3TextEncode", "EmptyMiniMaxMusic3LatentAudio", "ConditioningZeroOut", "KSampler", "VAEDecodeAudio", "SaveAudio")}
    class FakeClient:
        def __enter__(self): return self
        def __exit__(self, *_): return None
        def get(self, _): return httpx.Response(200, json=info)
    monkeypatch.setattr(module.httpx, "Client", lambda **_: FakeClient())
    assert module.health()["comfyFeatures"]["music3"] is False
    for loader, field, name in (("UNETLoader", "unet_name", "minimax_music3_dit_fp16.safetensors"), ("CLIPLoader", "clip_name", "minimax_music3_text_encoder_pruned_int8_convrot.safetensors"), ("VAELoader", "vae_name", "minimax_music3_dav.safetensors")):
        assert module.health()["comfyFeatures"]["music3"] is False
        info[loader] = {"input": {"required": {field: [[name]]}}}
    assert module.health()["comfyFeatures"]["music3"] is True
    del info["MiniMaxMusic3TextEncode"]
    assert module.health()["comfyFeatures"]["music3"] is False
