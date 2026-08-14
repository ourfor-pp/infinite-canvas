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
        headers = {"Authorization": "Bearer secret"}
        assert client.get("/health", headers=headers).status_code == 200
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

    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **_: FakeClient())
    with TestClient(module.app) as client:
        assert client.post("/v1/comfy/prompt", json={}).status_code == 401
        response = client.post("/v1/comfy/prompt", json={"prompt": {"1": {}}}, headers={"Authorization": "Bearer secret"})
        assert response.status_code == 200
        assert response.json() == {"prompt_id": "proxied"}
        module.GPU_NATIVE_ACTIVE.set()
        assert client.post("/v1/comfy/prompt", json={"prompt": {}}, headers={"Authorization": "Bearer secret"}).status_code == 409
        module.GPU_NATIVE_ACTIVE.clear()


def test_ace_runtime_drains_and_restores_gpu_services(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    monkeypatch.setenv("ACE_STEP_ENABLED", "1")
    monkeypatch.setenv("MEDIA_EXECUTOR_ACE_DRAIN_USER_UNITS", "comfy-user.service,qwen.service")
    monkeypatch.setenv("MEDIA_EXECUTOR_ACE_DRAIN_SYSTEM_UNITS", "comfy.service")
    import media_executor.app as module
    module = importlib.reload(module)
    commands = []

    def command(scope, action, units, *, check=True):
        commands.append((scope, action, units))
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(module, "service_command", command)
    monkeypatch.setattr(module.httpx, "get", lambda *_args, **_kwargs: httpx.Response(200, json={"queue_running": [], "queue_pending": []}))
    drained = module.drain_for_ace()
    module.restore_after_ace(*drained)
    assert ("user", "stop", ["comfy-user.service", "qwen.service"]) in commands
    assert ("system", "stop", ["comfy.service"]) in commands
    assert ("user", "stop", module.ACE_USER_UNITS) in commands
    assert ("system", "start", ["comfy.service"]) in commands


def test_h3_prompt_detection_and_gpu_drain(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    monkeypatch.setenv("MEDIA_EXECUTOR_H3_DRAIN_USER_UNITS", "qwen.service,moss.service")
    monkeypatch.setenv("MEDIA_EXECUTOR_H3_DRAIN_SYSTEM_UNITS", "comfy.service")
    import media_executor.app as module
    module = importlib.reload(module)
    commands = []

    def command(scope, action, units, *, check=True):
        commands.append((scope, action, units))
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(module, "service_command", command)
    body = json.dumps({"prompt": {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors"}}}}).encode()
    assert module.is_h3_prompt(body)
    assert not module.is_h3_prompt(json.dumps({"prompt": {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image.safetensors"}}}}).encode())
    assert module.begin_h3()
    assert module.H3_ACTIVE.is_set()
    assert not module.begin_h3()
    assert commands.count(("user", "stop", ["qwen.service", "moss.service"])) == 1
    assert commands.count(("system", "stop", ["comfy.service"])) == 1
