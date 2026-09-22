#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
manifest="$repo_root/media-executor/models/qwen-image21.json"
modelscope_python="${MODELSCOPE_PYTHON:-/home/cec/ComfyUI-H3-current/.venv/bin/python}"
"$modelscope_python" - "$manifest" "${COMFY_MODEL_SSD_ROOT:-/home/cec/.local/share/comfyui-models}" "${COMFY_MODEL_ROOT:-/data/sas/ComfyUI/models}" <<'PY'
import hashlib, json, sys
from pathlib import Path
from modelscope.hub.file_download import model_file_download

manifest = json.loads(Path(sys.argv[1]).read_text())
target = Path(sys.argv[2]) / ('Qwen-Image-2.1-' + manifest['revision'][:12])
entry = Path(sys.argv[3])
for item in manifest['files']:
    path = target / item['path']
    if not path.is_file():
        model_file_download(manifest['repository'], item['path'], revision=manifest['revision'], local_dir=str(target))
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if path.stat().st_size != item['size'] or digest != item['sha256']:
        raise RuntimeError(f'Weight verification failed: {path}')
for item in manifest['files']:
    link = entry / item['path']
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.exists() or link.is_symlink():
        if link.resolve() != (target / item['path']).resolve():
            raise RuntimeError(f'Refusing to replace existing model: {link}')
    else:
        link.symlink_to((target / item['path']).resolve())
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Verified Qwen Image 2.1 weights: {target}')
PY
