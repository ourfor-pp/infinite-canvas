"""Pinned, hash-verified quantizer repository; active files live on SSD."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--ssd-root", type=Path, required=True)
parser.add_argument("--entry-root", type=Path, default=Path("/data/sas/models"))
args = parser.parse_args()
manifest = json.loads((Path(__file__).resolve().parents[1] / "models/qwen-llm.json").read_text())
target = args.ssd_root.resolve() / manifest["directory"]
target.mkdir(parents=True, exist_ok=True)


def valid(path, item):
    if not path.is_file() or path.stat().st_size != item["size"]:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == item["sha256"]


for item in manifest["files"]:
    path = target / item["name"]
    if not valid(path, item):
        if path.exists():
            raise RuntimeError(f"existing model hash mismatch: {path}")
        partial = path.with_suffix(".partial")
        url = f'https://modelscope.cn/models/{manifest["repository"]}/resolve/{manifest["revision"]}/{item["name"]}'
        urllib.request.urlretrieve(url, partial)
        if not valid(partial, item):
            raise RuntimeError(f"download hash mismatch: {partial}")
        partial.replace(path)
    print("verified", item["name"], flush=True)
args.entry_root.mkdir(parents=True, exist_ok=True)
entry = args.entry_root / manifest["directory"]
if entry.is_symlink() or entry.exists():
    if not entry.is_symlink() or entry.resolve() != target:
        raise RuntimeError("refusing to replace existing model entry")
else:
    entry.symlink_to(target, target_is_directory=True)
(target / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
