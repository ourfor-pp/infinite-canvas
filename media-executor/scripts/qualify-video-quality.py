#!/usr/bin/env python3
"""Qualify actual SR/RIFE output, download and ACK under the existing maintenance gate."""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path

import httpx
from media_executor import app
from media_executor.capabilities import video_quality


def main():
    os.environ["MEDIA_EXECUTOR_DISABLE_WORKER"] = "1"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", choices=list(video_quality.MODELS), required=True)
    parser.add_argument("--resolution", choices=["1080p", "4k"], default="1080p")
    parser.add_argument("--fps", choices=["source", "48", "60"], default="48")
    args = parser.parse_args()
    if not (app.ROOT / "maintenance").is_file():
        raise RuntimeError("qualification requires maintenance")
    lock = (app.ROOT / "qualification.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with app.connect() as db:
        if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone() or db.execute("SELECT 1 FROM proxy_executions WHERE finished=0").fetchone():
            raise RuntimeError("wait for existing jobs and proxy submissions")
    job_id = "video-quality-qualification-" + uuid.uuid4().hex
    ref_id = job_id + args.reference.suffix
    shutil.copy2(args.reference, app.FILES / ref_id)
    request = {"id": job_id, "model": args.model, "mode": "enhance", "operation": "enhance", "prompt": "",
               "params": {"resolution": args.resolution, "fps": "source" if args.fps == "source" else int(args.fps), "seed": 42},
               "references": [{"fileId": ref_id, "kind": "video", "role": "reference"}]}
    plan = app.prepare_capability(request)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "request.json").write_text(json.dumps(request, indent=2))
    with app.connect() as db:
        db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES(?,'running',?,?,?)", (job_id, json.dumps(request), time.time(), time.time()))
        db.execute("INSERT INTO comfy_executions(job_id,plan) VALUES(?,?)", (job_id, json.dumps(plan)))
    started = time.monotonic()
    try:
        app.run_job(job_id, request)
    except BaseException as error:
        with app.connect() as db:
            db.execute("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?", (str(error), time.time(), job_id))
        raise
    headers = {"Authorization": "Bearer " + app.TOKEN, "X-Media-Protocol": "2"}
    with httpx.Client(base_url="http://127.0.0.1:8290", headers=headers, trust_env=False, timeout=120) as client:
        response = client.get(f"/v1/jobs/{job_id}")
        response.raise_for_status()
        report = response.json()
        if report["status"] != "succeeded":
            raise RuntimeError(str(report))
        for item in report["result"]["files"]:
            response = client.get(f"/v1/jobs/{job_id}/files/{item['name']}")
            response.raise_for_status()
            if hashlib.sha256(response.content).hexdigest() != item["sha256"]:
                raise RuntimeError("download checksum mismatch")
            (args.output / "output.mp4").write_bytes(response.content)
        response = client.post(f"/v1/jobs/{job_id}/ack")
        response.raise_for_status()
        report.update(wallSeconds=time.monotonic() - started, acknowledged=True, qualityAccepted=False)
        (args.output / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"model": args.model, "status": report["status"], "wallSeconds": report["wallSeconds"], "acknowledged": True}), flush=True)


if __name__ == "__main__":
    main()
