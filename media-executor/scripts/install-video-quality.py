#!/usr/bin/env python3
"""Promote the pinned, verified evaluation assets; never download or replace model weights."""
import argparse
import fcntl
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

SOURCES = {"flash-comfy": "153cf03343a116c85aee40d291125921cc33935a", "seed-comfy": "4490bd1f482e026674543386bb2a4d176da245b9"}
WEIGHTS = {
    "flashvsr-plus/turbo/dit.safetensors": "7862b92178176fa3aebc34c6c071daca6b56ab1dddb8e7ff9a01c47f5226ec8b",
    "flashvsr-plus/turbo/lq_proj_in.safetensors": "e77b378ae12342eefbb58f924256f362a151b93ce73dd32808fcdaca9c051496",
    "flashvsr-plus/TCDecoder.ckpt": "e224bdcf2f52745cbf4d393ff5374c2ba09e90285d5d19062d2bf63b915b6161",
    "seedvr2-comfy-official/evaluation_comfy_seedvr2_3b_fp16.safetensors": "ab0f5c6949943d5ff4f887466a0245446885c425a12d8ac8d4f270032899afd6",
    "seedvr2-comfy-official/ema_vae_fp16.safetensors": "20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1",
    "frame-interpolation/rife_v4.25.safetensors": "1505884b9bdae956795430d2a70f7e2317b2abd8f130f8cfdb35a5759f909481",
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evaluation-root", type=Path, required=True)
    parser.add_argument("--comfy-root", type=Path, required=True)
    parser.add_argument("--comfy-models", type=Path, default=Path("/data/sas/ComfyUI/models"))
    parser.add_argument("--runtime-root", type=Path, default=Path.home() / ".local/share/infinite-media-executor/video-quality")
    parser.add_argument("--weights", type=Path, default=Path("/data/sas/models/VideoQualityEvaluation"))
    parser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args()
    if not (args.data_dir / "maintenance").is_file():
        raise RuntimeError("set maintenance and drain existing jobs before installation")
    lock = (args.data_dir / "qualification.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    import sqlite3
    with sqlite3.connect(args.data_dir / "jobs.db") as db:
        if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone() or db.execute("SELECT 1 FROM proxy_executions WHERE finished=0").fetchone():
            raise RuntimeError("jobs or proxy submissions are still active")
    root, evaluation = args.runtime_root.resolve(), args.evaluation_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name, revision in SOURCES.items():
        source = evaluation / "sources" / name
        if subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() != revision:
            raise RuntimeError(f"unverified source revision: {name}")
        changed = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True).splitlines()
        expected = [" M flashvsr_plus/inference/loading/loader.py"] if name == "flash-comfy" else []
        if changed != expected:
            raise RuntimeError(f"unexpected source changes: {name}")
        shutil.copytree(source, root / "sources" / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"))
    shutil.copytree(evaluation / "deps", root / "deps", dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if digest(root / "sources/flash-comfy/flashvsr_plus/inference/loading/loader.py") != "e1780f3d9ab074ac04ebb68cc0f5c6f3001d7c91781dfe4ef52b5782b486339c":
        raise RuntimeError("Flash decoder patch differs from the evaluated source")
    # The official Flash tensor has a different name in the pinned community loader.
    context = root / "sources/flash-comfy/flashvsr_plus/prompt_tensor/posi_prompt_plus.pth"
    if digest(context) != "4601107a11e4e11a936a6b79df579e54dbc99872132bf542151f0ffd65b4b1ef":
        raise RuntimeError("Flash context tensor mismatch")
    records = {}
    for name, expected in WEIGHTS.items():
        path = (args.weights / name).resolve()
        actual = digest(path)
        if not expected:
            raise RuntimeError("a pinned checksum is required for every model file")
        if actual != expected:
            raise RuntimeError(f"weight checksum mismatch: {name}")
        stat = path.stat()
        records[name] = {"path": str(path), "sha256": actual, "bytes": stat.st_size, "mtimeNs": stat.st_mtime_ns}
    common = [records["frame-interpolation/rife_v4.25.safetensors"]]
    required = {
        "flashvsr-turbo-local": common + [record for name, record in records.items() if name.startswith("flashvsr")],
        "seedvr2-local": common + [record for name, record in records.items() if name.startswith("seedvr2")],
    }
    config = {"root": str(root), "weights": str(args.weights.resolve()), "required": required, "sources": SOURCES, "recipe": "sr-rife-v1"}
    provenance = root / "provenance"
    provenance.mkdir(exist_ok=True)
    for name in ("all-model-sources.json", "seedvr2-comfy-official-manifest.json", "seedvr2-derived-manifest.json", "flash-context-provenance.json", "flash-loader-decoder.patch"):
        shutil.copy2(evaluation / name, provenance / name)
    (root / "runtime.json").write_text(json.dumps(config, indent=2) + "\n")
    plugin = Path(__file__).resolve().parents[1] / "comfy-video-quality"
    target = args.comfy_root / "custom_nodes/infinite-video-quality"
    if target.exists() and target.resolve() != plugin:
        raise RuntimeError("refusing to replace an unrelated Comfy extension")
    if not target.is_symlink():
        target.symlink_to(plugin, target_is_directory=True)
    # Core RIFE loader consumes the stable model entrypoint.
    rife = args.comfy_models / "frame_interpolation/rife_v4.25.safetensors"
    rife.parent.mkdir(parents=True, exist_ok=True)
    if rife.exists() and digest(rife) != WEIGHTS["frame-interpolation/rife_v4.25.safetensors"]:
        raise RuntimeError("existing RIFE model differs from the verified weights")
    if not rife.exists():
        rife.symlink_to(records["frame-interpolation/rife_v4.25.safetensors"]["path"])
    print(json.dumps({"config": str(root / "runtime.json"), "plugin": str(target), "models": list(required)}))


if __name__ == "__main__":
    main()
