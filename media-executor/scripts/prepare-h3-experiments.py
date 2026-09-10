#!/usr/bin/env python3
"""Link verified experiment weights into a separate Comfy model directory."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runtime", type=Path, required=True)
parser.add_argument("--base-models", type=Path, default=Path("/data/sas/ComfyUI/models"))
parser.add_argument("--weights", type=Path, default=Path.home() / ".local/share/infinite-media-executor/models/H3-Experiments")
args = parser.parse_args()
expected = json.loads((Path(__file__).resolve().parents[1] / "h3-experiments.json").read_text())
if json.loads((args.weights / "manifest.json").read_text()) != expected:
    raise RuntimeError("Download and verify all pinned checkpoints before preparing the runtime")
models = args.runtime.resolve() / "models"

def link(target, source):
    source = source.resolve(strict=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        if target.resolve() != source:
            raise RuntimeError(f"Refusing to replace existing path: {target}")
    else:
        target.symlink_to(source)

for name in ("diffusion_models", "text_encoders", "vae"):
    for source in (args.base_models / name).iterdir():
        if source.is_file() and source.suffix == ".safetensors" and "minimax_h3" in source.name:
            link(models / name / source.name, source)
link(models / "loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors", args.weights / "lightx2v/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors")
link(models / "loras/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", args.weights / "lightx2v/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors")
link(models / "pdd_acc/MiniMax-H3-Ref2VA-Acc-8Step.safetensors", args.weights / "alibaba-pai/MiniMax-H3-Ref2VA-Acc-8Step.safetensors")
stage = args.weights / "OpenVDN/stage-dmd-step-250"
for source in stage.rglob("*"):
    if source.is_file():
        link(models / "vdn/stage-dmd-step-250" / source.relative_to(stage), source)
print(models)
