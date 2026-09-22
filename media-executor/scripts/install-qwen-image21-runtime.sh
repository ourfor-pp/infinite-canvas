#!/usr/bin/env bash
# Prepare the unified ComfyUI upgrade. Switch the existing service only after draining.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
revision="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["comfyRevision"])' "$repo_root/media-executor/models/qwen-image21.json")"
target="${MEDIA_COMFY_RUNTIME_ROOT:-$HOME/.local/share/infinite-media-executor/comfy-runtimes}/ComfyUI-$revision"
base="${COMFY_BASE_RUNTIME:-/home/cec/ComfyUI-H3-current}"
if [[ ! -f "$target/main.py" ]]; then
    mkdir -p "$target"
    archive="$(mktemp)"
    trap 'rm -f "$archive"' EXIT
    curl --fail --location --retry 3 "https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/$revision" -o "$archive"
    tar -xzf "$archive" --strip-components=1 -C "$target"
fi
if [[ "$(readlink -f "$base")" != "$(readlink -f "$target")" ]]; then
    cp -an "$base/custom_nodes/." "$target/custom_nodes/"
    for name in input output user; do
        cp -an "$(readlink -f "$base/$name")/." "$target/$name/"
    done
    if [[ ! -x "$target/.venv/bin/python" ]]; then
        cp -a --reflink=auto "$(readlink -f "$base/.venv")" "$target/.venv"
    fi
fi
uv pip install --python "$target/.venv/bin/python" -r "$target/requirements.txt"
uv pip freeze --python "$target/.venv/bin/python" > "$target/installed-requirements.txt"
printf '%s\n' "$revision" > "$target/source-revision"
ln -sfn "$repo_root/media-executor/comfy-runtime" "$target/custom_nodes/infinite_runtime"
echo "Prepared unified ComfyUI: $target"
echo 'Drain executor jobs, back up configuration, then point the existing 8189 service and stable link to this directory.'
echo 'Keep one COMFYUI_URL and MEDIA_EXECUTOR_COMFY_UNITS; update MEDIA_EXECUTOR_COMFY_REVISION and validate Qwen/H3 before reopening admission.'
