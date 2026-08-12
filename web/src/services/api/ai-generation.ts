import { serverApi, serverFileIdFromUrl, serverFileUrl, uploadServerFile, type ServerGeneration } from "@/services/api/server";

export type GenerationKind = ServerGeneration["kind"];
export type GenerationInput = {
    kind: GenerationKind;
    model?: string;
    purpose?: "default" | "image-edit" | "image-inpaint" | "image-upscale-faithful" | "image-upscale-generative" | "image-angle";
    prompt?: string;
    messages?: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
    params?: Record<string, unknown>;
    references?: Array<{ fileId: string; kind: "image" | "video" | "audio" }>;
};

export async function runServerGeneration(input: GenerationInput, options?: { signal?: AbortSignal; onDelta?: (text: string) => void }) {
    const generation = await serverApi.createGeneration(input);
    let streamedText = "";
    const onDelta = (event: Event) => {
        const detail = (event as CustomEvent<{ id?: string; delta?: string }>).detail;
        if (detail?.id !== generation.id || !detail.delta) return;
        streamedText += detail.delta;
        options?.onDelta?.(streamedText);
    };
    window.addEventListener("infinite-canvas:generation-delta", onDelta);
    const abort = () => void serverApi.cancelGeneration(generation.id).catch(() => undefined);
    options?.signal?.addEventListener("abort", abort, { once: true });
    try {
        for (;;) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const current = await serverApi.generation(generation.id);
            if (current.status === "succeeded") return current;
            if (current.status === "canceled") throw new DOMException("Aborted", "AbortError");
            if (current.status === "failed") throw Object.assign(new Error(current.error || "生成任务失败"), { code: current.errorCode });
            await delay(1200, options?.signal);
        }
    } finally {
        window.removeEventListener("infinite-canvas:generation-delta", onDelta);
        options?.signal?.removeEventListener("abort", abort);
    }
}

export async function ensureServerReference(source: { storageKey?: string; dataUrl?: string; url?: string; name?: string; type?: string }, kind: "image" | "video" | "audio") {
    if (source.storageKey?.startsWith("server:")) return { fileId: source.storageKey.slice(7), kind };
    const candidate = source.dataUrl || source.url || "";
    const existing = serverFileIdFromUrl(candidate);
    if (existing) return { fileId: existing, kind };
    if (!candidate) throw new Error("参考素材不存在或尚未保存");
    const response = await fetch(candidate);
    if (!response.ok) throw new Error(`读取参考素材失败（${response.status}）`);
    const blob = await response.blob();
    const uploaded = await uploadServerFile(blob, source.name || `reference-${kind}.${extension(blob.type)}`);
    return { fileId: uploaded.fileId, kind };
}

export function generationFiles(generation: ServerGeneration) {
    const files = Array.isArray(generation.result?.files) ? generation.result.files as Array<Record<string, unknown>> : [];
    return files.map((file) => {
        const fileId = String(file.fileId || file.id || "");
        return {
            id: fileId,
            fileId,
            url: serverFileUrl(`server:${fileId}`, String(file.url || "")),
            storageKey: `server:${fileId}`,
            name: String(file.name || ""),
            mimeType: String(file.mimeType || "application/octet-stream"),
            bytes: Number(file.bytes) || 0,
            metadata: file.metadata && typeof file.metadata === "object" ? file.metadata as Record<string, unknown> : {},
        };
    });
}

function extension(mimeType: string) {
    return mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
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
