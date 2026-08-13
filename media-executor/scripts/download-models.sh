#!/usr/bin/env bash
set -euo pipefail

entry_root="${MEDIA_MODEL_ROOT:-/data/sas/models}"
ssd_root="${MEDIA_MODEL_SSD_ROOT:-${HOME}/.local/share/infinite-media-executor/models}"
mkdir -p "$entry_root" "$ssd_root"

download_modelscope() {
    local repo="$1" name="$2" revision="$3"
    local target="$ssd_root/$name"
    if [[ -e "$target" ]]; then
        [[ -d "$target/.git" ]] || { echo "目标已存在但不是 Git 仓库：$target" >&2; return 1; }
        git -C "$target" fetch --depth 1 origin "$revision"
    else
        git clone --filter=blob:none "https://www.modelscope.cn/$repo.git" "$target"
        git -C "$target" fetch --depth 1 origin "$revision"
    fi
    git -C "$target" checkout --detach "$revision"
    git -C "$target" lfs pull
    if [[ -e "$entry_root/$name" && ! -L "$entry_root/$name" ]]; then
        echo "统一入口已被真实目录占用，拒绝覆盖：$entry_root/$name" >&2
        return 1
    fi
    ln -sfn "$target" "$entry_root/$name"
}

download_modelscope Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice Qwen3-TTS-12Hz-1.7B-CustomVoice 54dfa57e196341bfa4994c97ad1f0f874964eeab
download_modelscope Qwen/Qwen3-TTS-12Hz-1.7B-Base Qwen3-TTS-12Hz-1.7B-Base dfb4a462f62f8f831ff0ffabf31189fc9d4344fd
download_modelscope openmoss/MOSS-SoundEffect-v2.0 MOSS-SoundEffect-v2.0 4186a598ef1e99df4d4f8ebf7b31ed21a935c16f

download_ace_checkpoints() {
    local target="$ssd_root/ACE-Step1.5"
    if [[ -e "$target" ]]; then
        [[ -d "$target/.git" ]] || { echo "目标已存在但不是 Git 仓库：$target" >&2; return 1; }
    else
        git clone --filter=blob:none https://www.modelscope.cn/ACE-Step/Ace-Step1.5.git "$target"
    fi
    git -C "$target" fetch --depth 1 origin 3e24671cd4f2830dea1cbf5eaaf00cab1087f7ea
    git -C "$target" checkout --detach 3e24671cd4f2830dea1cbf5eaaf00cab1087f7ea
    git -C "$target" lfs pull
    download_nested() {
        local repo="$1" name="$2" revision="$3" nested="$target/$name"
        if [[ ! -e "$nested" ]]; then
            git clone --filter=blob:none "https://www.modelscope.cn/$repo.git" "$nested"
        fi
        git -C "$nested" fetch --depth 1 origin "$revision"
        git -C "$nested" checkout --detach "$revision"
        git -C "$nested" lfs pull
    }
    download_nested ACE-Step/acestep-v15-xl-sft acestep-v15-xl-sft d1ca0bc96e29cd46435219ceb4f8e3a13a8eaf50
    if [[ -e "$entry_root/ACE-Step1.5" && ! -L "$entry_root/ACE-Step1.5" ]]; then
        echo "统一入口已被真实目录占用，拒绝覆盖：$entry_root/ACE-Step1.5" >&2
        return 1
    fi
    ln -sfn "$target" "$entry_root/ACE-Step1.5"
}

download_ace_checkpoints

if [[ "${STABLE_AUDIO_3_LICENSE_ACCEPTED:-0}" == "1" ]]; then
    echo "Stable Audio 3 没有已确认的 ModelScope 同仓；请按许可要求从官方 Hugging Face 下载并固定 revision。" >&2
    exit 2
fi

"$(dirname "$0")/write-model-manifest.py"
