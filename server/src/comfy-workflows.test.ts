import assert from "node:assert/strict";
import test from "node:test";

import { buildComfyWorkflow } from "./comfy-workflows.js";

const image = (fileId = "source") => ({ fileId, kind: "image" as const, name: `${fileId}.png` });

test("Qwen 2512 按比例生成并根据质量选择步数", () => {
    const medium = buildComfyWorkflow({ model: "qwen-image-2512-local", prompt: "测试", params: { size: "3:2", quality: "medium" }, files: [] });
    assert.deepEqual(medium["6"].inputs, { width: 1536, height: 1024, batch_size: 1 });
    assert.equal(medium["9"].inputs.steps, 8);
    assert.equal(medium["7"].inputs.lora_name, "Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors");
    const high = buildComfyWorkflow({ model: "qwen-image-2512-local", prompt: "测试", params: { size: "2048x2048", quality: "high" }, files: [] });
    assert.equal(high["9"].inputs.steps, 40);
    assert.equal(high["7"], undefined);
});

test("HiDream 不再把全部横图固定为 16:9", () => {
    const workflow = buildComfyWorkflow({ model: "hidream-o1-full-fp8-local", prompt: "测试", params: { size: "4:3" }, files: [] });
    assert.deepEqual(workflow["6"].inputs, { width: 1920, height: 1440, batch_size: 1 });
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
