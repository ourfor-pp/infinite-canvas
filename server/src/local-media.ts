import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type { AiGenerationRequest } from "./ai-adapters.js";
import { getStoredFile, storeRemoteFile } from "./file-store.js";
import type { GenerationRow } from "./generation-service.js";
import { getMediaExecutorSettings } from "./media-executor-settings.js";

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function runLocalMediaGeneration(row: GenerationRow, request: AiGenerationRequest, signal: AbortSignal, onRemoteTask: (id: string) => void, onProgress: (value: number) => void) {
    const executor = getMediaExecutorSettings();
    if (!executor.url || !executor.token) throw localError("MEDIA_EXECUTOR_UNAVAILABLE", "媒体执行器尚未配置");
    const params = request.params || {};
    if (!row.remote_task_id) {
        const references = await Promise.all((request.references || []).map(async (reference) => {
            const stored = getStoredFile(row.user_id, reference.fileId);
            if (!stored) throw localError("AI_REFERENCE_NOT_FOUND", "参考素材不存在或无权访问");
            const form = new FormData();
            form.set("upload", await openAsBlob(stored.path, { type: stored.mime_type }), stored.original_name);
            const uploaded = await executorJson<{ id: string }>(executor, "/v1/files", { method: "POST", headers: authHeaders(executor.token), body: form, signal });
            return { fileId: uploaded.id, kind: reference.kind || "audio", transcript: reference.transcript };
        }));
        const created = await executorJson<{ id: string }>(executor, "/v1/jobs", { method: "POST", headers: { ...authHeaders(executor.token), "Content-Type": "application/json" }, signal, body: JSON.stringify({ id: row.id, model: row.model_id, mode: params.audioMode || "speech", operation: params.audioOperation || (references.length ? "clone" : "generate"), prompt: request.prompt || "", params, references }) });
        onRemoteTask(created.id);
    }
    for (;;) {
        const job = await executorJson<{ status: string; progress: number; error?: string; result?: { files?: Array<{ name: string }> } }>(executor, `/v1/jobs/${encodeURIComponent(row.id)}`, { headers: authHeaders(executor.token), signal });
        onProgress(job.progress || 0);
        if (["failed", "canceled"].includes(job.status)) throw localError("MEDIA_EXECUTOR_FAILED", job.error || "媒体执行任务失败");
        if (job.status === "succeeded") {
            const files = await Promise.all((job.result?.files || []).map(async (file) => storeRemoteFile(row.user_id, await fetch(`${executor.url}/v1/jobs/${encodeURIComponent(row.id)}/files/${encodeURIComponent(file.name)}`, { headers: authHeaders(executor.token), signal }), basename(file.name))));
            return { files };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

export async function cancelLocalMediaGeneration(row: GenerationRow) {
    const executor = getMediaExecutorSettings();
    if (executor.url && executor.token) await fetch(`${executor.url}/v1/jobs/${encodeURIComponent(row.id)}`, { method: "DELETE", headers: authHeaders(executor.token), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

export async function acknowledgeLocalMediaGeneration(id: string) {
    const executor = getMediaExecutorSettings();
    if (executor.url && executor.token) await fetch(`${executor.url}/v1/jobs/${encodeURIComponent(id)}/ack`, { method: "POST", headers: authHeaders(executor.token), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

async function executorJson<T>(executor: { url: string }, path: string, init: RequestInit) {
    const response = await fetch(`${executor.url}${path}`, init);
    if (!response.ok) throw localError("MEDIA_EXECUTOR_REQUEST_FAILED", `媒体执行器请求失败（${response.status}）`);
    return await response.json() as T;
}
function localError(code: string, message: string) { return Object.assign(new Error(message), { code }); }
