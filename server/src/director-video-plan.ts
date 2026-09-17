import { COMFY_MODEL_DEFINITIONS } from "./comfy-workflows.js";

export const defaultDirectorVideoModel = "comfyui::minimax-h3-ref2va-local";
export function directorVideoLimits(modelRef = defaultDirectorVideoModel) {
    const [provider, id] = modelRef.split("::");
    const model = COMFY_MODEL_DEFINITIONS[id as keyof typeof COMFY_MODEL_DEFINITIONS];
    if (provider !== "comfyui" || !model || model.output !== "video" || !("minDurationSeconds" in model) || !("maxDurationSeconds" in model) || typeof model.minDurationSeconds !== "number" || typeof model.maxDurationSeconds !== "number") throw new Error("请为分镜段选择支持时长校验的视频模型");
    return { modelRef, min: model.minDurationSeconds, max: model.maxDurationSeconds };
}
export function validateDirectorSegmentDuration(seconds: number, modelRef = defaultDirectorVideoModel) {
    const limits = directorVideoLimits(modelRef);
    if (!Number.isFinite(seconds) || seconds < limits.min || seconds > limits.max) throw new Error(`分镜段须对应一次完整视频生成，当前模型支持 ${limits.min}–${limits.max} 秒；请回到分镜按动作与镜头切点重新拆段`);
    return seconds;
}
