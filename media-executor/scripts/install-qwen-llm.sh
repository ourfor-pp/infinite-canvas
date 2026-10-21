#!/usr/bin/env bash
set -euo pipefail
executor_root="$(cd "$(dirname "$0")/.." && pwd)"
revision=8baabd53b77d1c48c6ef8d3b620436292f3f6231
source_root="${LLAMA_CPP_SOURCE:-$executor_root/third_party/llama.cpp-source}"
build_root="${LLAMA_CPP_BUILD:-$source_root/build}"
engine_root="$executor_root/third_party/llama.cpp-${revision:0:12}"
if [[ ! -d "$source_root" ]]; then
    git clone https://github.com/ggml-org/llama.cpp.git "$source_root"
    git -C "$source_root" checkout --detach "$revision"
fi
[[ "$(git -C "$source_root" remote get-url origin)" == https://github.com/ggml-org/llama.cpp.git ]]
[[ "$(git -C "$source_root" rev-parse HEAD)" == "$revision" ]]
[[ -z "$(git -C "$source_root" status --porcelain --untracked-files=no)" ]]
cmake -S "$source_root" -B "$build_root" -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release -DCMAKE_BUILD_RPATH_USE_ORIGIN=ON -DCMAKE_CUDA_ARCHITECTURES="${LLAMA_CUDA_ARCHITECTURES:-120}" -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build "$build_root" --target llama-server -j "${LLAMA_BUILD_JOBS:-4}"
mkdir -p "$engine_root/bin"
cp -a "$build_root/bin/." "$engine_root/bin/"
uv sync --project "$executor_root/runtimes/qwen_llm" --python 3.12 --frozen
echo 'LLM worker installed. Verify pinned weights and qualify real inference before enabling QWEN_LLM_ENABLED.'
