#!/usr/bin/env python3
"""Maintenance-only inference through the executor's durable Comfy job path."""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path

from media_executor import app
from media_executor.capabilities import qwen_image


def main():
    os.environ["MEDIA_EXECUTOR_DISABLE_WORKER"] = "1"  # This process executes its own durable jobs synchronously.
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not (app.ROOT / "maintenance").exists():
        raise RuntimeError("qualification requires maintenance admission gate")
    with (app.ROOT / "qualification.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with app.connect() as db:
            if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone() or db.execute("SELECT 1 FROM proxy_executions WHERE finished=0").fetchone():
                raise RuntimeError("wait for existing jobs and proxy submissions to drain")
        manifest = json.loads((Path(__file__).resolve().parents[1] / "models/qwen-image21.json").read_text())
        for item in manifest["files"]:
            path = Path("/data/sas/ComfyUI/models") / item["path"]
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                    raise RuntimeError(f"weight checksum mismatch: {path}")
        args.output.mkdir(parents=True, exist_ok=True)
        records = []
        refs = []
        for mode, prompt in [
            ("text-to-image", "This is an RGBA image with transparency. A glossy blue ceramic teapot with one curved handle and a short spout, isolated product photograph, soft studio lighting. The image has alpha channel and the background is transparent."),
            ("image-edit", "Change only the blue ceramic teapot to bright red ceramic. Preserve its shape, handle, spout, camera angle and lighting. This is an RGBA image with transparency. The image has alpha channel and the background is transparent."),
        ]:
            job_id = "qwen21-qualification-" + uuid.uuid4().hex
            request = {"id": job_id, "model": qwen_image.MODEL, "mode": mode, "operation": "generate", "prompt": prompt, "params": {"seed": 42, "steps": 40}, "references": refs}
            plan = app.prepare_capability(request)
            with app.connect() as db:
                db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES(?,'running',?,?,?)", (job_id, json.dumps(request), time.time(), time.time()))
                db.execute("INSERT INTO comfy_executions(job_id,plan) VALUES(?,?)", (job_id, json.dumps(plan)))
            try:
                app.run_job(job_id, request)
            except Exception as error:
                with app.connect() as db:
                    db.execute("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?", (str(error), time.time(), job_id))
                raise
            with app.connect() as db:
                result = json.loads(db.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()[0])
            source = app.RESULTS / job_id / result["files"][0]["name"]
            shutil.copy2(source, args.output / f"{mode}.png")
            reference = f"{job_id}.png"
            shutil.copy2(source, app.FILES / reference)
            refs = [{"fileId": reference, "kind": "image", "role": "reference"}]
            records.append({"id": job_id, "request": request, "result": result, "qualityAccepted": False})
            (args.output / "qualification.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps({"id": job_id, "mode": mode, "execution": result["execution"]}), flush=True)


if __name__ == "__main__":
    main()
