import { serverApi, serverFileUrl, type ServerGeneration } from "@/services/api/server";

export function createServerGenerationStore<T extends object>(kind: ServerGeneration["kind"]) {
    return {
        async setItem(id: string, value: T) {
            return value;
        },
        async removeItem(id: string) {
            const generation = await serverApi.generation(id);
            if (["queued", "running"].includes(generation.status)) await serverApi.cancelGeneration(id);
            await serverApi.deleteGeneration(id);
        },
        async iterate<R>(_callback: (value: T, key: string, iterationNumber: number) => R | void) {
            const rows = (await serverApi.generations()).filter((row) => row.kind === kind);
            let result: R | undefined;
            for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index];
                if (kind === "image" && ["queued", "running"].includes(row.status)) continue;
                const payload = ((row.request?.legacy ? row.result : row.result?.record) || serverGenerationRecord(row)) as T | null;
                if (!payload) continue;
                const next = _callback(payload, row.id, index + 1);
                if (next !== undefined) {
                    result = next;
                    break;
                }
            }
            return result;
        },
    };
}

function serverGenerationRecord(row: ServerGeneration) {
    const request = row.request || {};
    const files = Array.isArray(row.result?.files) ? row.result.files as Array<Record<string, unknown>> : [];
    const prompt = String(request.prompt || "");
    const common = {
        id: row.id,
        createdAt: Date.parse(row.createdAt) || Date.now(),
        title: prompt.slice(0, 32) || "服务端生成",
        prompt,
        model: String(request.model || ""),
        config: { ...(request.params as Record<string, unknown> || {}), model: String(request.model || ""), imageModel: String(request.model || ""), videoModel: String(request.model || "") },
        references: [],
        durationMs: Math.max(0, Date.parse(row.updatedAt) - Date.parse(row.createdAt)),
        status: row.status === "succeeded" ? "success" : ["queued", "running"].includes(row.status) ? "pending" : "failed",
        error: row.error || undefined,
    };
    if (row.kind === "image") {
        const images = files.map((file) => ({
            id: String(file.fileId || file.id || ""),
            dataUrl: serverFileUrl(`server:${String(file.fileId || file.id || "")}`, String(file.url || "")),
            storageKey: `server:${String(file.fileId || file.id || "")}`,
            width: Number((file.metadata as Record<string, unknown> | undefined)?.width) || 0,
            height: Number((file.metadata as Record<string, unknown> | undefined)?.height) || 0,
            bytes: Number(file.bytes) || 0,
            mimeType: String(file.mimeType || "image/png"),
            durationMs: common.durationMs,
        }));
        return { ...common, successCount: images.length, failCount: images.length ? 0 : 1, imageCount: images.length, size: String((request.params as Record<string, unknown> | undefined)?.size || ""), quality: String((request.params as Record<string, unknown> | undefined)?.quality || ""), images, thumbnails: images.map((image) => image.dataUrl) };
    }
    if (row.kind === "video") {
        const file = files[0];
        const params = request.params as Record<string, unknown> | undefined;
        return { ...common, task: ["queued", "running"].includes(row.status) ? { id: row.id, provider: "server", model: String(request.model || "") } : undefined, size: String(params?.ratio || params?.size || ""), resolution: String(params?.resolution || ""), seconds: String(params?.seconds || ""), videoReferences: [], audioReferences: [], video: file ? { id: String(file.fileId || file.id || ""), url: serverFileUrl(`server:${String(file.fileId || file.id || "")}`, String(file.url || "")), storageKey: `server:${String(file.fileId || file.id || "")}`, width: 1280, height: 720, durationMs: common.durationMs, bytes: Number(file.bytes) || 0, mimeType: String(file.mimeType || "video/mp4") } : undefined };
    }
    return null;
}
