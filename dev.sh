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
comfy_system_unit="${COMFYUI_SYSTEM_UNIT:-comfyui-h3.service}"
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
    pid="$(comfy_main_pid)"
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

comfy_main_pid() {
    local pid
    pid="$(systemctl --user show "$comfy_unit" --property=MainPID --value 2>/dev/null || true)"
    if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
        pid="$(systemctl show "$comfy_system_unit" --property=MainPID --value 2>/dev/null || true)"
    fi
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] && printf '%s\n' "$pid"
}

comfy_user_unit_loaded() {
    [[ "$(systemctl --user show "$comfy_unit" --property=LoadState --value 2>/dev/null || true)" == "loaded" ]]
}

comfy_system_unit_loaded() {
    [[ "$(systemctl show "$comfy_system_unit" --property=LoadState --value 2>/dev/null || true)" == "loaded" ]]
}

comfy_queue_idle() {
    curl -fsS "$comfy_local_url/queue" | python3 -c 'import json,sys; q=json.load(sys.stdin); raise SystemExit(0 if not q.get("queue_running") and not q.get("queue_pending") else 1)'
}

start_comfyui() {
    if curl -fsS "$comfy_local_url/system_stats" >/dev/null 2>&1; then
        if comfy_is_backend_only; then
            echo "ComfyUI 已运行，仅供后端访问：$comfy_local_url"
            return
        fi
        if ! comfy_queue_idle; then
            echo "ComfyUI 正在执行任务，暂不重启。任务结束后重新运行 ./dev.sh。" >&2
            exit 1
        fi
        if comfy_system_unit_loaded; then
            echo "系统服务 $comfy_system_unit 已占用 8189，但没有仅绑定后端回环地址。" >&2
            echo "请先运行 media-executor/scripts/install-comfyui-h3-dropin.sh 修复正式服务。" >&2
            exit 1
        fi
        if ! comfy_user_unit_loaded; then
            echo "8189 已被未识别的 ComfyUI 进程占用，拒绝自动停止。" >&2
            echo "请先确认该进程的启动方式，或通过 COMFYUI_UNIT 指定对应的用户服务。" >&2
            exit 1
        fi
        echo "请先将用户服务 $comfy_unit 配置为 --listen 127.0.0.1，再重启该服务。" >&2
        exit 1
    fi

    echo "正在启动 ComfyUI：$comfy_local_url"
    if comfy_user_unit_loaded; then
        systemctl --user start "$comfy_unit"
    elif comfy_system_unit_loaded; then
        systemctl start "$comfy_system_unit"
    else
        if [[ ! -x "$comfy_python" || ! -d "$comfy_models_dir" ]]; then
            echo "找不到 ComfyUI Python 或模型目录：$comfy_python，$comfy_models_dir" >&2
            exit 1
        fi
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
    fi

    for _ in {1..180}; do
        if curl -fsS "$comfy_local_url/system_stats" >/dev/null 2>&1; then
            if ! comfy_is_backend_only; then
                echo "ComfyUI 未仅绑定 127.0.0.1，请检查服务的 --listen 配置。" >&2
                exit 1
            fi
            echo "ComfyUI 已就绪"
            return
        fi
        sleep 0.5
    done
    echo "ComfyUI 启动超时，请查看日志：$comfy_log" >&2
    exit 1
}

executor_is_ready() {
    curl --max-time 10 -fsS \
        -H "Authorization: Bearer $executor_token" \
        -H "X-Media-Protocol: 2" \
        "$executor_local_url/health" >/dev/null 2>&1
}

start_media_executor() {
    if executor_is_ready; then
        echo "媒体执行器已运行：$executor_local_url"
        return
    fi
    local http_status
    http_status="$(curl --max-time 10 -sS -o /dev/null -w '%{http_code}' "$executor_local_url/health" 2>/dev/null || true)"
    if [[ "$http_status" != "000" && -n "$http_status" ]]; then
        echo "8290 已有 HTTP 服务响应，但媒体执行器健康检查未通过；请检查 $executor_env 中的凭据、协议版本和服务日志。" >&2
        exit 1
    fi
    if systemctl --user cat infinite-media-executor.service >/dev/null 2>&1; then
        echo "正在启动常驻媒体执行器：$executor_local_url"
        systemctl --user start infinite-media-executor.service
        for _ in {1..60}; do
            if executor_is_ready; then
                echo "媒体执行器已就绪"
                return
            fi
            sleep 0.25
        done
        echo "常驻媒体执行器启动失败，请查看：journalctl --user -u infinite-media-executor" >&2
        exit 1
    fi
    if [[ ! -x "$executor_dir/.venv/bin/infinite-media-executor" ]]; then
        echo "正在安装媒体执行器轻量依赖..."
        (cd "$executor_dir" && uv sync --extra test)
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
        if executor_is_ready; then
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
