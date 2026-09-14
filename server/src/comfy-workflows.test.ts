import assert from "node:assert/strict";
import test from "node:test";

import { buildComfyWorkflow, COMFY_MODEL_DEFINITIONS } from "./comfy-workflows.js";

const image = (fileId = "source", role?: "reference" | "first-frame" | "last-frame") => ({ fileId, kind: "image" as const, name: `${fileId}.png`, role });

test("Qwen 2512 按比例生成并根据质量选择步数", () => {
    const medium = buildComfyWorkflow({ model: "qwen-image-2512-local", prompt: "测试", params: { size: "3:2", quality: "medium" }, files: [] });
    assert.deepEqual(medium["6"].inputs, { width: 1536, height: 1024, batch_size: 1 });
    assert.equal(medium["9"].inputs.steps, 8);
    assert.equal(medium["7"].inputs.lora_name, "Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors");
    const high = buildComfyWorkflow({ model: "qwen-image-2512-local", prompt: "测试", params: { size: "2048x2048", quality: "high" }, files: [] });
    assert.equal(high["9"].inputs.steps, 40);
    assert.equal(high["7"], undefined);
});

test("HiDream 使用最接近画布比例的原生约 4MP 分辨率并保持官方模型链路", () => {
    const square = buildComfyWorkflow({ model: "hidream-o1-full-fp8-local", prompt: "测试", params: { size: "1:1" }, files: [] });
    const landscape = buildComfyWorkflow({ model: "hidream-o1-full-fp8-local", prompt: "测试", params: { size: "4:3" }, files: [] });
    const portrait = buildComfyWorkflow({ model: "hidream-o1-full-fp8-local", prompt: "测试", params: { size: "9:16" }, files: [] });
    assert.deepEqual(square["6"].inputs, { width: 2048, height: 2048, batch_size: 1 });
    assert.deepEqual(landscape["6"].inputs, { width: 2304, height: 1728, batch_size: 1 });
    assert.deepEqual(portrait["6"].inputs, { width: 1440, height: 2560, batch_size: 1 });
    assert.deepEqual(square["9"].inputs.model, ["3", 0]);
    assert.equal(square["13"], undefined);
});

test("HiDream 仅为声明纯净背景的资产确定性合成纯白底", () => {
    const plain = buildComfyWorkflow({ model: "hidream-o1-full-fp8-local", prompt: "单人全身像", params: { size: "1:1", __promptPackage: { checks: ["plain_background"] } }, files: [] });
    assert.equal(plain["16"].class_type, "LoadBackgroundRemovalModel");
    assert.equal(plain["17"].class_type, "RemoveBackground");
    assert.deepEqual(plain["18"].inputs, { width: 2048, height: 2048, batch_size: 1, color: 0xFFFFFF });
    assert.deepEqual(plain["19"].inputs.mask, ["17", 0]);
    assert.deepEqual(plain["11"].inputs.images, ["19", 0]);
    const raw = buildComfyWorkflow({ model: "hidream-o1-full-fp8-local", prompt: "雪山", params: { size: "1:1" }, files: [] });
    assert.equal(raw["16"], undefined);
    assert.deepEqual(raw["11"].inputs.images, ["10", 0]);
});

test("FLUX.2 Dev 使用官方 20 步链路并串联最多六张参考图", () => {
    const model = COMFY_MODEL_DEFINITIONS["flux2-dev-fp8-local"];
    assert.equal(model.maxReferenceImages, 6);
    const workflow = buildComfyWorkflow({ model: "flux2-dev-fp8-local", prompt: "六人同框", params: { size: "16:9", quality: "high" }, files: Array.from({ length: 6 }, (_, index) => image(`ref-${index + 1}`)) });
    assert.deepEqual(workflow["6"].inputs, { width: 2560, height: 1440, batch_size: 1 });
    assert.deepEqual(workflow["9"].inputs, { steps: 20, width: 2560, height: 1440 });
    assert.equal(workflow["8"].inputs.sampler_name, "euler");
    assert.equal(workflow["5"].inputs.guidance, 4);
    assert.equal(workflow["22"].class_type, "ReferenceLatent");
    assert.deepEqual(workflow["37"].inputs.conditioning, ["34", 0]);
    assert.deepEqual(workflow["10"].inputs.conditioning, ["37", 0]);
    assert.throws(() => buildComfyWorkflow({ model: "flux2-dev-fp8-local", prompt: "超限", params: {}, files: Array.from({ length: 7 }, (_, index) => image(`ref-${index + 1}`)) }), /最多支持 6 张/);
});

test("Qwen Edit 限制三张参考图并装配多参考输入", () => {
    const workflow = buildComfyWorkflow({ model: "qwen-image-edit-2511-local", prompt: "修改", params: {}, files: [image("one"), image("two"), image("three")] });
    assert.deepEqual(workflow["9"].inputs.image2, ["20", 0]);
    assert.deepEqual(workflow["9"].inputs.image3, ["21", 0]);
    assert.throws(() => buildComfyWorkflow({ model: "qwen-image-edit-2511-local", prompt: "修改", params: {}, files: [image("1"), image("2"), image("3"), image("4")] }), /最多支持 3 张/);
});

test("局部编辑按 fileId 区分蒙版并在严格模式合成原图", () => {
    const workflow = buildComfyWorkflow({ model: "qwen-image-inpaint-local", prompt: "换成金属", params: { maskFileId: "mask", preserveMode: "strict", growPixels: 12, featherPixels: 6 }, files: [image(), image("mask")] });
    assert.equal(workflow["6"].inputs.image, "source.png");
    assert.equal(workflow["7"].inputs.image, "mask.png");
    assert.equal(workflow["9"].inputs.expand, 12);
    assert.equal(workflow["21"].class_type, "ImageCompositeMasked");
    assert.deepEqual(workflow["22"].inputs.images, ["21", 0]);
});

test("两种超分都输出指定长边", () => {
    const params = { sourceWidth: 1600, sourceHeight: 900, targetLongEdge: 4096 };
    const faithful = buildComfyWorkflow({ model: "realesrgan-x4-local", prompt: "", params, files: [image()] });
    assert.deepEqual({ width: faithful["4"].inputs.width, height: faithful["4"].inputs.height }, { width: 4096, height: 2304 });
    const generative = buildComfyWorkflow({ model: "z-image-upscale-local", prompt: "增强", params: { ...params, denoise: 0.2 }, files: [image()] });
    assert.equal(generative["12"].inputs.denoise, 0.2);
    assert.deepEqual({ width: generative["14"].inputs.width, height: generative["14"].inputs.height }, { width: 4096, height: 2304 });
});

test("VoxCPM2 不再经过 ComfyUI 推理", () => {
    assert.throws(() => buildComfyWorkflow({ model: "voxcpm2-local", prompt: "台词", params: {}, files: [] }), { code: "COMFY_MODEL_UNSUPPORTED" });
});

test("H3 与 Music3 生产图仅由媒体执行器提供", () => {
    for (const model of ["minimax-h3-ref2va-local", "minimax-h3-fl2va-local", "minimax-music3-local"]) assert.throws(() => buildComfyWorkflow({ model, prompt: "test", params: {}, files: [] }), { code: "MEDIA_EXECUTOR_REQUIRED" });
});
