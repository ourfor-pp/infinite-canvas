import importlib
import json

import pytest

from media_executor import native_jobs


def setup(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    import media_executor.app as app
    app = importlib.reload(app)
    app.init_db()
    with app.connect() as db:
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES('job','running','{}',0,0)")
        db.execute("INSERT INTO native_executions VALUES('job',1)")
    monkeypatch.setattr(native_jobs.httpx, "Client", lambda **_: pytest.fail("recovery must not submit again"))
    return app


def test_recovered_native_result_is_saved_without_duplicate_inference(monkeypatch, tmp_path):
    app = setup(monkeypatch, tmp_path)
    root = app.RESULTS / "job"
    root.mkdir()
    (root / "speech.wav").write_bytes(b"result")
    (root / ".runtime-job.json").write_text(json.dumps({"status": "succeeded", "result": {"files": [{"path": str(root / "speech.wav"), "mimeType": "audio/wav"}]}}))
    runtime = type("Runtime", (), {"status": lambda self: {"busy": False}})()
    native_jobs.run(app, "job", {}, runtime)
    with app.connect() as db:
        assert db.execute("SELECT status FROM jobs WHERE id='job'").fetchone()[0] == "running"
        assert json.loads(db.execute("SELECT result FROM jobs WHERE id='job'").fetchone()[0])["files"][0]["name"] == "speech.wav"


def test_cancel_waits_for_managed_service_stop(monkeypatch, tmp_path):
    app = setup(monkeypatch, tmp_path)
    with app.connect() as db:
        db.execute("UPDATE jobs SET cancel_requested=1 WHERE id='job'")
    stopped = []
    class Runtime:
        def status(self): return {"busy": True, "jobId": "job"}
        def stop(self): stopped.append("all managed pids gone")
    with pytest.raises(RuntimeError, match="canceled"):
        native_jobs.run(app, "job", {}, Runtime())
    assert stopped == ["all managed pids gone"]


def test_interrupted_adapter_stops_orphan_engine_before_failure(monkeypatch, tmp_path):
    app = setup(monkeypatch, tmp_path)
    stopped = []
    runtime = type("Runtime", (), {"status": lambda self: {"busy": False}, "stop": lambda self: stopped.append(True)})()
    with pytest.raises(RuntimeError, match="no automatic resubmission"):
        native_jobs.run(app, "job", {}, runtime)
    assert stopped == [True]
