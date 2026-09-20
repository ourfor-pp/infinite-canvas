#!/usr/bin/env python3
"""Install the pinned official weights and auxiliary models, verifying every file."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ssd-root", type=Path, required=True)
    parser.add_argument("--entry-root", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).resolve().parents[1] / "models/indextts.json").read_text())
    target = args.ssd_root.resolve() / ("IndexTTS-2.5-" + manifest["revision"][:12])
    for item in manifest["files"]:
        path = target / item["path"]
        if path.is_file() and digest(path) == item["sha256"]:
            continue
        if path.exists() or path.is_symlink():
            raise RuntimeError(f"Existing model file differs from pinned source: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".download")
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "30", "--output", str(temporary), item["url"]], check=True)
        if digest(temporary) != item["sha256"]:
            raise RuntimeError(f"Model checksum mismatch: {item['path']}")
        temporary.replace(path)
    (target / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    args.entry_root.mkdir(parents=True, exist_ok=True)
    entry = args.entry_root / "IndexTTS-2.5"
    if entry.is_symlink() and entry.resolve() == target:
        pass
    elif entry.exists() or entry.is_symlink():
        raise RuntimeError(f"Refusing to replace existing model entry: {entry}")
    else:
        entry.symlink_to(target, target_is_directory=True)
    print(f"Verified {len(manifest['files'])} files: {entry}")


if __name__ == "__main__":
    main()
