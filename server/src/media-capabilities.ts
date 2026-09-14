import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import type { AiGenerationRequest } from "./ai-adapters.js";
import { db, parseJson } from "./database.js";
import { getStoredFile } from "./file-store.js";
import { getMediaExecutorSettings, MEDIA_PROTOCOL } from "./media-executor-settings.js";

export type MediaCapability = { id: string; version: string; output: "video" | "audio" | "text"; available: boolean; modes: string[]; operations: string[]; inputs: string[]; [key: string]: unknown };
export type MediaPlan = { capabilityVersion: string; mode: string; recipe?: string; qualityPreset?: string; width?: number; height?: number; fps?: number; outputFrames?: number; outputSeconds?: number; overlapFrames?: number; context?: Record<string, unknown> | null; previous?: Record<string, unknown> | null; seed: number };
export const executorComfyModels = new Set(["minimax-h3-ref2va-local", "minimax-h3-fl2va-local", "minimax-music3-local"]);

export async function executorRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const executor = getMediaExecutorSettings();
    if (!executor.url || !executor.token) throw mediaError("MEDIA_EXECUTOR_UNAVAILABLE", "媒体能力服务尚未配置");
    const response = await fetch(`${executor.url}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${executor.token}`, "X-Media-Protocol": MEDIA_PROTOCOL }, signal: init.signal || AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { detail?: unknown };
        throw Object.assign(mediaError("MEDIA_EXECUTOR_REQUEST_FAILED", typeof detail.detail === "string" ? detail.detail : `媒体能力请求失败（${response.status}）`), { status: response.status });
    }
    return await response.json() as T;
}

export async function listMediaCapabilities() {
    const result = await executorRequest<{ version: string; capabilities: MediaCapability[] }>("/v1/capabilities");
    if (result.version !== MEDIA_PROTOCOL) throw mediaError("MEDIA_CAPABILITY_VERSION_MISMATCH", "媒体能力协议不匹配，请配套更新执行器");
    return result;
}

export async function ownedMediaHash(userId: string, fileId: string) {
    const file = getStoredFile(userId, fileId);
    if (!file) throw mediaError("AI_REFERENCE_NOT_FOUND", "参考文件不存在或无权访问");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file.path)) hash.update(chunk);
    return hash.digest("hex");
}

export async function resolveMediaContinuation(userId: string, source: NonNullable<AiGenerationRequest["continuation"]>) {
    const generation = db.prepare("SELECT status,result FROM generations WHERE id=? AND user_id=?").get(source.generationId, userId) as { status: string; result: string | null } | undefined;
    const result = parseJson<{ continuationStates?: Array<{ fileId?: string; id?: string; sha256?: string; context?: Record<string, unknown> }> }>(generation?.result || "{}", {});
    const state = result.continuationStates?.find((file) => (file.fileId || file.id) === source.fileId);
    if (generation?.status !== "succeeded" || !state?.sha256 || !state.context || await ownedMediaHash(userId, source.fileId) !== state.sha256) throw mediaError("MEDIA_CONTINUATION_INVALID", "续接状态与已完成的来源任务不一致，或文件已变化");
    return { ...source, sha256: state.sha256, context: state.context };
}

async function upload(userId: string, fileId: string, signal?: AbortSignal) {
    const file = getStoredFile(userId, fileId);
    if (!file) throw mediaError("AI_REFERENCE_NOT_FOUND", "参考文件不存在或无权访问");
    const form = new FormData();
    form.set("upload", await openAsBlob(file.path, { type: file.mime_type }), file.original_name);
    return (await executorRequest<{ id: string }>("/v1/files", { method: "POST", body: form, signal })).id;
}

export async function prepareExecutorRequest(userId: string, id: string, model: string, request: AiGenerationRequest, signal?: AbortSignal) {
    const refs = request.references || [];
    const state = request.continuation ? await resolveMediaContinuation(userId, request.continuation) : undefined;
    const references = await Promise.all(refs.map(async (ref) => ({ fileId: await upload(userId, ref.fileId, signal), kind: ref.kind || "image", role: ref.role || "reference", transcript: ref.transcript, frameIndex: ref.frameIndex, includeAudio: ref.includeAudio })));
    const continuation = state ? { fileId: await upload(userId, state.fileId, signal), sha256: state.sha256 } : undefined;
    const params = Object.fromEntries(Object.entries(request.params || {}).filter(([key]) => !key.startsWith("__")));
    const mode = request.mode || (request.kind === "transcription" ? "transcription" : model.includes("ref2va") ? "ref2va" : model.includes("fl2va") ? "fl2va" : model === "minimax-music3-local" ? "music" : String(params.audioMode || "speech"));
    const operation = request.operation || (request.kind === "transcription" ? "transcribe" : state ? "extend" : String(params.audioOperation || (mode === "speech" && refs.length ? "clone" : "generate")));
    return { id, model, mode, operation, prompt: request.prompt || "", params, references, continuation };
}

export async function validateMediaGeneration(userId: string, id: string, model: string, request: AiGenerationRequest) {
    const value = await prepareExecutorRequest(userId, id, model, request);
    const result = await executorRequest<{ valid: true; plan: MediaPlan }>("/v1/jobs/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    if (result.valid !== true || result.plan?.capabilityVersion !== "1") throw mediaError("MEDIA_CAPABILITY_VERSION_MISMATCH", "媒体能力版本不匹配，请更新执行器与能力 Skill");
    return result;
}

function mediaError(code: string, message: string) { return Object.assign(new Error(message), { code }); }
