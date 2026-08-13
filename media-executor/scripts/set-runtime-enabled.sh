#!/usr/bin/env bash
set -euo pipefail

runtime="${1:-}"
state="${2:-}"
case "$runtime:$state" in
    ace:0|ace:1) key=ACE_STEP_ENABLED ;;
    stable-audio:0|stable-audio:1) key=STABLE_AUDIO_3_LICENSE_ACCEPTED ;;
    *) echo "用法：$0 ace|stable-audio 0|1" >&2; exit 2 ;;
esac

env_file="${XDG_CONFIG_HOME:-$HOME/.config}/infinite-canvas/media-executor.env"
[[ -f "$env_file" ]] || { echo "环境文件不存在：$env_file" >&2; exit 1; }
if grep -q "^${key}=" "$env_file"; then
    sed -i "s/^${key}=.*/${key}=${state}/" "$env_file"
else
    printf '%s=%s\n' "$key" "$state" >> "$env_file"
fi
echo "$key=$state"
