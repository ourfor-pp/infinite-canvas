import importlib
import json

import httpx
from fastapi.testclient import TestClient

from test_capabilities import runtime


def setup(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_TOKEN", "secret")
    monkeypatch.setenv("MEDIA_EXECUTOR_DISABLE_WORKER", "1")
    import media_executor.app as module
    module = importlib.reload(module)
    module.init_db()
    monkeypatch.setattr(module, "health", runtime)
    (module.FILES / "image.png").write_bytes(b"reference")
    return module


def test_neutral_preflight_and_idempotency(monkeypatch, tmp_path):
    module = setup(monkeypatch, tmp_path)
    job = {"id": "neutral", "model": "minimax-h3-ref2va-local", "mode": "ref2va", "prompt": "A room.", "references": [{"fileId": "image.png", "kind": "image"}]}
    headers = {"Authorization": "Bearer secret"}
    with TestClient(module.app) as client:
        assert client.get("/v1/capabilities").status_code == 401
        assert client.get("/v1/capabilities", headers=headers).json()["version"] == "1"
        response = client.post("/v1/jobs/validate", json=job, headers=headers)
        assert response.status_code == 200
        assert response.json()["plan"]["recipe"] == "pdd-ref8"
        with module.connect() as db:
            assert db.execute("SELECT count(*) FROM jobs").fetchone()[0] == 0
        assert client.post("/v1/jobs", json=job, headers=headers).status_code == 202
        assert client.post("/v1/jobs", json=job, headers=headers).status_code == 202
        assert client.post("/v1/jobs", json={**job, "prompt": "Different."}, headers=headers).status_code == 409
        assert client.post("/v1/jobs", json={**job, "id": "../escape"}, headers=headers).status_code == 422
        with module.connect() as db:
            assert db.execute("SELECT count(*) FROM comfy_executions").fetchone()[0] == 1


def test_previously_submitted_job_is_recovered_not_resubmitted(monkeypatch, tmp_path):
    from media_executor import comfy_jobs
    module = setup(monkeypatch, tmp_path)
    request = {"id": "resume", "model": "minimax-music3-local", "mode": "music", "operation": "generate", "prompt": "Piano", "params": {}, "references": []}
    with module.connect() as db:
        db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)", ("resume", "running", json.dumps(request), None, None, 0, 1, 1, 1))
        db.execute("INSERT INTO comfy_executions(job_id,plan,submitted) VALUES(?,?,1)", ("resume", json.dumps({"seed": 42, "capabilityVersion": "1"})))
    posts = []
    def handler(req):
        if req.method == "POST": posts.append(req.url.path)
        if req.url.path == "/queue": return httpx.Response(200, json={"queue_running": [], "queue_pending": [[0, "previous-id", {}, {"client_id": "resume"}]]})
        if req.url.path == "/history": return httpx.Response(200, json={})
        return httpx.Response(200, json={})
    real_client = httpx.Client
    monkeypatch.setattr(comfy_jobs.httpx, "Client", lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(handler)))
    import pytest
    with pytest.raises(RuntimeError, match="canceled"):
        comfy_jobs.run(module, "resume", request)
    assert posts == ["/queue"]
    with module.connect() as db:
        assert db.execute("SELECT prompt_id FROM comfy_executions WHERE job_id='resume'").fetchone()[0] == "previous-id"


def test_uploaded_state_retains_loader_extension(monkeypatch, tmp_path):
    module = setup(monkeypatch, tmp_path)
    with TestClient(module.app) as client:
        response = client.post("/v1/files", headers={"Authorization": "Bearer secret"}, files={"upload": ("../../state.safetensors", b"state", "application/octet-stream")})
        assert response.status_code == 200
        file_id = response.json()["id"]
        assert file_id.endswith(".safetensors") and "/" not in file_id
        assert (module.FILES / file_id).read_bytes() == b"state"
