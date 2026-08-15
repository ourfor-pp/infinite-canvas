#!/usr/bin/env bash
set -euo pipefail

comfy_commit="${COMFY_H3_COMMIT:-7fe8a6138504f90ff7be82f3babf416da32876b1}"
turbo_commit="${H3_TURBO_NODE_COMMIT:-4274783a23afcfdbea3b4876cb79effd6c510785}"
kj_nodes_commit="${H3_KJ_NODES_COMMIT:-6edfa76599c13905968841b81309784a7dbb7803}"
turbo_revision="${H3_TURBO_LORA_REVISION:-43a74557ac3f6539db8e0f2a959d03feb7a81480}"
runtime_root="${MEDIA_H3_RUNTIME_ROOT:-/home/cec/.local/share/infinite-media-executor/h3-runtimes}"
model_ssd_root="${MEDIA_MODEL_SSD_ROOT:-/home/cec/.local/share/infinite-media-executor/models}"
model_entry_root="${MEDIA_MODEL_ROOT:-/data/sas/ComfyUI/models}"
target="$runtime_root/ComfyUI-$comfy_commit"
stable_link="${COMFY_H3_STABLE_LINK:-/home/cec/ComfyUI-H3-current}"
turbo_name=minimax_h3_turbo_v4_step600_ema.safetensors
turbo_path="$model_ssd_root/H3-Turbo/$turbo_name"

curl -fsS http://127.0.0.1:8189/queue | grep -Eq '"queue_running"[[:space:]]*:[[:space:]]*\[\]' || {
    echo "ComfyUI-H3 仍有运行任务，拒绝升级。" >&2
    exit 1
}
mkdir -p "$runtime_root" "$model_ssd_root/H3-Turbo" "$model_entry_root/loras"
if [[ ! -d "$target/.git" ]]; then
    git clone --filter=blob:none https://github.com/comfyanonymous/ComfyUI.git "$target"
fi
git -C "$target" fetch --depth=1 origin "$comfy_commit"
git -C "$target" checkout --detach "$comfy_commit"

turbo_node="$target/custom_nodes/ComfyUI-MiniMax-H3-Turbo"
if [[ ! -d "$turbo_node/.git" ]]; then
    git clone --filter=blob:none https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo.git "$turbo_node"
fi
git -C "$turbo_node" fetch --depth=1 origin "$turbo_commit"
git -C "$turbo_node" checkout --detach "$turbo_commit"

kj_node="$target/custom_nodes/ComfyUI-KJNodes"
if [[ ! -d "$kj_node/.git" ]]; then
    git clone --filter=blob:none https://github.com/kijai/ComfyUI-KJNodes.git "$kj_node"
fi
git -C "$kj_node" fetch --depth=1 origin "$kj_nodes_commit"
git -C "$kj_node" checkout --detach "$kj_nodes_commit"

if [[ ! -f "$turbo_path" ]]; then
    curl -fL --retry 3 "https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora/resolve/$turbo_revision/$turbo_name" -o "$turbo_path.part"
    mv "$turbo_path.part" "$turbo_path"
fi
ln -sfn "$turbo_path" "$model_entry_root/loras/$turbo_name"

if [[ ! -x "$target/.venv/bin/python" ]]; then
    uv venv --python 3.12 "$target/.venv"
fi
uv pip install --python "$target/.venv/bin/python" -r "$target/requirements.txt"
if [[ -f "$turbo_node/requirements.txt" ]]; then
    uv pip install --python "$target/.venv/bin/python" -r "$turbo_node/requirements.txt"
fi
if [[ -f "$kj_node/requirements.txt" ]]; then
    uv pip install --python "$target/.venv/bin/python" -r "$kj_node/requirements.txt"
fi

manifest="$model_ssd_root/H3-Turbo/manifest.json"
sha256="$(sha256sum "$turbo_path" | cut -d' ' -f1)"
printf '{\n  "repository": "larryvrh/MiniMax-H3-Turbo-Lora",\n  "revision": "%s",\n  "file": "%s",\n  "sha256": "%s",\n  "license": "Apache-2.0"\n}\n' "$turbo_revision" "$turbo_name" "$sha256" > "$manifest"

log_file="$(mktemp)"
"$target/.venv/bin/python" "$target/main.py" --listen 127.0.0.1 --port 8190 --models-directory "$model_entry_root" --disable-auto-launch > "$log_file" 2>&1 &
probe_pid=$!
cleanup() { kill "$probe_pid" 2>/dev/null || true; wait "$probe_pid" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 90); do
    if curl -fsS http://127.0.0.1:8190/object_info/MiniMaxH3AddGuide | grep -q MiniMaxH3AddGuide \
        && curl -fsS http://127.0.0.1:8190/object_info/MiniMaxH3TurboLoRA | grep -q MiniMaxH3TurboLoRA \
        && curl -fsS http://127.0.0.1:8190/object_info/MiniMaxH3TurboSampler | grep -q MiniMaxH3TurboSampler \
        && curl -fsS http://127.0.0.1:8190/object_info/PathchSageAttentionKJ | grep -q PathchSageAttentionKJ \
        && curl -fsS http://127.0.0.1:8190/object_info/SaveVideo | grep -q SaveVideo; then
        ln -sfn "$target" "$stable_link"
        echo "H3 checkout 与节点探测通过：$target"
        echo "Turbo SHA256：$sha256"
        echo "稳定入口已切换：$stable_link"
        exit 0
    fi
    sleep 1
done
cat "$log_file" >&2
echo "新 checkout 节点探测失败，稳定入口未切换。" >&2
exit 1
