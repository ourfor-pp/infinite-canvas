import { basename } from "node:path";
import type { AiGenerationRequest } from "./ai-adapters.js";
import { storeRemoteFile } from "./file-store.js";
import type { GenerationRow } from "./generation-service.js";
import { getMediaExecutorSettings, MEDIA_PROTOCOL } from "./media-executor-settings.js";
import { executorRequest, ownedMediaHash, prepareExecutorRequest } from "./media-capabilities.js";
import { transcriptionSchema } from "./transcription.js";

type ExecutorFile = { name: string; sha256?: string; context?: Record<string, unknown>; media?: Record<string, unknown> };
type ExecutorJob = { status: string; progress: number; diagnostics?: Record<string, unknown>; error?: string; result?: { files?: ExecutorFile[]; continuationStates?: ExecutorFile[]; cumulativeVideos?: ExecutorFile[]; execution?: Record<string, unknown> } };

async function observe<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (;;) {
        signal.throwIfAborted();
        try { return await read(); }
        catch (error) {
            const status = (error as { status?: number }).status;
            if (signal.aborted || !(error instanceof TypeError || status && status >= 500)) throw error;
            await new Promise<void>((resolve, reject) => {
                const abort = () => { clearTimeout(timer); reject(signal.reason); };
                const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
                signal.addEventListener("abort", abort, { once: true });
            });
        }
    }
}

export async function runLocalMediaGeneration(row: GenerationRow, request: AiGenerationRequest, signal: AbortSignal, onRemoteTask: (id: string) => void, onProgress: (value: number, diagnostics?: Record<string, unknown>) => void) {
    const path = `/v1/jobs/${encodeURIComponent(row.id)}`;
    // A response can be lost after POST. Look up the same id before uploading or submitting again.
    if (!row.remote_task_id) {
        try { await observe(() => executorRequest<ExecutorJob>(path, { signal }), signal); }
        catch (error) {
            if ((error as { status?: number }).status !== 404) throw error;
            const input = await prepareExecutorRequest(row.user_id, row.id, row.model_id, request, signal);
            try { await executorRequest("/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }); }
            catch (error) {
                if (signal.aborted || !(error instanceof TypeError || Number((error as { status?: number }).status) >= 500)) throw error;
                // A lost submit response is reconciled by id, never by submitting again.
                await observe(() => executorRequest<ExecutorJob>(path, { signal }), signal);
            }
        }
        onRemoteTask(row.id);
    }
    for (;;) {
        const job = await observe(() => executorRequest<ExecutorJob>(path, { signal }), signal);
        onProgress(job.progress || 0, job.diagnostics);
        if (["failed", "canceled"].includes(job.status)) throw Object.assign(new Error(job.error || "媒体执行任务失败"), { code: "MEDIA_EXECUTOR_FAILED" });
        if (job.status === "succeeded") {
            const executor = getMediaExecutorSettings();
            const download = async (file: ExecutorFile) => {
                const response = await observe(async () => {
                    const downloaded = await fetch(`${executor.url}${path}/files/${encodeURIComponent(file.name)}`, { headers: { Authorization: `Bearer ${executor.token}`, "X-Media-Protocol": MEDIA_PROTOCOL }, signal, redirect: "error" });
                    if (!downloaded.ok) throw Object.assign(new Error(`媒体结果下载失败（${downloaded.status}）`), { status: downloaded.status });
                    return downloaded;
                }, signal);
                if (row.kind === "transcription") transcriptionSchema.parse(await response.clone().json());
                const stored = await storeRemoteFile(row.user_id, response, basename(file.name));
                if (file.sha256 && await ownedMediaHash(row.user_id, stored.id) !== file.sha256) throw new Error("媒体结果哈希不一致");
                return { ...stored, fileId: stored.id, ...(file.sha256 ? { sha256: file.sha256 } : {}), ...(file.context ? { context: file.context } : {}), ...(file.media ? { media: file.media } : {}) };
            };
            const [files, continuationStates, cumulativeVideos] = await Promise.all([Promise.all((job.result?.files || []).map(download)), Promise.all((job.result?.continuationStates || []).map(download)), Promise.all((job.result?.cumulativeVideos || []).map(download))]);
            return { files, ...(continuationStates.length ? { continuationStates } : {}), ...(cumulativeVideos.length ? { cumulativeVideos } : {}), ...(job.result?.execution ? { execution: job.result.execution } : {}) };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

export async function cancelLocalMediaGeneration(row: GenerationRow) {
    await executorRequest(`/v1/jobs/${encodeURIComponent(row.id)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

export async function acknowledgeLocalMediaGeneration(id: string) {
    await executorRequest(`/v1/jobs/${encodeURIComponent(id)}/ack`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}
