/** Canvas video inputs. Native Director continuation/guide requests have their own contract. */
export type VideoParameters = { sizes?: string[]; resolutions?: string[]; seconds?: number[]; generateAudio?: boolean; watermark?: boolean; maxImages?: number; maxVideos?: number; maxAudios?: number; maxTotal?: number };
export type VideoContract = { version: 1; sizes: string[]; resolutions: string[]; seconds: number[]; generateAudio: boolean; watermark: boolean; imageRoles: string[]; minImages: number; maxImages: number; maxVideos: number; maxAudios: number; maxTotal: number; family: "openai" | "gemini" | "ark" | "h3"; mode?: string };
export function videoContractFor(model: { id: string; endpoint?: string; videoParameters?: VideoParameters; maxReferenceImages?: number; videoReferenceRoles?: string[] }): VideoContract | undefined {
    let c: VideoContract;
    const base = { version: 1 as const, generateAudio: false, watermark: false, minImages: 0, maxVideos: 0, maxAudios: 0 };
    if (model.id.startsWith("minimax-h3-")) {
        const firstLast = model.id.includes("fl2va");
        c = { ...base, family: "h3", mode: firstLast ? "fl2va" : "ref2va", sizes: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["480p", "768p"], seconds: Array.from({ length: 12 }, (_, i) => i + 4), imageRoles: firstLast ? ["first-frame", "last-frame"] : ["reference"], minImages: firstLast ? 1 : 0, maxImages: firstLast ? 2 : 9, maxVideos: firstLast ? 0 : 3, maxAudios: firstLast ? 0 : 3, maxTotal: firstLast ? 2 : 12 };
    } else if (model.endpoint === "openai-video") c = { ...base, family: "openai", sizes: model.id === "sora-2" ? ["1280x720", "720x1280"] : ["1280x720", "720x1280", "1792x1024", "1024x1792"], resolutions: [], seconds: [4, 8, 12], imageRoles: ["first-frame"], maxImages: 1, maxTotal: 1 };
    else if (model.endpoint === "gemini-video") c = { ...base, family: "gemini", sizes: ["16:9", "9:16"], resolutions: ["720p"], seconds: model.id.startsWith("veo-2") ? [5, 6, 7, 8] : [4, 6, 8], imageRoles: model.videoReferenceRoles?.includes("last-frame") ? ["first-frame", "last-frame"] : ["first-frame"], maxImages: model.videoReferenceRoles?.includes("last-frame") ? 2 : 1, maxTotal: 2 };
    else if (model.endpoint === "ark-seedance") c = { ...base, family: "ark", sizes: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], resolutions: ["720p"], seconds: [5, 10], generateAudio: true, watermark: true, imageRoles: model.videoReferenceRoles?.includes("reference") ? ["reference"] : ["first-frame", "last-frame"], maxImages: model.videoReferenceRoles?.includes("reference") ? model.maxReferenceImages || 1 : 2, maxTotal: model.maxReferenceImages || 2 };
    else return undefined;
    if (c.family === "gemini" && model.videoReferenceRoles?.includes("reference")) { c.imageRoles = ["reference"]; c.maxImages = 3; c.maxTotal = 3; }
    return { ...c, ...model.videoParameters };
}
export function videoDefaults(c: VideoContract) {
    return { size: c.sizes[0], vquality: c.resolutions[0] || "", videoSeconds: String(c.family === "gemini" && c.imageRoles.includes("reference") && c.seconds.includes(8) ? 8 : c.seconds[0]), videoGenerateAudio: "true", videoWatermark: "false" };
}
export function videoRequestParams(c: VideoContract, config: Record<string, unknown>) {
    return { seconds: Number(config.videoSeconds), ...(c.family === "openai" ? { size: config.size } : { ratio: config.size }), ...(c.resolutions.length ? { resolution: config.vquality } : {}), ...(c.generateAudio ? { generateAudio: config.videoGenerateAudio !== "false" } : {}), ...(c.watermark ? { watermark: config.videoWatermark === "true" } : {}) };
}
export function videoReferenceRole(c: VideoContract, kind: string, imageIndex: number) {
    return kind === "image" && !c.imageRoles.includes("reference") ? c.imageRoles[imageIndex] || "reference" : "reference";
}
export function validateVideoInput(c: VideoContract, prompt: string, params: Record<string, unknown>, refs: Array<{ kind?: string; role?: string }>) {
    const errors: string[] = [];
    if (!prompt.trim()) errors.push("请填写视频描述");
    if (!c.sizes.includes(String(params[c.family === "openai" ? "size" : "ratio"]))) errors.push("画面尺寸不受当前模型支持");
    if (!c.seconds.includes(Number(params.seconds)) || typeof params.seconds !== "number") errors.push("时长不受当前模型支持");
    if (c.resolutions.length && !c.resolutions.includes(String(params.resolution))) errors.push("分辨率不受当前模型支持");
    const allowed = ["seconds", c.family === "openai" ? "size" : "ratio", ...(c.resolutions.length ? ["resolution"] : []), ...(c.generateAudio ? ["generateAudio"] : []), ...(c.watermark ? ["watermark"] : [])];
    if (Object.keys(params).some(k => !allowed.includes(k))) errors.push("包含当前视频模型不支持的参数");
    for (const key of ["generateAudio", "watermark"]) if (params[key] !== undefined && typeof params[key] !== "boolean") errors.push("声音和水印开关必须为布尔值");
    const count = (kind: string) => refs.filter(r => (r.kind || "image") === kind).length;
    if (count("image") < c.minImages) errors.push("当前模型需要首帧参考图");
    if (count("image") > c.maxImages || count("video") > c.maxVideos || count("audio") > c.maxAudios || refs.length > c.maxTotal) errors.push(`参考数量超限：图片 ${c.maxImages}、视频 ${c.maxVideos}、音频 ${c.maxAudios}，合计最多 ${c.maxTotal}`);
    if (refs.some(r => !["image", "video", "audio"].includes(r.kind || "image") || ((r.kind || "image") === "image" ? !c.imageRoles.includes(r.role || "reference") : (r.role || "reference") !== "reference"))) errors.push("参考用途不受当前模型支持");
    for (const role of ["first-frame", "last-frame"]) if (refs.filter(r => r.role === role).length > 1) errors.push("首帧和尾帧各只能设置一张");
    if (refs.some(r => r.role === "last-frame") && !refs.some(r => r.role === "first-frame")) errors.push("尾帧需要同时提供首帧");
    if (c.family === "h3" && count("audio") && !count("image") && !count("video")) errors.push("H3 音频参考需要搭配图片或视频");
    if (c.family === "gemini" && c.imageRoles.includes("reference") && count("image") && params.seconds !== 8) errors.push("Veo 参考图生成需要 8 秒时长");
    if (c.family === "gemini" && params.resolution !== "720p" && params.seconds !== 8) errors.push("Veo 高分辨率输出需要 8 秒时长");
    return errors;
}
