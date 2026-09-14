#!/usr/bin/env bash
set -euo pipefail

root="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
echo "Repository: $root"
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free --format=csv,noheader || true
model_root="${MEDIA_MODEL_ROOT:-/data/sas/models}"
df -h "$model_root" "$root" 2>/dev/null || true
find "$model_root" -maxdepth 1 -type l -printf '%f -> %l\n' 2>/dev/null || true
while IFS= read -r link; do
    target="$(readlink -f "$link")"
    source="$(findmnt -T "$target" -no SOURCE 2>/dev/null || true)"
    parent="$(lsblk -ndo PKNAME "$source" 2>/dev/null | head -1 || true)"
    [[ -n "$parent" ]] || parent="$(lsblk -ndo NAME "$source" 2>/dev/null | head -1 || true)"
    rota="$(lsblk -ndo ROTA "/dev/$parent" 2>/dev/null | head -1 || true)"
    echo "$(basename "$link") physical=$target source=$source rota=${rota:-unknown}"
done < <(find "$model_root" -maxdepth 1 -type l ! -name manifest.json 2>/dev/null)
for port in 8001 8189 8290; do
    ss -ltn "sport = :$port" | tail -n +2 | sed "s/^/$port /" || true
done
for runtime in qwen_tts moss_sfx ace_step stable_audio qwen_asr voxcpm; do
    test -x "$root/media-executor/runtimes/$runtime/.venv/bin/python" && echo "$runtime adapter environment: present" || echo "$runtime adapter environment: missing"
done
test -x "$root/media-executor/third_party/ACE-Step-1.5/.venv/bin/acestep-api" && echo "ACE engine environment: present" || echo "ACE engine environment: missing"
test -f "$model_root/manifest.json" && echo "model manifest: present" || echo "model manifest: missing"

# Native worker IPC is local filesystem state, not TCP listeners.
find "${MEDIA_EXECUTOR_DATA_DIR:-$HOME/.local/state/infinite-media-executor}/workers" -maxdepth 1 -type s -printf "%f private socket\n" 2>/dev/null || true
