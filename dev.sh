#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$project_dir/web"
server_dir="$project_dir/server"
executor_dir="$project_dir/media-executor"
server_data_dir="${SERVER_DATA_DIR:-$project_dir/data}"
comfy_dir="${COMFYUI_DIR:-/home/cec/ComfyUI-H3}"
comfy_models_dir="${COMFYUI_MODELS_DIR:-/data/sas/ComfyUI/models}"
comfy_unit="${COMFYUI_UNIT:-arcreel-comfyui-8189.service}"
comfy_local_url="http://127.0.0.1:8189"
comfy_log="$comfy_dir/comfyui-8189.log"
comfy_python="$comfy_dir/.venv/bin/python"
executor_local_url="http://127.0.0.1:8290"
executor_env="${MEDIA_EXECUTOR_ENV_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/infinite-canvas/media-executor.env}"
if [[ -r "$executor_env" ]]; then
    executor_token="$(sed -n 's/^MEDIA_EXECUTOR_TOKEN=//p' "$executor_env" | tail -1)"
    executor_data_dir="$(sed -n 's/^MEDIA_EXECUTOR_DATA_DIR=//p' "$executor_env" | tail -1)"
else
    executor_token="${MEDIA_EXECUTOR_TOKEN:-infinite-canvas-local-development}"
    executor_data_dir="${MEDIA_EXECUTOR_DATA_DIR:-$server_data_dir/media-executor}"
fi
cuda_lib="$comfy_dir/.venv/lib/python3.12/site-packages/nvidia/cu13/lib:$comfy_dir/.venv/lib/python3.12/site-packages/nvidia/cuda_nvrtc/lib"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "缺少命令：$1" >&2
        exit 1
    fi
}

comfy_is_backend_only() {
    local pid index next
    local -a args=()
    pid="$(systemctl --user show "$comfy_unit" --property=MainPID --value 2>/dev/null || true)"
    [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/cmdline" ]] || return 1
    mapfile -d '' -t args < "/proc/$pid/cmdline"
    for index in "${!args[@]}"; do
        [[ "${args[$index]}" == "--listen" ]] || continue
        next="${args[$((index + 1))]:-}"
        [[ "$next" == "127.0.0.1" ]]
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
        if comfy_is_backend_only; then
            echo "ComfyUI 已运行，仅供后端访问：$comfy_local_url"
            return
        fi
        if ! comfy_queue_idle; then
            echo "ComfyUI 正在执行任务，暂不重启。任务结束后重新运行 ./dev.sh。" >&2
            exit 1
        fi
        echo "正在重启 ComfyUI，仅绑定后端回环地址..."
        systemctl --user stop "$comfy_unit"
        for _ in {1..30}; do
            systemctl --user status "$comfy_unit" >/dev/null 2>&1 || break
            sleep 0.2
        done
    fi

    echo "正在启动 ComfyUI：$comfy_local_url"
    systemd-run --user \
        --unit="$comfy_unit" \
        --collect \
        --working-directory="$comfy_dir" \
        --setenv="LD_LIBRARY_PATH=$cuda_lib" \
        --property="StandardOutput=append:$comfy_log" \
        --property="StandardError=append:$comfy_log" \
        "$comfy_python" main.py \
        --listen 127.0.0.1 \
        --port 8189 \
        --models-directory "$comfy_models_dir" \
        --reserve-vram 2 \
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

start_media_executor() {
    if curl -fsS -H "Authorization: Bearer $executor_token" "$executor_local_url/health" >/dev/null 2>&1; then
        echo "媒体执行器已运行：$executor_local_url"
        return
    fi
    if [[ ! -x "$executor_dir/.venv/bin/infinite-media-executor" ]]; then
        echo "正在安装媒体执行器轻量依赖..."
        (cd "$executor_dir" && uv sync --extra test)
    fi
    if systemctl --user cat infinite-media-executor.service >/dev/null 2>&1 && ! curl -sS -o /dev/null "$executor_local_url/health"; then
        echo "正在启动常驻媒体执行器：$executor_local_url"
        systemctl --user start infinite-media-executor.service
        for _ in {1..60}; do
            if curl -fsS -H "Authorization: Bearer $executor_token" "$executor_local_url/health" >/dev/null 2>&1; then
                echo "媒体执行器已就绪"
                return
            fi
            sleep 0.25
        done
        echo "常驻媒体执行器启动失败，请查看：journalctl --user -u infinite-media-executor" >&2
        exit 1
    fi
    echo "正在启动媒体执行器：$executor_local_url"
    (
        cd "$executor_dir"
        MEDIA_EXECUTOR_HOST=127.0.0.1 \
        MEDIA_EXECUTOR_PORT=8290 \
        MEDIA_EXECUTOR_TOKEN="$executor_token" \
        MEDIA_EXECUTOR_DATA_DIR="$executor_data_dir" \
        COMFYUI_URL="$comfy_local_url" \
        exec .venv/bin/infinite-media-executor
    ) &
    executor_pid="$!"
    for _ in {1..60}; do
        if curl -fsS -H "Authorization: Bearer $executor_token" "$executor_local_url/health" >/dev/null 2>&1; then
            echo "媒体执行器已就绪"
            return
        fi
        if ! kill -0 "$executor_pid" >/dev/null 2>&1; then
            echo "媒体执行器启动失败" >&2
            exit 1
        fi
        sleep 0.25
    done
    echo "媒体执行器启动超时" >&2
    exit 1
}

require_command bun
require_command curl
require_command python3
require_command systemctl
require_command systemd-run
require_command uv

start_comfyui
executor_pid=""
start_media_executor

if [[ ! -d "$server_dir/node_modules" ]]; then
    echo "正在安装后端依赖..."
    (cd "$server_dir" && bun install)
fi

if [[ ! -d "$web_dir/node_modules" ]]; then
    echo "正在安装前端依赖..."
    (cd "$web_dir" && bun install)
fi

export VITE_LOCAL_COMFYUI_DEFAULT="true"

server_pid=""
cleanup() {
    if [[ -n "$server_pid" ]]; then
        kill "$server_pid" >/dev/null 2>&1 || true
    fi
    if [[ -n "$executor_pid" ]]; then
        kill "$executor_pid" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

if curl -fsS "http://127.0.0.1:3001/api/session" >/dev/null 2>&1; then
    echo "Infinite Canvas 后端已运行：http://127.0.0.1:3001"
else
    echo "正在启动 Infinite Canvas 后端"
    (
        cd "$server_dir"
        PORT=3001 AUTH_MODE=dev DATA_DIR="$server_data_dir" MEDIA_EXECUTOR_URL="$executor_local_url" MEDIA_EXECUTOR_TOKEN="$executor_token" exec bun run dev
    ) &
    server_pid="$!"
    for _ in {1..60}; do
        if curl -fsS "http://127.0.0.1:3001/api/session" >/dev/null 2>&1; then
            break
        fi
        if ! kill -0 "$server_pid" >/dev/null 2>&1; then
            echo "后端启动失败" >&2
            exit 1
        fi
        sleep 0.25
    done
    if ! curl -fsS "http://127.0.0.1:3001/api/session" >/dev/null 2>&1; then
        echo "后端启动超时" >&2
        exit 1
    fi
fi

curl -fsS -X PUT "http://127.0.0.1:3001/api/admin/media-executor/settings" \
    -H "Content-Type: application/json" \
    --data "{\"url\":\"$executor_local_url\",\"token\":\"$executor_token\",\"stableAudio3LicenseAccepted\":false}" \
    >/dev/null
echo "媒体执行器已注册为本地供应商"

echo "正在启动 Infinite Canvas"
echo "本机访问：http://localhost:3000"
echo "局域网访问：http://192.168.3.55:3000"
cd "$web_dir"
bun run dev
