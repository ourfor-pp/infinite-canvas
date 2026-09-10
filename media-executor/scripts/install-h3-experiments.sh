#!/usr/bin/env bash
set -euo pipefail
export UV_NATIVE_TLS="${UV_NATIVE_TLS:-true}"
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-300}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
manifest="$repo_root/media-executor/h3-experiments.json"
revision="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["comfyRevision"])' "$manifest")"
target="${H3_EXPERIMENT_RUNTIME_ROOT:-$repo_root/.tmp/h3-lab}/ComfyUI-$revision"
clone_revision() {
    local url="$1" path="$2" commit="$3"
    if [[ ! -d "$path/.git" ]]; then git clone --filter=blob:none --no-checkout "$url" "$path"; fi
    if [[ "$(git -C "$path" rev-parse HEAD 2>/dev/null || true)" == "$commit" ]]; then return; fi
    git -C "$path" fetch --depth=1 origin "$commit"
    git -C "$path" checkout --detach "$commit"
}
clone_revision https://github.com/Comfy-Org/ComfyUI.git "$target" "$revision"
for entry in 'vdnNodeRevision Saganaki22/ComfyUI-VDN-H3' 'pddNodeRevision Jalen-Brunson/ComfyUI-MiniMax-H3-PDD-Acc'; do
    read -r key repository <<< "$entry"
    commit="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$manifest" "$key")"
    clone_revision "https://github.com/$repository.git" "$target/custom_nodes/${repository##*/}" "$commit"
done
clone_revision https://github.com/kijai/ComfyUI-KJNodes.git "$target/custom_nodes/ComfyUI-KJNodes" 6edfa76599c13905968841b81309784a7dbb7803
if [[ ! -x "$target/.venv/bin/python" ]]; then uv venv --python 3.12 "$target/.venv"; fi
uv pip install --python "$target/.venv/bin/python" --index-url https://download.pytorch.org/whl/cu130 'torch==2.11.0' 'torchvision==0.26.0' 'torchaudio==2.11.0'
uv pip install --python "$target/.venv/bin/python" -r "$target/requirements.txt"
uv pip install --python "$target/.venv/bin/python" -r "$target/custom_nodes/ComfyUI-KJNodes/requirements.txt"
if [[ -n "${H3_SAGE_WHEEL:-}" ]]; then uv pip install --python "$target/.venv/bin/python" --no-deps "$H3_SAGE_WHEEL"; fi
echo "Independent runtime installed: $target"
echo 'No service or stable link was changed. Download models, then run the benchmark on a loopback-only port.'
