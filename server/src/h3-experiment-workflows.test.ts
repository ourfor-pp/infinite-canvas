import assert from "node:assert/strict";
import test from "node:test";
import { buildH3Experiment, type H3Experiment } from "./h3-experiment-workflows.js";

test("隔离配方共享输入、帧数和随机种子，保留原声音轨", () => {
    const runs = (["base", "lightx2v-ref4", "pdd-ref8", "vdn8"] as H3Experiment[]).map((recipe) => buildH3Experiment({ recipe, mode: "ref2va", prompt: "test", seed: 42, files: [{ fileId: "i", kind: "image", name: "reference.png" }] }));
    assert.ok(runs.every(({ graph }) => graph["9"]!.inputs.noise_seed === 42 && graph["5"]!.inputs.length === 124 && graph["12"]!.class_type === "VAEDecodeAudio"));
    assert.deepEqual(runs[2]!.graph["10"]!.inputs.sigmas, ["16", 1]);
    assert.equal(runs[3]!.graph["15"]!.class_type, "ApplyVDNH3");
    assert.equal(runs[3]!.graph["16"], undefined);
    assert.throws(() => buildH3Experiment({ recipe: "pdd-ref8", mode: "fl2va", prompt: "test", seed: 42, files: [] }));
});

test("新版 Ref2V 八步使用独立权重且拒绝 FL2VA", () => {
    const input = { recipe: "lightx2v-ref8" as const, mode: "ref2va" as const, prompt: "test", seed: 42, files: [] };
    const { graph, recipe } = buildH3Experiment(input);
    assert.equal(recipe.steps, 8);
    assert.equal(graph["16"]!.inputs.lora_name, "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
    assert.equal(graph["7"]!.inputs.sampler_name, "euler");
    assert.throws(() => buildH3Experiment({ ...input, mode: "fl2va" }));
});
