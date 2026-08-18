import assert from "node:assert/strict";
import test from "node:test";

import { alignH3Frames, buildComfyWorkflow, COMFY_MODEL_DEFINITIONS, h3Recipe } from "./comfy-workflows.js";

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

test("VoxCPM2 透传克隆文本、归一化、降噪与高级参数", () => {
    const workflow = buildComfyWorkflow({
        model: "voxcpm2-local",
        prompt: "新的台词",
        params: { referenceTranscript: "参考台词", cfgValue: 3, steps: 18, seed: 42, ultimateClone: true, maxLength: 2048 },
        files: [{ fileId: "voice", kind: "audio", name: "voice.wav" }],
    });
    assert.equal(workflow["2"].inputs.reference_audio_text, "参考台词");
    assert.equal(workflow["2"].inputs.normalize_text, true);
    assert.equal(workflow["2"].inputs.denoise_reference, true);
    assert.equal(workflow["2"].inputs.cfg_value, 3);
    assert.equal(workflow["2"].inputs.inference_steps, 18);
    assert.equal(workflow["2"].inputs.seed, 42);
    assert.equal(workflow["2"].inputs.ultimate_clone, true);
    assert.deepEqual(workflow["2"].inputs.reference_audio, ["4", 0]);
});

test("MiniMax H3 声明真实能力并接受 4–15 秒", () => {
    const fl = COMFY_MODEL_DEFINITIONS["minimax-h3-fl2va-local"];
    assert.deepEqual({ min: fl.minDurationSeconds, max: fl.maxDurationSeconds, images: fl.maxReferenceImages, fps: fl.videoFps, audio: fl.videoNativeAudio, resolution: fl.videoNativeResolution }, { min: 4, max: 15, images: 4, fps: 24, audio: true, resolution: "768p" });
    assert.deepEqual(fl.videoReferenceRoles, ["first-frame", "last-frame", "continuation"]);
    const textOnly = buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", params: { seconds: 4 }, files: [] });
    assert.equal(textOnly["5"].inputs.length, 107);
    assert.equal(textOnly["14"].inputs.format, "auto");
    assert.equal(textOnly["14"].inputs.codec, "auto");
    assert.equal(textOnly["5"].inputs.first_frame, undefined);
    assert.equal(textOnly["5"].inputs.last_frame, undefined);
    const firstOnly = buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", params: { seconds: 4 }, files: [image("first", "first-frame")] });
    assert.deepEqual(firstOnly["5"].inputs.first_frame, ["20", 0]);
    assert.equal(firstOnly["5"].inputs.last_frame, undefined);
    const lastOnly = buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", params: { seconds: 4 }, files: [image("last", "last-frame")] });
    assert.equal(lastOnly["5"].inputs.first_frame, undefined);
    assert.deepEqual(lastOnly["5"].inputs.last_frame, ["21", 0]);
    const both = buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", params: { seconds: 15 }, files: [image("last", "last-frame"), image("first", "first-frame")] });
    assert.deepEqual(both["20"].inputs.image, "first.png");
    assert.deepEqual(both["21"].inputs.image, "last.png");
});

test("MiniMax H3 按 17k+5 对齐并串联最多四个时间锚点", () => {
    assert.deepEqual(alignH3Frames(4), { requestedSeconds: 4, requestedFrames: 96, modelFrames: 107, trimFrames: 96, fps: 24, stride: 17, base: 5 });
    const files = [image("g1"), image("g2")];
    const workflow = buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", params: { seconds: 4, temporalGuides: [{ fileId: "g1", frameIndex: 0 }, { fileId: "g2", frameIndex: 95 }] }, files });
    assert.equal(workflow["102"].class_type, "MiniMaxH3AddGuide");
    assert.equal(workflow["105"].inputs.frame_idx, 95);
    assert.deepEqual(workflow["6"].inputs.conditioning, ["105", 0]);
    assert.equal(workflow["5"].inputs.first_frame, undefined);
});

test("MiniMax H3 两档配方只给 FL2VA 预览使用已探测 Turbo", () => {
    assert.equal(h3Recipe("fl2va", "preview", true).turbo, true);
    assert.equal(h3Recipe("fl2va", "preview", true).scheduler, "simple");
    assert.equal(h3Recipe("ref2va", "preview", true).turbo, false);
    const turbo = buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", params: { seconds: 5, qualityPreset: "preview", turboAvailable: true }, files: [] });
    assert.equal(turbo["16"].class_type, "MiniMaxH3TurboLoRA");
    assert.equal(turbo["7"].class_type, "MiniMaxH3TurboSampler");
    assert.equal(turbo["8"].inputs.scheduler, "simple");
    const refPreview = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", params: { seconds: 5, qualityPreset: "preview", turboAvailable: true }, files: [image()] });
    assert.equal(refPreview["16"], undefined);
    assert.equal(refPreview["5"].inputs.ref_image_size, "match");
    const refFinal = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", params: { seconds: 5, qualityPreset: "final" }, files: [image()] });
    assert.equal(refFinal["5"].inputs.ref_image_size, "max");
    assert.equal(refFinal["8"].inputs.scheduler, "beta");
});

test("MiniMax H3 Ref2VA 限制合计 12 个参考文件", () => {
    const files = [...Array.from({ length: 7 }, (_, index) => image(`i${index}`)), ...Array.from({ length: 3 }, (_, index) => ({ fileId: `v${index}`, kind: "video" as const, name: `v${index}.mp4` })), ...Array.from({ length: 3 }, (_, index) => ({ fileId: `a${index}`, kind: "audio" as const, name: `a${index}.wav` }))];
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", params: { seconds: 15 }, files }), /数量超限/);
});
