#!/usr/bin/env bash
set -euo pipefail

comfy_url="${COMFY_H3_URL:-http://127.0.0.1:8189}"
comfy_root="${COMFY_H3_ROOT:-/home/cec/ComfyUI-H3}"

echo "== GPU =="
nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv,noheader || echo "GPU 驱动在当前主机不可用"
echo "== Services =="
systemctl is-active comfyui-h3.service infinite-media-executor.service 2>/dev/null || true
echo "== Queue =="
curl -fsS "$comfy_url/queue" || echo "ComfyUI-H3 队列接口不可达：$comfy_url"
echo
echo "== Node capabilities =="
curl -fsS "$comfy_url/object_info/MiniMaxH3AddGuide" || echo "MiniMaxH3AddGuide 未探测到"
echo
curl -fsS "$comfy_url/object_info/MiniMaxH3TurboLoRA" || true
echo
curl -fsS "$comfy_url/object_info/MiniMaxH3TurboSampler" || true
echo
echo "== Revisions =="
git -C "$comfy_root" rev-parse HEAD 2>/dev/null || true
git -C "$comfy_root/custom_nodes/ComfyUI-MiniMax-H3-Turbo" rev-parse HEAD 2>/dev/null || true
echo "== H3 model files =="
find /data/sas/ComfyUI/models -maxdepth 3 -type f -o -type l | grep -E 'minimax_h3|qwen3vl_32b_minimax_h3' | sort
