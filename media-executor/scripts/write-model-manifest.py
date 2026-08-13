#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

ENTRY = Path(os.getenv("MEDIA_MODEL_ROOT", "/data/sas/models"))
SSD = Path(os.getenv("MEDIA_MODEL_SSD_ROOT", Path.home() / ".local/share/infinite-media-executor/models"))


def fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts):
        stat = path.stat()
        digest.update(f"{path.relative_to(root)}\0{stat.st_size}\n".encode())
    return digest.hexdigest()


models = []
for link in sorted(ENTRY.iterdir() if ENTRY.exists() else []):
    if not link.is_symlink():
        continue
    target = link.resolve()
    if not target.is_dir() or target.parent != SSD.resolve():
        continue
    revision = None
    head = target / ".git/HEAD"
    if head.is_file():
        result = subprocess.run(["git", "-C", str(target), "rev-parse", "HEAD"], capture_output=True, text=True)
        revision = result.stdout.strip() or None
    models.append({
        "name": link.name,
        "entry": str(link),
        "physicalPath": str(target),
        "revision": revision,
        "fileListSha256": fingerprint(target),
    })

SSD.mkdir(parents=True, exist_ok=True)
manifest = SSD / "manifest.json"
manifest.write_text(json.dumps({"schemaVersion": 1, "models": models}, ensure_ascii=False, indent=2) + "\n")
entry_manifest = ENTRY / "manifest.json"
if entry_manifest.exists() and not entry_manifest.is_symlink():
    raise SystemExit(f"refusing to replace regular file: {entry_manifest}")
entry_manifest.unlink(missing_ok=True)
entry_manifest.symlink_to(manifest)
print(manifest)
