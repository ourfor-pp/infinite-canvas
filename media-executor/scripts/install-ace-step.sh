#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../.." && pwd)"
executor_root="$project_root/media-executor"
source_root="$executor_root/third_party/ACE-Step-1.5"
revision="${ACE_STEP_CODE_REVISION:-6d467e4b5081ccb0abf1ec1bf4fdf9051a2d34b0}"
checkpoint_root="${ACESTEP_CHECKPOINTS_DIR:-/data/sas/models/ACE-Step1.5}"

if [[ ! -d "$source_root/.git" ]]; then
    mkdir -p "$(dirname "$source_root")"
    git clone https://github.com/ACE-Step/ACE-Step-1.5.git "$source_root"
fi
git -C "$source_root" fetch --depth 1 origin "$revision"
git -C "$source_root" checkout --detach "$revision"
apply_once() {
    local patch="$1"
    if git -C "$source_root" apply --reverse --check "$patch" 2>/dev/null; then
        return
    fi
    git -C "$source_root" apply --check "$patch"
    git -C "$source_root" apply "$patch"
}
apply_once "$executor_root/patches/ace-step-linux-python312.patch"
apply_once "$executor_root/patches/ace-step-rest-quality.patch"
(
    cd "$source_root"
    UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-600}" uv lock --python 3.12
    UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-600}" uv sync --python 3.12 --no-install-package flash-attn
    .venv/bin/acestep-api --help >/dev/null
)
if [[ -e "$source_root/checkpoints" && ! -L "$source_root/checkpoints" ]]; then
    echo "源码 checkpoints 是真实目录，拒绝覆盖；请移走后重新执行：$source_root/checkpoints" >&2
    exit 1
fi
ln -sfn "$checkpoint_root" "$source_root/checkpoints"
echo "ACE-Step $revision 已安装；请完成真实音乐 smoke test 后再启用 ACE_STEP_ENABLED。"
