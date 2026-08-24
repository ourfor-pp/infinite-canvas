#!/usr/bin/env bash
set -euo pipefail

repository="Comfy-Org/flux2-dev"
revision="7a0f7814935f81acf49d70a6616c7ed2f18afb8b"
ssd_root="${COMFY_MODEL_SSD_ROOT:-/home/cec/.local/share/comfyui-models}"
entry_root="${COMFY_MODEL_ROOT:-/data/sas/ComfyUI/models}"
modelscope_python="${MODELSCOPE_PYTHON:-/home/cec/ComfyUI-H3-current/.venv/bin/python}"
checkout="$ssd_root/Comfy-Org-flux2-dev-$revision"
files=(
    split_files/diffusion_models/flux2_dev_fp8mixed.safetensors
    split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors
    split_files/vae/flux2-vae.safetensors
)
hashes=(
    863a82e4ff950a42a6b0e80bea824828f129eb1a8fbbdbd9e8cb29859127b486
    e3467b7d912a234fb929cdf215dc08efdb011810b44bc21081c4234cc75b370e
    d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5
)

mkdir -p "$checkout" "$entry_root/diffusion_models" "$entry_root/text_encoders" "$entry_root/vae"

verify_files() {
    local status=0 source_file
    for index in "${!files[@]}"; do
        source_file="$checkout/${files[$index]}"
        echo "${hashes[$index]}  $source_file" | sha256sum --check || status=1
    done
    return "$status"
}

all_present=true
for file in "${files[@]}"; do
    [[ -f "$checkout/$file" ]] || all_present=false
done
if [[ "$all_present" != true ]] || ! verify_files; then
    [[ -x "$modelscope_python" ]] || { echo "找不到可用的 ModelScope Python：$modelscope_python" >&2; exit 1; }
    "$modelscope_python" -m modelscope.cli.cli download "$repository" "${files[@]}" --revision "$revision" --local-dir "$checkout" --force
    verify_files
fi

links=(
    "$entry_root/diffusion_models/flux2_dev_fp8mixed.safetensors"
    "$entry_root/text_encoders/mistral_3_small_flux2_fp8.safetensors"
    "$entry_root/vae/flux2-vae.safetensors"
)
for index in "${!links[@]}"; do
    link="${links[$index]}"
    if [[ -e "$link" && ! -L "$link" ]]; then
        echo "ComfyUI 模型入口已被真实文件占用，拒绝覆盖：$link" >&2
        exit 1
    fi
    ln -sfn "$checkout/${files[$index]}" "$link"
done

printf '{\n  "repository": "%s",\n  "revision": "%s",\n  "source": "ModelScope",\n  "license": "FLUX Non-Commercial License v2.1",\n  "files": [\n' "$repository" "$revision" > "$checkout/manifest.json"
for index in "${!files[@]}"; do
    separator=,
    [[ "$index" -eq $((${#files[@]} - 1)) ]] && separator=
    printf '    {"path": "%s", "sha256": "%s"}%s\n' "${files[$index]}" "${hashes[$index]}" "$separator" >> "$checkout/manifest.json"
done
printf '  ]\n}\n' >> "$checkout/manifest.json"

echo "FLUX.2 Dev 已安装到 SSD：$checkout"
echo "ComfyUI 稳定入口：$entry_root"
