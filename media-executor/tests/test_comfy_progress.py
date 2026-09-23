import json

from media_executor import comfy_progress
from test_capability_jobs import setup


class Socket:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.closed = False

    def recv(self, timeout):
        try:
            return next(self.messages)
        except StopIteration:
            raise TimeoutError

    def close(self):
        self.closed = True


def test_progress_is_bound_to_prompt_and_uses_real_steps(monkeypatch, tmp_path):
    app = setup(monkeypatch, tmp_path)
    with app.connect() as db:
        db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)", ("progress-test", "running", "{}", None, None, 0, 0, 1, 1))
    socket = Socket([b"preview", "not-json", json.dumps({"type": "progress", "data": {"prompt_id": "other", "value": 9, "max": 10}}), json.dumps({"type": "progress", "data": {"prompt_id": "ours", "node": "sampler", "value": 3, "max": 10}})])
    monkeypatch.setattr(comfy_progress, "connect", lambda *args, **kwargs: socket)
    with comfy_progress.ComfyProgress(app, "progress-test") as progress:
        progress.poll("ours")
    with app.connect() as db:
        assert db.execute("SELECT progress FROM jobs WHERE id='progress-test'").fetchone()[0] == .3
        detail = json.loads(db.execute("SELECT detail FROM gpu_diagnostics WHERE job_id='progress-test'").fetchone()[0])
        assert detail["step"] == 3 and detail["totalSteps"] == 10
    assert socket.closed


def test_progress_unavailable_does_not_fail_execution(monkeypatch, tmp_path):
    app = setup(monkeypatch, tmp_path)
    def unavailable(*args, **kwargs):
        raise OSError("disconnected")
    monkeypatch.setattr(comfy_progress, "connect", unavailable)
    with comfy_progress.ComfyProgress(app, "test") as progress:
        progress.poll("prompt")
        assert progress.socket is None
