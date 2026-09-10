#!/usr/bin/env python3
"""Download pinned author checkpoints onto SSD; never change the live model catalog."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import quote

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/infinite-media-executor/models/H3-Experiments")
args = parser.parse_args()
manifest = json.loads((Path(__file__).resolve().parents[1] / "h3-experiments.json").read_text())
args.root.mkdir(parents=True, exist_ok=True)
for item in manifest["files"]:
    target = args.root / item["repository"].split("/")[0] / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    if not target.exists():
        host = "https://modelscope.cn/models" if item["source"] == "modelscope" else "https://huggingface.co"
        url = f'{host}/{item["repository"]}/resolve/{item["revision"]}/{quote(item["path"])}'
        print(f'Downloading {item["repository"]}/{item["path"]}', flush=True)
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--continue-at", "-", "--silent", "--show-error", url, "--output", str(partial)], check=True)
    candidate = target if target.exists() else partial
    digest = hashlib.sha256()
    with candidate.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    if candidate.stat().st_size != item["bytes"] or digest.hexdigest() != item["sha256"]:
        raise RuntimeError(f"Checkpoint checksum mismatch: {candidate}")
    if candidate == partial:
        partial.rename(target)
    print(f"Verified {target}", flush=True)
(args.root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
