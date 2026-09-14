"""Existing MiniMax Music3 recipe, independent of director timelines."""
import math

MODEL = "minimax-music3-local"


def prepare(request):
    seconds = float(request.get("params", {}).get("seconds", 30))
    if request["mode"] != "music" or request["operation"] != "generate" or not request["prompt"].strip() or request.get("references") or request.get("continuation") or not math.isfinite(seconds) or not 1 <= seconds <= 300:
        raise ValueError("Music3 requires a prompt, 1–300 seconds and no reference media")
    return {"capabilityVersion": "1", "mode": "music", "recipe": "base", "seconds": seconds}


def graph(request, plan):
    def node(kind, **inputs): return {"class_type": kind, "inputs": inputs}
    params = request.get("params", {})
    seed = params["seed"]
    return {
        "1": node("UNETLoader", unet_name="minimax_music3_dit_fp16.safetensors", weight_dtype="default"),
        "2": node("CLIPLoader", clip_name="minimax_music3_text_encoder_pruned_int8_convrot.safetensors", type="minimax", device="default"),
        "3": node("VAELoader", vae_name="minimax_music3_dav.safetensors"),
        "4": node("MiniMaxMusic3TextEncode", clip=["2", 0], caption=request["prompt"], lyrics=str(params.get("lyrics", "[Instrumental]")), seed=seed, max_duration=plan["seconds"], cfg_scale=1.7, top_k=50),
        "5": node("ConditioningZeroOut", conditioning=["4", 0]),
        "6": node("EmptyMiniMaxMusic3LatentAudio", seconds=["4", 1], batch_size=1),
        "7": node("KSampler", model=["1", 0], positive=["4", 0], negative=["5", 0], latent_image=["6", 0], seed=seed, steps=30, cfg=1.7, sampler_name="euler", scheduler="simple", denoise=1),
        "8": node("VAEDecodeAudio", samples=["7", 0], vae=["3", 0]),
        "14": node("SaveAudio", audio=["8", 0], filename_prefix="InfiniteCanvas/MiniMax-Music3"),
    }
