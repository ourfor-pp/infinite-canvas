import { applyH3PddRef8, buildComfyWorkflow, type ComfyUploadedInput } from "./comfy-workflows.js";

export type H3Experiment = "base" | "lightx2v-ref4" | "lightx2v-ref8" | "pdd-ref8" | "vdn8";

/** Isolated evaluation only. These recipes are not advertised by the model catalog. */
export function buildH3Experiment(input: { recipe: H3Experiment; mode: "fl2va" | "ref2va"; prompt: string; files: ComfyUploadedInput[]; seed: number; seconds?: number }) {
    if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error("实验必须指定有效的固定 seed");
    if ((input.recipe.startsWith("lightx2v-ref") || input.recipe === "pdd-ref8") && input.mode !== "ref2va") throw new Error("Ref2VA 加速权重不能用于 FL2VA");
    const graph = buildComfyWorkflow({ model: `minimax-h3-${input.mode}-local`, prompt: input.prompt, files: input.files, params: { qualityPreset: "preview", seconds: input.seconds || 5, resolution: "480p" } });
    Object.assign(graph["5"]!.inputs, { width: 960, height: 544 });
    graph["9"]!.inputs.noise_seed = input.seed;
    graph["14"]!.inputs.filename_prefix = `H3-Evaluation/${input.mode}-${input.recipe}-${input.seed}`;
    const steps = input.recipe === "base" ? 20 : input.recipe === "lightx2v-ref4" ? 4 : 8;
    graph["8"]!.inputs.steps = steps;
    if (input.recipe.startsWith("lightx2v-ref")) {
        graph["16"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: input.recipe === "lightx2v-ref4" ? "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors" : "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", strength_model: 1 } };
        graph["17"] = { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["16", 0], shift_video: 12, shift_audio: 3 } };
        graph["15"]!.inputs.model = ["17", 0];
        graph["7"]!.inputs.sampler_name = "euler";
    } else if (input.recipe === "pdd-ref8") {
        applyH3PddRef8(graph);
    } else if (input.recipe === "vdn8") {
        // VDN replaces attention and supplies both released adapters; do not stack a Turbo LoRA or Sage patch.
        graph["15"] = { class_type: "ApplyVDNH3", inputs: { model: ["1", 0], vdn_checkpoint: "stage-dmd-step-250", apply_turbo_adapter: true, strength: 1, lora_mode: "merge", branch_weights: "auto", retain_buffers: "auto", verbose: false, attention_backend: "grouped" } };
        graph["7"]!.inputs.sampler_name = "er_sde";
        graph["8"]!.inputs.scheduler = "beta";
    }
    return { graph, recipe: { id: input.recipe, mode: input.mode, seed: input.seed, steps, width: 960, height: 544, frames: graph["5"]!.inputs.length, experimental: true, audioAccepted: false } };
}
