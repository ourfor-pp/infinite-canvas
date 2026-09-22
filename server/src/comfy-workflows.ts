type NodeInput = Record<string, unknown>;
export type Workflow = Record<string, { class_type: string; inputs: NodeInput }>;
export type ComfyUploadedInput = { fileId: string; kind: "image" | "video" | "audio"; name: string; role?: "reference" | "first-frame" | "last-frame" | "continuation" };
type WorkflowInput = { model: string; prompt: string; params: Record<string, unknown>; files: ComfyUploadedInput[] };
export type H3QualityPreset = "preview" | "final";
export type H3Acceleration = "base" | "pdd-ref8";
export type H3TemporalGuide = { fileId: string; frameIndex: number; includeAudio?: boolean };
export type H3GenerationRecipe = { qualityPreset: H3QualityPreset; resolution: "480p" | "768p"; steps: number; sampler: string; scheduler: string; refImageSize: "match" | "max"; attention: string; turbo: boolean };
export type H3FrameAlignment = { requestedSeconds: number; requestedFrames: number; modelFrames: number; trimFrames: number; fps: 24; stride: 17; base: 5 };

const node = (classType: string, inputs: NodeInput) => ({ class_type: classType, inputs });
const seed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

export const COMFY_MODELS = [
    "qwen-image-2512-local",
    "z-image-turbo-local",
    "qwen-image-edit-2511-local",
    "qwen-image-inpaint-local",
    "realesrgan-x4-local",
    "z-image-upscale-local",
    "hidream-o1-full-fp8-local",
    "flux2-dev-fp8-local",
    "minimax-h3-fl2va-local",
    "minimax-h3-ref2va-local",
    "minimax-music3-local",
] as const;

export type ComfyModel = (typeof COMFY_MODELS)[number];
export type GenerationPurpose = "default" | "image-inpaint" | "image-upscale-faithful" | "image-upscale-generative" | "image-angle";
export type ImageMode = "generate" | "edit";

export type ImageWorkflowPurpose = Exclude<GenerationPurpose, "default">;

export const PURPOSE_MODELS: Record<ImageWorkflowPurpose, ComfyModel> = {
    "image-inpaint": "qwen-image-inpaint-local",
    "image-upscale-faithful": "realesrgan-x4-local",
    "image-upscale-generative": "z-image-upscale-local",
    "image-angle": "qwen-image-edit-2511-local",
};

export type ComfyModelDefinition = { name: string; output: "image" | "video" | "audio"; inputs: Array<"text" | "image" | "video" | "audio">; selectable: boolean; audioModes?: Array<"speech" | "ambient" | "sfx" | "music">; audioOperations?: Array<"generate" | "clone" | "transform" | "extend" | "inpaint" | "cover" | "remix">; imageModes?: ImageMode[]; maxReferenceImages?: number; minDurationSeconds?: number; maxDurationSeconds?: number; videoModes?: Array<"fl2va" | "ref2va">; videoReferenceRoles?: Array<"reference" | "first-frame" | "last-frame" | "continuation">; maxReferenceVideos?: number; maxReferenceAudios?: number; maxReferenceFiles?: number; videoFps?: number; videoNativeAudio?: boolean; videoNativeResolution?: string; videoContinuationMode?: "reference" | "extend"; qualityPresets?: H3QualityPreset[]; supportsTemporalGuides?: boolean; maxTemporalGuides?: number; frameStride?: number; frameBase?: number; turboPreview?: boolean };
export const COMFY_MODEL_DEFINITIONS: Record<ComfyModel, ComfyModelDefinition> = {
    "qwen-image-2512-local": { name: "Qwen Image 2512 FP8", output: "image", inputs: ["text"], selectable: true, imageModes: ["generate"] },
    "z-image-turbo-local": { name: "Z-Image Turbo", output: "image", inputs: ["text"], selectable: true, imageModes: ["generate"] },
    "qwen-image-edit-2511-local": { name: "Qwen Image Edit 2511", output: "image", inputs: ["text", "image"], selectable: true, imageModes: ["edit"], maxReferenceImages: 3 },
    "qwen-image-inpaint-local": { name: "Qwen Image 局部编辑", output: "image", inputs: ["text", "image"], selectable: false },
    "realesrgan-x4-local": { name: "RealESRGAN 忠实超分", output: "image", inputs: ["image"], selectable: false },
    "z-image-upscale-local": { name: "Z-Image 细节增强", output: "image", inputs: ["text", "image"], selectable: false },
    "hidream-o1-full-fp8-local": { name: "HiDream-O1 Full FP8", output: "image", inputs: ["text", "image"], selectable: true, imageModes: ["generate", "edit"], maxReferenceImages: 1 },
    "flux2-dev-fp8-local": { name: "FLUX.2 Dev FP8 Mixed", output: "image", inputs: ["text", "image"], selectable: true, imageModes: ["generate", "edit"], maxReferenceImages: 6 },
    "minimax-h3-fl2va-local": { name: "MiniMax H3 FL2VA", output: "video", inputs: ["text", "image", "video", "audio"], selectable: true, minDurationSeconds: 4, maxDurationSeconds: 15, maxReferenceImages: 4, maxReferenceVideos: 1, maxReferenceAudios: 1, maxReferenceFiles: 5, videoModes: ["fl2va"], videoReferenceRoles: ["first-frame", "last-frame", "continuation"], videoContinuationMode: "reference", videoFps: 24, videoNativeAudio: true, videoNativeResolution: "768p", qualityPresets: ["preview", "final"], supportsTemporalGuides: true, maxTemporalGuides: 4, frameStride: 17, frameBase: 5, turboPreview: true },
    "minimax-h3-ref2va-local": { name: "MiniMax H3 Ref2VA", output: "video", inputs: ["text", "image", "video", "audio"], selectable: true, minDurationSeconds: 4, maxDurationSeconds: 15, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferenceFiles: 12, videoModes: ["ref2va"], videoReferenceRoles: ["reference", "continuation"], videoContinuationMode: "reference", videoFps: 24, videoNativeAudio: true, videoNativeResolution: "768p", qualityPresets: ["preview", "final"], supportsTemporalGuides: true, maxTemporalGuides: 4, frameStride: 17, frameBase: 5, turboPreview: false },
    "minimax-music3-local": { name: "MiniMax-Music3", output: "audio", inputs: ["text"], selectable: true, audioModes: ["music"], audioOperations: ["generate"], minDurationSeconds: 1, maxDurationSeconds: 300 },
};

export const COMFY_REQUIREMENTS: Partial<Record<ComfyModel, { nodes: string[]; models: Array<{ loader: string; name: string }> }>> = {
    "minimax-music3-local": { nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxMusic3TextEncode", "EmptyMiniMaxMusic3LatentAudio", "ConditioningZeroOut", "KSampler", "VAEDecodeAudio", "SaveAudio"], models: [{ loader: "UNETLoader", name: "minimax_music3_dit_fp16.safetensors" }, { loader: "CLIPLoader", name: "minimax_music3_text_encoder_pruned_int8_convrot.safetensors" }, { loader: "VAELoader", name: "minimax_music3_dav.safetensors" }] },
    "qwen-image-2512-local": { nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly", "EmptySD3LatentImage", "KSampler"], models: [{ loader: "UNETLoader", name: "qwen_image_2512_fp8_e4m3fn.safetensors" }, { loader: "CLIPLoader", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors" }, { loader: "VAELoader", name: "qwen_image_vae.safetensors" }, { loader: "LoraLoaderModelOnly", name: "Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors" }, { loader: "LoraLoaderModelOnly", name: "Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors" }] },
    "z-image-turbo-local": { nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "EmptySD3LatentImage", "KSampler"], models: [{ loader: "UNETLoader", name: "z_image_turbo_bf16.safetensors" }, { loader: "CLIPLoader", name: "qwen_3_4b.safetensors" }, { loader: "VAELoader", name: "ae.safetensors" }] },
    "qwen-image-edit-2511-local": { nodes: ["TextEncodeQwenImageEditPlus", "FluxKontextImageScale", "CFGNorm"], models: [{ loader: "UNETLoader", name: "qwen_image_edit_2511_bf16.safetensors" }, { loader: "CLIPLoader", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors" }, { loader: "VAELoader", name: "qwen_image_vae.safetensors" }] },
    "qwen-image-inpaint-local": { nodes: ["ControlNetInpaintingAliMamaApply", "SetLatentNoiseMask", "ImageCompositeMasked", "GrowMask", "ImageBlur"], models: [{ loader: "UNETLoader", name: "qwen_image_fp8_e4m3fn.safetensors" }, { loader: "CLIPLoader", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors" }, { loader: "VAELoader", name: "qwen_image_vae.safetensors" }, { loader: "ControlNetLoader", name: "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors" }] },
    "realesrgan-x4-local": { nodes: ["ImageUpscaleWithModel", "ImageScale"], models: [{ loader: "UpscaleModelLoader", name: "RealESRGAN_x4plus.safetensors" }] },
    "z-image-upscale-local": { nodes: ["ImageUpscaleWithModel", "ImageScaleToTotalPixels", "VAEEncode", "KSampler"], models: [{ loader: "UpscaleModelLoader", name: "RealESRGAN_x4plus.safetensors" }, { loader: "UNETLoader", name: "z_image_turbo_bf16.safetensors" }, { loader: "CLIPLoader", name: "qwen_3_4b.safetensors" }, { loader: "VAELoader", name: "ae.safetensors" }] },
    "hidream-o1-full-fp8-local": { nodes: ["ModelNoiseScale", "HiDreamO1PatchSeamSmoothing", "EmptyHiDreamO1LatentImage", "HiDreamO1ReferenceImages", "LoadBackgroundRemovalModel", "RemoveBackground", "ImageCompositeMasked"], models: [{ loader: "CheckpointLoaderSimple", name: "hidream_o1_image_fp8_scaled.safetensors" }, { loader: "LoadBackgroundRemovalModel", name: "birefnet.safetensors" }] },
    "flux2-dev-fp8-local": { nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "EmptyFlux2LatentImage", "Flux2Scheduler", "FluxGuidance", "ReferenceLatent", "VAEEncode", "SamplerCustomAdvanced"], models: [{ loader: "UNETLoader", name: "flux2_dev_fp8mixed.safetensors" }, { loader: "CLIPLoader", name: "mistral_3_small_flux2_fp8.safetensors" }, { loader: "VAELoader", name: "flux2-vae.safetensors" }] },
    "minimax-h3-fl2va-local": { nodes: ["MiniMaxH3ImageToVideo", "PathchSageAttentionKJ"], models: [{ loader: "UNETLoader", name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors" }, { loader: "CLIPLoader", name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" }] },
    "minimax-h3-ref2va-local": { nodes: ["MiniMaxH3ReferenceToVideo", "PathchSageAttentionKJ"], models: [{ loader: "UNETLoader", name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors" }, { loader: "CLIPLoader", name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" }] },
};

export function buildComfyWorkflow(input: WorkflowInput): Workflow {
    if (input.model === "qwen-image-2512-local") return qwenTextToImage(input);
    if (input.model === "z-image-turbo-local") return zImageTextToImage(input);
    if (input.model === "qwen-image-edit-2511-local") return qwenEdit(input);
    if (input.model === "qwen-image-inpaint-local") return qwenInpaint(input);
    if (input.model === "realesrgan-x4-local") return realEsrgan(input);
    if (input.model === "z-image-upscale-local") return zImageUpscale(input);
    if (input.model === "hidream-o1-full-fp8-local") return hiDream(input);
    if (input.model === "flux2-dev-fp8-local") return flux2Dev(input);
    if (["minimax-h3-fl2va-local", "minimax-h3-ref2va-local", "minimax-music3-local"].includes(input.model)) throw Object.assign(new Error("此能力由媒体执行器构建工作流"), { code: "MEDIA_EXECUTOR_REQUIRED" });
    throw Object.assign(new Error("不支持的 ComfyUI 模型"), { code: "COMFY_MODEL_UNSUPPORTED", status: 400 });
}

export function dimensions(params: Record<string, unknown>, fallback = 1024) {
    const size = String(params.size || "1:1");
    const suffix = size.match(/-(2k|4k)$/i)?.[1]?.toLowerCase();
    if (suffix) fallback = suffix === "4k" ? 3840 : 2048;
    const raw = size.replace(/-(?:2k|4k)$/i, "");
    const pixels = raw.match(/^(\d+)x(\d+)$/i);
    const ratio = raw.match(/^(\d+):(\d+)$/);
    let width = pixels ? Number(pixels[1]) : ratio ? fallback * Number(ratio[1]) / Number(ratio[2]) : fallback;
    let height = pixels ? Number(pixels[2]) : ratio ? fallback : fallback;
    const maxArea = 2048 * 2048;
    if (width * height > maxArea) { const scale = Math.sqrt(maxArea / (width * height)); width *= scale; height *= scale; }
    return { width: Math.max(256, Math.round(width / 32) * 32), height: Math.max(256, Math.round(height / 32) * 32) };
}

const HIDREAM_NATIVE_RESOLUTIONS = [
    [2048, 2048], [2304, 1728], [1728, 2304], [2560, 1440], [1440, 2560], [2496, 1664], [1664, 2496], [3104, 1312], [1312, 3104], [2304, 1792], [1792, 2304],
] as const;

function hiDreamDimensions(params: Record<string, unknown>) {
    const raw = String(params.size || "1:1").replace(/-(?:2k|4k)$/i, "");
    const pixels = raw.match(/^(\d+)x(\d+)$/i);
    const ratio = raw.match(/^(\d+):([\d.]+)$/);
    const target = pixels ? Number(pixels[1]) / Number(pixels[2]) : ratio ? Number(ratio[1]) / Number(ratio[2]) : 1;
    const [width, height] = HIDREAM_NATIVE_RESOLUTIONS.reduce((best, candidate) => Math.abs(Math.log(candidate[0] / candidate[1] / target)) < Math.abs(Math.log(best[0] / best[1] / target)) ? candidate : best);
    return { width, height };
}

function firstImage(input: WorkflowInput) {
    const image = input.files.find((file) => file.kind === "image" && file.fileId !== String(input.params.maskFileId || ""));
    if (!image) throw Object.assign(new Error("工作流需要一张输入图片"), { code: "COMFY_IMAGE_REQUIRED", status: 400 });
    return image.name;
}

function qwenTextToImage({ prompt, params }: WorkflowInput): Workflow {
    const { width, height } = dimensions(params);
    const quality = String(params.quality || "auto");
    const steps = quality === "high" ? 40 : quality === "low" ? 4 : 8;
    const lora = quality === "high" ? null : quality === "low" ? "Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors" : "Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors";
    const graph: Workflow = {
        "1": node("UNETLoader", { unet_name: "qwen_image_2512_fp8_e4m3fn.safetensors", weight_dtype: "default" }),
        "2": node("CLIPLoader", { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" }),
        "3": node("VAELoader", { vae_name: "qwen_image_vae.safetensors" }),
        "4": node("CLIPTextEncode", { clip: ["2", 0], text: prompt.trim() }),
        "5": node("CLIPTextEncode", { clip: ["2", 0], text: "低分辨率，低画质，肢体畸形，手指畸形，蜡像感，过度光滑，文字模糊" }),
        "6": node("EmptySD3LatentImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(params.count) || 1)) }),
        "8": node("ModelSamplingAuraFlow", { model: lora ? ["7", 0] : ["1", 0], shift: 3.1 }),
        "9": node("KSampler", { model: ["8", 0], seed: seed(), steps, cfg: quality === "high" ? 4 : 1, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], denoise: 1 }),
        "10": node("VAEDecode", { samples: ["9", 0], vae: ["3", 0] }),
        "11": node("SaveImage", { images: ["10", 0], filename_prefix: "InfiniteCanvas/Qwen-2512" }),
    };
    if (lora) graph["7"] = node("LoraLoaderModelOnly", { model: ["1", 0], lora_name: lora, strength_model: 1 });
    return graph;
}

function zImageTextToImage({ prompt, params }: WorkflowInput): Workflow {
    const { width, height } = dimensions(params);
    return {
        "1": node("UNETLoader", { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }),
        "2": node("CLIPLoader", { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" }),
        "3": node("VAELoader", { vae_name: "ae.safetensors" }),
        "4": node("CLIPTextEncode", { clip: ["2", 0], text: prompt.trim() }),
        "5": node("ConditioningZeroOut", { conditioning: ["4", 0] }),
        "6": node("EmptySD3LatentImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(params.count) || 1)) }),
        "7": node("ModelSamplingAuraFlow", { model: ["1", 0], shift: 3 }),
        "8": node("KSampler", { model: ["7", 0], seed: seed(), steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], denoise: 1 }),
        "9": node("VAEDecode", { samples: ["8", 0], vae: ["3", 0] }),
        "10": node("SaveImage", { images: ["9", 0], filename_prefix: "InfiniteCanvas/Z-Image" }),
    };
}

function qwenEdit(input: WorkflowInput): Workflow {
    const images = input.files.filter((file) => file.kind === "image");
    if (!images.length) throw Object.assign(new Error("Qwen Edit 需要参考图片"), { code: "COMFY_IMAGE_REQUIRED", status: 400 });
    if (images.length > 3) throw Object.assign(new Error("Qwen Edit 最多支持 3 张参考图"), { code: "COMFY_REFERENCE_LIMIT", status: 400 });
    const graph: Workflow = {
        "1": node("UNETLoader", { unet_name: "qwen_image_edit_2511_bf16.safetensors", weight_dtype: "default" }),
        "2": node("CLIPLoader", { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" }),
        "3": node("VAELoader", { vae_name: "qwen_image_vae.safetensors" }),
        "4": node("ModelSamplingAuraFlow", { model: ["1", 0], shift: 3.1 }),
        "5": node("CFGNorm", { model: ["4", 0], strength: 1 }),
        "6": node("LoadImage", { image: images[0].name }),
        "7": node("FluxKontextImageScale", { image: ["6", 0] }),
        "8": node("VAEEncode", { pixels: ["7", 0], vae: ["3", 0] }),
        "9": node("TextEncodeQwenImageEditPlus", { clip: ["2", 0], vae: ["3", 0], image1: ["7", 0], prompt: input.prompt.trim() }),
        "10": node("TextEncodeQwenImageEditPlus", { clip: ["2", 0], vae: ["3", 0], image1: ["7", 0], prompt: "" }),
        "11": node("KSampler", { model: ["5", 0], seed: seed(), steps: String(input.params.quality) === "high" ? 40 : 20, cfg: 4, sampler_name: "euler", scheduler: "simple", positive: ["12", 0], negative: ["13", 0], latent_image: ["8", 0], denoise: 1 }),
        "12": node("FluxKontextMultiReferenceLatentMethod", { conditioning: ["9", 0], reference_latents_method: "index_timestep_zero" }),
        "13": node("FluxKontextMultiReferenceLatentMethod", { conditioning: ["10", 0], reference_latents_method: "index_timestep_zero" }),
        "14": node("VAEDecode", { samples: ["11", 0], vae: ["3", 0] }),
        "15": node("SaveImage", { images: ["14", 0], filename_prefix: "InfiniteCanvas/Qwen-Edit-2511" }),
    };
    images.slice(1).forEach((image, index) => {
        const id = String(20 + index);
        graph[id] = node("LoadImage", { image: image.name });
        graph["9"].inputs[`image${index + 2}`] = [id, 0];
        graph["10"].inputs[`image${index + 2}`] = [id, 0];
    });
    return graph;
}

function qwenInpaint(input: WorkflowInput): Workflow {
    const maskId = String(input.params.maskFileId || "");
    const source = input.files.find((file) => file.kind === "image" && file.fileId !== maskId);
    const mask = input.files.find((file) => file.fileId === maskId);
    if (!source || !mask) throw Object.assign(new Error("局部编辑需要原图和蒙版"), { code: "COMFY_INPAINT_INPUT_REQUIRED", status: 400 });
    const grow = Math.max(0, Math.min(64, Number(input.params.growPixels) || 12));
    const feather = Math.max(0, Math.min(32, Number(input.params.featherPixels) || 6));
    const strict = String(input.params.preserveMode || "strict") === "strict";
    const graph: Workflow = {
        "1": node("UNETLoader", { unet_name: "qwen_image_fp8_e4m3fn.safetensors", weight_dtype: "default" }),
        "2": node("LoraLoaderModelOnly", { model: ["1", 0], lora_name: "Qwen-Image-Lightning-4steps-V1.0.safetensors", strength_model: 1 }),
        "3": node("CLIPLoader", { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" }),
        "4": node("VAELoader", { vae_name: "qwen_image_vae.safetensors" }),
        "5": node("ControlNetLoader", { control_net_name: "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors" }),
        "6": node("LoadImage", { image: source.name }),
        "7": node("LoadImage", { image: mask.name }),
        "8": node("ImageToMask", { image: ["7", 0], channel: "red" }),
        "9": node("GrowMask", { mask: ["8", 0], expand: grow, tapered_corners: true }),
        "10": node("MaskToImage", { mask: ["9", 0] }),
        "11": node("ImageBlur", { image: ["10", 0], blur_radius: feather, sigma: Math.max(1, feather / 2) }),
        "12": node("ImageToMask", { image: ["11", 0], channel: "red" }),
        "13": node("CLIPTextEncode", { clip: ["3", 0], text: input.prompt.trim() }),
        "14": node("CLIPTextEncode", { clip: ["3", 0], text: " " }),
        "15": node("ControlNetInpaintingAliMamaApply", { positive: ["13", 0], negative: ["14", 0], control_net: ["5", 0], vae: ["4", 0], image: ["6", 0], mask: ["12", 0], strength: 1, start_percent: 0, end_percent: 1 }),
        "16": node("VAEEncode", { pixels: ["6", 0], vae: ["4", 0] }),
        "17": node("SetLatentNoiseMask", { samples: ["16", 0], mask: ["12", 0] }),
        "18": node("ModelSamplingAuraFlow", { model: ["2", 0], shift: 3.1 }),
        "19": node("KSampler", { model: ["18", 0], seed: seed(), steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["15", 0], negative: ["15", 1], latent_image: ["17", 0], denoise: 1 }),
        "20": node("VAEDecode", { samples: ["19", 0], vae: ["4", 0] }),
        "22": node("SaveImage", { images: strict ? ["21", 0] : ["20", 0], filename_prefix: "InfiniteCanvas/Qwen-Inpaint" }),
    };
    if (strict) graph["21"] = node("ImageCompositeMasked", { destination: ["6", 0], source: ["20", 0], x: 0, y: 0, resize_source: true, mask: ["12", 0] });
    return graph;
}

function targetSize(params: Record<string, unknown>) {
    const sourceWidth = Math.max(1, Number(params.sourceWidth) || 1024);
    const sourceHeight = Math.max(1, Number(params.sourceHeight) || 1024);
    const target = [1024, 2048, 4096].includes(Number(params.targetLongEdge)) ? Number(params.targetLongEdge) : 2048;
    const scale = target / Math.max(sourceWidth, sourceHeight);
    return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

function realEsrgan(input: WorkflowInput): Workflow {
    const { width, height } = targetSize(input.params);
    return {
        "1": node("LoadImage", { image: firstImage(input) }),
        "2": node("UpscaleModelLoader", { model_name: "RealESRGAN_x4plus.safetensors" }),
        "3": node("ImageUpscaleWithModel", { upscale_model: ["2", 0], image: ["1", 0] }),
        "4": node("ImageScale", { image: ["3", 0], upscale_method: "lanczos", width, height, crop: "disabled" }),
        "5": node("SaveImage", { images: ["4", 0], filename_prefix: "InfiniteCanvas/RealESRGAN" }),
    };
}

function zImageUpscale(input: WorkflowInput): Workflow {
    const { width, height } = targetSize(input.params);
    return {
        "1": node("LoadImage", { image: firstImage(input) }),
        "2": node("UpscaleModelLoader", { model_name: "RealESRGAN_x4plus.safetensors" }),
        "3": node("ImageUpscaleWithModel", { upscale_model: ["2", 0], image: ["1", 0] }),
        "4": node("ImageScaleToTotalPixels", { image: ["3", 0], upscale_method: "lanczos", megapixels: 2, resolution_steps: 1 }),
        "5": node("UNETLoader", { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }),
        "6": node("CLIPLoader", { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" }),
        "7": node("VAELoader", { vae_name: "ae.safetensors" }),
        "8": node("CLIPTextEncode", { clip: ["6", 0], text: input.prompt.trim() || "high quality, preserve composition and identity, natural fine details" }),
        "9": node("CLIPTextEncode", { clip: ["6", 0], text: "" }),
        "10": node("ModelSamplingAuraFlow", { model: ["5", 0], shift: 3 }),
        "11": node("VAEEncode", { pixels: ["4", 0], vae: ["7", 0] }),
        "12": node("KSampler", { model: ["10", 0], seed: seed(), steps: 5, cfg: 1, sampler_name: "dpmpp_2m_sde", scheduler: "beta", positive: ["8", 0], negative: ["9", 0], latent_image: ["11", 0], denoise: Math.max(0.05, Math.min(0.4, Number(input.params.denoise) || 0.2)) }),
        "13": node("VAEDecode", { samples: ["12", 0], vae: ["7", 0] }),
        "14": node("ImageScale", { image: ["13", 0], upscale_method: "lanczos", width, height, crop: "disabled" }),
        "15": node("SaveImage", { images: ["14", 0], filename_prefix: "InfiniteCanvas/Z-Image-Upscale" }),
    };
}

function hiDream(input: WorkflowInput): Workflow {
    const { width, height } = hiDreamDimensions(input.params);
    const promptPackage = input.params.__promptPackage && typeof input.params.__promptPackage === "object" ? input.params.__promptPackage as Record<string, unknown> : {};
    const checks = Array.isArray(promptPackage.checks) ? promptPackage.checks : [];
    const plainBackground = checks.includes("plain_background");
    const graph: Workflow = {
        "1": node("CheckpointLoaderSimple", { ckpt_name: "hidream_o1_image_fp8_scaled.safetensors" }),
        "2": node("ModelNoiseScale", { model: ["1", 0], noise_scale: 8 }),
        "3": node("HiDreamO1PatchSeamSmoothing", { model: ["2", 0], start_percent: 0.8, end_percent: 1, pattern: "single_shift", passes: "ramp_2_4", blend: "median", strength: 1 }),
        "4": node("CLIPTextEncode", { clip: ["1", 1], text: input.prompt.trim() }),
        "5": node("CLIPTextEncode", { clip: ["1", 1], text: "" }),
        "6": node("EmptyHiDreamO1LatentImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(input.params.count) || 1)) }),
        "7": node("BasicScheduler", { model: ["2", 0], scheduler: "normal", steps: String(input.params.quality) === "high" ? 50 : 40, denoise: 1 }),
        "8": node("KSamplerSelect", { sampler_name: "dpmpp_2m_sde_gpu" }),
        "9": node("SamplerCustom", { model: ["3", 0], add_noise: true, noise_seed: seed(), cfg: 5, positive: ["4", 0], negative: ["5", 0], sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["6", 0] }),
        "10": node("VAEDecode", { samples: ["9", 0], vae: ["1", 2] }),
        "11": node("SaveImage", { images: ["10", 0], filename_prefix: "InfiniteCanvas/HiDream-O1" }),
    };
    if (plainBackground) {
        graph["16"] = node("LoadBackgroundRemovalModel", { bg_removal_name: "birefnet.safetensors" });
        graph["17"] = node("RemoveBackground", { bg_removal_model: ["16", 0], image: ["10", 0] });
        graph["18"] = node("EmptyImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(input.params.count) || 1)), color: 0xFFFFFF });
        graph["19"] = node("ImageCompositeMasked", { destination: ["18", 0], source: ["10", 0], x: 0, y: 0, resize_source: false, mask: ["17", 0] });
        graph["11"].inputs.images = ["19", 0];
    }
    const images = input.files.filter((file) => file.kind === "image");
    if (images.length > 10) throw Object.assign(new Error("HiDream-O1 最多支持 10 张参考图"), { status: 400 });
    if (images.length) {
        const referenceInputs: NodeInput = { positive: ["4", 0], negative: ["5", 0] };
        images.forEach((image, index) => { const id = String(21 + index); graph[id] = node("LoadImage", { image: image.name }); referenceInputs[`images.image_${index + 1}`] = [id, 0]; });
        graph["12"] = node("HiDreamO1ReferenceImages", referenceInputs);
        graph["9"].inputs.positive = ["12", 0]; graph["9"].inputs.negative = ["12", 1];
    }
    return graph;
}

function flux2Dev(input: WorkflowInput): Workflow {
    const { width, height } = dimensions(input.params, String(input.params.quality) === "high" ? 1440 : 1024);
    const images = input.files.filter((file) => file.kind === "image");
    if (images.length > 6) throw Object.assign(new Error("FLUX.2 Dev 最多支持 6 张参考图"), { status: 400 });
    const graph: Workflow = {
        "1": node("UNETLoader", { unet_name: "flux2_dev_fp8mixed.safetensors", weight_dtype: "default" }),
        "2": node("CLIPLoader", { clip_name: "mistral_3_small_flux2_fp8.safetensors", type: "flux2", device: "default" }),
        "3": node("VAELoader", { vae_name: "flux2-vae.safetensors" }),
        "4": node("CLIPTextEncode", { clip: ["2", 0], text: input.prompt.trim() }),
        "5": node("FluxGuidance", { conditioning: ["4", 0], guidance: 4 }),
        "6": node("EmptyFlux2LatentImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(input.params.count) || 1)) }),
        "7": node("RandomNoise", { noise_seed: seed() }),
        "8": node("KSamplerSelect", { sampler_name: "euler" }),
        "9": node("Flux2Scheduler", { steps: 20, width, height }),
        "10": node("BasicGuider", { model: ["1", 0], conditioning: ["5", 0] }),
        "11": node("SamplerCustomAdvanced", { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["6", 0] }),
        "12": node("VAEDecode", { samples: ["11", 0], vae: ["3", 0] }),
        "13": node("SaveImage", { images: ["12", 0], filename_prefix: "InfiniteCanvas/FLUX.2-Dev" }),
    };
    let conditioning: [string, number] = ["5", 0];
    images.forEach((image, index) => {
        const loadId = String(20 + index * 3);
        const encodeId = String(21 + index * 3);
        const referenceId = String(22 + index * 3);
        graph[loadId] = node("LoadImage", { image: image.name });
        graph[encodeId] = node("VAEEncode", { pixels: [loadId, 0], vae: ["3", 0] });
        graph[referenceId] = node("ReferenceLatent", { conditioning, latent: [encodeId, 0] });
        conditioning = [referenceId, 0];
    });
    graph["10"].inputs.conditioning = conditioning;
    return graph;
}
