#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$project_dir/web"
comfy_dir="${COMFYUI_DIR:-/home/cec/ComfyUI-H3}"
comfy_models_dir="${COMFYUI_MODELS_DIR:-/data/sas/ComfyUI/models}"
comfy_unit="${COMFYUI_UNIT:-arcreel-comfyui-8189.service}"
comfy_local_url="http://127.0.0.1:8189"
comfy_public_url="${COMFYUI_PUBLIC_URL:-http://192.168.3.55:8189}"
comfy_log="$comfy_dir/comfyui-8189.log"
comfy_python="$comfy_dir/.venv/bin/python"
cuda_lib="$comfy_dir/.venv/lib/python3.12/site-packages/nvidia/cu13/lib:$comfy_dir/.venv/lib/python3.12/site-packages/nvidia/cuda_nvrtc/lib"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "缺少命令：$1" >&2
        exit 1
    fi
}

comfy_has_wildcard_cors() {
    local pid index next
    local -a args=()
    pid="$(systemctl --user show "$comfy_unit" --property=MainPID --value 2>/dev/null || true)"
    [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/cmdline" ]] || return 1
    mapfile -d '' -t args < "/proc/$pid/cmdline"
    for index in "${!args[@]}"; do
        [[ "${args[$index]}" == "--enable-cors-header" ]] || continue
        next="${args[$((index + 1))]:-}"
        [[ -z "$next" || "$next" == --* || "$next" == "*" ]]
        return
    done
    return 1
}

comfy_queue_idle() {
    curl -fsS "$comfy_local_url/queue" | python3 -c 'import json,sys; q=json.load(sys.stdin); raise SystemExit(0 if not q.get("queue_running") and not q.get("queue_pending") else 1)'
}

start_comfyui() {
    if [[ ! -x "$comfy_python" ]]; then
        echo "找不到 ComfyUI Python：$comfy_python" >&2
        exit 1
    fi
    if [[ ! -d "$comfy_models_dir" ]]; then
        echo "找不到 ComfyUI 模型目录：$comfy_models_dir" >&2
        exit 1
    fi

    if curl -fsS "$comfy_local_url/system_stats" >/dev/null 2>&1; then
        if comfy_has_wildcard_cors; then
            echo "ComfyUI 已运行：$comfy_public_url"
            return
        fi
        if ! comfy_queue_idle; then
            echo "ComfyUI 正在执行任务，暂不重启。任务结束后重新运行 ./dev.sh。" >&2
            exit 1
        fi
        echo "正在重启 ComfyUI 以启用内网 CORS..."
        systemctl --user stop "$comfy_unit"
        for _ in {1..30}; do
            systemctl --user status "$comfy_unit" >/dev/null 2>&1 || break
            sleep 0.2
        done
    fi

    echo "正在启动 ComfyUI：$comfy_public_url"
    systemd-run --user \
        --unit="$comfy_unit" \
        --collect \
        --working-directory="$comfy_dir" \
        --setenv="LD_LIBRARY_PATH=$cuda_lib" \
        --property="StandardOutput=append:$comfy_log" \
        --property="StandardError=append:$comfy_log" \
        "$comfy_python" main.py \
        --listen 0.0.0.0 \
        --port 8189 \
        --models-directory "$comfy_models_dir" \
        --reserve-vram 2 \
        --enable-cors-header \
        --disable-auto-launch

    for _ in {1..180}; do
        if curl -fsS "$comfy_local_url/system_stats" >/dev/null 2>&1; then
            echo "ComfyUI 已就绪"
            return
        fi
        sleep 0.5
    done
    echo "ComfyUI 启动超时，请查看日志：$comfy_log" >&2
    exit 1
}

require_command bun
require_command curl
require_command python3
require_command systemctl
require_command systemd-run

start_comfyui

if [[ ! -d "$web_dir/node_modules" ]]; then
    echo "正在安装前端依赖..."
    (cd "$web_dir" && bun install)
fi

export VITE_LOCAL_COMFYUI_URL="$comfy_public_url"
export VITE_LOCAL_COMFYUI_DEFAULT="true"

echo "正在启动 Infinite Canvas"
echo "本机访问：http://localhost:3000"
echo "局域网访问：http://192.168.3.55:3000"
cd "$web_dir"
exec bun run dev
