#!/usr/bin/env python3
"""Real jobs under a drained maintenance gate; calibrate bounded reuse budgets."""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path

os.environ["MEDIA_EXECUTOR_DISABLE_WORKER"] = "1"
from media_executor import app, llm
from media_executor.gpu import GIB


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    args = parser.parse_args()
    if not (app.ROOT / "maintenance").exists():
        raise RuntimeError("maintenance marker required")
    lock = (app.ROOT / "qualification.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with app.connect() as db:
        if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone() or db.execute("SELECT 1 FROM proxy_executions WHERE finished=0").fetchone():
            raise RuntimeError("drain existing jobs before qualification")
    revisions = {name: os.getenv(f"MEDIA_EXECUTOR_{name.upper()}_REVISION") for name in ("llm", "comfy")}
    if not all(revisions.values()):
        raise RuntimeError("verified LLM and Comfy runtime revisions required")
    manifest = json.loads((Path(__file__).resolve().parents[1] / "models/qwen-llm.json").read_text())
    model_root = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models")) / manifest["directory"]
    for item in manifest["files"]:
        path = model_root / item["name"]
        with path.open("rb") as stream:
            if path.stat().st_size != item["size"] or hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise RuntimeError(f"model checksum mismatch: {item['name']}")
    gpu = app.scheduler()
    if gpu.runtimes["comfy"].status().get("busy"):
        raise RuntimeError("ComfyUI is busy")
    prefix = "qualify-llm-" + uuid.uuid4().hex[:12]
    reference = prefix + ".png"
    shutil.copyfile(args.reference, app.FILES / reference)
    records = []
    budgets_file = app.ROOT / "qwen-coexistence.json"
    previous = budgets_file.read_bytes() if budgets_file.exists() else None
    budgets_file.unlink(missing_ok=True)

    def run(name, prompt, image=False, size=None, params=None):
        job_id = prefix + "-" + name
        request = {"id": job_id, "model": "qwen-image-2.1-local" if size else llm.MODEL,
                   "mode": "text-to-image" if size else "text", "operation": "generate", "prompt": prompt,
                   "params": {"width": size, "height": size, "steps": 40, "seed": int(hashlib.sha256(prefix.encode()).hexdigest()[:8], 16)} if size else params or {},
                   "references": [{"fileId": reference, "kind": "image", "role": "reference"}] if image else []}
        if size:
            gpu.runtimes["comfy"].start()
        plan = app.prepare_capability(request)
        with app.connect() as db:
            db.execute("INSERT INTO jobs(id,status,request,created_at,updated_at) VALUES(?, 'running', ?, ?, ?)",
                       (job_id, json.dumps(request), time.time(), time.time()))
            if size:
                db.execute("INSERT INTO comfy_executions(job_id,plan) VALUES(?,?)", (job_id, json.dumps(plan)))
        started = time.monotonic()
        try:
            app.run_job(job_id, request)
        except Exception as error:
            with app.connect() as db:
                db.execute("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?", (str(error), time.time(), job_id))
            raise
        with app.connect() as db:
            result = json.loads(db.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()[0])
            detail = json.loads(db.execute("SELECT detail FROM gpu_diagnostics WHERE job_id=?", (job_id,)).fetchone()[0])
        records.append({"name": name, "jobId": job_id, "seconds": time.monotonic() - started, "result": result, "diagnostics": detail})
        print(json.dumps({"name": name, "seconds": records[-1]["seconds"], "peakGiB": detail["peakBytes"] / GIB,
                          "loads": detail["runtime"].get("loads"), "events": detail.get("events", [])}), flush=True)
        return records[-1]

    success = False
    try:
        run("text", "用一句中文说明你能帮助处理哪些文字和图片任务。")
        run("vision", "说明图片中杯子的数量、颜色和左右位置。", image=True)
        run("long-context", "请忽略下面的测试填充内容，只回答完成。\n" + "a " * 5000, image=True, params={"maxTokens": 2048})
        # Calibrate a longer prompt than routine product-image requests.
        calibration = "白色背景的蓝色陶瓷杯产品摄影。以下是内部素材编号，不要绘制任何文字：" + hashlib.shake_256(b"qwen-memory-envelope").hexdigest(450)
        run("calibrate-1024", calibration, size=1024)
        run("calibrate-2048", calibration, size=2048)
        budgets = {"llm": max(x["diagnostics"]["peakBytes"] for x in records[:3]) + GIB,
                   "image-1024": records[3]["diagnostics"]["peakBytes"] + GIB,
                   "image-2048": records[4]["diagnostics"]["peakBytes"] + GIB}
        record = {"version": 1, "revisions": revisions, "budgets": budgets,
                  "qualificationJobs": [x["jobId"] for x in records], "qualityAccepted": False}
        budgets_file.write_text(json.dumps(record, indent=2))
        system = "忠实整理用户要求。只输出JSON对象，prompt字段须独立包含全部要求，constraints字段列出约束。不要把修改要求只放在constraints中。"
        row = run("pipeline-plan", "生成白底正方形产品图，左边蓝色杯子，右边红色杯子，恰好两个，无文字。", params={"systemPrompt": system, "responseFormat": "json_object"})
        prompt = json.loads(row["result"]["text"])["prompt"]
        run("pipeline-image", prompt, size=1024)
        run("pipeline-followup", "请把‘白底两个杯子’改写得更具体，保持简短。")
        run("pipeline-image-2048", prompt, size=2048)
        last = run("pipeline-followup-2048", "用一句话列出产品图中应避免的多余内容。")
        if row["diagnostics"]["runtime"]["loads"] != last["diagnostics"]["runtime"]["loads"]:
            raise RuntimeError("LLM was reloaded during the qualified coexistence pipeline")
        success = True
    finally:
        report = {"success": success, "records": records, "qualityAccepted": False}
        (app.ROOT / "qwen-llm-qualification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        gpu.runtimes["llm"].stop()
        if not success:
            if previous is None:
                budgets_file.unlink(missing_ok=True)
            else:
                budgets_file.write_bytes(previous)


if __name__ == "__main__":
    main()
