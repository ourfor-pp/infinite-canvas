type NodeInput = Record<string, unknown>;
type Workflow = Record<string, { class_type: string; inputs: NodeInput }>;
type WorkflowInput = { model: string; prompt: string; params: Record<string, unknown>; images: string[]; videos: string[]; audios: string[] };

const node = (classType: string, inputs: NodeInput) => ({ class_type: classType, inputs });
const seed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

export const COMFY_MODELS = ["hidream-o1-full-fp8-local", "minimax-h3-fl2va-local", "minimax-h3-ref2va-local", "voxcpm2-local"] as const;

export function buildComfyWorkflow(input: WorkflowInput): Workflow {
    if (input.model === "hidream-o1-full-fp8-local") return hiDream(input);
    if (input.model === "minimax-h3-fl2va-local" || input.model === "minimax-h3-ref2va-local") return miniMaxH3(input);
    if (input.model === "voxcpm2-local") return voxCpm(input);
    throw Object.assign(new Error("不支持的 ComfyUI 模型"), { code: "COMFY_MODEL_UNSUPPORTED", status: 400 });
}

function hiDream({ prompt, params, images }: WorkflowInput): Workflow {
    const size = String(params.size || "16:9");
    const dimensions = size.match(/^(\d+)x(\d+)$/);
    const portrait = dimensions ? Number(dimensions[2]) > Number(dimensions[1]) : size === "9:16";
    const graph: Workflow = {
        "1": node("CheckpointLoaderSimple", { ckpt_name: "hidream_o1_image_fp8_scaled.safetensors" }),
        "2": node("ModelNoiseScale", { model: ["1", 0], noise_scale: 8 }),
        "3": node("HiDreamO1PatchSeamSmoothing", { model: ["2", 0], start_percent: 0.8, end_percent: 1, pattern: "single_shift", passes: "ramp_2_4", blend: "median", strength: 1 }),
        "4": node("CLIPTextEncode", { clip: ["1", 1], text: prompt.trim() }),
        "5": node("CLIPTextEncode", { clip: ["1", 1], text: "" }),
        "6": node("EmptyHiDreamO1LatentImage", { width: portrait ? 1440 : 2560, height: portrait ? 2560 : 1440, batch_size: Math.max(1, Math.min(15, Number(params.count) || 1)) }),
        "7": node("BasicScheduler", { model: ["2", 0], scheduler: "normal", steps: 40, denoise: 1 }),
        "8": node("KSamplerSelect", { sampler_name: "dpmpp_2m_sde_gpu" }),
        "9": node("SamplerCustom", { model: ["13", 0], add_noise: true, noise_seed: seed(), cfg: 5, positive: ["4", 0], negative: ["5", 0], sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["6", 0] }),
        "10": node("VAEDecode", { samples: ["9", 0], vae: ["1", 2] }),
        "11": node("SaveImage", { images: ["10", 0], filename_prefix: "InfiniteCanvas/HiDream-O1" }),
        "13": node("PathchSageAttentionKJ", { model: ["3", 0], sage_attention: "sageattn_qk_int8_pv_fp16_cuda", allow_compile: false }),
    };
    if (images.length > 10) throw Object.assign(new Error("HiDream-O1 最多支持 10 张参考图"), { status: 400 });
    if (images.length) {
        const referenceInputs: NodeInput = { positive: ["4", 0], negative: ["5", 0] };
        images.forEach((image, index) => {
            const id = String(21 + index);
            graph[id] = node("LoadImage", { image });
            referenceInputs[`images.image_${index + 1}`] = [id, 0];
        });
        graph["12"] = node("HiDreamO1ReferenceImages", referenceInputs);
        graph["9"].inputs.positive = ["12", 0];
        graph["9"].inputs.negative = ["12", 1];
    }
    return graph;
}

function miniMaxH3({ model, prompt, params, images, videos, audios }: WorkflowInput): Workflow {
    const ratioParts = String(params.ratio || params.size || "16:9").split(":").map(Number);
    const ratio = ratioParts.length === 2 && ratioParts.every((value) => value > 0) ? ratioParts[0] / ratioParts[1] : 16 / 9;
    const shortEdge = String(params.resolution || params.vquality).toLowerCase() === "480p" ? 480 : 768;
    let width = ratio >= 1 ? shortEdge * ratio : shortEdge;
    let height = ratio >= 1 ? shortEdge : shortEdge / ratio;
    const maxPixels = shortEdge * (shortEdge === 480 ? 864 : 1344);
    if (width * height > maxPixels) {
        const scale = Math.sqrt(maxPixels / (width * height));
        width *= scale;
        height *= scale;
    }
    width = Math.max(32, Math.round(width / 32) * 32);
    height = Math.max(32, Math.round(height / 32) * 32);
    const duration = Math.max(5, Math.min(15, Math.floor(Number(params.seconds || params.videoSeconds) || 5)));
    const referenceMode = model === "minimax-h3-ref2va-local";
    const graph: Workflow = {
        "1": node("UNETLoader", { unet_name: referenceMode ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors" : "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" }),
        "2": node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }),
        "3": node("VAELoader", { vae_name: "minimax_h3_video_vae_fp16.safetensors" }),
        "4": node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }),
        "6": node("BasicGuider", { model: ["15", 0], conditioning: ["5", 0] }),
        "7": node("KSamplerSelect", { sampler_name: "res_multistep" }),
        "8": node("BasicScheduler", { model: ["15", 0], scheduler: "simple", steps: 20, denoise: 1 }),
        "9": node("RandomNoise", { noise_seed: seed() }),
        "10": node("SamplerCustomAdvanced", { noise: ["9", 0], guider: ["6", 0], sampler: ["7", 0], sigmas: ["8", 0], latent_image: ["5", 1] }),
        "11": node("VAEDecode", { samples: ["10", 0], vae: ["3", 0] }),
        "12": node("VAEDecodeAudio", { samples: ["10", 0], vae: ["4", 0] }),
        "13": node("CreateVideo", { images: ["11", 0], audio: ["12", 0], fps: 24, bit_depth: 8 }),
        "14": node("SaveVideo", { video: ["13", 0], filename_prefix: "InfiniteCanvas/MiniMax-H3", format: "auto", codec: "auto" }),
        "15": node("PathchSageAttentionKJ", { model: ["1", 0], sage_attention: "sageattn_qk_int8_pv_fp16_cuda", allow_compile: false }),
    };
    const inputs: NodeInput = { clip: ["2", 0], vae: ["3", 0], prompt: prompt.trim(), width, height, length: duration * 24 };
    if (!referenceMode) {
        if (videos.length || audios.length) throw Object.assign(new Error("H3 FL2VA 不支持参考视频或音频"), { status: 400 });
        images.slice(0, 2).forEach((image, index) => {
            const id = String(20 + index);
            graph[id] = node("LoadImage", { image });
            inputs[index ? "last_frame" : "first_frame"] = [id, 0];
        });
        graph["5"] = node("MiniMaxH3ImageToVideo", inputs);
        return graph;
    }
    if (images.length > 9 || videos.length > 3 || audios.length > 3) throw Object.assign(new Error("H3 Ref2VA 参考素材数量超限"), { status: 400 });
    if (audios.length && !images.length && !videos.length) throw Object.assign(new Error("使用参考音频时还需要参考图片或视频"), { status: 400 });
    Object.assign(inputs, { audio_vae: ["4", 0], ref_image_size: "match" });
    images.forEach((image, index) => {
        const id = String(21 + index);
        graph[id] = node("LoadImage", { image });
        inputs[`ref_images.ref_image_${index}`] = [id, 0];
    });
    audios.forEach((audio, index) => {
        const id = String(41 + index);
        graph[id] = node("LoadAudio", { audio });
        inputs[`ref_audios.ref_audio_${index}`] = [id, 0];
    });
    videos.forEach((video, index) => {
        const loadId = String(61 + index * 2);
        const componentsId = String(62 + index * 2);
        graph[loadId] = node("LoadVideo", { file: video });
        graph[componentsId] = node("GetVideoComponents", { video: [loadId, 0] });
        inputs[`ref_videos.ref_video_${index}`] = [componentsId, 0];
        inputs[`ref_video_audios.ref_video_audio_${index}`] = [componentsId, 1];
    });
    graph["5"] = node("MiniMaxH3ReferenceToVideo", inputs);
    return graph;
}

function voxCpm({ prompt, params }: WorkflowInput): Workflow {
    return {
        "1": node("RunningHub_VoxCPM_LoadModel", { model_name: "VoxCPM2", optimize: false, lora_name: "None" }),
        "2": node("RunningHub_VoxCPM_Generate", {
            model: ["1", 0],
            control_instruction: String(params.instructions || "自然、清晰、有感染力的中文旁白声音").trim(),
            text: prompt.trim(),
            cfg_value: 2,
            inference_steps: 10,
            seed: seed(),
            ultimate_clone: false,
            reference_audio_text: "",
            normalize_text: false,
            denoise_reference: false,
            max_len: 4096,
            retry_badcase: true,
        }),
        "3": node("SaveAudio", { audio: ["2", 0], filename_prefix: "InfiniteCanvas/VoxCPM2" }),
    };
}
