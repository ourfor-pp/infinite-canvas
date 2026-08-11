import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { nanoid } from "nanoid";
import { adapterFor, type AiGenerationRequest, type ProviderContext } from "./ai-adapters.js";
import { config } from "./config.js";
import { decryptJson } from "./crypto.js";
import { db, parseJson } from "./database.js";
import { buildComfyWorkflow } from "./comfy-workflows.js";
import { getStoredFile, storeRemoteFile, syncFileRefs } from "./file-store.js";
import { decryptCredentials, getProviderRow, resolveProviderModel, type MediaKind } from "./provider-service.js";
import { syncAgentGenerationCanvas } from "./agent/generation-canvas.js";
import { syncCreativeAssetGeneration } from "./creative-assets.js";

export type GenerationRow = {
    id: string;
    user_id: string;
    kind: MediaKind;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    provider_id: string | null;
    model_id: string;
    request: string;
    result: string | null;
    error: string | null;
    error_code: string | null;
    remote_task_id: string | null;
    progress: number;
    usage: string | null;
    comfy_server_id: string | null;
    created_at: string;
    updated_at: string;
};
type ComfyServerRow = { id: string; name: string; encrypted_url: string; enabled: number; models: string };
type ComfyOutputFile = { filename: string; subfolder?: string; type?: string };

const running = new Map<string, { controller: AbortController; row: GenerationRow }>();
let emitEvent: (userId: string, type: "generation.updated" | "generation.delta", value: unknown) => void = () => undefined;
let pumpScheduled = false;

export function setGenerationEmitter(emitter: typeof emitEvent) {
    emitEvent = emitter;
}

export function generationResponse(row: GenerationRow) {
    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        providerId: row.provider_id,
        modelId: row.model_id,
        request: parseJson(row.request, {}),
        result: parseJson(row.result, null),
        error: row.error,
        errorCode: row.error_code,
        progress: row.progress,
        usage: parseJson(row.usage, null),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function createGeneration(userId: string, input: AiGenerationRequest) {
    const selection = resolveProviderModel(input.model, input.kind);
    if ((input.prompt?.trim() || input.messages?.length) && !selection.model.inputs.includes("text")) throw generationError("AI_MODEL_INPUT_UNSUPPORTED", "所选模型不支持文本输入");
    for (const reference of input.references || []) {
        const kind = reference.kind || "image";
        if (!selection.model.inputs.includes(kind)) throw generationError("AI_MODEL_INPUT_UNSUPPORTED", "所选模型不支持当前参考素材类型");
        if (!getStoredFile(userId, reference.fileId)) throw generationError("AI_REFERENCE_NOT_FOUND", "参考素材不存在或无权访问");
    }
    const id = nanoid();
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare(`INSERT INTO generations(id, user_id, kind, status, provider_id, model_id, request, progress, comfy_server_id, created_at, updated_at)
            VALUES(?, ?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?)`).run(id, userId, input.kind, selection.providerId, selection.modelId, JSON.stringify(input), selection.comfyServerId || null, now, now);
        syncFileRefs(userId, "generation", id, input);
    })();
    schedulePump();
    return generationResponse(getGenerationRow(userId, id)!);
}

export function cancelGeneration(userId: string, id: string) {
    return cancelRow(getGenerationRow(userId, id));
}

export function cancelGenerationByAdmin(id: string) {
    return cancelRow(db.prepare("SELECT * FROM generations WHERE id=?").get(id) as GenerationRow | undefined);
}

function cancelRow(row: GenerationRow | undefined) {
    if (!row || !["queued", "running"].includes(row.status)) return null;
    running.get(row.id)?.controller.abort(new DOMException("Aborted", "AbortError"));
    if (row.provider_id === "comfyui" && row.remote_task_id) void cancelComfyPrompt(row);
    else if (row.provider_id && row.remote_task_id) void cancelProviderTask(row);
    updateGeneration(row, { status: "canceled", error: "用户已取消任务", errorCode: "GENERATION_CANCELED" });
    schedulePump();
    return generationResponse(getGenerationRow(row.user_id, row.id)!);
}

export function resumeGenerations() {
    const rows = db.prepare("SELECT * FROM generations WHERE status IN ('queued','running') ORDER BY created_at").all() as GenerationRow[];
    rows.forEach((row) => {
        if (row.status === "running" && !row.remote_task_id) updateGeneration(row, { status: "failed", error: "服务重启中断，任务无法安全恢复", errorCode: "SERVICE_RESTART_INTERRUPTED" });
        else if (row.status === "running") updateGeneration(row, { status: "queued" });
    });
    schedulePump();
}

function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
        pumpScheduled = false;
        pumpQueue();
    });
}

function pumpQueue() {
    while (running.size < config.aiMaxConcurrency) {
        const rows = db.prepare("SELECT * FROM generations WHERE status='queued' ORDER BY created_at LIMIT 100").all() as GenerationRow[];
        const row = rows.find(canRun);
        if (!row) return;
        const controller = new AbortController();
        running.set(row.id, { controller, row });
        updateGeneration(row, { status: "running", progress: row.progress || 0.01 });
        void runGeneration(row, controller).finally(() => {
            running.delete(row.id);
            schedulePump();
        });
    }
}

function canRun(row: GenerationRow) {
    const userActive = Array.from(running.values()).filter((item) => item.row.user_id === row.user_id).length;
    if (userActive >= config.aiUserConcurrency) return false;
    if (!row.provider_id || row.provider_id === "comfyui") return true;
    const provider = getProviderRow(row.provider_id);
    if (!provider?.enabled) return true;
    const providerActive = Array.from(running.values()).filter((item) => item.row.provider_id === row.provider_id).length;
    return providerActive < provider.concurrency;
}

async function runGeneration(initialRow: GenerationRow, controller: AbortController) {
    try {
        const row = getGenerationRow(initialRow.user_id, initialRow.id);
        if (!row || row.status === "canceled") return;
        const request = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
        const result = row.provider_id === "comfyui"
            ? await runComfyGeneration(row, request, controller.signal)
            : await runPublicGeneration(row, request, controller.signal);
        const current = getGenerationRow(row.user_id, row.id);
        if (!current || current.status === "canceled") return;
        updateGeneration(current, { status: "succeeded", result, progress: 1, usage: asUsage((result as Record<string, unknown>).usage) });
        syncFileRefs(row.user_id, "generation", row.id, { request, result });
    } catch (error) {
        const row = getGenerationRow(initialRow.user_id, initialRow.id);
        if (!row || row.status === "canceled") return;
        const typed = error as Error & { code?: string };
        updateGeneration(row, { status: "failed", error: sanitizeGenerationError(typed.message || "生成任务失败"), errorCode: typed.code || "GENERATION_FAILED" });
    }
}

async function runPublicGeneration(row: GenerationRow, request: AiGenerationRequest, signal: AbortSignal) {
    if (!row.provider_id) throw generationError("AI_PROVIDER_NOT_FOUND", "生成记录缺少渠道");
    const selection = resolveProviderModel(`${row.provider_id}::${row.model_id}`, row.kind);
    if (!selection.provider) throw generationError("AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    const adapter = adapterFor(selection.model.endpoint);
    const method = row.kind === "text" ? adapter.generateText : row.kind === "image" ? adapter.generateImage : row.kind === "video" ? adapter.generateVideo : adapter.generateAudio;
    if (!method) throw generationError("AI_CAPABILITY_UNSUPPORTED", "当前渠道不支持这种生成能力");
    const context: ProviderContext = {
        row: selection.provider,
        credentials: selection.provider.credentials,
        model: selection.model,
        userId: row.user_id,
        request,
        signal,
        remoteTaskId: row.remote_task_id,
        onDelta: (delta) => emitEvent(row.user_id, "generation.delta", { id: row.id, delta }),
        onRemoteTask: (id) => updateGeneration(row, { remoteTaskId: id }),
        onProgress: (progress) => updateGeneration(row, { progress }),
    };
    return method(context);
}

async function cancelProviderTask(row: GenerationRow) {
    if (!row.provider_id) return;
    const provider = getProviderRow(row.provider_id);
    if (!provider) return;
    const request = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
    const model = resolveProviderModel(`${row.provider_id}::${row.model_id}`, row.kind).model;
    const adapter = adapterFor(model.endpoint);
    if (!adapter.cancel) return;
    await adapter.cancel({
        row: provider,
        credentials: decryptCredentials(provider),
        model,
        userId: row.user_id,
        request,
        signal: AbortSignal.timeout(5000),
        remoteTaskId: row.remote_task_id,
        onDelta: () => undefined,
        onRemoteTask: () => undefined,
        onProgress: () => undefined,
    });
}

async function runComfyGeneration(row: GenerationRow, request: AiGenerationRequest, signal: AbortSignal) {
    const server = selectComfyServer(row.comfy_server_id, row.model_id);
    if (!server) throw generationError("COMFY_UNAVAILABLE", "没有可用的 ComfyUI 节点");
    const baseUrl = decryptJson<{ url: string }>(server.encrypted_url, config.appSecret).url.replace(/\/+$/, "");
    let promptId = row.remote_task_id;
    if (!promptId) {
        const uploaded = await uploadComfyReferences(baseUrl, row.user_id, request.references || [], signal);
        const workflow = buildComfyWorkflow({
            model: row.model_id,
            prompt: request.prompt || "",
            params: request.params || {},
            images: uploaded.filter((item) => item.kind === "image").map((item) => item.name),
            videos: uploaded.filter((item) => item.kind === "video").map((item) => item.name),
            audios: uploaded.filter((item) => item.kind === "audio").map((item) => item.name),
        });
        const created = await comfyJson<{ prompt_id?: string; node_errors?: unknown }>(`${baseUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `infinite-canvas-${row.id}` }), signal });
        if (!created.prompt_id) throw generationError("COMFY_REJECTED", `ComfyUI 拒绝工作流：${JSON.stringify(created.node_errors || created)}`);
        promptId = created.prompt_id;
        updateGeneration(row, { remoteTaskId: promptId });
    }
    const outputFiles = await waitForComfyOutput(baseUrl, promptId, signal, (progress) => updateGeneration(row, { progress }));
    const files = await Promise.all(outputFiles.map(async (file) => {
        const url = `${baseUrl}/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" })}`;
        return storeRemoteFile(row.user_id, await fetch(url, { signal, redirect: "error" }), basename(file.filename));
    }));
    return { files };
}

function selectComfyServer(id: string | null, model: string) {
    const rows = db.prepare("SELECT * FROM comfy_servers WHERE enabled=1 ORDER BY created_at").all() as ComfyServerRow[];
    return rows.find((row) => (!id || row.id === id) && parseJson<string[]>(row.models, []).includes(model));
}

async function uploadComfyReferences(baseUrl: string, userId: string, references: NonNullable<AiGenerationRequest["references"]>, signal: AbortSignal) {
    return Promise.all(references.map(async (reference, index) => {
        const stored = getStoredFile(userId, reference.fileId);
        if (!stored) throw generationError("AI_REFERENCE_NOT_FOUND", "参考素材不存在或无权访问");
        const form = new FormData();
        form.set("type", "input");
        form.set("image", await openAsBlob(stored.path, { type: stored.mime_type }), stored.original_name || `reference-${index}`);
        const result = await comfyJson<{ name?: string; subfolder?: string }>(`${baseUrl}/upload/image`, { method: "POST", body: form, signal });
        if (!result.name) throw generationError("COMFY_UPLOAD_FAILED", "ComfyUI 素材上传失败");
        return { kind: reference.kind || storedKind(stored.mime_type), name: result.subfolder ? `${result.subfolder}/${result.name}` : result.name };
    }));
}

async function waitForComfyOutput(baseUrl: string, promptId: string, signal: AbortSignal, onProgress: (value: number) => void) {
    for (let attempt = 0; attempt < 7200; attempt += 1) {
        const history = await comfyJson<Record<string, { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, unknown> }>>(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal });
        const entry = history[promptId];
        if (entry?.status?.status_str === "error") throw generationError("COMFY_WORKFLOW_FAILED", comfyErrorMessage(entry.status.messages) || "ComfyUI 工作流执行失败");
        const files = collectOutputFiles(entry?.outputs);
        if (files.length) return files;
        onProgress(Math.min(0.95, 0.05 + attempt / 7200));
        await delay(1500, signal);
    }
    throw generationError("COMFY_TIMEOUT", "ComfyUI 任务执行超时");
}

async function cancelComfyPrompt(row: GenerationRow) {
    const server = selectComfyServer(row.comfy_server_id, row.model_id);
    if (!server || !row.remote_task_id) return;
    const baseUrl = decryptJson<{ url: string }>(server.encrypted_url, config.appSecret).url.replace(/\/+$/, "");
    try {
        await fetch(`${baseUrl}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [row.remote_task_id] }), signal: AbortSignal.timeout(5000), redirect: "error" });
        const queue = await comfyJson<{ queue_running?: unknown[] }>(`${baseUrl}/queue`, { signal: AbortSignal.timeout(5000) });
        if (JSON.stringify(queue.queue_running || []).includes(row.remote_task_id)) await fetch(`${baseUrl}/interrupt`, { method: "POST", signal: AbortSignal.timeout(5000), redirect: "error" });
    } catch {
        // The local task remains canceled even when the node is offline.
    }
}

function comfyErrorMessage(messages: unknown[] | undefined) {
    for (const item of [...(messages || [])].reverse()) {
        if (!Array.isArray(item) || !item[1] || typeof item[1] !== "object") continue;
        const detail = item[1] as Record<string, unknown>;
        if (typeof detail.exception_message === "string") return detail.exception_message;
    }
    return "";
}

function collectOutputFiles(outputs: Record<string, unknown> | undefined) {
    const files: ComfyOutputFile[] = [];
    Object.values(outputs || {}).forEach((output) => {
        if (!output || typeof output !== "object") return;
        Object.values(output).forEach((items) => {
            if (!Array.isArray(items)) return;
            items.forEach((item) => {
                if (item && typeof item === "object" && "filename" in item && typeof item.filename === "string") files.push(item as ComfyOutputFile);
            });
        });
    });
    return files;
}

async function comfyJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (!response.ok) throw generationError("COMFY_REQUEST_FAILED", `ComfyUI 请求失败（${response.status}）`);
    return await response.json() as T;
}

function updateGeneration(row: GenerationRow, patch: { status?: GenerationRow["status"]; result?: unknown; error?: string; errorCode?: string; remoteTaskId?: string; progress?: number; usage?: unknown }) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE generations SET
        status=COALESCE(?, status), result=COALESCE(?, result), error=?, error_code=?,
        remote_task_id=COALESCE(?, remote_task_id), progress=COALESCE(?, progress), usage=COALESCE(?, usage), updated_at=?
        WHERE id=? AND user_id=?`).run(
        patch.status || null,
        patch.result === undefined ? null : JSON.stringify(patch.result),
        patch.error || null,
        patch.errorCode || null,
        patch.remoteTaskId || null,
        patch.progress === undefined ? null : patch.progress,
        patch.usage === undefined ? null : JSON.stringify(patch.usage),
        now,
        row.id,
        row.user_id,
    );
    const updated = getGenerationRow(row.user_id, row.id);
    if (updated) {
        emitEvent(row.user_id, "generation.updated", generationResponse(updated));
        syncAgentGenerationCanvas(updated);
        syncCreativeAssetGeneration(updated);
    }
}

function getGenerationRow(userId: string, id: string) {
    return db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(id, userId) as GenerationRow | undefined;
}

export function getGenerationForAgent(userId: string, id: string) {
    return getGenerationRow(userId, id);
}

function storedKind(mimeType: string): Exclude<MediaKind, "text"> {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "image";
}

function asUsage(value: unknown) {
    return value && typeof value === "object" ? value : undefined;
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

function generationError(code: string, message: string) {
    return Object.assign(new Error(message), { code, status: 400 });
}

function sanitizeGenerationError(value: string) {
    return value
        .replace(/https?:\/\/\S+/gi, "[URL]")
        .replace(/(?:sk|key|token|bearer)[-_\s:=]+[A-Za-z0-9._-]{8,}/gi, "[凭据已隐藏]")
        .slice(0, 1000);
}
