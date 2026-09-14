"""Observe durable native execution through disconnects and executor restarts."""
import json
import threading
import time
from pathlib import Path

import httpx


def run(app, job_id, request, runtime):
    root = (app.RESULTS / job_id).resolve()
    root.mkdir(parents=True, exist_ok=True)
    payload = {**request, "outputDir": str(root), "references": []}
    for reference in request.get("references", []):
        path = (app.FILES / reference["fileId"]).resolve()
        if not path.is_file() or app.FILES not in path.parents:
            raise RuntimeError("reference file is missing")
        payload["references"].append({**reference, "path": str(path)})
    journal = root / ".runtime-job.json"
    with app.connect() as db:
        submitted = db.execute("SELECT submitted FROM native_executions WHERE job_id=?", (job_id,)).fetchone()
        if not submitted:
            db.execute("INSERT INTO native_executions VALUES(?,0)", (job_id,))
    outcome = []
    thread = None
    if not submitted or not submitted[0]:
        with app.connect() as db:
            db.execute("UPDATE native_executions SET submitted=1 WHERE job_id=?", (job_id,))
        def submit():
            try:
                outcome.append(runtime.request("POST", "/generate", json=payload, timeout=None))
            except Exception as error:
                outcome.append(error)
        thread = threading.Thread(target=submit, daemon=True)
        thread.start()
    while True:
        state = runtime.status()
        if app.canceled(job_id):
            # Stop the explicitly bound service, including an in-flight POST not yet registered.
            if state.get("busy") and state.get("jobId") != job_id:
                raise RuntimeError("runtime job ownership mismatch")
            runtime.stop()
            if thread:
                thread.join()
            raise RuntimeError("canceled")
        record = json.loads(journal.read_text()) if journal.exists() else None
        if record and record["status"] != "running" and not state.get("busy"):
            if record["status"] == "failed":
                raise RuntimeError(f"{record.get('errorType', '')}: {record.get('error', '')}")
            result = record["result"]
            break
        if not state.get("busy") and (thread is None or not thread.is_alive()):
            # An adapter crash can leave its managed engine alive (ACE). Reconcile by
            # stopping that exact service group before reporting an interrupted job.
            runtime.stop()
            raise RuntimeError(f"Native execution interrupted; no automatic resubmission: {outcome}")
        app.report(job_id, {"phase": state.get("phase", "inference"), "runtime": state})
        time.sleep(.5)
    files = []
    for value in result.get("files", []):
        path = Path(str(value.get("path", ""))).resolve()
        if not path.is_file() or root not in path.parents:
            raise RuntimeError("runtime returned an invalid output path")
        files.append({"name": path.name, "mimeType": value.get("mimeType", "audio/wav")})
    if not files:
        raise RuntimeError("runtime returned no output files")
    with app.connect() as db:
        db.execute("UPDATE jobs SET result=?,progress=1,updated_at=? WHERE id=? AND cancel_requested=0", (json.dumps({"files": files}), time.time(), job_id))
