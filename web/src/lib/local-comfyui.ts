const COMMON_SCRIPT = String.raw`
const comfyNode = (classType, inputs) => ({ class_type: classType, inputs });
const comfySeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
const comfyId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

async function comfyUpload(source, prefix) {
  const blob = await (await fetch(source)).blob();
  const extension = (blob.type.split("/")[1] || "bin").replace("jpeg", "jpg").replace("x-wav", "wav");
  const form = new FormData();
  form.set("type", "input");
  form.set("image", blob, prefix + "-" + comfyId() + "." + extension);
  const uploaded = await request({ method: "post", url: baseUrl + "/upload/image", data: form });
  if (!uploaded?.name) throw new Error("ComfyUI 素材上传失败");
  return uploaded.subfolder ? uploaded.subfolder + "/" + uploaded.name : uploaded.name;
}

function comfyHistoryResult(history, promptId) {
  const entry = history?.[promptId];
  if (!entry) return null;
  if (entry.status?.status_str === "error") {
    const messages = entry.status.messages || [];
    const detail = [...messages].reverse().find((item) => item?.[1]?.exception_message)?.[1]?.exception_message;
    throw new Error(detail || "ComfyUI 工作流执行失败");
  }
  const files = Object.values(entry.outputs || {}).flatMap((output) =>
    Object.values(output || {}).flatMap((items) => Array.isArray(items) ? items : []),
  ).filter((item) => item?.filename);
  return files.length ? files : null;
}

async function comfyRun(workflow, timeoutMs) {
  const created = await request({
    method: "post",
    url: baseUrl + "/prompt",
    headers: { "Content-Type": "application/json" },
    data: { prompt: workflow, client_id: "infinite-canvas-" + comfyId() },
  });
  if (!created?.prompt_id) throw new Error("ComfyUI 拒绝工作流：" + JSON.stringify(created?.node_errors || created));
  const files = await poll(
    () => request({ method: "get", url: baseUrl + "/history/" + created.prompt_id }),
    (history) => comfyHistoryResult(history, created.prompt_id),
    { intervalMs: 1500, timeoutMs },
  );
  return files.map((file) => baseUrl + "/view?" + new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || "output",
  }));
}
`;

export const HIDREAM_O1_SCRIPT = `${COMMON_SCRIPT}
const size = String(params.size || "16:9");
const dimensions = size.match(/^(\\d+)x(\\d+)$/);
const portrait = dimensions ? Number(dimensions[2]) > Number(dimensions[1]) : size === "9:16";
const width = portrait ? 1440 : 2560;
const height = portrait ? 2560 : 1440;
const graph = {
  "1": comfyNode("CheckpointLoaderSimple", { ckpt_name: "hidream_o1_image_fp8_scaled.safetensors" }),
  "2": comfyNode("ModelNoiseScale", { model: ["1", 0], noise_scale: 8 }),
  "3": comfyNode("HiDreamO1PatchSeamSmoothing", { model: ["2", 0], start_percent: 0.8, end_percent: 1, pattern: "single_shift", passes: "ramp_2_4", blend: "median", strength: 1 }),
  "4": comfyNode("CLIPTextEncode", { clip: ["1", 1], text: prompt.trim() }),
  "5": comfyNode("CLIPTextEncode", { clip: ["1", 1], text: "" }),
  "6": comfyNode("EmptyHiDreamO1LatentImage", { width, height, batch_size: Math.max(1, Math.min(15, Number(params.count) || 1)) }),
  "7": comfyNode("BasicScheduler", { model: ["2", 0], scheduler: "normal", steps: 40, denoise: 1 }),
  "8": comfyNode("KSamplerSelect", { sampler_name: "dpmpp_2m_sde_gpu" }),
  "9": comfyNode("SamplerCustom", { model: ["13", 0], add_noise: true, noise_seed: comfySeed(), cfg: 5, positive: ["4", 0], negative: ["5", 0], sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["6", 0] }),
  "10": comfyNode("VAEDecode", { samples: ["9", 0], vae: ["1", 2] }),
  "11": comfyNode("SaveImage", { images: ["10", 0], filename_prefix: "InfiniteCanvas/HiDream-O1" }),
  "13": comfyNode("PathchSageAttentionKJ", { model: ["3", 0], sage_attention: "sageattn_qk_int8_pv_fp16_cuda", allow_compile: false }),
};
if (images.length > 10) throw new Error("HiDream-O1 最多支持 10 张参考图");
if (images.length) {
  const referenceInputs = { positive: ["4", 0], negative: ["5", 0] };
  for (let index = 0; index < images.length; index += 1) {
    const nodeId = String(21 + index);
    graph[nodeId] = comfyNode("LoadImage", { image: await comfyUpload(images[index], "hidream-reference") });
    referenceInputs["images.image_" + (index + 1)] = [nodeId, 0];
  }
  graph["12"] = comfyNode("HiDreamO1ReferenceImages", referenceInputs);
  graph["9"].inputs.positive = ["12", 0];
  graph["9"].inputs.negative = ["12", 1];
}
return await comfyRun(graph, 60 * 60 * 1000);`;

export const MINIMAX_H3_SCRIPT = `${COMMON_SCRIPT}
const ratioParts = String(params.ratio || "16:9").split(":").map(Number);
const ratio = ratioParts.length === 2 && ratioParts.every((value) => value > 0) ? ratioParts[0] / ratioParts[1] : 16 / 9;
const shortEdge = String(params.resolution).toLowerCase() === "480p" ? 480 : 768;
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
const duration = Math.max(5, Math.min(15, Math.floor(Number(params.seconds) || 5)));
const isReferenceModel = model === "minimax-h3-ref2va-local";
const graph = {
  "1": comfyNode("UNETLoader", { unet_name: isReferenceModel ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors" : "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" }),
  "2": comfyNode("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }),
  "3": comfyNode("VAELoader", { vae_name: "minimax_h3_video_vae_fp16.safetensors" }),
  "4": comfyNode("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }),
  "6": comfyNode("BasicGuider", { model: ["15", 0], conditioning: ["5", 0] }),
  "7": comfyNode("KSamplerSelect", { sampler_name: "res_multistep" }),
  "8": comfyNode("BasicScheduler", { model: ["15", 0], scheduler: "simple", steps: 20, denoise: 1 }),
  "9": comfyNode("RandomNoise", { noise_seed: comfySeed() }),
  "10": comfyNode("SamplerCustomAdvanced", { noise: ["9", 0], guider: ["6", 0], sampler: ["7", 0], sigmas: ["8", 0], latent_image: ["5", 1] }),
  "11": comfyNode("VAEDecode", { samples: ["10", 0], vae: ["3", 0] }),
  "12": comfyNode("VAEDecodeAudio", { samples: ["10", 0], vae: ["4", 0] }),
  "13": comfyNode("CreateVideo", { images: ["11", 0], audio: ["12", 0], fps: 24, bit_depth: 8 }),
  "14": comfyNode("SaveVideo", { video: ["13", 0], filename_prefix: "InfiniteCanvas/MiniMax-H3", format: "auto", codec: "auto" }),
  "15": comfyNode("PathchSageAttentionKJ", { model: ["1", 0], sage_attention: "sageattn_qk_int8_pv_fp16_cuda", allow_compile: false }),
};
const h3Inputs = { clip: ["2", 0], vae: ["3", 0], prompt: prompt.trim(), width, height, length: duration * 24 };
if (!isReferenceModel) {
  if (params.referenceVideos?.length || params.referenceAudios?.length) throw new Error("H3 FL2VA 不支持参考视频或参考音频");
  if (images[0]) {
    graph["20"] = comfyNode("LoadImage", { image: await comfyUpload(images[0], "h3-first-frame") });
    h3Inputs.first_frame = ["20", 0];
  }
  if (images[1]) {
    graph["21"] = comfyNode("LoadImage", { image: await comfyUpload(images[1], "h3-last-frame") });
    h3Inputs.last_frame = ["21", 0];
  }
  graph["5"] = comfyNode("MiniMaxH3ImageToVideo", h3Inputs);
} else {
  const referenceVideos = params.referenceVideos || [];
  const referenceAudios = params.referenceAudios || [];
  if (images.length > 9 || referenceVideos.length > 3 || referenceAudios.length > 3) throw new Error("H3 Ref2VA 参考素材数量超限（图片 9、视频 3、音频 3）");
  if (referenceAudios.length && !images.length && !referenceVideos.length) throw new Error("H3 Ref2VA 使用参考音频时还需要参考图片或视频");
  h3Inputs.audio_vae = ["4", 0];
  h3Inputs.ref_image_size = "match";
  for (let index = 0; index < images.length; index += 1) {
    const nodeId = String(21 + index);
    graph[nodeId] = comfyNode("LoadImage", { image: await comfyUpload(images[index], "h3-reference-image") });
    h3Inputs["ref_images.ref_image_" + index] = [nodeId, 0];
  }
  for (let index = 0; index < referenceAudios.length; index += 1) {
    const nodeId = String(41 + index);
    graph[nodeId] = comfyNode("LoadAudio", { audio: await comfyUpload(referenceAudios[index], "h3-reference-audio") });
    h3Inputs["ref_audios.ref_audio_" + index] = [nodeId, 0];
  }
  for (let index = 0; index < referenceVideos.length; index += 1) {
    const loadId = String(61 + index * 2);
    const componentsId = String(62 + index * 2);
    graph[loadId] = comfyNode("LoadVideo", { file: await comfyUpload(referenceVideos[index], "h3-reference-video") });
    graph[componentsId] = comfyNode("GetVideoComponents", { video: [loadId, 0] });
    h3Inputs["ref_videos.ref_video_" + index] = [componentsId, 0];
    h3Inputs["ref_video_audios.ref_video_audio_" + index] = [componentsId, 1];
  }
  graph["5"] = comfyNode("MiniMaxH3ReferenceToVideo", h3Inputs);
}
return { url: (await comfyRun(graph, 3 * 60 * 60 * 1000))[0] };`;

export const VOXCPM2_SCRIPT = `${COMMON_SCRIPT}
const instruction = String(params.instructions || "自然、清晰、有感染力的中文旁白声音").trim();
const graph = {
  "1": comfyNode("RunningHub_VoxCPM_LoadModel", { model_name: "VoxCPM2", optimize: false, lora_name: "None" }),
  "2": comfyNode("RunningHub_VoxCPM_Generate", {
    model: ["1", 0], control_instruction: instruction, text: prompt.trim(), cfg_value: 2,
    inference_steps: 10, seed: comfySeed(), ultimate_clone: false, reference_audio_text: "",
    normalize_text: false, denoise_reference: false, max_len: 4096, retry_badcase: true,
  }),
  "3": comfyNode("SaveAudio", { audio: ["2", 0], filename_prefix: "InfiniteCanvas/VoxCPM2" }),
};
return { url: (await comfyRun(graph, 60 * 60 * 1000))[0] };`;
