#!/usr/bin/env bash
set -euo pipefail
executor_root="$(cd "$(dirname "$0")/.." && pwd)"
source_root="$executor_root/third_party/IndexTTS"
revision=ee40fa7d6c6b8a2c7f06105f9f1e65775b74868c
if [[ ! -d "$source_root" ]]; then
    git clone https://github.com/index-tts/index-tts.git "$source_root"
    git -C "$source_root" checkout --detach "$revision"
fi
[[ "$(git -C "$source_root" remote get-url origin)" == https://github.com/index-tts/index-tts.git ]]
[[ "$(git -C "$source_root" rev-parse HEAD)" == "$revision" ]]
[[ -z "$(git -C "$source_root" status --porcelain --untracked-files=no)" ]]
uv sync --project "$executor_root/runtimes/indextts" --python 3.11 --frozen
echo 'IndexTTS runtime installed. Download verified weights and qualify inference before configuring MEDIA_EXECUTOR_INDEX_REVISION.'
