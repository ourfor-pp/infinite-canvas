#!/usr/bin/env python3
"""Run one exported video/audio experiment on isolated ComfyUI and retain evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlparse
import requests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("experiment", type=Path, help="JSON containing graph and recipe")
parser.add_argument("--url", default="http://127.0.0.1:8190")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--timeout", type=int, default=1800)
args = parser.parse_args()
if urlparse(args.url).hostname not in ("127.0.0.1", "localhost") or urlparse(args.url).port == 8189:
    parser.error("Use an isolated loopback port, not the active H3 service")
args.output.mkdir(parents=True, exist_ok=True)
experiment = json.loads(args.experiment.read_text())
session = requests.Session()

def get(path):
    response = session.get(args.url + path, timeout=30)
    response.raise_for_status()
    return response.json()

for url in (args.url, "http://127.0.0.1:8189"):
    response = session.get(url + "/queue", timeout=10)
    response.raise_for_status()
    queue = response.json()
    if queue.get("queue_running") or queue.get("queue_pending"):
        raise RuntimeError(f"GPU queue busy: {url}")
release = session.post(args.url + "/free", json={"unload_models": True, "free_memory": True}, timeout=30)
release.raise_for_status()
time.sleep(2)

def gpu_memory():
    result = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True, check=True)
    return [int(line) for line in result.stdout.splitlines()]

gpu_start = gpu_memory()
gpu_peak = gpu_start.copy()
start = time.monotonic()
response = session.post(args.url + "/prompt", json={"prompt": experiment["graph"]}, timeout=60)
submission = response.json()
report = {"recipe": experiment["recipe"], "submission": submission, "qualityAccepted": False, "audioAccepted": False, "gpuInitialTotalUsedMiB": gpu_start, "gpuPeakTotalUsedMiB": gpu_peak}
(args.output / "experiment.json").write_text(json.dumps(experiment, indent=2))
(args.output / "report.json").write_text(json.dumps(report, indent=2))
response.raise_for_status()
prompt_id = submission["prompt_id"]
print(f"Queued {prompt_id}: {experiment['recipe']}", flush=True)
last_progress = 0
while time.monotonic() - start < args.timeout:
    gpu_peak[:] = [max(before, current) for before, current in zip(gpu_peak, gpu_memory())]
    history = get("/history/" + prompt_id).get(prompt_id)
    if history:
        report["seconds"] = round(time.monotonic() - start, 3)
        report["history"] = history
        (args.output / "report.json").write_text(json.dumps(report, indent=2))
        if history["status"]["status_str"] != "success":
            raise RuntimeError(f"Inference failed; see {args.output / 'report.json'}")
        outputs = history["outputs"]["14"]
        videos = [item for values in outputs.values() if isinstance(values, list) for item in values if isinstance(item, dict) and str(item.get("filename", "")).endswith((".mp4", ".webm", ".flac", ".wav", ".mp3"))]
        if not videos:
            raise RuntimeError("No saved media in successful history")
        artifacts = []
        for index, item in enumerate(videos):
            video = session.get(args.url + "/view", params={key: item[key] for key in ("filename", "subfolder", "type") if key in item}, timeout=60)
            video.raise_for_status()
            target = args.output / f"output-{index}{Path(item['filename']).suffix}"
            target.write_bytes(video.content)
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(target)], capture_output=True, text=True, check=True)
            volume = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(target), "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, check=True)
            artifacts.append({"path": str(target), "sha256": hashlib.sha256(video.content).hexdigest(), "probe": json.loads(probe.stdout), "audioStatistics": volume.stderr})
        report["artifacts"] = artifacts
        (args.output / "report.json").write_text(json.dumps(report, indent=2))
        print(f"Completed in {report['seconds']} seconds: {args.output}", flush=True)
        break
    elapsed = int(time.monotonic() - start)
    if elapsed - last_progress >= 30:
        print(f"Running {prompt_id}: {elapsed}s", flush=True)
        last_progress = elapsed
    time.sleep(2)
else:
    # Do not send a global interrupt: another job may have started by now.
    raise TimeoutError(f"Prompt {prompt_id} still pending; inspect its isolated queue")
