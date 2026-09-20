#!/usr/bin/env python3
"""Qualify the private worker while formal admission is drained by the operator."""
import argparse
import array
import fcntl
import hashlib
import json
import os
import subprocess
import time
import uuid
import wave
from pathlib import Path

from media_executor import app, indextts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    args = parser.parse_args()
    if not (app.ROOT / "maintenance").is_file():
        raise RuntimeError("maintenance marker required")
    with app.connect() as db:
        if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone() or db.execute("SELECT 1 FROM proxy_executions WHERE finished=0").fetchone():
            raise RuntimeError("drain existing jobs before qualification")
    executor = Path(__file__).resolve().parents[1]
    manifest = json.loads((executor / "models/indextts.json").read_text())
    source = executor / "third_party/IndexTTS"
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != manifest["codeRevision"] or subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True).strip():
        raise RuntimeError("IndexTTS source differs from pinned revision")
    model = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models")) / "IndexTTS-2.5"
    for item in manifest["files"]:
        with (model / item["path"]).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise RuntimeError(f"Model checksum mismatch: {item['path']}")
    reference = args.reference.resolve(strict=True)
    indextts.validate_audio(reference)
    owner = "qualify-index-" + uuid.uuid4().hex
    gpu = app.scheduler()
    if not gpu.acquire(owner):
        raise RuntimeError("GPU busy")
    runtime = gpu.runtimes["index"]
    try:
        gpu.prepare(owner, "index", owner)
        runtime.start()
        root = app.ROOT / "qualification" / owner
        text = "今天我们慢慢聊，不着急。先把想说的话说清楚，再接着往下讲。"
        result = runtime.request("POST", "/generate", json={"prompt": text, "params": {"seed": 20260919, "durationFactor": 1.2},
            "references": [{"kind": "audio", "role": "reference", "path": str(reference)}], "outputDir": str(root)}, timeout=None)
        output = Path(result["files"][0]["path"])
        with wave.open(str(output)) as wav:
            if wav.getsampwidth() != 2:
                raise RuntimeError("Expected PCM16 output")
            samples = array.array("h", wav.readframes(wav.getnframes()))
            if not samples or max(abs(value) for value in samples) == 0:
                raise RuntimeError("Empty or silent speech")
            seconds = wav.getnframes() / wav.getframerate()
        record = {"model": indextts.MODEL, "codeRevision": revision, "modelRevision": manifest["revision"],
                  "lockSha256": hashlib.sha256((app.RUNTIME_ROOT / "indextts/uv.lock").read_bytes()).hexdigest(),
                  "smokePassed": True, "qualityAccepted": False, "verifiedAt": time.time(),
                  "smoke": {"file": str(output), "seconds": seconds, "text": text, "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}}
        (app.ROOT / "indextts-qualification.json").write_text(json.dumps(record, ensure_ascii=False, indent=2))
        print(json.dumps(record, ensure_ascii=False), flush=True)
    finally:
        runtime.stop()
        gpu.release(owner)


if __name__ == "__main__":
    with (app.ROOT / "qualification.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        main()
