import { syncDirectorLookFrameGeneration } from "./director-look-frame.js";
import { resolveEditPlan, type EditVideoClip, type EditAudioClip } from "./director-edit-plan.js";
import type { AiGenerationRequest, GenerationReference } from "./ai-adapters.js";
import { validateMediaGeneration } from "./media-capabilities.js";
import { config } from "./config.js";
import { mkdirSync, copyFileSync } from "node:fs";
import { markDirectorProjectChanged } from "./director-sync.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getStoredFile, storeLocalFile, syncFileRefs } from "./file-store.js";
import type { GenerationRow } from "./generation-service.js";
import { createGeneration } from "./generation-service.js";
import { getAiGlobalSettings, listModelDefaults, resolveSelectableModel, type AiModelDefinition } from "./provider-service.js";
import { getMediaExecutorCatalog } from "./media-executor-settings.js";
import { type H3QualityPreset, type H3TemporalGuide } from "./comfy-workflows.js";
import { h3AudioReferencesInput, validateH3FinalPromptReferences, isH3TurboAudioSafe } from "./h3-prompt.js";
import { createH3ContinuationBinding, createH3CumulativeBinding, h3StateContextSchema, validateH3NativeVideo, resolveDirectorH3Continuation, resolveDirectorH3Cumulative, verifyRequestedH3Continuation, isSameH3OwnedMedia } from "./h3-continuation.js";
import { planH3TaskSources } from "./h3-media-plan.js";
import { getTaskPrevisInputs, readDirectorPrevis, freezeDirectorGenerationInputs } from "./director-previs.js";
import { getDirectorTaskImageReferences, archiveDirectorRender, assertDirectorProjectValid, readDirectorVideoPrompt, getDirectorAssetReferenceImage, syncDirectorVideoSegmentFile, syncDirectorTimelineFile } from "./director-workspace.js";

type RenderRow = { id: string; user_id: string; project_id: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; payload: string; output_file_id: string | null; error: string | null; progress: number; created_at: string; updated_at: string };
type ShotRow = { id: string; position: number; payload: string; revision: number };
type TimelineRow = { payload: string; revision: number };
type WorkspaceRow = { aspect_ratio: string; directing_rules: string; revision: number };
type AudioClip = { id: string; segmentId?: string; fileId?: string; start: number; duration: number; trimIn?: number; fadeIn?: number; fadeOut?: number; volume?: number; muted?: boolean; loop?: boolean };
type RenderPayload = { timelineRevision: number; segmentIds: string[]; duration: number; warnings: string[]; snapshot?: { edit: unknown; aspectRatio: string; segments: Array<{ path: string; trimIn: number; duration: number }>; audio: Array<EditAudioClip & { path: string }> } };

const renderInput = z.object({ timelineRevision: z.number().int().positive() });
const shotGenerationInput = z.object({ revision: z.number().int().positive(), qualityPreset: z.enum(["preview", "final"]).default("preview"), recipe: z.enum(["base", "pdd-ref8"]).optional(), model: z.string().trim().optional() });
const running = new Map<string, AbortController>();
let scheduled = false;
let emitRender: (userId: string, entity: { type: string; projectId: string; data: unknown }) => void = () => undefined;

export function setDirectorRenderEmitter(emitter: typeof emitRender) { emitRender = emitter; }

async function prepareDirectorShotGeneration(userId: string, shotId: string, input: unknown) {
    const value = shotGenerationInput.parse(input);
    const shot = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(shotId, userId) as (ShotRow & { project_id: string; status: string; title: string }) | undefined;
    if (!shot) throw renderError(404, "DIRECTOR_VIDEO_SEGMENT_NOT_FOUND", "视频段不存在");
    assertDirectorProjectValid(userId, shot.project_id);
    if (shot.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "视频段已在其他页面更新");
    const payload = parseJson<Record<string, unknown>>(shot.payload, {});
    validateShotAssetRefs(userId, shot.project_id, payload);
    const route = resolveH3Route(payload);
    const workspace = db.prepare("SELECT aspect_ratio FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, shot.project_id) as WorkspaceRow;
    const modelRef = value.model || `comfyui::minimax-h3-${route.mode}-local`;
    const selection = resolveSelectableModel(modelRef, "video");
    const model = selection.model as AiModelDefinition;
    if (!model.videoModes?.includes(route.mode)) throw renderError(409, "DIRECTOR_H3_MODE_UNSUPPORTED", `所选模型不支持 ${route.mode.toUpperCase()} 模式`);
    if (selection.comfyServerId !== "media-executor") throw renderError(409, "MEDIA_EXECUTOR_REQUIRED", "H3 制作任务需要媒体能力执行器");
    const nativeContinuation = payload.boundary === "continue";
    const routeReason = nativeContinuation ? "使用前段原生状态续接" : route.reason;
    const references: GenerationReference[] = [];
    const continuationId = String(payload.continuationFromSegmentId || payload.continuationFromShotId || "");
    const previousState = nativeContinuation ? await resolveDirectorH3Continuation(userId, shot.project_id, continuationId) : undefined;
    const preflight = getDirectorVideoSegmentPreflight(userId, shotId, Boolean(model.supportsTemporalGuides), true);
    if (preflight.blockedReasons.length) throw renderError(409, "DIRECTOR_H3_PROMPT_INVALID", preflight.blockedReasons.join("；"), preflight);
    const temporalGuides: H3TemporalGuide[] = [];
    if (route.mode === "ref2va") {
        preflight.videoSelected.forEach((item) => references.push({ fileId: item.fileId, kind: "image", role: "reference", label: item.name }));
        preflight.videoReferences.forEach((item) => references.push({ fileId: item.fileId, kind: "video", role: "reference", includeAudio: item.includeAudio, label: item.name }));
        h3AudioReferencesInput.parse(payload.audioReferences).forEach(({ fileId }) => references.push({ fileId, kind: "audio", role: "reference" }));
    } else {
        const firstFrame = transitionFrame(userId, shot.project_id, String(payload.transitionFromSegmentId || ""), "actualLastFrameFileId");
        const lastFrame = transitionFrame(userId, shot.project_id, String(payload.transitionToSegmentId || ""), "actualFirstFrameFileId");
        if (!firstFrame || !lastFrame) throw renderError(409, "DIRECTOR_TRANSITION_FRAMES_REQUIRED", "首尾帧生成仅用于已准备好前后画面的连续镜头或视觉过渡");
        references.push({ fileId: firstFrame, kind: "image", role: "first-frame" }, { fileId: lastFrame, kind: "image", role: "last-frame" });
    }
    const promptSource = readDirectorVideoPrompt(userId, shot.project_id, shotId);
    const prompt = promptSource.content;
    const referenceErrors = validateH3FinalPromptReferences(prompt, { image: references.filter((item) => item.kind === "image").length, video: references.filter((item) => item.kind === "video").length, audio: references.filter((item) => item.kind === "audio").length });
    if (referenceErrors.length) throw renderError(409, "DIRECTOR_H3_PROMPT_REFERENCES_INVALID", referenceErrors.join("；"));
    const turboEligible = isH3TurboAudioSafe(payload, undefined);
    const id = nanoid();
    const request: AiGenerationRequest = { kind: "video", model: modelRef, mode: route.mode, operation: nativeContinuation ? "extend" : "generate", prompt, references,
        continuation: previousState ? { generationId: previousState.generationId, fileId: previousState.fileId } : undefined,
        params: { seconds: Number(payload.durationSeconds || 4), ratio: workspace.aspect_ratio, qualityPreset: value.qualityPreset, ...(value.recipe ? { recipe: value.recipe } : {}), allowTurbo: turboEligible },
        metadata: { directorSegment: { projectId: shot.project_id, segmentId: shotId, revision: shot.revision, previsHashes: preflight.previsHashes, designHashes: payload.shotDesignHashes, segmentRanges: payload.segmentRanges, mode: route.mode, reason: routeReason, qualityPreset: value.qualityPreset, promptPath: promptSource.path, promptHash: promptSource.hash, previousState, dependencies: payload.dependencies } } };
    const { plan } = await validateMediaGeneration(userId, id, selection.modelId, request);
    if (plan.outputSeconds !== undefined && plan.outputSeconds + 1 / 24 < Number(payload.durationSeconds)) throw renderError(409, "DIRECTOR_OUTPUT_TOO_SHORT", "模型实际输出短于本次覆盖范围，请明确重新划分制作任务", { plan, segmentRanges: payload.segmentRanges });
    const current = segmentRow(userId, shotId);
    if (current.revision !== shot.revision || readDirectorVideoPrompt(userId, shot.project_id, shotId).hash !== promptSource.hash) throw renderError(409, "DIRECTOR_CONFLICT", "校验期间制作任务或提示词已变化，请重新提交");
    request.params = { ...request.params, seed: plan.seed, recipe: plan.recipe };
    return { id, request, plan, shot, payload, route, routeReason, value, prompt, promptSource, references, temporalGuides, preflight };
}

export async function createDirectorVideoSegmentGeneration(userId: string, shotId: string, input: unknown) {
    const { id, request, plan, shot, payload, route, routeReason, value, prompt, promptSource, references, temporalGuides, preflight } = await prepareDirectorShotGeneration(userId, shotId, input);
    const frozen = freezeDirectorGenerationInputs(userId, shot.project_id, shotId, id, references, prompt, preflight.previsHashes);
    request.references = frozen.references;
    request.metadata = { ...request.metadata, inputSnapshot: frozen.path };
    const generation = createGeneration(userId, request, id);
    const { h3ModeOverride: _h3ModeOverride, firstFrameFileId: _firstFrameFileId, lastFrameFileId: _lastFrameFileId, ...cleanPayload } = payload;
    const nextPayload = { ...cleanPayload, h3Mode: route.mode, h3ModeReason: routeReason, h3PromptSnapshot: { mode: route.mode, qualityPreset: value.qualityPreset, plan, prompt, promptPath: promptSource.path, promptHash: promptSource.hash, references: frozen.references, inputSnapshot: frozen.path, temporalGuides, previsHashes: preflight.previsHashes, segmentRanges: payload.segmentRanges }, videoGenerationId: generation.id, videoStale: Boolean(payload.videoStale) };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), shotId, userId);
    syncDirectorVideoSegmentFile(userId, shot.project_id, shotId);
    emitRender(userId, { type: "video-segment", projectId: shot.project_id, data: { id: shotId, revision: shot.revision + 1, payload: nextPayload } });
    return generation;
}

export function getDirectorVideoSegmentPreflight(userId: string, segmentId: string, _supportsTemporalGuides = false, supportsNativeState = Boolean(getMediaExecutorCatalog().h3Runtime)) {
    const segment = segmentRow(userId, segmentId), payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const route = resolveH3Route(payload), blockedReasons: string[] = [], warnings: string[] = [];
    let candidates: ReturnType<typeof getDirectorTaskImageReferences> = [];
    let previs: ReturnType<typeof getTaskPrevisInputs> = { files: [], hashes: {}, warnings: [], ranges: [] };
    try { candidates = getDirectorTaskImageReferences(userId, segment.project_id, payload.referenceImages); } catch (error) { blockedReasons.push((error as Error).message); }
    try { previs = getTaskPrevisInputs(userId, segment.project_id, payload); warnings.push(...previs.warnings); } catch (error) { blockedReasons.push((error as Error).message); }
    const videoSelected = route.mode === "ref2va" ? candidates : [];
    const videoReferences = route.mode === "ref2va" ? previs.files : [];
    if (route.mode === "fl2va") {
        blockedReasons.push(...transitionBlockedReasons(userId, segment.project_id, payload));
        if (previs.files.length || (Array.isArray(payload.audioReferences) && payload.audioReferences.length)) blockedReasons.push("首尾帧过渡不能同时使用独立音视频参考；请使用参考生成或明确跳过预演");
    }
    let finalPrompt: { path: string; hash: string } | undefined;
    try {
        const source = readDirectorVideoPrompt(userId, segment.project_id, segmentId);
        finalPrompt = { path: source.path, hash: source.hash };
        blockedReasons.push(...validateH3FinalPromptReferences(source.content, { image: route.mode === "ref2va" ? candidates.length : 2, video: videoReferences.length, audio: (Array.isArray(payload.audioReferences) ? payload.audioReferences.length : 0) + videoReferences.filter((item) => item.includeAudio).length }));
    } catch (error) { blockedReasons.push((error as Error).message); }
    const audio = h3AudioReferencesInput.safeParse(payload.audioReferences);
    if (!audio.success) blockedReasons.push("声音引用格式无效");
    else for (const reference of audio.data) if (!getStoredFile(userId, reference.fileId)?.mime_type.startsWith("audio/")) blockedReasons.push("音频参考文件不存在或不是音频");
    if (audio.success && audio.data.length && !candidates.length && !videoReferences.length) blockedReasons.push("声音参考还需要显式图片或视频参考");
    const transitionInputs = route.mode === "fl2va" ? { firstFrameFileId: transitionFrame(userId, segment.project_id, String(payload.transitionFromSegmentId || ""), "actualLastFrameFileId") || undefined, lastFrameFileId: transitionFrame(userId, segment.project_id, String(payload.transitionToSegmentId || ""), "actualFirstFrameFileId") || undefined } : undefined;
    return { finalPrompt, transitionInputs, selected: candidates, omitted: [], videoSelected, videoReferences, previsHashes: previs.hashes, videoOmitted: [], assetBlockedReasons: [], promptValidation: { blockedReasons, warnings }, blockedReasons, warnings, route, capabilities: { turboPreview: route.mode === "fl2va" && getMediaExecutorCatalog().comfyFeatures.turboPreview, nativeState: supportsNativeState } };
}

export async function getDirectorVideoSegmentPreflightWithFraming(userId: string, segmentId: string) {
    const preflight = getDirectorVideoSegmentPreflight(userId, segmentId), segment = segmentRow(userId, segmentId);
    if (preflight.blockedReasons.length) return { ...preflight, plan: undefined };
    try { return { ...preflight, plan: (await prepareDirectorShotGeneration(userId, segmentId, { revision: segment.revision })).plan }; }
    catch (error) { return { ...preflight, plan: undefined, blockedReasons: [...preflight.blockedReasons, (error as Error).message] }; }
}

async function resolveH3MediaSources(userId: string, projectId: string, shots: ShotRow[]) {
    const cumulative = new Map<string, Awaited<ReturnType<typeof resolveDirectorH3Cumulative>>>();
    for (const shot of shots) {
        const payload = parseJson<Record<string, unknown>>(shot.payload, {});
        if (!payload.h3ContinuationState || payload.videoStale) continue;
        cumulative.set(shot.id, await resolveDirectorH3Cumulative(userId, projectId, shot.id));
    }
    return planH3TaskSources(shots.map((shot) => shot.id), cumulative);
}

export async function getDirectorPlaybackPlan(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    const rows = db.prepare("SELECT s.id,s.position,s.payload,s.revision FROM director_shots s JOIN director_sequences q ON q.id=s.sequence_id AND q.user_id=s.user_id WHERE s.user_id=? AND s.project_id=? ORDER BY q.position,s.position,s.id").all(userId, projectId) as ShotRow[];
    const edit = parseJson<{ videoClips?: EditVideoClip[]; tracks?: Array<{ clips: EditAudioClip[] }> }>(timeline.payload, {});
    const needed = new Set([...(edit.videoClips || []).map((clip) => clip.taskId), ...(edit.tracks || []).flatMap((track) => track.clips.map((clip) => clip.taskId || clip.segmentId).filter(Boolean))]);
    const native = await resolveH3MediaSources(userId, projectId, rows.filter((row) => needed.has(row.id)));
    const sources = rows.map((shot) => {
        const payload = parseJson<Record<string, unknown>>(shot.payload, {});
        const source = native.get(shot.id) || { fileId: String(payload.videoFileId || ""), trimIn: 0, duration: directorSegmentMediaDuration(payload) };
        return { taskId: shot.id, revision: shot.revision, ...source, audioFileId: payload.nativeAudioFileId ? native.get(shot.id)?.fileId || String(payload.nativeAudioFileId) : undefined, audioTrimIn: native.get(shot.id)?.trimIn || 0 };
    });
    let plan: ReturnType<typeof resolveEditPlan>;
    try { plan = resolveEditPlan(edit, sources); } catch (error) { throw renderError(409, "DIRECTOR_EDIT_INVALID", error instanceof Error ? error.message : "剪辑引用无效"); }
    const current = db.prepare("SELECT revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    if (current.revision !== timeline.revision || rows.some((shot) => (db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=?").get(shot.id, userId) as ShotRow | undefined)?.payload !== shot.payload)) throw renderError(409, "DIRECTOR_PLAYBACK_STALE", "预览来源已变化，请刷新后重试");
    return { timelineRevision: timeline.revision, warnings: rows.filter((row) => needed.has(row.id) && parseJson<Record<string, unknown>>(row.payload, {}).videoStale).map((row) => `任务 ${row.id} 的来源已变化，当前采用已有视频，请检查剪接`), ...plan };

}

export function listDirectorRenders(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    return (db.prepare("SELECT * FROM director_renders WHERE user_id=? AND project_id=? ORDER BY created_at DESC").all(userId, projectId) as RenderRow[]).map(renderResponse);
}

export async function createDirectorRender(userId: string, projectId: string, input: unknown) {
    assertDirector(userId, projectId);
    assertDirectorProjectValid(userId, projectId);
    const value = renderInput.parse(input);
    const plan = await getDirectorPlaybackPlan(userId, projectId);
    if (plan.timelineRevision !== value.timelineRevision) throw renderError(409, "DIRECTOR_CONFLICT", "时间线已在其他页面更新");
    if (!plan.segments.length) throw renderError(409, "DIRECTOR_RENDER_EMPTY", "时间线还没有选用视频");
    const id = nanoid();
    const directory = join(config.dataDir, "director-render-inputs", id);
    mkdirSync(directory, { recursive: true });
    try {
        const paths = new Map<string, string>();
        const snapshotFile = (fileId: string) => {
            if (paths.has(fileId)) return paths.get(fileId)!;
            const source = getStoredFile(userId, fileId);
            if (!source) throw new Error(`合成媒体不存在：${fileId}`);
            const path = join(directory, `${paths.size}.media`);
            copyFileSync(source.path, path);
            paths.set(fileId, path);
            return path;
        };
        const aspectRatio = (db.prepare("SELECT aspect_ratio FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow).aspect_ratio;
        const snapshot = { edit: parseJson((db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow).payload, {}), aspectRatio, segments: plan.segments.map((clip) => ({ path: snapshotFile(clip.fileId), trimIn: clip.trimIn, duration: clip.duration })), audio: plan.audio.map((clip) => ({ ...clip, path: snapshotFile(clip.fileId!) })) };
        const payload: RenderPayload = { timelineRevision: plan.timelineRevision, segmentIds: plan.segments.map((clip) => clip.taskId), duration: plan.duration, warnings: plan.audio.length ? [] : ["时间线没有声音，将导出静音 AAC 轨"], snapshot };
        const now = new Date().toISOString();
        db.prepare("INSERT INTO director_renders(id,user_id,project_id,status,payload,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)").run(id, userId, projectId, JSON.stringify(payload), now, now);
        schedule();
        return renderResponse(renderRow(userId, id)!);
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export function cancelDirectorRender(userId: string, id: string) {
    const row = renderRow(userId, id);
    if (!row) throw renderError(404, "DIRECTOR_RENDER_NOT_FOUND", "合成任务不存在");
    if (!["queued", "running"].includes(row.status)) throw renderError(409, "DIRECTOR_RENDER_FINISHED", "合成任务已经结束");
    running.get(id)?.abort();
    updateRender(row, { status: "canceled", error: "用户已取消合成" });
    return renderResponse(renderRow(userId, id)!);
}

export function retryDirectorRender(userId: string, id: string) {
    const row = renderRow(userId, id);
    if (!row) throw renderError(404, "DIRECTOR_RENDER_NOT_FOUND", "合成任务不存在");
    if (!['failed', 'canceled'].includes(row.status)) throw renderError(409, "DIRECTOR_RENDER_ACTIVE", "只有失败或取消的任务可以重试");
    if (!parseJson<RenderPayload>(row.payload, {} as RenderPayload).snapshot) throw renderError(409, "DIRECTOR_RENDER_STALE", "旧合成任务缺少媒体快照，请重新提交");
    db.prepare("UPDATE director_renders SET status='queued',error=NULL,progress=0,updated_at=? WHERE id=? AND user_id=?").run(new Date().toISOString(), id, userId);
    schedule();
    return renderResponse(renderRow(userId, id)!);
}

export function resumeDirectorRenders() {
    db.prepare("UPDATE director_renders SET status='queued',progress=0,updated_at=? WHERE status='running'").run(new Date().toISOString());
    schedule();
}

export async function syncDirectorGeneration(row: GenerationRow) {
    syncDirectorLookFrameGeneration(row);
    if (row.status !== "succeeded") return;
    if (row.kind !== "video") return;
    const request = parseJson<{ metadata?: { directorSegment?: { projectId?: string; segmentId?: string; revision?: number; previsHashes?: Record<string, string>; designHashes?: Record<string, string>; segmentRanges?: unknown; mode?: string; qualityPreset?: H3QualityPreset; promptHash?: string; previousState?: { context: { frames: number } } } } }>(row.request, {});
    const context = request.metadata?.directorSegment;
    if (!context?.projectId || !context.segmentId) return;
    const result = parseJson<{ files?: Array<{ id?: string; fileId?: string }>; continuationStates?: Array<{ fileId?: string }>; cumulativeVideos?: Array<{ fileId?: string }>; execution?: { context?: unknown; recipe?: string } }>(row.result, {});
    const sourceVideoFileId = result.files?.[0]?.id || result.files?.[0]?.fileId;
    const video = sourceVideoFileId ? getStoredFile(row.user_id, sourceVideoFileId) : null;
    if (!video) return;
    const directory = await mkdtemp(join(tmpdir(), "director-frames-"));
    try {
        const first = join(directory, "first.png"); const last = join(directory, "last.png"); const audio = join(directory, "model-original.wav"); const trimmed = join(directory, "trimmed.mp4");
        const shot = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(context.segmentId, row.user_id, context.projectId) as { payload: string; revision: number } | undefined;
        if (!shot) return;
        const currentPayload = parseJson<Record<string, unknown>>(shot.payload, {});
        if (currentPayload.videoGenerationId !== row.id || currentPayload.videoAdoptedGenerationId === row.id) return;
        const stateContext = result.execution?.context ? h3StateContextSchema.parse(result.execution.context) : undefined;
        if (stateContext && (result.continuationStates?.length !== 1 || !result.continuationStates[0]?.fileId)) throw renderError(409, "DIRECTOR_H3_STATE_MISSING", "生成结果缺少唯一的原生续接状态");
        if (stateContext && (result.cumulativeVideos?.length !== 1 || !result.cumulativeVideos[0]?.fileId)) throw renderError(409, "DIRECTOR_H3_CUMULATIVE_MISSING", "生成结果缺少唯一的累计音视频");
        const duration = Number(currentPayload.durationSeconds || 4);
        const renderedDuration = stateContext ? await validateH3NativeVideo(video.path, stateContext, context.previousState?.context.frames ?? 0) : Number((await promisify(execFile)("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "default=nw=1:nk=1", video.path], { timeout: 10000 })).stdout.trim());
        if (!Number.isFinite(renderedDuration) || renderedDuration <= 0) throw new Error("生成视频的实际时长无效，保留原结果");
        await ffmpeg(["-y", "-i", video.path, "-t", String(renderedDuration), "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", trimmed], undefined);
        const storedVideo = storeLocalFile(row.user_id, trimmed, `${context.segmentId}-${context.qualityPreset || "preview"}.mp4`, "video/mp4");
        await ffmpeg(["-y", "-i", trimmed, "-frames:v", "1", first], undefined);
        await ffmpeg(["-y", "-sseof", "-1", "-i", trimmed, "-vf", "reverse", "-frames:v", "1", last], undefined);
        const firstFile = storeLocalFile(row.user_id, first, `${context.segmentId}-first.png`, "image/png");
        const lastFile = storeLocalFile(row.user_id, last, `${context.segmentId}-last.png`, "image/png");
        let nativeAudioFileId = "";
        try { await ffmpeg(["-y", "-i", trimmed, "-vn", "-c:a", "pcm_s16le", audio], undefined); nativeAudioFileId = storeLocalFile(row.user_id, audio, `${context.segmentId}-model-original.wav`, "audio/wav").id; } catch { nativeAudioFileId = ""; }
        if (stateContext && context.previousState) await verifyRequestedH3Continuation(row.user_id, context.previousState, stateContext);
        const continuationState = stateContext ? await createH3ContinuationBinding(row.user_id, { projectId: context.projectId, segmentId: context.segmentId, generationId: row.id, videoFileId: storedVideo.id, fileId: result.continuationStates![0]!.fileId!, context: stateContext }) : undefined;
        const cumulativeVideo = continuationState ? await createH3CumulativeBinding(row.user_id, result.cumulativeVideos![0]!.fileId!, continuationState) : undefined;
        const latestShot = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(context.segmentId, row.user_id, context.projectId) as { payload: string; revision: number } | undefined;
        if (!latestShot) return;
        const latestPayload = parseJson<Record<string, unknown>>(latestShot.payload, {});
        if (latestPayload.videoGenerationId !== row.id || Number(latestPayload.durationSeconds || 4) !== duration) return;
        const generationDurationMs = Math.max(0, new Date(row.updated_at).getTime() - new Date(row.created_at).getTime());
        const inputRequest = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
        const payload = { ...latestPayload, videoInputSnapshot: { mode: context.mode, qualityPreset: context.qualityPreset, prompt: inputRequest.prompt, references: inputRequest.references || [], inputSnapshot: inputRequest.metadata?.inputSnapshot, previsHashes: context.previsHashes, designHashes: context.designHashes, segmentRanges: context.segmentRanges }, h3CumulativeVideo: cumulativeVideo, videoAdoptedGenerationId: row.id, videoDurationSeconds: renderedDuration, h3ContinuationState: continuationState, videoFileId: storedVideo.id, videoGenerationId: row.id, videoQualityPreset: context.qualityPreset || "preview", videoRecipeSnapshot: result.execution, videoNativeResolution: stateContext ? `${stateContext.width}×${stateContext.height}` : undefined, videoGenerationDurationMs: generationDurationMs, actualFirstFrameFileId: firstFile.id, actualLastFrameFileId: lastFile.id, nativeAudioFileId: nativeAudioFileId || undefined, nativeAudioStatus: nativeAudioFileId ? "ready" : "missing", videoStale: Boolean(context.designHashes && JSON.stringify(context.designHashes) !== JSON.stringify(latestPayload.shotDesignHashes)) || Boolean(context.promptHash && readDirectorVideoPrompt(row.user_id, context.projectId, context.segmentId).hash !== context.promptHash) || Object.entries(context.previsHashes || {}).some(([id, hash]) => { try { return readDirectorPrevis(row.user_id, context.projectId!, id).hash !== hash; } catch { return true; } }) };
        const adopted = db.transaction(() => {
            const updated = db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?").run(JSON.stringify(payload), new Date().toISOString(), context.segmentId, row.user_id, latestShot.revision);
            if (!updated.changes) return false;
            syncFileRefs(row.user_id, "director_shot", context.segmentId!, payload);
            markContinuationStale(row.user_id, context.projectId!, context.segmentId!);
            return true;
        })();
        if (!adopted) return;
        syncDirectorVideoSegmentFile(row.user_id, context.projectId!, context.segmentId!);
        if (nativeAudioFileId) {
            const timeline = db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(row.user_id, context.projectId) as { payload: string };
            syncDirectorTimelineFile(row.user_id, context.projectId!, parseJson(timeline.payload, {}));
        }
        emitRender(row.user_id, { type: "video-segment", projectId: context.projectId, data: { id: context.segmentId, revision: latestShot.revision + 1, payload } });
    } finally { await rm(directory, { recursive: true, force: true }); }
}

function schedule() {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => { scheduled = false; pump(); });
}

function pump() {
    if (running.size) return;
    const row = db.prepare("SELECT * FROM director_renders WHERE status='queued' ORDER BY created_at LIMIT 1").get() as RenderRow | undefined;
    if (!row) return;
    const controller = new AbortController(); running.set(row.id, controller); updateRender(row, { status: "running", progress: .01 });
    void runRender(row, controller.signal).catch((error) => {
        const current = renderRow(row.user_id, row.id);
        if (current?.status !== "canceled") updateRender(row, { status: "failed", error: error instanceof Error ? error.message.slice(0, 2_000) : "合成失败" });
    }).finally(() => { running.delete(row.id); schedule(); });
}

async function runRender(row: RenderRow, signal: AbortSignal) {
    const payload = parseJson<RenderPayload>(row.payload, { timelineRevision: 0, segmentIds: [], duration: 0, warnings: [] });
    const snapshot = payload.snapshot;
    if (!snapshot) throw new Error("合成任务缺少提交时媒体快照，请重新提交");
    const directory = await mkdtemp(join(tmpdir(), "director-render-"));
    try {
        const [width, height] = outputSize(snapshot.aspectRatio);
        const normalized: string[] = [];
        for (let index = 0; index < snapshot.segments.length; index++) {
            const clip = snapshot.segments[index];
            const output = join(directory, `clip-${index}.mp4`);
            await ffmpeg(["-y", "-ss", String(clip.trimIn), "-i", clip.path, "-t", String(clip.duration), "-an", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", output], signal);
            normalized.push(output); updateRender(row, { progress: .05 + .55 * ((index + 1) / snapshot.segments.length) });
        }
        const concat = join(directory, "concat.txt"); await writeFile(concat, normalized.map((path) => `file '${path}'`).join("\n"));
        const silentVideo = join(directory, "video.mp4");
        await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", silentVideo], signal);
        updateRender(row, { progress: .7 });
        const output = join(directory, "final.mp4");
        const args = ["-y", "-i", silentVideo];
        const usable: AudioClip[] = [];
        for (const clip of snapshot.audio) {
            if (clip.loop) args.push("-stream_loop", "-1");
            if (clip.trimIn) args.push("-ss", String(clip.trimIn));
            args.push("-t", String(clip.duration), "-i", clip.path); usable.push(clip);
        }
        args.push("-f", "lavfi", "-t", String(payload.duration), "-i", "anullsrc=r=48000:cl=stereo");
        if (usable.length) {
            const filters = usable.map((clip, index) => directorAudioClipFilter(clip, index));
            const inputs = [...usable.map((_, index) => `[a${index}]`), `[${usable.length + 1}:a]`].join("");
            args.push("-filter_complex", `${filters.join(";")};${inputs}amix=inputs=${usable.length + 1}:duration=longest:dropout_transition=0:normalize=0,apad=pad_dur=0.005,alimiter=limit=0.95:level=0:attack=5,atrim=start=0.005,asetpts=PTS-STARTPTS[aout]`, "-map", "0:v:0", "-map", "[aout]");
        } else args.push("-map", "0:v:0", "-map", "1:a:0");
        args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(payload.duration), "-movflags", "+faststart", output);
        await ffmpeg(args, signal, (seconds) => updateRender(row, { progress: .7 + .28 * Math.min(1, seconds / Math.max(1, payload.duration)) }));
        const stored = storeLocalFile(row.user_id, output, `director-${row.project_id}-${row.id}.mp4`, "video/mp4");
        const current = renderRow(row.user_id, row.id); if (!current || current.status === "canceled") return;
        archiveDirectorRender(row.user_id, row.project_id, row.id, output, { timelineRevision: payload.timelineRevision, segmentIds: payload.segmentIds, duration: payload.duration, width, height, fps: 24, timeline: snapshot.edit });
        db.prepare("UPDATE director_renders SET status='succeeded',output_file_id=?,error=NULL,progress=1,updated_at=? WHERE id=? AND user_id=?").run(stored.id, new Date().toISOString(), row.id, row.user_id);
        syncFileRefs(row.user_id, "director_render", row.id, { fileId: stored.id }); publish(renderRow(row.user_id, row.id)!);
    } finally { await rm(directory, { recursive: true, force: true }); }
}

function ffmpeg(args: string[], signal?: AbortSignal, progress?: (seconds: number) => void) {
    return new Promise<void>((resolve, reject) => {
        const command = progress ? [...args.slice(0, -1), "-progress", "pipe:1", "-nostats", args.at(-1)!] : args;
        const child = spawn("ffmpeg", command, { stdio: ["ignore", "pipe", "pipe"] }); let error = ""; let stdout = "";
        child.stderr.on("data", (chunk) => { error = `${error}${chunk}`.slice(-8_000); });
        child.stdout.on("data", (chunk) => { stdout += chunk; const matches = [...stdout.matchAll(/out_time_ms=(\d+)/g)]; if (matches.length) progress?.(Number(matches.at(-1)![1]) / 1_000_000); stdout = stdout.slice(-1_000); });
        const abort = () => child.kill("SIGTERM"); signal?.addEventListener("abort", abort, { once: true });
        child.on("error", reject); child.on("close", (code) => { signal?.removeEventListener("abort", abort); if (signal?.aborted) reject(new Error("合成已取消")); else if (code) reject(new Error(error || `FFmpeg 退出码 ${code}`)); else resolve(); });
    });
}

function markContinuationStale(userId: string, projectId: string, shotId: string, excluded = new Set<string>()) {
    const rows = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    rows.forEach((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        const continuationDepends = payload.boundary === "continue" && (payload.continuationFromSegmentId === shotId || payload.continuationFromShotId === shotId);
        const transitionDepends = payload.generationIntent === "transition" && (payload.transitionFromSegmentId === shotId || payload.transitionToSegmentId === shotId);
        if (!excluded.has(row.id) && (continuationDepends || transitionDepends)) {
            db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...payload, videoStale: true, needsReview: true }), new Date().toISOString(), row.id, userId);
            syncDirectorVideoSegmentFile(userId, projectId, row.id);
        }
    });
}
function validateShotAssetRefs(userId: string, projectId: string, payload: Record<string, unknown>) {
    const refs = [payload.characterRefs, payload.sceneRefs, payload.propRefs].flatMap((value) => Array.isArray(value) ? value : []) as Array<{ id?: string; revision?: number }>;
    for (const reference of refs) {
        const asset = db.prepare("SELECT id FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId);
        if (!asset) throw renderError(409, "DIRECTOR_ASSET_MISSING", "视频段引用的角色、场景或道具已不存在，请重新匹配素材");
    }
}
type FullSegmentRow = ShotRow & { id: string; user_id: string; project_id: string; sequence_id: string; title: string; status: string };
type StyleRow = { id: string; name: string; description: string; reference_files: string; status: string; revision: number };

function segmentRow(userId: string, segmentId: string) {
    const row = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(segmentId, userId) as FullSegmentRow | undefined;
    if (!row) throw renderError(404, "DIRECTOR_VIDEO_SEGMENT_NOT_FOUND", "视频段不存在");
    return row;
}
function activeStyle(userId: string, projectId: string) {
    const project = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as { payload: string } | undefined;
    const styleId = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload || "{}", {}).defaultVisualStyleId || "");
    return styleId ? db.prepare("SELECT * FROM visual_styles WHERE id=? AND user_id=? AND project_id=?").get(styleId, userId, projectId) as StyleRow | undefined : undefined;
}
export function resolveH3Route(payload: Record<string, unknown>) {
    if (payload.generationIntent === "transition") return { mode: "fl2va", reason: "视觉过渡使用前段尾帧与后段首帧生成" } as const;
    return { mode: "ref2va", reason: payload.boundary === "continue" ? "连续任务使用上一任务的运动与原声状态续写" : "按分镜段预演、最终提示词与显式参考输入生成" } as const;
}

function transitionFrame(userId: string, projectId: string, segmentId: string, field: "actualFirstFrameFileId" | "actualLastFrameFileId") {
    if (!segmentId) return "";
    const row = db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(segmentId, userId, projectId) as { payload: string } | undefined;
    const fileId = row ? String(parseJson<Record<string, unknown>>(row.payload, {})[field] || "") : "";
    return fileId && getStoredFile(userId, fileId) ? fileId : "";
}
function transitionBlockedReasons(userId: string, projectId: string, payload: Record<string, unknown>) {
    const from = transitionFrame(userId, projectId, String(payload.transitionFromSegmentId || ""), "actualLastFrameFileId");
    const to = transitionFrame(userId, projectId, String(payload.transitionToSegmentId || ""), "actualFirstFrameFileId");
    return [!from ? "前一视频段缺少实际尾帧" : "", !to ? "后一视频段缺少实际首帧" : ""].filter(Boolean);
}
async function extractContinuationTail(userId: string, segmentId: string, videoFileId: string) {
    const source = getStoredFile(userId, videoFileId);
    if (!source) throw renderError(409, "DIRECTOR_CONTINUATION_VIDEO_MISSING", "上一视频段的实际成片不存在，请先重新生成上一段");
    const directory = await mkdtemp(join(tmpdir(), "director-continuation-"));
    try {
        const output = join(directory, "tail.mp4");
        await ffmpeg(["-y", "-sseof", "-0.92", "-i", source.path, "-map", "0:v:0", "-map", "0:a?", "-frames:v", "22", "-r", "24", "-c:v", "libx264", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
        return storeLocalFile(userId, output, `${segmentId}-continuation-tail.mp4`, "video/mp4").id;
    } finally { await rm(directory, { recursive: true, force: true }); }
}
export function directorSegmentMediaDuration(payload: Record<string, unknown>) {
    return Number((payload.videoFileId && payload.videoDurationSeconds) || payload.durationSeconds || 4);
}
function outputSize(ratio: string): [number, number] { if (ratio === "9:16") return [1080, 1920]; if (ratio === "1:1") return [1080, 1080]; if (ratio === "2.39:1") return [1920, 804]; return [1920, 1080]; }
function updateRender(row: RenderRow, patch: { status?: RenderRow["status"]; progress?: number; error?: string }) { db.prepare("UPDATE director_renders SET status=coalesce(?,status),progress=coalesce(?,progress),error=?,updated_at=? WHERE id=? AND user_id=?").run(patch.status || null, patch.progress ?? null, patch.error || null, new Date().toISOString(), row.id, row.user_id); const next = renderRow(row.user_id, row.id); if (next) publish(next); }
function publish(row: RenderRow) { markDirectorProjectChanged(row.user_id, row.project_id, ["renders"]); const data = renderResponse(row); emitRender(row.user_id, { type: "render", projectId: row.project_id, data }); return data; }
function renderRow(userId: string, id: string) { return db.prepare("SELECT * FROM director_renders WHERE id=? AND user_id=?").get(id, userId) as RenderRow | undefined; }
function renderResponse(row: RenderRow) { return { id: row.id, projectId: row.project_id, status: row.status, payload: (({ snapshot: _snapshot, ...value }) => value)(parseJson<RenderPayload>(row.payload, {} as RenderPayload)), outputFileId: row.output_file_id, ...(row.status === "succeeded" ? { outputPath: `renders/${row.id}/final.mp4`, metadataPath: `renders/${row.id}/render.json` } : {}), error: row.error, progress: row.progress, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assertDirector(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw renderError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在"); }
function renderError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }

export function directorAudioClipFilter(clip: AudioClip, index: number) {
    for (const value of [clip.fadeIn, clip.fadeOut]) if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > clip.duration)) throw new Error("淡入淡出时长必须在声音片段时长范围内");
    const fade = [clip.fadeIn ? `afade=t=in:st=0:d=${clip.fadeIn}` : "", clip.fadeOut ? `afade=t=out:st=${clip.duration - clip.fadeOut}:d=${clip.fadeOut}` : ""].filter(Boolean);
    const delay = Math.max(0, Math.round(clip.start * 1000));
    return `[${index + 1}:a]${[`atrim=0:${clip.duration}`, "asetpts=PTS-STARTPTS", `volume=${clip.volume ?? 1}`, ...fade, "aformat=channel_layouts=stereo", `adelay=${delay}|${delay}`].join(",")}[a${index}]`;
}
