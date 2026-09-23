import { imageRequestParams, validateImageInput } from "../../../../server/src/image-contract";
import { nanoid } from "nanoid";

import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { ensureServerReference, generationFiles, runServerGeneration } from "@/services/api/ai-generation";
import { getAvailableModel, modelSupportsImageMode, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

type TextContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
type TextPart = Exclude<TextContent, string>[number];
export type AiTextMessage = { role: "system" | "user" | "assistant"; content: TextContent };
type RequestOptions = { signal?: AbortSignal };

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const generation = await runServerGeneration({
        kind: "image", imageInputVersion: 1,
        model: config.model || config.imageModel,
        prompt,
        params: modelImageParams(config, prompt, 0),
    }, options);
    return imageResults(generation);
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions, purpose?: "image-inpaint" | "image-angle", toolParams: Record<string, unknown> = {}) {
    const files = await Promise.all([...references, ...(mask ? [mask] : [])].map((reference) => ensureServerReference(reference, "image")));
    const editModel = config.model || [config.imageEditModel].find((model) => modelSupportsImageMode(model, "edit"));
    const generation = await runServerGeneration({
        kind: "image",
        ...(!purpose ? { imageInputVersion: 1 as const } : {}),
        model: purpose ? undefined : editModel,
        ...(purpose ? { purpose } : {}),
        prompt: buildImageReferencePromptText(prompt, references),
        params: purpose ? { ...imageParams(config), ...toolParams, maskFileId: mask ? files.at(-1)?.fileId : undefined } : modelImageParams({ ...config, model: editModel || "" }, prompt, references.length),
        references: files,
    }, options);
    return imageResults(generation);
}

export async function requestUpscale(source: ReferenceImage, params: { mode: "faithful" | "generative"; targetLongEdge: number; sourceWidth: number; sourceHeight: number; denoise?: number }, options?: RequestOptions) {
    const reference = await ensureServerReference(source, "image");
    const generation = await runServerGeneration({
        kind: "image",
        purpose: params.mode === "generative" ? "image-upscale-generative" : "image-upscale-faithful",
        prompt: params.mode === "generative" ? "保持原图构图、主体身份、颜色和文字，增强自然纹理与清晰度。" : undefined,
        params,
        references: [reference],
    }, options);
    return imageResults(generation);
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const imageSources = messages.flatMap((message) => Array.isArray(message.content)
        ? message.content.filter((part): part is Extract<TextPart, { type: "image_url" }> => part.type === "image_url").map((part) => part.image_url.url)
        : []);
    const references = await Promise.all(imageSources.map((url, index) => ensureServerReference({ dataUrl: url, name: `message-image-${index + 1}.png`, type: "image/png" }, "image")));
    const normalized = messages.map((message) => ({
        role: message.role,
        content: Array.isArray(message.content) ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : message.content,
    }));
    const generation = await runServerGeneration({
        kind: "text",
        model: config.model || config.textModel,
        messages: normalized,
        params: { systemPrompt: config.systemPrompt, reasoningEffort: config.reasoningEffort },
        references,
    }, { ...options, onDelta });
    return String(generation.result?.text || "");
}

function imageParams(config: AiConfig) {
    return {
        count: Math.max(1, Math.min(15, Math.floor(Number(config.count)) || 1)),
        quality: config.quality,
        size: config.size,
        background: config.background,
        systemPrompt: config.systemPrompt,
    };
}

function modelImageParams(config: AiConfig, prompt: string, referenceCount: number) {
    const contract = getAvailableModel(config.model || config.imageModel)?.imageContract;
    if (!contract) throw new Error("当前图片模型缺少输入定义，请刷新模型目录");
    const params = imageRequestParams(contract, { ...config });
    const errors = validateImageInput(contract, prompt, params, referenceCount);
    if (errors.length) throw new Error(errors.join("；"));
    return { ...params, systemPrompt: config.systemPrompt };
}

function imageResults(generation: Parameters<typeof generationFiles>[0]) {
    const files = generationFiles(generation);
    if (!files.length || files.some((file) => !file.mimeType.startsWith("image/"))) throw new Error("图片任务没有返回有效图片文件");
    return files.map((file) => ({ id: file.id || nanoid(), dataUrl: file.url }));
}
