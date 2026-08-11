import { ensureServerReference, generationFiles } from "@/services/api/ai-generation";
import { serverApi } from "@/services/api/server";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal };
export type VideoGenerationResult = { url: string; mimeType?: string; generationId: string };
export type VideoGenerationTask = { id: string; provider: "server"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    for (;;) {
        if (options?.signal?.aborted) {
            await serverApi.cancelGeneration(task.id).catch(() => undefined);
            throw new DOMException("Aborted", "AbortError");
        }
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        await delay(1500, options?.signal);
    }
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const allReferences = await Promise.all([
        ...references.map((reference) => ensureServerReference(reference, "image")),
        ...videoReferences.map((reference) => ensureServerReference(reference, "video")),
        ...audioReferences.map((reference) => ensureServerReference(reference, "audio")),
    ]);
    const generation = await serverApi.createGeneration({
        kind: "video",
        model: config.model || config.videoModel,
        prompt,
        params: {
            seconds: config.videoSeconds,
            size: config.size,
            ratio: config.size,
            resolution: config.vquality,
            generateAudio: config.videoGenerateAudio !== "false",
            watermark: config.videoWatermark === "true",
            systemPrompt: config.systemPrompt,
        },
        references: allReferences,
    });
    const abort = () => void serverApi.cancelGeneration(generation.id).catch(() => undefined);
    options?.signal?.addEventListener("abort", abort, { once: true });
    return { id: generation.id, provider: "server", model: config.model || config.videoModel };
}

export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, _options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const generation = await serverApi.generation(task.id);
    if (generation.status === "failed" || generation.status === "canceled") return { status: "failed", error: generation.error || "视频生成失败" };
    if (generation.status !== "succeeded") return { status: "pending" };
    const file = generationFiles(generation)[0];
    return file ? { status: "completed", result: { url: file.url, mimeType: file.mimeType, generationId: generation.id } } : { status: "failed", error: "视频任务没有返回文件" };
}

export function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    return uploadMediaFile(result.url, "video");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}
