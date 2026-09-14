import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { nanoid } from "nanoid";
import { adapterFor, type AiGenerationRequest, type ProviderContext } from "./ai-adapters.js";
import { config } from "./config.js";
import { decryptJson } from "./crypto.js";
import { db, parseJson } from "./database.js";
import { executorComfyModels } from "./media-capabilities.js";
import { buildComfyWorkflow, type GenerationPurpose } from "./comfy-workflows.js";
import { getStoredFile, storeRemoteFile, syncFileRefs } from "./file-store.js";
import { decryptCredentials, getProviderRow, resolveImageModel, resolveMediaUnderstandingModel, resolveProviderModel, resolvePurposeModel, resolveSelectableModel, type AiModelDefinition, type AudioMode, type AudioOperation, type MediaKind } from "./provider-service.js";
import { acknowledgeLocalMediaGeneration, cancelLocalMediaGeneration, runLocalMediaGeneration } from "./local-media.js";
import { getMediaExecutorSettings } from "./media-executor-settings.js";

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
function usesMediaExecutorJobs(row: GenerationRow) {
    return row.provider_id === "local-media" || row.comfy_server_id === "media-executor" && executorComfyModels.has(row.model_id);
}
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
        effects: db.prepare("SELECT handler,status,attempts,error FROM generation_effects WHERE generation_id=? ORDER BY handler").all(row.id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

let observeGeneration: (row: GenerationRow) => void = () => undefined;
export function setGenerationObserver(observer: typeof observeGeneration) { observeGeneration = observer; }

export function createGeneration(userId: string, input: AiGenerationRequest, id = nanoid()) {
    const purpose = (input.purpose || "default") as GenerationPurpose;
    const selection = purpose === "default"
        ? input.kind === "image"
            ? resolveImageModel(input.model || "", (input.references || []).some((reference) => (reference.kind || "image") === "image") ? "edit" : "generate")
            : resolveSelectableModel(input.model || "", input.kind)
        : resolvePurposeModel(purpose, input.kind);
    const imageReferenceCount = (input.references || []).filter((reference) => (reference.kind || "image") === "image").length;
    const audioReferenceCount = (input.references || []).filter((reference) => reference.kind === "audio").length;
    const videoReferenceCount = (input.references || []).filter((reference) => reference.kind === "video").length;
    if (purpose === "default" && input.kind === "image" && selection.model.maxReferenceImages && imageReferenceCount > selection.model.maxReferenceImages) throw generationError("AI_MODEL_REFERENCE_LIMIT", `所选图生图模型最多支持 ${selection.model.maxReferenceImages} 张参考图`);
    if (input.kind === "audio") {
        const audioModel = selection.model as AiModelDefinition;
        const mode = String(input.mode || input.params?.audioMode || "speech");
        const operation = String(input.operation || input.params?.audioOperation || (audioReferenceCount ? "clone" : "generate"));
        if (audioModel.audioModes?.length && !audioModel.audioModes.includes(mode as AudioMode)) throw generationError("AI_MODEL_AUDIO_MODE_UNSUPPORTED", "所选模型不支持当前声音类型");
        if (audioModel.audioOperations?.length && !audioModel.audioOperations.includes(operation as AudioOperation)) throw generationError("AI_MODEL_AUDIO_OPERATION_UNSUPPORTED", "所选模型不支持当前声音操作");
        if (audioModel.maxReferenceAudios && audioReferenceCount > audioModel.maxReferenceAudios) throw generationError("AI_MODEL_REFERENCE_LIMIT", `所选模型最多支持 ${audioModel.maxReferenceAudios} 段参考音频`);
    }
    if (input.kind === "video") {
        const model = selection.model as AiModelDefinition;
        const seconds = Number(input.params?.seconds || input.params?.videoSeconds || 0);
        if (model.minDurationSeconds && seconds && seconds < model.minDurationSeconds) throw generationError("AI_MODEL_DURATION_UNSUPPORTED", `所选视频模型最短支持 ${model.minDurationSeconds} 秒`);
        if (model.maxDurationSeconds && seconds > model.maxDurationSeconds) throw generationError("AI_MODEL_DURATION_UNSUPPORTED", `所选视频模型最长支持 ${model.maxDurationSeconds} 秒`);
        if (model.maxReferenceImages !== undefined && imageReferenceCount > model.maxReferenceImages) throw generationError("AI_MODEL_REFERENCE_LIMIT", `所选视频模型最多支持 ${model.maxReferenceImages} 张参考图`);
        if (model.maxReferenceVideos !== undefined && videoReferenceCount > model.maxReferenceVideos) throw generationError("AI_MODEL_REFERENCE_LIMIT", `所选视频模型最多支持 ${model.maxReferenceVideos} 段参考视频`);
        if (model.maxReferenceAudios !== undefined && audioReferenceCount > model.maxReferenceAudios) throw generationError("AI_MODEL_REFERENCE_LIMIT", `所选视频模型最多支持 ${model.maxReferenceAudios} 段参考音频`);
        if (model.maxReferenceFiles !== undefined && imageReferenceCount + videoReferenceCount + audioReferenceCount > model.maxReferenceFiles) throw generationError("AI_MODEL_REFERENCE_LIMIT", `所选视频模型最多支持 ${model.maxReferenceFiles} 个参考文件`);
    }
    if ((input.prompt?.trim() || input.messages?.length) && !selection.model.inputs.includes("text")) throw generationError("AI_MODEL_INPUT_UNSUPPORTED", "所选模型不支持文本输入");
    for (const reference of input.references || []) {
        const kind = reference.kind || "image";
        if (!selection.model.inputs.includes(kind)) throw generationError("AI_MODEL_INPUT_UNSUPPORTED", "所选模型不支持当前参考素材类型");
        const role = reference.role || "reference";
        const videoModel = selection.model as AiModelDefinition;
        if (input.kind === "video" && role !== "reference" && !videoModel.videoReferenceRoles?.includes(role)) throw generationError("AI_MODEL_VIDEO_REFERENCE_UNSUPPORTED", `所选视频模型未声明 ${role} 能力`);
        if (input.kind === "video" && role === "continuation" && !videoModel.videoExtend && videoModel.videoContinuationMode !== "reference") throw generationError("AI_MODEL_VIDEO_EXTEND_UNSUPPORTED", "所选视频模型不支持续接参考");
        if (["first-frame", "last-frame"].includes(role) && kind !== "image") throw generationError("AI_VIDEO_FRAME_KIND", "首帧和尾帧引用必须是图片");
        if (!getStoredFile(userId, reference.fileId)) throw generationError("AI_REFERENCE_NOT_FOUND", "参考素材不存在或无权访问");
    }
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare(`INSERT INTO generations(id, user_id, kind, status, provider_id, model_id, request, progress, comfy_server_id, created_at, updated_at)
            VALUES(?, ?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?)`).run(id, userId, input.kind, selection.providerId, selection.modelId, JSON.stringify(input), selection.comfyServerId || null, now, now);
        syncFileRefs(userId, "generation", id, input);
        observeGeneration(getGenerationRow(userId, id)!);
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
    if (usesMediaExecutorJobs(row)) void cancelLocalMediaGeneration(row);
    else if (row.provider_id === "comfyui" && row.remote_task_id) void cancelComfyPrompt(row);
    else if (row.provider_id && row.remote_task_id) void cancelProviderTask(row);
    updateGeneration(row, { status: "canceled", error: "用户已取消任务", errorCode: "GENERATION_CANCELED" });
    schedulePump();
    return generationResponse(getGenerationRow(row.user_id, row.id)!);
}

export function resumeGenerations() {
    const rows = db.prepare("SELECT * FROM generations WHERE status IN ('queued','running') ORDER BY created_at").all() as GenerationRow[];
    rows.forEach((row) => {
        if (row.status === "running" && !row.remote_task_id && !usesMediaExecutorJobs(row)) updateGeneration(row, { status: "failed", error: "服务重启中断，任务无法安全恢复", errorCode: "SERVICE_RESTART_INTERRUPTED" });
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
    while (running.size < Math.max(config.aiMaxConcurrency, config.aiImageMaxConcurrency)) {
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
    const sameKind = Array.from(running.values()).filter((item) => item.row.kind === row.kind);
    const kindLimit = row.kind === "image" ? config.aiImageMaxConcurrency : config.aiMaxConcurrency;
    if (sameKind.length >= kindLimit) return false;
    const userActive = sameKind.filter((item) => item.row.user_id === row.user_id).length;
    if (userActive >= (row.kind === "image" ? config.aiImageUserConcurrency : config.aiUserConcurrency)) return false;
    if (!row.provider_id) return true;
    if (row.provider_id === "comfyui") return !Array.from(running.values()).some((item) => item.row.id !== row.id && (item.row.provider_id === "local-media" || (item.row.provider_id === "comfyui" && item.row.comfy_server_id === row.comfy_server_id)));
    if (row.provider_id === "local-media") return !Array.from(running.values()).some((item) => item.row.id !== row.id && ["local-media", "comfyui"].includes(item.row.provider_id || ""));
    const provider = getProviderRow(row.provider_id);
    if (!provider?.enabled) return true;
    const providerActive = Array.from(running.values()).filter((item) => item.row.provider_id === row.provider_id).length;
    return providerActive < (row.kind === "image" ? Math.max(provider.concurrency, config.aiImageMaxConcurrency) : provider.concurrency);
}

async function runGeneration(initialRow: GenerationRow, controller: AbortController) {
    try {
        const row = getGenerationRow(initialRow.user_id, initialRow.id);
        if (!row || row.status === "canceled") return;
        const request = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
        const result = usesMediaExecutorJobs(row)
            ? await runLocalMediaGeneration(row, request, controller.signal, (id) => updateGeneration(row, { remoteTaskId: id }), (progress) => updateGeneration(row, { progress }))
            : row.provider_id === "comfyui"
            ? await runComfyGeneration(row, request, controller.signal)
            : await runPublicGeneration(row, request, controller.signal);
        const current = getGenerationRow(row.user_id, row.id);
        if (!current || current.status === "canceled") return;
        updateGeneration(current, { status: "succeeded", result, progress: 1, usage: asUsage((result as Record<string, unknown>).usage) });
        syncFileRefs(row.user_id, "generation", row.id, { request, result });
        if (usesMediaExecutorJobs(row)) void acknowledgeLocalMediaGeneration(row.id);
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

export async function runTextModelOnce(userId: string, modelRef: string, request: Omit<AiGenerationRequest, "kind" | "model">, signal: AbortSignal = AbortSignal.timeout(10 * 60_000)) {
    const selection = resolveMediaUnderstandingModel(modelRef);
    const adapter = adapterFor(selection.model.endpoint);
    if (!adapter.generateText) throw generationError("AI_CAPABILITY_UNSUPPORTED", "当前媒体理解模型不支持文本响应");
    return adapter.generateText({
        row: selection.provider,
        credentials: selection.provider.credentials,
        model: selection.model,
        userId,
        request: { ...request, kind: "text", model: modelRef },
        signal,
        onDelta: () => undefined,
        onRemoteTask: () => undefined,
        onProgress: () => undefined,
    });
}

async function cancelProviderTask(row: GenerationRow) {
    if (!row.provider_id || row.provider_id === "comfyui") return;
    const provider = getProviderRow(row.provider_id);
    if (!provider) return;
    const request = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
    const selection = resolveProviderModel(`${row.provider_id}::${row.model_id}`, row.kind);
    if (!("provider" in selection)) return;
    const model = selection.model as AiModelDefinition;
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
    if (executorComfyModels.has(row.model_id)) throw generationError("MEDIA_EXECUTOR_REQUIRED", "该媒体能力由执行器独立提供，请选择媒体执行器节点");
    const server = selectComfyServer(row.comfy_server_id, row.model_id);
    if (!server) throw generationError("COMFY_UNAVAILABLE", "没有可用的 ComfyUI 节点");
    const baseUrl = decryptJson<{ url: string }>(server.encrypted_url, config.appSecret).url.replace(/\/+$/, "");
    const comfyHeaders: Record<string, string> = server.id === "media-executor" ? { Authorization: `Bearer ${getMediaExecutorSettings().token}` } : {};
    let promptId = row.remote_task_id;
    if (!promptId) {
        const uploaded = await uploadComfyReferences(baseUrl, row.user_id, request.references || [], signal);
        const workflow = buildComfyWorkflow({
            model: row.model_id,
            prompt: request.prompt || "",
            params: { ...(request.params || {}), referenceTranscript: request.references?.find((reference) => reference.kind === "audio")?.transcript || request.params?.referenceTranscript },
            files: uploaded,
        });
        const created = await comfyJson<{ prompt_id?: string; node_errors?: unknown }>(`${baseUrl}/prompt`, { method: "POST", headers: { ...comfyHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `infinite-canvas-${row.id}` }), signal });
        if (!created.prompt_id) throw generationError("COMFY_REJECTED", `ComfyUI 拒绝工作流：${JSON.stringify(created.node_errors || created)}`);
        promptId = created.prompt_id;
        updateGeneration(row, { remoteTaskId: promptId });
    }
    const output = await waitForComfyOutput(baseUrl, promptId, comfyHeaders, signal, (progress) => updateGeneration(row, { progress }));
    const download = async (file: ComfyOutputFile) => {
        const url = `${baseUrl}/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" })}`;
        return storeRemoteFile(row.user_id, await fetch(url, { headers: comfyHeaders, signal, redirect: "error" }), basename(file.filename));
    };
    const [files, continuationStates, cumulativeVideos] = await Promise.all([Promise.all(output.files.map(download)), Promise.all(output.continuationStates.map(download)), Promise.all(output.cumulativeVideos.map(download))]);
    return { files, ...(continuationStates.length ? { continuationStates } : {}), ...(cumulativeVideos.length ? { cumulativeVideos } : {}) };
}

function selectComfyServer(id: string | null, model: string) {
    const rows = db.prepare("SELECT * FROM comfy_servers WHERE enabled=1 ORDER BY created_at").all() as ComfyServerRow[];
    return rows.find((row) => (!id || row.id === id) && parseJson<string[]>(row.models, []).includes(model));
}

async function uploadComfyFile(baseUrl: string, userId: string, fileId: string, signal: AbortSignal) {
    const headers: Record<string, string> = baseUrl.includes("/v1/comfy") ? { Authorization: `Bearer ${getMediaExecutorSettings().token}` } : {};
    const stored = getStoredFile(userId, fileId);
    if (!stored) throw generationError("AI_REFERENCE_NOT_FOUND", "参考素材不存在或无权访问");
    const form = new FormData();
    form.set("type", "input");
    form.set("image", await openAsBlob(stored.path, { type: stored.mime_type }), stored.original_name || fileId);
    const result = await comfyJson<{ name?: string; subfolder?: string }>(`${baseUrl}/upload/image`, { method: "POST", headers, body: form, signal });
    if (!result.name) throw generationError("COMFY_UPLOAD_FAILED", "ComfyUI 素材上传失败");
    return { name: result.subfolder ? `${result.subfolder}/${result.name}` : result.name, mimeType: stored.mime_type };
}

async function uploadComfyReferences(baseUrl: string, userId: string, references: NonNullable<AiGenerationRequest["references"]>, signal: AbortSignal) {
    return Promise.all(references.map(async (reference) => {
        const uploaded = await uploadComfyFile(baseUrl, userId, reference.fileId, signal);
        return { fileId: reference.fileId, kind: reference.kind || storedKind(uploaded.mimeType), role: reference.role, name: uploaded.name };
    }));
}

async function waitForComfyOutput(baseUrl: string, promptId: string, headers: Record<string, string>, signal: AbortSignal, onProgress: (value: number) => void) {
    for (let attempt = 0; attempt < 7200; attempt += 1) {
        const history = await comfyJson<Record<string, { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, unknown> }>>(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { headers, signal });
        const entry = history[promptId];
        if (entry?.status?.status_str === "error") throw generationError("COMFY_WORKFLOW_FAILED", comfyErrorMessage(entry.status.messages) || "ComfyUI 工作流执行失败");
        const output = collectComfyOutputs(entry?.outputs);
        if (output.files.length) return output;
        if (entry?.status?.status_str === "success" && output.continuationStates.length) throw generationError("COMFY_MEDIA_OUTPUT_MISSING", "ComfyUI 仅返回续接状态，缺少可用媒体输出");
        onProgress(Math.min(0.95, 0.05 + attempt / 7200));
        await delay(1500, signal);
    }
    throw generationError("COMFY_TIMEOUT", "ComfyUI 任务执行超时");
}

async function cancelComfyPrompt(row: GenerationRow) {
    const server = selectComfyServer(row.comfy_server_id, row.model_id);
    if (!server || !row.remote_task_id) return;
    const baseUrl = decryptJson<{ url: string }>(server.encrypted_url, config.appSecret).url.replace(/\/+$/, "");
    const headers: Record<string, string> = server.id === "media-executor" ? { Authorization: `Bearer ${getMediaExecutorSettings().token}` } : {};
    try {
        await fetch(`${baseUrl}/queue`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ delete: [row.remote_task_id] }), signal: AbortSignal.timeout(5000), redirect: "error" });
        const queue = await comfyJson<{ queue_running?: unknown[] }>(`${baseUrl}/queue`, { headers, signal: AbortSignal.timeout(5000) });
        if (JSON.stringify(queue.queue_running || []).includes(row.remote_task_id)) await fetch(`${baseUrl}/interrupt`, { method: "POST", headers, signal: AbortSignal.timeout(5000), redirect: "error" });
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

export function collectComfyOutputs(outputs: Record<string, unknown> | undefined) {
    const files: ComfyOutputFile[] = [];
    const continuationStates: ComfyOutputFile[] = [];
    const cumulativeVideos: ComfyOutputFile[] = [];
    Object.entries(outputs || {}).forEach(([nodeId, output]) => {
        if (!output || typeof output !== "object") return;
        Object.entries(output).forEach(([key, items]) => {
            if (!Array.isArray(items)) return;
            items.forEach((item) => {
                if (!item || typeof item !== "object" || !("filename" in item) || typeof item.filename !== "string") return;
                if (key === "h3_states") {
                    if (!item.filename.endsWith(".safetensors")) throw generationError("COMFY_H3_STATE_INVALID", "H3 续接状态格式无效");
                    continuationStates.push(item as ComfyOutputFile);
                } else if (nodeId === "h3_cumulative") {
                    if (!/\.(mp4|webm|mkv)$/i.test(item.filename)) throw generationError("COMFY_H3_CUMULATIVE_INVALID", "H3 累计音视频格式无效");
                    cumulativeVideos.push(item as ComfyOutputFile);
                } else files.push(item as ComfyOutputFile);
            });
        });
    });
    return { files, continuationStates, cumulativeVideos };
}

async function comfyJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (!response.ok) throw generationError("COMFY_REQUEST_FAILED", `ComfyUI 请求失败（${response.status}）`);
    return await response.json() as T;
}

function updateGeneration(row: GenerationRow, patch: { status?: GenerationRow["status"]; result?: unknown; error?: string; errorCode?: string; remoteTaskId?: string; progress?: number; usage?: unknown }) {
    db.transaction(() => {
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
        if (updated) observeGeneration(updated);
    })();
    const updated = getGenerationRow(row.user_id, row.id);
    if (updated) emitEvent(row.user_id, "generation.updated", generationResponse(updated));
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
