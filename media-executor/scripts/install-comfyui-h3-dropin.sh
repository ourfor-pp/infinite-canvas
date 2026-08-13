#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_file="$project_root/media-executor/systemd/comfyui-h3.service.d/10-infinite-media.conf"
target_dir=/etc/systemd/system/comfyui-h3.service.d

curl -fsS http://127.0.0.1:8189/queue | grep -Eq '"queue_running"[[:space:]]*:[[:space:]]*\[\]' || {
    echo "ComfyUI-H3 仍有运行任务，拒绝重启。" >&2
    exit 1
}
sudo install -d -m 0755 "$target_dir"
sudo install -m 0644 "$source_file" "$target_dir/10-infinite-media.conf"
sudo systemctl daemon-reload
sudo systemctl restart comfyui-h3.service
systemctl is-active --quiet comfyui-h3.service
echo "ComfyUI-H3 CUDA 13 运行环境已安装。"
