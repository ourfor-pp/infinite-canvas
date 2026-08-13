#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../.." && pwd)"
executor_root="$project_root/media-executor"
config_root="${XDG_CONFIG_HOME:-$HOME/.config}/infinite-canvas"
unit_root="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
state_root="${XDG_STATE_HOME:-$HOME/.local/state}/infinite-media-executor"
env_file="$config_root/media-executor.env"
mkdir -p "$config_root" "$unit_root" "$state_root"

if [[ ! -f "$env_file" ]]; then
    token="$(openssl rand -hex 32)"
    sed \
      -e "s|replace-with-a-long-random-token|$token|" \
      -e "s|/var/lib/infinite-media-executor|$state_root|" \
      "$executor_root/systemd/media-executor.env.example" > "$env_file"
    chmod 600 "$env_file"
fi

ensure_env() {
    local key="$1" value="$2"
    grep -q "^${key}=" "$env_file" || printf '%s=%s\n' "$key" "$value" >> "$env_file"
}
ensure_env ACESTEP_INIT_LLM true
ensure_env ACESTEP_NO_INIT true
ensure_env ACESTEP_DOWNLOAD_SOURCE modelscope
ensure_env ACESTEP_USE_FLASH_ATTENTION false
ensure_env ACESTEP_OFFLOAD_DIT_TO_CPU true
ensure_env PYTORCH_CUDA_ALLOC_CONF expandable_segments:True

write_unit() {
    local name="$1" description="$2" working_dir="$3" command="$4" after="${5:-network.target}"
    {
        printf '[Unit]\nDescription=%s\nAfter=%s\n\n' "$description" "$after"
        printf '[Service]\nWorkingDirectory=%s\nEnvironmentFile=%s\nExecStart=%s\nRestart=on-failure\nRestartSec=3\n' "$working_dir" "$env_file" "$command"
        [[ "$name" == infinite-media-executor ]] && printf 'NoNewPrivileges=false\n'
        printf '\n'
        printf '[Install]\nWantedBy=default.target\n'
    } > "$unit_root/$name.service"
}

write_unit infinite-media-executor 'Infinite Canvas Media Executor' "$executor_root" "$executor_root/.venv/bin/infinite-media-executor"
write_unit infinite-qwen-tts 'Infinite Canvas Qwen3 TTS Runtime' "$executor_root/runtimes/qwen_tts" "$executor_root/runtimes/qwen_tts/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8301"
write_unit infinite-moss-sfx 'Infinite Canvas MOSS SoundEffect Runtime' "$executor_root/runtimes/moss_sfx" "$executor_root/runtimes/moss_sfx/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8302"
write_unit infinite-ace-step-engine 'ACE-Step 1.5 Official API' "$executor_root/third_party/ACE-Step-1.5" "$executor_root/third_party/ACE-Step-1.5/.venv/bin/acestep-api"
write_unit infinite-ace-step 'Infinite Canvas ACE-Step Runtime Adapter' "$executor_root/runtimes/ace_step" "$executor_root/runtimes/ace_step/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8303" 'network.target infinite-ace-step-engine.service'

systemctl --user daemon-reload
systemctl --user enable infinite-media-executor infinite-qwen-tts infinite-moss-sfx
if grep -qx 'ACE_STEP_ENABLED=1' "$env_file"; then
    systemctl --user enable infinite-ace-step-engine infinite-ace-step
else
    systemctl --user disable infinite-ace-step-engine infinite-ace-step >/dev/null 2>&1 || true
fi
echo "用户服务已安装；环境文件：$env_file"
echo "先完成各运行时安装和 smoke test，再用 systemctl --user start <unit> 启动。"
