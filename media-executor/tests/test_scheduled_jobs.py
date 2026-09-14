import importlib
import json

import pytest

from media_executor.gpu import GIB, Memory, Scheduler


@pytest.mark.parametrize("error,retries", [("CUDA out of memory", 2), ("CPU out of memory", 1), ("transport failure", 1)])
def test_only_cuda_oom_retries_once_with_same_request(monkeypatch, tmp_path, error, retries):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MEDIA_EXECUTOR_QWEN_REVISION", "fixed-model-and-runtime")
    import media_executor.app as app
    app = importlib.reload(app)
    app.init_db()
    request = {"model": "qwen3-tts-1.7b-customvoice-local", "mode": "speech", "prompt": "你好", "params": {}, "references": []}
    with app.connect() as db:
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES('job','running',?,0,0)", (json.dumps(request),))
    class Runtime:
        def start(self): pass
        def status(self): return {"pids": [1], "loaded": [], "busy": False}
        def pids(self): return [1]
        def clear_cache(self): pass
    gpu = Scheduler(app.connect, lambda: Memory(32 * GIB, 30 * GIB, {1: GIB}), {"qwen": Runtime()}, wait_seconds=0)
    monkeypatch.setattr(app, "scheduler", lambda: gpu)
    monkeypatch.setattr(app, "prepare_capability", lambda value: {"seed": 42, "capabilityVersion": "1"})
    submitted = []
    def fail(_app, _id, value, _runtime):
        submitted.append(value)
        raise RuntimeError(error)
    monkeypatch.setattr(app.native_jobs, "run", fail)
    with pytest.raises(RuntimeError, match=error):
        app.run_job("job", request)
    assert len(submitted) == retries
    assert all(value == submitted[0] and value["params"]["seed"] == 42 for value in submitted)
    assert gpu.owner is None
    with app.connect() as db:
        diagnostic = json.loads(db.execute("SELECT detail FROM gpu_diagnostics WHERE job_id='job'").fetchone()[0])
    assert diagnostic["attempt"] == retries and diagnostic["error"] == error


@pytest.mark.parametrize("cancel_at_completion", [False, True])
def test_terminal_status_follows_diagnostics_and_honors_late_cancel(monkeypatch, tmp_path, cancel_at_completion):
    monkeypatch.setenv("MEDIA_EXECUTOR_DATA_DIR", str(tmp_path))
    import media_executor.app as app
    app = importlib.reload(app)
    app.init_db()
    request = {"model": "qwen3-tts-1.7b-customvoice-local", "mode": "speech", "prompt": "你好", "params": {}, "references": []}
    with app.connect() as db:
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES('job','running',?,0,0)", (json.dumps(request),))
    class Runtime:
        def start(self): pass
        def status(self): return {"pids": [], "loaded": [], "busy": False}
        def pids(self): return []
    gpu = Scheduler(app.connect, lambda: Memory(32 * GIB, 32 * GIB, {}), {"qwen": Runtime()}, wait_seconds=0)
    monkeypatch.setattr(app, "scheduler", lambda: gpu)
    monkeypatch.setattr(app, "prepare_capability", lambda _: {"seed": 42})
    def complete(*_):
        with app.connect() as db:
            db.execute("UPDATE jobs SET result='{}',cancel_requested=? WHERE id='job'", (int(cancel_at_completion),))
    monkeypatch.setattr(app.native_jobs, "run", complete)
    report = app.report
    def observe(job_id, detail):
        if detail.get("phase") == "completed":
            with app.connect() as db:
                assert db.execute("SELECT status FROM jobs WHERE id='job'").fetchone()[0] == "running"
        report(job_id, detail)
    monkeypatch.setattr(app, "report", observe)
    app.run_job("job", request)
    with app.connect() as db:
        assert db.execute("SELECT status FROM jobs WHERE id='job'").fetchone()[0] == ("canceled" if cancel_at_completion else "succeeded")
        assert json.loads(db.execute("SELECT detail FROM gpu_diagnostics WHERE job_id='job'").fetchone()[0])["phase"] == "completed"
