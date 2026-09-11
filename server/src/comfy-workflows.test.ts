import assert from "node:assert/strict";
import test from "node:test";

import { alignH3Frames, buildComfyWorkflow, COMFY_MODEL_DEFINITIONS, h3Recipe, selectH3Acceleration } from "./comfy-workflows.js";

const image = (fileId = "source", role?: "reference" | "first-frame" | "last-frame") => ({ fileId, kind: "image" as const, name: `${fileId}.png`, role });

test("导演默认加速仅用于就绪的 Ref2VA，续接继承来源且允许首段基础重做", () => {
    const input = { mode: "ref2va" as const, pddReady: true, continuing: false, hasAudioReferences: false };
    assert.equal(selectH3Acceleration(input), "pdd-ref8");
    assert.equal(selectH3Acceleration({ ...input, requested: "base" }), "base");
    assert.equal(selectH3Acceleration({ ...input, pddReady: false }), "base");
    assert.equal(selectH3Acceleration({ ...input, mode: "fl2va" }), "base");
    assert.equal(selectH3Acceleration({ ...input, hasAudioReferences: true }), "base");
    assert.equal(selectH3Acceleration({ ...input, continuing: true, previousModelRevision: "base" }), "base");
    assert.equal(selectH3Acceleration({ ...input, continuing: true, previousModelRevision: "base:pdd-ref8:digest" }), "pdd-ref8");
    assert.throws(() => selectH3Acceleration({ ...input, requested: "pdd-ref8", pddReady: false }), /尚未就绪/);
    assert.throws(() => selectH3Acceleration({ ...input, continuing: true, previousModelRevision: "base:pdd-ref8:digest", requested: "base" }), /首段重新生成/);
});

test("PDD 生产图保持参考与时间锚点，基础重做恢复独立调度", () => {
    const files = [image("board"), image("first"), { fileId: "voice", kind: "audio" as const, name: "voice.wav" }, { fileId: "motion", kind: "video" as const, name: "motion.mp4" }];
    const params = { qualityPreset: "final", seconds: 10, temporalGuides: [{ fileId: "first", frameIndex: 0 }] };
    const fast = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files, params: { ...params, h3Recipe: "pdd-ref8" } });
    assert.equal(fast["5"].inputs.ref_image_size, "match");
    assert.deepEqual(fast["5"].inputs["ref_audios.ref_audio_0"], ["41", 0]);
    assert.deepEqual(fast["5"].inputs["ref_videos.ref_video_0"], ["62", 0]);
    assert.deepEqual(fast["6"].inputs.conditioning, ["102", 0]);
    assert.equal(fast["16"].class_type, "MiniMaxH3PDDAccApply");
    assert.deepEqual(fast["10"].inputs.sigmas, ["16", 1]);
    assert.equal(fast["8"], undefined);
    assert.equal(fast["7"].inputs.sampler_name, "euler");
    const base = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files, params: { ...params, h3Recipe: "base" } });
    assert.equal(base["8"].inputs.steps, 20);
    assert.equal(base["16"], undefined);
    assert.deepEqual(base["10"].inputs.sigmas, ["8", 0]);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-fl2va-local", prompt: "test", files: [image()], params: { h3Recipe: "pdd-ref8" } }), /首尾帧/);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [], params: { h3Recipe: "unknown" } }), /不支持/);
});

test("PDD 续接图保留累计双流且拒绝配方身份错配", () => {
    const prior = { schemaVersion: 1, fps: 24, modelRevision: "base:pdd-ref8:digest", videoVaeRevision: "vvae", audioVaeRevision: "avae", sourceId: "previous", width: 1344, height: 768, frames: 243 };
    const params = { h3Recipe: "pdd-ref8", seconds: 5, resolution: "768p", __h3StateContext: { ...prior, sourceId: "next", frames: 362 }, __h3PreviousState: { fileId: "state-file", context: prior }, __h3PreviousFrames: 243, __h3StateInputName: "state.safetensors" };
    const fast = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [image()], params });
    assert.deepEqual(fast["10"].inputs.sigmas, ["16", 1]);
    assert.deepEqual(fast["10"].inputs.latent_image, ["81", 0]);
    assert.deepEqual(fast["70"].inputs.latent, ["83", 0]);
    assert.deepEqual(fast["h3_cumulative"].inputs.video, ["87", 0]);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [], params: { ...params, h3Recipe: "base" } }), /身份不一致/);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [], params: { ...params, __h3StateContext: { ...params.__h3StateContext, modelRevision: "base" } } }), /身份不一致/);
});

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

test("Ref2VA 保留整板参考并将独立起始画格接入原生时间锚点", () => {
    const workflow = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", params: { seconds: 5, temporalGuides: [{ fileId: "opening", frameIndex: 0 }] }, files: [image("board"), image("actor"), image("opening")] });
    const loads = Object.values(workflow).filter((node) => node.class_type === "LoadImage").map((node) => node.inputs.image);
    assert.deepEqual(loads.sort(), ["actor.png", "board.png", "opening.png"]);
    assert.equal(workflow["102"].class_type, "MiniMaxH3AddGuide");
    assert.equal(workflow["102"].inputs.frame_idx, 0);
    assert.deepEqual(workflow["6"].inputs.conditioning, ["102", 0]);
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

test("H3 首段保存原生状态，续段追加后仅输出新增音视频", () => {
    const prior = { schemaVersion: 1, fps: 24, modelRevision: "model", videoVaeRevision: "vvae", audioVaeRevision: "avae", sourceId: "previous", width: 1344, height: 768, frames: 243 };
    const initial = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [image("board")], params: { seconds: 5, resolution: "768p", __h3StateContext: { ...prior, frames: 124 } } });
    assert.deepEqual(initial["70"].inputs.latent, ["10", 0]);
    assert.deepEqual(initial["11"].inputs.samples, ["70", 0]);
    assert.equal(initial["85"].inputs.previous_frames, 0);
    const params = { seconds: 5, resolution: "768p", __h3StateContext: { ...prior, sourceId: "next", frames: 362 }, __h3PreviousState: { fileId: "state-file", context: prior }, __h3PreviousFrames: 243, __h3StateInputName: "state.safetensors" };
    const continued = buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [image("board")], params });
    assert.equal(continued["81"].inputs.extension_frames, 119);
    assert.equal(continued["81"].inputs.overlap_frames, 22);
    assert.deepEqual(continued["10"].inputs.latent_image, ["81", 0]);
    assert.deepEqual(continued["83"].inputs.sampled_window, ["10", 0]);
    assert.deepEqual(continued["83"].inputs.transition_video_tokens, ["81", 4]);
    assert.deepEqual(continued["83"].inputs.transition_audio_tokens, ["81", 5]);
    assert.deepEqual(continued["70"].inputs.latent, ["83", 0]);
    assert.equal(continued["85"].inputs.previous_frames, 243);
    assert.deepEqual(continued["13"].inputs.images, ["85", 0]);
    assert.deepEqual(continued["13"].inputs.audio, ["85", 1]);
    assert.equal(continued["86"].inputs.previous_frames, 0);
    assert.deepEqual(continued["87"].inputs.images, ["86", 0]);
    assert.deepEqual(continued["h3_cumulative"].inputs.video, ["87", 0]);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [], params: { ...params, __h3StateInputName: "../state.safetensors" } }), /upload/);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [], params: { ...params, __h3StateContext: undefined } }), /explicit state context/);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [], params: { ...params, __h3StateContext: { ...params.__h3StateContext, modelRevision: "other" } } }), /context/);
    assert.throws(() => buildComfyWorkflow({ model: "minimax-h3-ref2va-local", prompt: "test", files: [image("g")], params: { ...params, temporalGuides: [{ fileId: "g", frameIndex: 0 }] } }), /override/);
});

test("H3 续接窗口包含隐藏重叠且不超过单次 362 帧", async () => {
    const { h3ContinuationFrames } = await import("./comfy-workflows.js");
    for (const seconds of [4, 5, 10, 15]) {
        const frames = h3ContinuationFrames(seconds);
        assert.equal(frames % 17, 0);
        assert.ok(frames + 22 <= 362);
    }
    assert.equal(h3ContinuationFrames(15), 340);
    assert.throws(() => h3ContinuationFrames(NaN), /between/);
});
