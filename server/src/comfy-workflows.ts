type NodeInput = Record<string, unknown>;
export type Workflow = Record<string, { class_type: string; inputs: NodeInput }>;
export type ComfyUploadedInput = { fileId: string; kind: "image" | "video" | "audio"; name: string };
type WorkflowInput = { model: string; prompt: string; params: Record<string, unknown>; files: ComfyUploadedInput[] };

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
    "minimax-h3-fl2va-local",
    "minimax-h3-ref2va-local",
    "voxcpm2-local",
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

export const COMFY_MODEL_DEFINITIONS: Record<ComfyModel, { name: string; output: "image" | "video" | "audio"; inputs: Array<"text" | "image" | "video" | "audio">; selectable: boolean; imageModes?: ImageMode[]; maxReferenceImages?: number }> = {
    "qwen-image-2512-local": { name: "Qwen Image 2512 FP8", output: "image", inputs: ["text"], selectable: true, imageModes: ["generate"] },
    "z-image-turbo-local": { name: "Z-Image Turbo", output: "image", inputs: ["text"], selectable: true, imageModes: ["generate"] },
    "qwen-image-edit-2511-local": { name: "Qwen Image Edit 2511", output: "image", inputs: ["text", "image"], selectable: true, imageModes: ["edit"], maxReferenceImages: 3 },
    "qwen-image-inpaint-local": { name: "Qwen Image 局部编辑", output: "image", inputs: ["text", "image"], selectable: false },
    "realesrgan-x4-local": { name: "RealESRGAN 忠实超分", output: "image", inputs: ["image"], selectable: false },
    "z-image-upscale-local": { name: "Z-Image 细节增强", output: "image", inputs: ["text", "image"], selectable: false },
    "hidream-o1-full-fp8-local": { name: "HiDream-O1 Full FP8", output: "image", inputs: ["text", "image"], selectable: true, imageModes: ["generate", "edit"], maxReferenceImages: 1 },
    "minimax-h3-fl2va-local": { name: "MiniMax H3 FL2VA", output: "video", inputs: ["text", "image"], selectable: true },
    "minimax-h3-ref2va-local": { name: "MiniMax H3 Ref2VA", output: "video", inputs: ["text", "image", "video", "audio"], selectable: true },
    "voxcpm2-local": { name: "VoxCPM2", output: "audio", inputs: ["text", "audio"], selectable: true },
};

export const COMFY_REQUIREMENTS: Partial<Record<ComfyModel, { nodes: string[]; models: Array<{ loader: string; name: string }> }>> = {
    "qwen-image-2512-local": { nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly", "EmptySD3LatentImage", "KSampler"], models: [{ loader: "UNETLoader", name: "qwen_image_2512_fp8_e4m3fn.safetensors" }, { loader: "CLIPLoader", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors" }, { loader: "VAELoader", name: "qwen_image_vae.safetensors" }, { loader: "LoraLoaderModelOnly", name: "Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors" }, { loader: "LoraLoaderModelOnly", name: "Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors" }] },
    "z-image-turbo-local": { nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "EmptySD3LatentImage", "KSampler"], models: [{ loader: "UNETLoader", name: "z_image_turbo_bf16.safetensors" }, { loader: "CLIPLoader", name: "qwen_3_4b.safetensors" }, { loader: "VAELoader", name: "ae.safetensors" }] },
    "qwen-image-edit-2511-local": { nodes: ["TextEncodeQwenImageEditPlus", "FluxKontextImageScale", "CFGNorm"], models: [{ loader: "UNETLoader", name: "qwen_image_edit_2511_bf16.safetensors" }, { loader: "CLIPLoader", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors" }, { loader: "VAELoader", name: "qwen_image_vae.safetensors" }] },
    "qwen-image-inpaint-local": { nodes: ["ControlNetInpaintingAliMamaApply", "SetLatentNoiseMask", "ImageCompositeMasked", "GrowMask", "ImageBlur"], models: [{ loader: "UNETLoader", name: "qwen_image_fp8_e4m3fn.safetensors" }, { loader: "CLIPLoader", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors" }, { loader: "VAELoader", name: "qwen_image_vae.safetensors" }, { loader: "ControlNetLoader", name: "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors" }] },
    "realesrgan-x4-local": { nodes: ["ImageUpscaleWithModel", "ImageScale"], models: [{ loader: "UpscaleModelLoader", name: "RealESRGAN_x4plus.safetensors" }] },
    "z-image-upscale-local": { nodes: ["ImageUpscaleWithModel", "ImageScaleToTotalPixels", "VAEEncode", "KSampler"], models: [{ loader: "UpscaleModelLoader", name: "RealESRGAN_x4plus.safetensors" }, { loader: "UNETLoader", name: "z_image_turbo_bf16.safetensors" }, { loader: "CLIPLoader", name: "qwen_3_4b.safetensors" }, { loader: "VAELoader", name: "ae.safetensors" }] },
};

export function buildComfyWorkflow(input: WorkflowInput): Workflow {
    if (input.model === "qwen-image-2512-local") return qwenTextToImage(input);
    if (input.model === "z-image-turbo-local") return zImageTextToImage(input);
    if (input.model === "qwen-image-edit-2511-local") return qwenEdit(input);
    if (input.model === "qwen-image-inpaint-local") return qwenInpaint(input);
    if (input.model === "realesrgan-x4-local") return realEsrgan(input);
    if (input.model === "z-image-upscale-local") return zImageUpscale(input);
    if (input.model === "hidream-o1-full-fp8-local") return hiDream(input);
    if (input.model === "minimax-h3-fl2va-local" || input.model === "minimax-h3-ref2va-local") return miniMaxH3(input);
    if (input.model === "voxcpm2-local") return voxCpm(input);
    throw Object.assign(new Error("不支持的 ComfyUI 模型"), { code: "COMFY_MODEL_UNSUPPORTED", status: 400 });
}

function dimensions(params: Record<string, unknown>, fallback = 1024) {
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
    const { width, height } = dimensions(input.params, 1440);
    const graph: Workflow = {
        "1": node("CheckpointLoaderSimple", { ckpt_name: "hidream_o1_image_fp8_scaled.safetensors" }),
        "2": node("ModelNoiseScale", { model: ["1", 0], noise_scale: 8 }),
        "3": node("HiDreamO1PatchSeamSmoothing", { model: ["2", 0], start_percent: 0.8, end_percent: 1, pattern: "single_shift", passes: "ramp_2_4", blend: "median", strength: 1 }),
        "4": node("CLIPTextEncode", { clip: ["1", 1], text: input.prompt.trim() }),
        "5": node("CLIPTextEncode", { clip: ["1", 1], text: "" }),
        "6": node("EmptyHiDreamO1LatentImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(input.params.count) || 1)) }),
        "7": node("BasicScheduler", { model: ["2", 0], scheduler: "normal", steps: String(input.params.quality) === "high" ? 50 : 40, denoise: 1 }),
        "8": node("KSamplerSelect", { sampler_name: "dpmpp_2m_sde_gpu" }),
        "9": node("SamplerCustom", { model: ["13", 0], add_noise: true, noise_seed: seed(), cfg: 5, positive: ["4", 0], negative: ["5", 0], sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["6", 0] }),
        "10": node("VAEDecode", { samples: ["9", 0], vae: ["1", 2] }),
        "11": node("SaveImage", { images: ["10", 0], filename_prefix: "InfiniteCanvas/HiDream-O1" }),
        "13": node("PathchSageAttentionKJ", { model: ["3", 0], sage_attention: "sageattn_qk_int8_pv_fp16_cuda", allow_compile: false }),
    };
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

function miniMaxH3(input: WorkflowInput): Workflow {
    const images = input.files.filter((file) => file.kind === "image").map((file) => file.name);
    const videos = input.files.filter((file) => file.kind === "video").map((file) => file.name);
    const audios = input.files.filter((file) => file.kind === "audio").map((file) => file.name);
    const ratioParts = String(input.params.ratio || input.params.size || "16:9").split(":").map(Number);
    const ratio = ratioParts.length === 2 && ratioParts.every((value) => value > 0) ? ratioParts[0] / ratioParts[1] : 16 / 9;
    const shortEdge = String(input.params.resolution || input.params.vquality).toLowerCase() === "480p" ? 480 : 768;
    let width = ratio >= 1 ? shortEdge * ratio : shortEdge; let height = ratio >= 1 ? shortEdge : shortEdge / ratio;
    const maxPixels = shortEdge * (shortEdge === 480 ? 864 : 1344);
    if (width * height > maxPixels) { const scale = Math.sqrt(maxPixels / (width * height)); width *= scale; height *= scale; }
    width = Math.max(32, Math.round(width / 32) * 32); height = Math.max(32, Math.round(height / 32) * 32);
    const duration = Math.max(5, Math.min(15, Math.floor(Number(input.params.seconds || input.params.videoSeconds) || 5)));
    const referenceMode = input.model === "minimax-h3-ref2va-local";
    const graph: Workflow = {
        "1": node("UNETLoader", { unet_name: referenceMode ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors" : "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" }),
        "2": node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }),
        "3": node("VAELoader", { vae_name: "minimax_h3_video_vae_fp16.safetensors" }), "4": node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }),
        "6": node("BasicGuider", { model: ["15", 0], conditioning: ["5", 0] }), "7": node("KSamplerSelect", { sampler_name: "res_multistep" }), "8": node("BasicScheduler", { model: ["15", 0], scheduler: "simple", steps: 20, denoise: 1 }), "9": node("RandomNoise", { noise_seed: seed() }),
        "10": node("SamplerCustomAdvanced", { noise: ["9", 0], guider: ["6", 0], sampler: ["7", 0], sigmas: ["8", 0], latent_image: ["5", 1] }), "11": node("VAEDecode", { samples: ["10", 0], vae: ["3", 0] }), "12": node("VAEDecodeAudio", { samples: ["10", 0], vae: ["4", 0] }), "13": node("CreateVideo", { images: ["11", 0], audio: ["12", 0], fps: 24, bit_depth: 8 }), "14": node("SaveVideo", { video: ["13", 0], filename_prefix: "InfiniteCanvas/MiniMax-H3", format: "auto", codec: "auto" }), "15": node("PathchSageAttentionKJ", { model: ["1", 0], sage_attention: "sageattn_qk_int8_pv_fp16_cuda", allow_compile: false }),
    };
    const inputs: NodeInput = { clip: ["2", 0], vae: ["3", 0], prompt: input.prompt.trim(), width, height, length: duration * 24 };
    if (!referenceMode) {
        if (videos.length || audios.length) throw Object.assign(new Error("H3 FL2VA 不支持参考视频或音频"), { status: 400 });
        images.slice(0, 2).forEach((image, index) => { const id = String(20 + index); graph[id] = node("LoadImage", { image }); inputs[index ? "last_frame" : "first_frame"] = [id, 0]; }); graph["5"] = node("MiniMaxH3ImageToVideo", inputs); return graph;
    }
    if (images.length > 9 || videos.length > 3 || audios.length > 3) throw Object.assign(new Error("H3 Ref2VA 参考素材数量超限"), { status: 400 });
    if (audios.length && !images.length && !videos.length) throw Object.assign(new Error("使用参考音频时还需要参考图片或视频"), { status: 400 });
    Object.assign(inputs, { audio_vae: ["4", 0], ref_image_size: "match" });
    images.forEach((image, index) => { const id = String(21 + index); graph[id] = node("LoadImage", { image }); inputs[`ref_images.ref_image_${index}`] = [id, 0]; });
    audios.forEach((audio, index) => { const id = String(41 + index); graph[id] = node("LoadAudio", { audio }); inputs[`ref_audios.ref_audio_${index}`] = [id, 0]; });
    videos.forEach((video, index) => { const loadId = String(61 + index * 2); const componentsId = String(62 + index * 2); graph[loadId] = node("LoadVideo", { file: video }); graph[componentsId] = node("GetVideoComponents", { video: [loadId, 0] }); inputs[`ref_videos.ref_video_${index}`] = [componentsId, 0]; inputs[`ref_video_audios.ref_video_audio_${index}`] = [componentsId, 1]; });
    graph["5"] = node("MiniMaxH3ReferenceToVideo", inputs); return graph;
}

function voxCpm(input: WorkflowInput): Workflow {
    const reference = input.files.find((file) => file.kind === "audio");
    const graph: Workflow = { "1": node("RunningHub_VoxCPM_LoadModel", { model_name: "VoxCPM2", optimize: false, lora_name: "None" }), "2": node("RunningHub_VoxCPM_Generate", { model: ["1", 0], control_instruction: String(input.params.instructions || "自然、清晰、有感染力的中文旁白声音").trim(), text: input.prompt.trim(), cfg_value: Math.max(1, Math.min(5, Number(input.params.cfgValue) || 2)), inference_steps: Math.max(4, Math.min(50, Number(input.params.steps) || 10)), seed: Number.isFinite(Number(input.params.seed)) ? Number(input.params.seed) : seed(), ultimate_clone: input.params.ultimateClone === true, reference_audio_text: String(input.params.referenceTranscript || "").trim(), normalize_text: input.params.normalizeText !== false, denoise_reference: Boolean(reference) && input.params.denoiseReference !== false, max_len: Math.max(256, Math.min(8192, Number(input.params.maxLength) || 4096)), retry_badcase: input.params.retryBadcase !== false }), "3": node("SaveAudio", { audio: ["2", 0], filename_prefix: "InfiniteCanvas/VoxCPM2" }) };
    if (reference) { graph["4"] = node("LoadAudio", { audio: reference.name }); graph["2"].inputs.reference_audio = ["4", 0]; }
    return graph;
}
