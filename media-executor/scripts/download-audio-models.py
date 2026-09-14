#!/usr/bin/env python3
"""Fetch pinned official audio weights into revisioned SSD directories."""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

MODELS = [
    ("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "8dd530dbed7fda907a15ac48d7f78742cc90a065", ""),
    ("Qwen/Qwen3-ASR-1.7B", "a04930dbe5419bfee073f7cade734f572689a3a8", "/home/cec/ASRServer/models/Qwen/Qwen3-ASR-1___7B"),
    ("Qwen/Qwen3-ASR-0.6B", "4ce9cc728b473a5aedbe7b6e1ea45646316824dc", "/home/cec/ASRServer/models/Qwen/Qwen3-ASR-0___6B"),
    ("Qwen/Qwen3-ForcedAligner-0.6B", "cf1c50164ea3ac48240d12bef5ead74aee0720cc", "/home/cec/ASRServer/models/Qwen/Qwen3-ForcedAligner-0___6B"),
    ("OpenBMB/VoxCPM2", "519da200db2bc31a0395635fc7042653b9c4c862", "/home/cec/.local/share/comfyui-models/voxcpm/VoxCPM2"),
    ("iic/speech_zipenhancer_ans_multiloss_16k_base", "6879ac170ed1564f46dee038786ed84147205dcf", ""),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ssd-root", type=Path, required=True)
    parser.add_argument("--entry-root", type=Path, required=True)
    parser.add_argument("--model", choices=[item[0] for item in MODELS], help="Download only this model, preserving other manifest entries")
    args = parser.parse_args()
    args.ssd_root.mkdir(parents=True, exist_ok=True)
    args.entry_root.mkdir(parents=True, exist_ok=True)
    manifest = args.entry_root / "audio-models.json"
    records = json.loads(manifest.read_text())["models"] if manifest.exists() else []
    for repository, revision, cache in MODELS:
        if args.model and repository != args.model:
            continue
        name = repository.split("/")[-1]
        target = args.ssd_root / f"{name}-{revision[:12]}"
        url = f"https://modelscope.cn/{repository}.git"
        def git(*values):
            return subprocess.check_output(["git", "-C", str(target), *values], env={**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"}, text=True).strip()
        if not target.exists():
            target.mkdir()
            git("init", "-b", "model")
            git("remote", "add", "origin", url)
            git("fetch", "--depth", "1", "origin", revision)
            git("checkout", "--detach", revision)
        if git("rev-parse", "HEAD") != revision or git("remote", "get-url", "origin") != url:
            raise RuntimeError(f"existing model directory does not match pinned origin: {target}")
        # Reuse a local official-cache file only after matching the repository's LFS hash.
        entries = [{"oid": line.split(" ", 2)[0], "name": line.split(" ", 2)[2]} for line in git("lfs", "ls-files", "--long").splitlines()]
        for item in entries:
            source = Path(cache) / item["name"] if cache else None
            digest = item["oid"]
            if source and source.is_file():
                with source.open("rb") as stream:
                    matches = hashlib.file_digest(stream, "sha256").hexdigest() == digest
                if matches:
                    obj = target / ".git/lfs/objects" / digest[:2] / digest[2:4] / digest
                    obj.parent.mkdir(parents=True, exist_ok=True)
                    if not obj.exists():
                        subprocess.run(["cp", "--reflink=auto", str(source), str(obj)], check=True)
        git("lfs", "pull")
        git("lfs", "fsck")
        link = args.entry_root / name
        if link.is_symlink() and link.resolve() == target.resolve():
            pass
        elif link.exists() or link.is_symlink():
            raise RuntimeError(f"refusing to replace an existing model entry: {link}")
        else:
            link.symlink_to(target.resolve())
        record = {"name": name, "source": url, "revision": revision, "physicalPath": str(target.resolve()), "files": entries}
        records = [item for item in records if item["name"] != name] + [record]
        print(f"Verified {repository}@{revision}", flush=True)
    (args.entry_root / "audio-models.json").write_text(json.dumps({"schemaVersion": 1, "models": records}, indent=2) + "\n")


if __name__ == "__main__":
    main()
