#!/usr/bin/env bash
set -euo pipefail

user_units="${1:-infinite-qwen-tts.service,infinite-moss-sfx.service}"
system_units="${2:-comfyui.service,comfyui-h3.service}"
env_file="${XDG_CONFIG_HOME:-$HOME/.config}/infinite-canvas/media-executor.env"
[[ -f "$env_file" ]] || { echo "环境文件不存在：$env_file" >&2; exit 1; }

set_env() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$env_file"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$env_file"
    fi
}
set_env MEDIA_EXECUTOR_ACE_DRAIN_USER_UNITS "$user_units"
set_env MEDIA_EXECUTOR_ACE_DRAIN_SYSTEM_UNITS "$system_units"
set_env MEDIA_EXECUTOR_H3_DRAIN_USER_UNITS "$user_units"
set_env MEDIA_EXECUTOR_H3_DRAIN_SYSTEM_UNITS "${system_units//,comfyui-h3.service/}"
echo "ACE 与 H3 GPU 排空服务已配置。"
