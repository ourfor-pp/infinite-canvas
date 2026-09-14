"""Durable execution of executor-owned Comfy capabilities."""
import hashlib
import json
import mimetypes
import subprocess
import time
from pathlib import Path

import httpx

from .capabilities import h3, music
from .capabilities.catalog import input_path


def _json(client, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    return response.json()


def _observe_json(client, path):
    while True:
        try:
            return _json(client, "GET", path)
        except httpx.TransportError:
            time.sleep(2)
        except httpx.HTTPStatusError as error:
            if error.response.status_code < 500:
                raise
            time.sleep(2)


def _recover_submission(client, job_id):
    queue = _observe_json(client, "/queue")
    history = _observe_json(client, "/history?max_items=200")
    prompts = queue.get("queue_running", []) + queue.get("queue_pending", []) + [row["prompt"] for row in history.values() if "prompt" in row]
    matches = {p[1] for p in prompts if len(p) > 3 and p[3].get("client_id") == job_id}
    if len(matches) != 1:
        raise RuntimeError("Comfy submission outcome is unknown; no automatic resubmission")
    return matches.pop()


def _cancel(client, prompt_id):
    queue = _observe_json(client, "/queue")
    if any(p[1] == prompt_id for p in queue.get("queue_pending", [])):
        _json(client, "POST", "/queue", json={"delete": [prompt_id]})
    if any(p[1] == prompt_id for p in queue.get("queue_running", [])):
        response = client.post("/interrupt", json={"prompt_id": prompt_id})
        response.raise_for_status()


def run(app, job_id, request):
    with app.connect() as db:
        record = dict(db.execute("SELECT * FROM comfy_executions WHERE job_id=?", (job_id,)).fetchone())
    plan = json.loads(record["plan"])
    request = {**request, "params": {**request.get("params", {}), "seed": plan["seed"]}}
    root = app.RESULTS / job_id
    root.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=app.COMFY_URL, timeout=120, trust_env=False) as client:
        prompt_id = record["prompt_id"]
        if not prompt_id:
            if record["submitted"]:
                prompt_id = _recover_submission(client, job_id)
            else:
                # Runtime facts may have changed since preflight; fail before submitting.
                current = app.prepare_capability(request)
                if any(current.get(k) != plan.get(k) for k in ("context", "recipe", "width", "height", "outputFrames")):
                    raise RuntimeError("capability changed while queued; validate and submit a new task")
                uploads = {}
                inputs = request.get("references", []) + ([request["continuation"]] if request.get("continuation") else [])
                for ref in inputs:
                    path = input_path(app.FILES, ref["fileId"])
                    with path.open("rb") as stream:
                        value = _json(client, "POST", "/upload/image", files={"image": (path.name, stream, mimetypes.guess_type(path.name)[0] or "application/octet-stream")}, data={"overwrite": "false"})
                    uploads[ref["fileId"]] = "/".join(filter(None, [value.get("subfolder"), value["name"]]))
                graph = h3.graph(request, plan, uploads, uploads.get((request.get("continuation") or {}).get("fileId"))) if request["model"] in h3.MODELS else music.graph(request, plan)
                with app.connect() as db:
                    db.execute("UPDATE comfy_executions SET graph=?,submitted=1 WHERE job_id=?", (json.dumps(graph), job_id))
                # Persist intent BEFORE POST; interrupted POST is recovered, never blindly retried.
                try:
                    value = _json(client, "POST", "/prompt", json={"prompt": graph, "client_id": job_id})
                except httpx.TransportError:
                    time.sleep(2)
                    value = {"prompt_id": _recover_submission(client, job_id)}
                if not value.get("prompt_id"):
                    raise RuntimeError(f"Comfy rejected capability graph: {value.get('node_errors')}")
                prompt_id = value["prompt_id"]
            with app.connect() as db:
                db.execute("UPDATE comfy_executions SET prompt_id=? WHERE job_id=?", (prompt_id, job_id))
        while True:
            with app.connect() as db:
                canceled = db.execute("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
            if canceled:
                _cancel(client, prompt_id)
                raise RuntimeError("canceled")
            try:
                history = _observe_json(client, f"/history/{prompt_id}").get(prompt_id)
            except httpx.TransportError:
                # A transient observation failure does not authorize a second inference.
                time.sleep(2)
                continue
            if history and history.get("status", {}).get("completed"):
                break
            if history and history.get("status", {}).get("status_str") == "error":
                raise RuntimeError(str(history["status"].get("messages", []))[:2000])
            try:
                queue = _observe_json(client, "/queue")
                if not history and not any(p[1] == prompt_id for p in queue.get("queue_running", []) + queue.get("queue_pending", [])):
                    # Re-read history to close the queue/history completion race.
                    history = _observe_json(client, f"/history/{prompt_id}").get(prompt_id)
                    if not history:
                        raise RuntimeError("Comfy task no longer exists; no automatic resubmission")
                    continue
            except httpx.TransportError:
                time.sleep(2)
                continue
            time.sleep(1)
        if history["status"]["status_str"] != "success":
            raise RuntimeError(str(history["status"].get("messages", []))[:2000])
        result = {"files": [], "continuationStates": [], "cumulativeVideos": [], "execution": {**plan, "promptId": prompt_id}}
        for node_id, output in history.get("outputs", {}).items():
            for key, items in output.items():
                if key not in ("images", "audio", "gifs", "h3_states") or not isinstance(items, list): continue
                for item in items:
                    if not isinstance(item, dict) or not item.get("filename") or item.get("type") != "output": continue
                    category = "continuationStates" if key == "h3_states" else "cumulativeVideos" if node_id == "h3_cumulative" else "files"
                    name = f"{category}-{len(result[category])}-{Path(item['filename']).name}"
                    path = root / name
                    with client.stream("GET", "/view", params={k: item[k] for k in ("filename", "subfolder", "type") if k in item}) as response:
                        response.raise_for_status()
                        with path.open("wb") as stream:
                            for chunk in response.iter_bytes(): stream.write(chunk)
                    with path.open("rb") as stream: digest = hashlib.file_digest(stream, "sha256").hexdigest()
                    saved = {"name": name, "mimeType": mimetypes.guess_type(name)[0] or "application/safetensors", "sha256": digest}
                    if category == "continuationStates":
                        context = h3.state_context(path, digest)
                        if context != plan["context"]: raise RuntimeError("output continuation identity mismatch")
                        saved["context"] = context
                    else:
                        info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "stream=codec_type,width,height,nb_read_frames,r_frame_rate,duration:format=duration", "-of", "json", str(path)], text=True))
                        saved["media"] = info
                        if request["model"] in h3.MODELS:
                            video = next(s for s in info["streams"] if s["codec_type"] == "video")
                            expected = plan["context"]["frames"] if category == "cumulativeVideos" else plan["outputFrames"]
                            if int(video["nb_read_frames"]) != expected or video["width"] != plan["width"] or video["height"] != plan["height"] or video["r_frame_rate"] != "24/1":
                                raise RuntimeError("H3 output media does not match execution plan")
                    result[category].append(saved)
        if not result["files"] or plan.get("context") and (len(result["continuationStates"]) != 1 or len(result["cumulativeVideos"]) != 1):
            raise RuntimeError("capability returned incomplete output")
        times = {kind: detail.get("timestamp") for kind, detail in history["status"]["messages"]}
        if times.get("execution_start") is not None and times.get("execution_success") is not None:
            result["execution"]["elapsedSeconds"] = (times["execution_success"] - times["execution_start"]) / 1000
        with app.connect() as db:
            db.execute("UPDATE comfy_executions SET history=? WHERE job_id=?", (json.dumps(history), job_id))
            db.execute("UPDATE jobs SET status='succeeded',result=?,progress=1,updated_at=? WHERE id=? AND cancel_requested=0", (json.dumps(result), time.time(), job_id))
