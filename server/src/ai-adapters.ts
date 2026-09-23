import { playableAudio } from "./audio-output.js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { openAsBlob, readFileSync } from "node:fs";
import { basename } from "node:path";
import { config } from "./config.js";
import { getStoredFile, storeRemoteFile } from "./file-store.js";
import { modelEndpointRegistry, providerBaseUrl, providerPath, type AiModelDefinition, type MediaKind, type ProviderCredentials, type ProviderRow } from "./provider-service.js";
import type { GenerationPurpose } from "./comfy-workflows.js";

export type GenerationMessage = { role: "system" | "user" | "assistant"; content: unknown };
export type GenerationKind = MediaKind | "transcription";
export type GenerationReference = { fileId: string; kind?: Exclude<MediaKind, "text">; role?: "reference" | "first-frame" | "last-frame" | "continuation" | "emotion"; purpose?: "reference_input" | "identity_reference" | "wardrobe_reference" | "composition_reference"; label?: string; source?: "style" | "asset" | "canvas" | "primary"; transcript?: string; frameIndex?: number; includeAudio?: boolean };
export type AiGenerationRequest = {
    videoInputVersion?: 1;
    imageInputVersion?: 1;
    audioInputVersion?: 1;
    kind: GenerationKind;
    model?: string;
    purpose?: GenerationPurpose;
    prompt?: string;
    messages?: GenerationMessage[];
    params?: Record<string, unknown>;
    references?: GenerationReference[];
    mode?: string;
    operation?: string;
    continuation?: { generationId: string; fileId: string };
    metadata?: Record<string, unknown>;
};
export type ProviderContext = {
    row: ProviderRow;
    credentials: ProviderCredentials;
    model: AiModelDefinition;
    userId: string;
    request: AiGenerationRequest;
    signal: AbortSignal;
    remoteTaskId?: string | null;
    onDelta: (delta: string) => void;
    onRemoteTask: (id: string) => void;
    onProgress: (progress: number) => void;
};

export interface AiProviderAdapter {
    generateText?: (context: ProviderContext) => Promise<Record<string, unknown>>;
    generateImage?: (context: ProviderContext) => Promise<Record<string, unknown>>;
    generateVideo?: (context: ProviderContext) => Promise<Record<string, unknown>>;
    generateAudio?: (context: ProviderContext) => Promise<Record<string, unknown>>;
    cancel?: (context: ProviderContext) => Promise<void>;
}

export function adapterFor(endpoint: AiModelDefinition["endpoint"]): AiProviderAdapter {
    const definition = modelEndpointRegistry[endpoint];
    if (!definition) throw adapterError("AI_MODEL_ENDPOINT_UNSUPPORTED", "模型调用方案不存在或已失效");
    const output = definition.output;
    return {
        generateText: output === "text" ? generateText : undefined,
        generateImage: output === "image" ? generateImage : undefined,
        generateVideo: output === "video" ? generateVideo : undefined,
        generateAudio: output === "audio" ? generateAudio : undefined,
        cancel: output === "video" ? cancelRemote : undefined,
    };
}

async function generateText(context: ProviderContext) {
    const messages = await languageMessages(context);
    const result = streamText({
        model: languageModel(context) as never,
        messages: messages as never,
        abortSignal: context.signal,
        onError: () => undefined,
        ...(context.request.params?.temperature == null ? {} : { temperature: Number(context.request.params.temperature) }),
        ...textProviderOptions(context),
    });
    let text = "";
    for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error instanceof Error ? part.error : adapterError("AI_STREAM_FAILED", String(asRecord(part.error).message || "模型流式响应失败"));
        if (part.type === "text-delta") {
            text += part.text;
            context.onDelta(part.text);
        }
    }
    const usage = await result.usage;
    const finishReason = await result.finishReason;
    return { text, usage, finishReason };
}

function languageModel(context: ProviderContext) {
    const { row, credentials, model } = context;
    if (model.endpoint === "anthropic-messages") return createAnthropic({ baseURL: providerBaseUrl(row), apiKey: credentials.apiKey, authToken: credentials.authToken }).messages(model.id);
    if (model.endpoint === "gemini-generate") return createGoogleGenerativeAI({ baseURL: providerBaseUrl(row), apiKey: credentials.apiKey }).languageModel(model.id);
    if (row.type === "openai") return createOpenAI({ baseURL: providerBaseUrl(row), apiKey: credentials.apiKey }).chat(model.id);
    return createOpenAICompatible({ name: row.id, baseURL: providerBaseUrl(row), apiKey: credentials.apiKey || credentials.authToken || undefined }).chatModel(model.id);
}

async function languageMessages(context: ProviderContext) {
    const provided = Array.isArray(context.request.messages) ? context.request.messages.map((message) => ({ ...message })) : [];
    const messages = provided.length ? provided : [{ role: "user" as const, content: context.request.prompt || "" }];
    const systemPrompt = String(context.request.params?.systemPrompt || "").trim();
    if (systemPrompt && !messages.some((message) => message.role === "system")) messages.unshift({ role: "system", content: systemPrompt });
    const images = await referenceParts(context, "image");
    const audios = await referenceParts(context, "audio");
    if (!images.length && !audios.length) return messages;
    const index = Math.max(0, messages.map((message) => message.role).lastIndexOf("user"));
    const current = messages[index] || { role: "user" as const, content: context.request.prompt || "" };
    const text = typeof current.content === "string" ? current.content : context.request.prompt || "";
    messages[index] = { ...current, content: [
        { type: "text", text },
        ...images.map((reference) => ({ type: "image", image: reference.bytes, mediaType: reference.mimeType })),
        ...audios.map((reference) => ({ type: "file", data: reference.bytes, mediaType: reference.mimeType })),
    ] };
    return messages;
}

function textProviderOptions(context: ProviderContext) {
    const effort = String(context.request.params?.reasoningEffort || "auto");
    if (effort === "auto" || context.row.type !== "openai" || context.model.endpoint !== "openai-chat") return {};
    return { providerOptions: { openai: { reasoningEffort: effort } } };
}

async function generateImage(context: ProviderContext) {
    if (context.model.endpoint === "gemini-image") return generateGeminiImage(context);
    const references = context.request.references || [];
    if (context.model.endpoint === "openai-images-edits" && !references.length) throw adapterError("AI_IMAGE_REFERENCE_REQUIRED", "当前调用方案需要至少一张参考图");
    const useEdits = context.model.endpoint === "openai-images-edits" || (context.model.endpoint === "openai-images" && references.length > 0);
    const response = useEdits ? await requestOpenAIImageEdit(context) : await requestOpenAIImage(context);
    const payload = await jsonBody(response);
    const items = arrayOfRecords(payload.data);
    if (!items.length) throw adapterError("AI_IMAGE_EMPTY", "接口没有返回图片");
    const files = await Promise.all(items.map((item, index) => storeImageItem(context, item, index)));
    return { files };
}

async function requestOpenAIImage(context: ProviderContext) {
    const params = context.request.params || {};
    const references = context.request.references?.length ? await referenceDataUrls(context) : [];
    const size = normalizedImageSize(params.size, params.quality);
    return providerFetch(context, "/images/generations", {
        method: "POST",
        json: {
            model: context.model.id,
            prompt: withSystemPrompt(context),
            ...(context.model.endpoint === "ark-image" && context.request.imageInputVersion ? {} : { n: numberParam(params.count, 1, 15, 1) }),
            ...(context.model.endpoint === "ark-image" || context.model.id.startsWith("dall-e-") ? { response_format: "b64_json" } : { output_format: "png", ...(!context.request.imageInputVersion ? { response_format: "b64_json" } : {}) }),
            ...(params.quality ? { quality: params.quality } : {}),
            ...(size ? { size } : {}),
            ...(params.background ? { background: params.background } : {}),
            ...(context.model.endpoint === "ark-image" && references.length ? { image: references } : {}),
        },
    });
}

async function requestOpenAIImageEdit(context: ProviderContext) {
    const params = context.request.params || {};
    const form = new FormData();
    form.set("model", context.model.id);
    form.set("prompt", withSystemPrompt(context));
    form.set("n", String(numberParam(params.count, 1, 15, 1)));
    if (!context.request.imageInputVersion || context.model.id.startsWith("dall-e-")) form.set("response_format", "b64_json");
    if (!context.model.id.startsWith("dall-e-")) form.set("output_format", "png");
    if (params.quality) form.set("quality", String(params.quality));
    if (params.background) form.set("background", String(params.background));
    const size = normalizedImageSize(params.size, params.quality);
    if (size) form.set("size", size);
    const maskFileId = String(params.maskFileId || "");
    for (const reference of context.request.references || []) {
        const file = requireStoredFile(context.userId, reference.fileId);
        form.append(reference.fileId === maskFileId ? "mask" : "image", await openAsBlob(file.path, { type: file.mime_type }), file.original_name);
    }
    return providerFetch(context, "/images/edits", { method: "POST", body: form });
}

async function generateGeminiImage(context: ProviderContext) {
    const parts: Array<Record<string, unknown>> = [{ text: withSystemPrompt(context) }];
    for (const reference of await referenceParts(context, "image")) parts.push({ inlineData: { mimeType: reference.mimeType, data: Buffer.from(reference.bytes).toString("base64") } });
    const response = await providerFetch(context, `/models/${encodeURIComponent(context.model.id)}:generateContent`, {
        method: "POST",
        json: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(context.request.params?.size && context.request.params.size !== "auto" ? { imageConfig: { aspectRatio: context.request.params.size } } : {}) } },
    });
    const payload = await jsonBody(response);
    const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : [];
    const outputParts = candidates.flatMap((candidate) => arrayOfRecords(asRecord(candidate.content).parts));
    const images = outputParts.map((part) => asRecord(part.inlineData || part.inline_data)).filter((part) => typeof part.data === "string");
    if (!images.length) throw adapterError("AI_IMAGE_EMPTY", "Gemini 没有返回图片");
    const files = await Promise.all(images.map((image, index) => storeBytes(context.userId, Buffer.from(String(image.data), "base64"), String(image.mimeType || image.mime_type || "image/png"), `gemini-${index + 1}.png`)));
    return { files };
}

async function generateVideo(context: ProviderContext) {
    if (context.model.endpoint === "gemini-video") return generateGeminiVideo(context);
    if (context.model.endpoint === "ark-seedance") return generateArkVideo(context);
    return generateOpenAIVideo(context);
}

async function generateOpenAIVideo(context: ProviderContext) {
    let taskId = context.remoteTaskId || "";
    if (!taskId) {
        const form = new FormData();
        form.set("model", context.model.id);
        form.set("prompt", withSystemPrompt(context));
        form.set("seconds", String(context.request.params?.seconds || 6));
        if (context.request.params?.size) form.set("size", String(context.request.params.size));
        if (context.request.params?.resolution) form.set("resolution_name", String(context.request.params.resolution));
        for (const reference of context.request.references || []) {
            const file = requireStoredFile(context.userId, reference.fileId);
            const field = reference.role === "last-frame" ? "last_frame" : reference.role === "continuation" ? "video" : context.request.videoInputVersion ? "input_reference" : "input_reference[]";
            form.append(field, await openAsBlob(file.path, { type: file.mime_type }), file.original_name);
        }
        const created = await jsonBody(await providerFetch(context, "/videos", { method: "POST", body: form }));
        taskId = String(created.id || asRecord(created.data).id || "");
        if (!taskId) throw adapterError("AI_VIDEO_TASK_EMPTY", "视频接口没有返回任务 ID");
        context.onRemoteTask(taskId);
    }
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await providerFetch(context, `/videos/${encodeURIComponent(taskId)}`, { method: "GET" });
        const state = await jsonBody(response);
        const task = Object.keys(asRecord(state.data)).length ? asRecord(state.data) : state;
        const url = mediaUrl(task);
        if (url) return { files: [await storeRemoteFile(context.userId, await fetchMedia(context, url), basename(new URL(url).pathname) || "video.mp4")] };
        if (task.status === "completed" || task.status === "succeeded") {
            const content = await providerFetch(context, `/videos/${encodeURIComponent(taskId)}/content`, { method: "GET" });
            return { files: [await storeRemoteFile(context.userId, content, "video.mp4")] };
        }
        if (["failed", "cancelled", "canceled", "expired"].includes(String(task.status))) throw adapterError("AI_VIDEO_FAILED", remoteError(task) || "视频生成失败");
        context.onProgress(Math.min(0.95, (attempt + 1) / 120));
        await delay(2500, context.signal);
    }
    throw adapterError("AI_VIDEO_TIMEOUT", "视频生成超时");
}

async function generateArkVideo(context: ProviderContext) {
    let taskId = context.remoteTaskId || "";
    const endpoint = "/contents/generations/tasks";
    if (!taskId) {
        const content: Array<Record<string, unknown>> = [];
        if (withSystemPrompt(context)) content.push({ type: "text", text: withSystemPrompt(context) });
        for (const reference of context.request.references || []) {
            const file = requireStoredFile(context.userId, reference.fileId);
            const kind = reference.kind || mediaKind(file.mime_type);
            const role = reference.role === "first-frame" ? "first_frame" : reference.role === "last-frame" ? "last_frame" : reference.role === "continuation" ? "continuation" : `reference_${kind}`;
            content.push({ type: `${kind}_url`, [`${kind}_url`]: { url: fileDataUrl(file.path, file.mime_type) }, role });
        }
        const params = context.request.params || {};
        const created = await jsonBody(await providerFetch(context, endpoint, { method: "POST", json: { model: context.model.id, content, ratio: params.ratio || params.size, resolution: params.resolution, duration: params.seconds, ...(!context.request.videoInputVersion || params.generateAudio !== undefined ? { generate_audio: params.generateAudio !== false } : {}), ...(!context.request.videoInputVersion || params.watermark !== undefined ? { watermark: params.watermark === true } : {}) } }));
        taskId = String(created.id || asRecord(created.data).id || "");
        if (!taskId) throw adapterError("AI_VIDEO_TASK_EMPTY", "方舟没有返回任务 ID");
        context.onRemoteTask(taskId);
    }
    return pollJsonVideo(context, `${endpoint}/${encodeURIComponent(taskId)}`, 5000);
}

async function generateGeminiVideo(context: ProviderContext) {
    let taskId = context.remoteTaskId || "";
    if (!taskId) {
        const instance: Record<string, unknown> = { prompt: withSystemPrompt(context) };
        const images = await Promise.all((context.request.references || []).filter((item) => (item.kind || "image") === "image").map(async (item) => ({ item, file: requireStoredFile(context.userId, item.fileId) })));
        const first = images.find(({ item }) => item.role === "first-frame") || images.find(({ item }) => item.role !== "last-frame");
        const last = images.find(({ item }) => item.role === "last-frame");
        if (first) instance.image = { bytesBase64Encoded: readFileSync(first.file.path).toString("base64"), mimeType: first.file.mime_type };
        if (last) instance.lastFrame = { bytesBase64Encoded: readFileSync(last.file.path).toString("base64"), mimeType: last.file.mime_type };
        if (context.request.videoInputVersion && images.some(({ item }) => item.role === "reference")) {
            delete instance.image;
            instance.referenceImages = images.map(({ file }) => ({ image: { bytesBase64Encoded: readFileSync(file.path).toString("base64"), mimeType: file.mime_type }, referenceType: "asset" }));
        }
        const created = await jsonBody(await providerFetch(context, `/models/${encodeURIComponent(context.model.id)}:predictLongRunning`, { method: "POST", json: { instances: [instance], parameters: { aspectRatio: context.request.params?.ratio || context.request.params?.size, ...(context.request.videoInputVersion ? { durationSeconds: context.request.params?.seconds, resolution: context.request.params?.resolution } : {}) } } }));
        taskId = String(created.name || "");
        if (!taskId) throw adapterError("AI_VIDEO_TASK_EMPTY", "Gemini 没有返回任务 ID");
        context.onRemoteTask(taskId);
    }
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await jsonBody(await providerFetch(context, `/${taskId.replace(/^\/+/, "")}`, { method: "GET" }));
        const sample = arrayOfRecords(asRecord(asRecord(state.response).generateVideoResponse).generatedSamples)[0];
        const url = String(asRecord(sample?.video).uri || "");
        if (url) return { files: [await storeRemoteFile(context.userId, await fetchMedia(context, url), "gemini-video.mp4")] };
        if (state.done && asRecord(state.error).message) throw adapterError("AI_VIDEO_FAILED", String(asRecord(state.error).message));
        context.onProgress(Math.min(0.95, (attempt + 1) / 120));
        await delay(5000, context.signal);
    }
    throw adapterError("AI_VIDEO_TIMEOUT", "Gemini 视频生成超时");
}

async function pollJsonVideo(context: ProviderContext, path: string, interval: number) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await jsonBody(await providerFetch(context, path, { method: "GET" }));
        const task = Object.keys(asRecord(state.data)).length ? asRecord(state.data) : state;
        const url = mediaUrl(task);
        if (url) return { files: [await storeRemoteFile(context.userId, await fetchMedia(context, url), basename(new URL(url).pathname) || "video.mp4")] };
        if (["failed", "cancelled", "canceled", "expired"].includes(String(task.status))) throw adapterError("AI_VIDEO_FAILED", remoteError(task) || "视频生成失败");
        context.onProgress(Math.min(0.95, (attempt + 1) / 120));
        await delay(interval, context.signal);
    }
    throw adapterError("AI_VIDEO_TIMEOUT", "视频生成超时");
}

async function generateAudio(context: ProviderContext) {
    if (context.model.endpoint === "gemini-audio") return generateGeminiAudio(context);
    const params = context.request.params || {};
    const response = await providerFetch(context, "/audio/speech", {
        method: "POST",
        json: { model: context.model.id, input: withSystemPrompt(context), voice: params.voice || "alloy", response_format: params.format || "mp3", speed: Number(params.speed) || 1, ...(params.instructions ? { instructions: params.instructions } : {}) },
    });
    return { files: [await storeRemoteFile(context.userId, response, `speech.${String(params.format || "mp3")}`)] };
}

async function generateGeminiAudio(context: ProviderContext) {
    const params = context.request.params || {};
    const response = await providerFetch(context, `/models/${encodeURIComponent(context.model.id)}:generateContent`, {
        method: "POST",
        json: { contents: [{ role: "user", parts: [{ text: withSystemPrompt(context) }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice || "Kore" } } } } },
    });
    const payload = await jsonBody(response);
    const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : [];
    const parts = candidates.flatMap((candidate) => arrayOfRecords(asRecord(candidate.content).parts));
    const audio = parts.map((part) => asRecord(part.inlineData || part.inline_data)).find((part) => typeof part.data === "string");
    if (!audio) throw adapterError("AI_AUDIO_EMPTY", "Gemini 没有返回音频");
    const mimeType = String(audio.mimeType || audio.mime_type || "audio/mpeg");
    const playable = await playableAudio(Buffer.from(String(audio.data), "base64"), mimeType, context.signal);
    return { files: [await storeBytes(context.userId, playable.bytes, playable.mimeType, playable.mimeType === "audio/wav" ? "gemini-audio.wav" : "gemini-audio.bin")] };
}

async function cancelRemote(context: ProviderContext) {
    const id = context.remoteTaskId;
    if (!id) return;
    const path = context.model.endpoint === "ark-seedance" ? `/contents/generations/tasks/${encodeURIComponent(id)}` : context.model.endpoint === "gemini-video" ? `/${id.replace(/^\/+/, "")}` : `/videos/${encodeURIComponent(id)}`;
    try {
        await providerFetch(context, path, { method: "DELETE", signal: AbortSignal.timeout(5000) });
    } catch {
        // Local cancellation remains authoritative when the provider has no cancel endpoint.
    }
}

async function providerFetch(context: ProviderContext, path: string, options: { method: string; json?: unknown; body?: BodyInit; signal?: AbortSignal }) {
    const timeoutMs = config.aiProviderTimeouts[context.request.kind === "transcription" ? "text" : context.request.kind];
    let response: Response;
    try {
        response = await fetch(providerPath(context.row, path), {
            method: options.method,
            headers: requestHeaders(context, !(options.body instanceof FormData) && options.json !== undefined),
            body: options.body || (options.json === undefined ? undefined : JSON.stringify(options.json)),
            signal: AbortSignal.any([options.signal || context.signal, AbortSignal.timeout(timeoutMs)]),
            redirect: "error",
        });
    } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw adapterError("AI_PROVIDER_TIMEOUT", `${mediaLabel(context.request.kind)}生成请求超过 ${Math.round(timeoutMs / 60_000)} 分钟，请稍后重试`);
        throw error;
    }
    if (!response.ok) throw adapterError("AI_PROVIDER_REQUEST_FAILED", await responseError(response));
    return response;
}

async function fetchMedia(context: ProviderContext, url: string) {
    const timeoutMs = config.aiProviderTimeouts[context.request.kind === "transcription" ? "text" : context.request.kind];
    let response: Response;
    try {
        response = await fetch(url, { headers: requestHeaders(context), signal: AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]), redirect: "error" });
    } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw adapterError("AI_PROVIDER_TIMEOUT", `${mediaLabel(context.request.kind)}结果下载超过 ${Math.round(timeoutMs / 60_000)} 分钟，请稍后重试`);
        throw error;
    }
    if (!response.ok) throw adapterError("AI_RESULT_DOWNLOAD_FAILED", `生成结果下载失败（HTTP ${response.status}）`);
    return response;
}

function mediaLabel(kind: AiGenerationRequest["kind"]) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "声音" : "文本";
}

function requestHeaders(context: ProviderContext, json = false) {
    const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
    const family = modelEndpointRegistry[context.model.endpoint]?.family;
    if (!family) throw adapterError("AI_MODEL_ENDPOINT_UNSUPPORTED", "模型调用方案不存在或已失效");
    const token = context.credentials.authToken || context.credentials.apiKey || "";
    if (family === "anthropic") {
        headers[context.credentials.authToken ? "Authorization" : "x-api-key"] = context.credentials.authToken ? `Bearer ${context.credentials.authToken}` : context.credentials.apiKey || "";
        headers["anthropic-version"] = "2023-06-01";
    } else if (family === "gemini") {
        if (token) headers["x-goog-api-key"] = token;
    } else if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function storeImageItem(context: ProviderContext, item: Record<string, unknown>, index: number) {
    if (typeof item.b64_json === "string") return storeBytes(context.userId, Buffer.from(item.b64_json, "base64"), "image/png", `image-${index + 1}.png`);
    const url = String(item.url || item.image_url || "");
    if (!url) throw adapterError("AI_IMAGE_EMPTY", "图片结果格式不受支持");
    return storeRemoteFile(context.userId, await fetchMedia(context, url), basename(new URL(url).pathname) || `image-${index + 1}.png`);
}

function storeBytes(userId: string, bytes: Uint8Array, mimeType: string, name: string) {
    return storeRemoteFile(userId, new Response(Buffer.from(bytes), { headers: { "Content-Type": mimeType, "Content-Length": String(bytes.byteLength) } }), name);
}

async function referenceParts(context: ProviderContext, kind: Exclude<MediaKind, "text">) {
    return (context.request.references || []).filter((reference) => (reference.kind || "image") === kind).map((reference) => {
        const file = requireStoredFile(context.userId, reference.fileId);
        return { bytes: readFileSync(file.path), mimeType: file.mime_type };
    });
}

async function referenceDataUrls(context: ProviderContext) {
    return (context.request.references || []).map((reference) => {
        const file = requireStoredFile(context.userId, reference.fileId);
        return fileDataUrl(file.path, file.mime_type);
    });
}

function requireStoredFile(userId: string, fileId: string) {
    const file = getStoredFile(userId, fileId);
    if (!file) throw adapterError("AI_REFERENCE_NOT_FOUND", "参考素材不存在或无权访问");
    return file;
}

function fileDataUrl(path: string, mimeType: string) {
    return `data:${mimeType};base64,${readFileSync(path).toString("base64")}`;
}

function mediaKind(mimeType: string): Exclude<MediaKind, "text"> {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "image";
}

function withSystemPrompt(context: ProviderContext) {
    const prompt = context.request.prompt || "";
    const system = String(context.request.params?.systemPrompt || "").trim();
    return system ? `${system}\n\n${prompt}` : prompt;
}

function mediaUrl(value: Record<string, unknown>) {
    const content = asRecord(value.content);
    return [value.video_url, value.result_url, value.url, content.video_url, content.url].find((item) => typeof item === "string" && /^https?:\/\//i.test(item)) as string | undefined;
}

function remoteError(value: Record<string, unknown>) {
    return String(asRecord(value.error).message || value.message || value.msg || "");
}

async function jsonBody(response: Response) {
    return await response.json() as Record<string, unknown>;
}

async function responseError(response: Response) {
    const text = await response.text();
    try {
        const body = JSON.parse(text) as Record<string, unknown>;
        return String(asRecord(body.error).message || body.message || body.msg || `渠道返回 HTTP ${response.status}`);
    } catch {
        return text.slice(0, 300) || `渠道返回 HTTP ${response.status}`;
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function numberParam(value: unknown, min: number, max: number, fallback: number) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizedImageSize(value: unknown, quality: unknown) {
    const input = String(value || "").trim().toLowerCase();
    if (!input || input === "auto") return undefined;
    if (/^\d+x\d+$/.test(input)) return input;
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(input);
    if (!match) return input;
    const ratio = Number(match[1]) / Number(match[2]);
    if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
    const edge = ({ low: 1024, standard: 1024, medium: 2048, hd: 2048, high: 2880 } as Record<string, number>)[String(quality || "").toLowerCase()] || 1024;
    const width = ratio >= 1 ? edge : Math.max(16, Math.round(edge * ratio / 16) * 16);
    const height = ratio >= 1 ? Math.max(16, Math.round(edge / ratio / 16) * 16) : edge;
    return `${width}x${height}`;
}

function delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolvePromise, reject) => {
        if (signal.aborted) return reject(signal.reason || new Error("任务已取消"));
        const finish = () => {
            signal.removeEventListener("abort", abort);
            resolvePromise();
        };
        const timer = setTimeout(finish, ms);
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason || new Error("任务已取消"));
        };
        signal.addEventListener("abort", abort, { once: true });
    });
}

function adapterError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}
