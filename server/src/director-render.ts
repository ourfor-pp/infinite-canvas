import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getStoredFile, storeLocalFile, syncFileRefs } from "./file-store.js";
import type { GenerationRow } from "./generation-service.js";
import { createGeneration } from "./generation-service.js";
import { getAiGlobalSettings, listModelDefaults, resolveSelectableModel, type AiModelDefinition } from "./provider-service.js";
import { getMediaExecutorCatalog } from "./media-executor-settings.js";
import { alignH3Frames, h3Recipe, type H3QualityPreset, type H3TemporalGuide } from "./comfy-workflows.js";
import { compileH3Prompt } from "./h3-prompt.js";
import { recommendedStoryboardFrameCount, storyboardLayout, type DirectorStoryboardLayout } from "./director.js";

type RenderRow = { id: string; user_id: string; project_id: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; payload: string; output_file_id: string | null; error: string | null; progress: number; created_at: string; updated_at: string };
type ShotRow = { id: string; position: number; payload: string; revision: number };
type TimelineRow = { payload: string; revision: number };
type WorkspaceRow = { aspect_ratio: string };
type AudioClip = { id: string; fileId?: string; start: number; duration: number; trimIn?: number; volume?: number; muted?: boolean; loop?: boolean };
type RenderPayload = { timelineRevision: number; segmentIds: string[]; duration: number; warnings: string[] };

const renderInput = z.object({ timelineRevision: z.number().int().positive() });
const shotGenerationInput = z.object({ revision: z.number().int().positive(), mode: z.enum(["fl2va", "ref2va"]).optional(), qualityPreset: z.enum(["preview", "final"]).default("preview"), model: z.string().trim().optional() });
const storyboardGenerationInput = z.object({ revision: z.number().int().positive(), model: z.string().trim().optional() });
const running = new Map<string, AbortController>();
let scheduled = false;
let emitRender: (userId: string, entity: { type: string; projectId: string; data: unknown }) => void = () => undefined;

export function setDirectorRenderEmitter(emitter: typeof emitRender) { emitRender = emitter; }

export async function createDirectorShotGeneration(userId: string, shotId: string, input: unknown) {
    const value = shotGenerationInput.parse(input);
    const shot = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(shotId, userId) as (ShotRow & { project_id: string; status: string; title: string }) | undefined;
    if (!shot) throw renderError(404, "DIRECTOR_VIDEO_SEGMENT_NOT_FOUND", "视频段不存在");
    if (shot.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "视频段已在其他页面更新");
    const payload = parseJson<Record<string, unknown>>(shot.payload, {});
    validateShotAssetRefs(userId, shot.project_id, payload);
    let sheet = asSheet(payload.storyboardSheet);
    if (!sheet?.imageFileId) throw renderError(409, "DIRECTOR_STORYBOARD_REQUIRED", "请先生成当前视频段的整张故事板");
    if (sheet.frames.some((frame) => !frame.croppedFileId)) {
        const source = getStoredFile(userId, sheet.imageFileId);
        if (!source) throw renderError(409, "DIRECTOR_STORYBOARD_FILE_MISSING", "故事板图片不存在，请重新生成整张故事板");
        const crops = await extractStoryboardFrames(userId, shotId, source.path, sheet.layout, sheet.frames.length);
        const alignment = alignH3Frames(Number(payload.durationSeconds || 4));
        sheet = { ...sheet, frames: sheet.frames.map((frame, index) => ({ ...frame, croppedFileId: crops[index], resolvedFrameIndex: Math.min(alignment.trimFrames - 1, Math.max(0, Math.round(frame.timeSeconds * 24))) })), firstFrameFileId: crops[0], lastFrameFileId: crops.at(-1) };
        payload.storyboardSheet = sheet;
        payload.firstFrameFileId = crops[0]; payload.lastFrameFileId = crops.at(-1);
        db.prepare("UPDATE director_shots SET payload=?,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), new Date().toISOString(), shotId, userId);
        syncFileRefs(userId, "director_shot", shotId, payload);
    }
    const workspace = db.prepare("SELECT aspect_ratio FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, shot.project_id) as WorkspaceRow;
    const route = resolveH3Route(payload, sheet, value.mode);
    const modelRef = value.model || `comfyui::minimax-h3-${route.mode}-local`;
    const model = resolveSelectableModel(modelRef, "video").model as AiModelDefinition;
    if (!model.videoModes?.includes(route.mode)) throw renderError(409, "DIRECTOR_H3_MODE_UNSUPPORTED", `所选模型不支持 ${route.mode.toUpperCase()} 模式`);
    const references: Array<{ fileId: string; kind: "image" | "video"; role: "reference" | "first-frame" | "last-frame" | "continuation" }> = [];
    const continuationId = String(payload.continuationFromSegmentId || payload.continuationFromShotId || "");
    const previous = payload.boundary === "continue" && continuationId ? db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(continuationId, userId, shot.project_id) as { payload: string } | undefined : undefined;
    const priorPayload = previous ? parseJson<Record<string, unknown>>(previous.payload, {}) : {};
    const preflight = getDirectorVideoSegmentPreflight(userId, shotId);
    const temporalGuides: H3TemporalGuide[] = [];
    if (preflight.capabilities.temporalGuides) {
        preflight.temporalGuides.forEach((guide) => { references.push({ fileId: guide.fileId, kind: "image", role: "reference" }); temporalGuides.push({ fileId: guide.fileId, frameIndex: guide.frameIndex }); });
        if (payload.boundary === "continue" && priorPayload.videoFileId) {
            const tail = await extractContinuationTail(userId, shotId, String(priorPayload.videoFileId));
            references.push({ fileId: tail, kind: "video", role: "continuation" });
            temporalGuides.splice(0, temporalGuides.length, { fileId: tail, frameIndex: 0, includeAudio: true }, ...temporalGuides.filter((guide) => guide.frameIndex > 0).slice(0, 3));
        }
        if (route.mode === "ref2va") preflight.videoSelected.forEach((item) => references.push({ fileId: item.fileId, kind: "image", role: "reference" }));
    } else if (route.mode === "fl2va") {
        const firstFrame = payload.boundary === "continue" ? priorPayload.actualLastFrameFileId : sheet.firstFrameFileId;
        if (!firstFrame || !sheet.lastFrameFileId) throw renderError(409, "DIRECTOR_STORYBOARD_ANCHORS_PENDING", "故事板首尾锚点尚未准备完成");
        references.push({ fileId: String(firstFrame), kind: "image", role: "first-frame" }, { fileId: String(sheet.lastFrameFileId), kind: "image", role: "last-frame" });
    } else {
        references.push({ fileId: String(sheet.imageFileId), kind: "image", role: "reference" });
        preflight.videoSelected.forEach((item) => references.push({ fileId: item.fileId, kind: "image", role: "reference" }));
        if (payload.boundary === "continue" && priorPayload.videoFileId) references.push({ fileId: String(priorPayload.videoFileId), kind: "video", role: "continuation" });
    }
    const prompt = compileH3Prompt(route.mode, payload, sheet);
    const recipe = h3Recipe(route.mode, value.qualityPreset, preflight.capabilities.turboPreview);
    const alignment = alignH3Frames(Number(payload.durationSeconds || 4));
    const generation = createGeneration(userId, { kind: "video", model: modelRef, prompt, references, params: { seconds: Number(payload.durationSeconds || 4), ratio: workspace.aspect_ratio, resolution: recipe.resolution, qualityPreset: value.qualityPreset, turboAvailable: recipe.turbo, temporalGuides, frameAlignment: alignment, __directorSegment: { projectId: shot.project_id, segmentId: shotId, revision: shot.revision, storyboardRevision: sheet.revision, mode: route.mode, reason: route.reason, qualityPreset: value.qualityPreset, recipe, dependencies: payload.dependencies } } });
    const nextPayload = { ...payload, h3Mode: route.mode, h3ModeOverride: value.mode || payload.h3ModeOverride || null, h3ModeReason: route.reason, h3PromptSnapshot: { mode: route.mode, qualityPreset: value.qualityPreset, recipe, alignment, prompt, references, temporalGuides, storyboardRevision: sheet.revision }, videoGenerationId: generation.id, videoStale: false };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), shotId, userId);
    emitRender(userId, { type: "video-segment", projectId: shot.project_id, data: { id: shotId, revision: shot.revision + 1, payload: nextPayload } });
    return generation;
}

export function getDirectorVideoSegmentPreflight(userId: string, segmentId: string) {
    const segment = segmentRow(userId, segmentId);
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const style = activeStyle(userId, segment.project_id);
    const candidates = segmentReferenceCandidates(userId, segment.project_id, payload, style);
    const selected = candidates.slice(0, 6);
    const sheet = asSheet(payload.storyboardSheet);
    const capabilities = getMediaExecutorCatalog().comfyFeatures;
    const route = resolveH3Route(payload, sheet, undefined);
    const temporalGuides = capabilities.temporalGuides ? resolveTemporalGuides(sheet, Number(payload.durationSeconds || 4)) : [];
    const videoBudget = Math.max(0, 9 - temporalGuides.length - (!capabilities.temporalGuides && route.mode === "ref2va" ? 1 : 0));
    const videoSelected = candidates.slice(0, videoBudget);
    const hasCharacter = selected.some((item) => item.purpose === "主角色" || item.purpose === "出镜角色");
    const hasScene = selected.some((item) => item.purpose === "场景");
    return { selected, omitted: candidates.slice(6), videoSelected, videoOmitted: candidates.slice(videoBudget), temporalGuides, blockedReasons: [!hasCharacter ? "缺少出镜主角色图片" : "", !hasScene ? "缺少场景图片" : ""].filter(Boolean), route, capabilities, recipes: { preview: h3Recipe(route.mode, "preview", capabilities.turboPreview), final: h3Recipe(route.mode, "final", false) }, frameAlignment: alignH3Frames(Number(payload.durationSeconds || 4)) };
}

export function createDirectorStoryboardGeneration(userId: string, segmentId: string, input: unknown) {
    const value = storyboardGenerationInput.parse(input);
    const segment = segmentRow(userId, segmentId);
    if (segment.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "视频段已在其他页面更新");
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const script = db.prepare("SELECT revision,status FROM director_documents WHERE user_id=? AND project_id=? AND kind='script'").get(userId, segment.project_id) as { revision: number; status: string } | undefined;
    if (!script || !["confirmed", "locked"].includes(script.status)) throw renderError(409, "DIRECTOR_STAGE_GATE", "请先确认剧本");
    const style = activeStyle(userId, segment.project_id);
    if (!style || style.status !== "confirmed") throw renderError(409, "DIRECTOR_STAGE_GATE", "请先应用并确认当前视觉风格");
    validateShotAssetRefs(userId, segment.project_id, payload);
    const preflight = getDirectorVideoSegmentPreflight(userId, segmentId);
    if (preflight.blockedReasons.length) throw renderError(409, "DIRECTOR_STORYBOARD_ASSETS_REQUIRED", preflight.blockedReasons.join("；"), preflight);
    const modelRef = value.model || listModelDefaults().image;
    if (!modelRef) throw renderError(409, "AI_MODEL_NOT_CONFIGURED", "管理员尚未配置默认图片模型");
    const model = resolveSelectableModel(modelRef, "image").model as AiModelDefinition;
    if (model.imagePromptProfile !== "gpt-image-2") throw renderError(409, "DIRECTOR_STORYBOARD_MODEL_PROFILE", "当前故事板模型必须配置为 GPT-Image-2 提示档案");
    if ((model.maxReferenceImages || 0) < 6) throw renderError(409, "DIRECTOR_STORYBOARD_MODEL_REFERENCES", "当前 GPT-Image-2 模型需配置最多 6 张参考图");
    const sheet = asSheet(payload.storyboardSheet) || defaultSheet(segment.id, Number(payload.durationSeconds || 4), payload);
    const frameLines = sheet.frames.map((frame, index) => `Panel ${index + 1} | ${frame.timeSeconds}s | Shot ${frame.shotNumber} | ${frame.kind}: ${frame.description}; action: ${frame.action}; camera: ${frame.cameraAngle}, ${frame.cameraMove}; sound intent: ${frame.sound}`).join("\n");
    const prompt = [
        `Create ONE cinematic storyboard sheet for a ${Number(payload.durationSeconds || 4)}-second video segment.`,
        `Use an exact ${storyboardLayoutLabel(sheet.layout)} grid with ${sheet.frames.length} equal panels, thin neutral gutters, and no unused cells. Each panel is a distinct chronological visual beat, not a duplicate angle.`,
        `Segment intent: ${String(payload.description || segment.title)}. Action: ${String(payload.action || "")}. Dialogue meaning only (do not render text): ${String(payload.dialogue || payload.narration || "none")}.`,
        frameLines,
        `Visual style: ${style.description}. Maintain the exact same character identity, costume, props, spatial layout, lighting and color treatment across all panels. Reference images are authoritative. Show clear chronological progress and screen direction.`,
        "Output only the storyboard image. No title, captions, panel numbers, labels, speech bubbles, subtitles, logos, UI, decorative border, split-screen inside panels, duplicated characters, or identity drift.",
    ].filter(Boolean).join("\n\n");
    const references = preflight.selected.map((item) => ({ fileId: item.fileId, kind: "image" as const, role: "reference" as const }));
    const generation = createGeneration(userId, { kind: "image", model: modelRef, prompt, references, params: { count: 1, size: storyboardImageSize(sheet.layout), quality: "high", imagePromptProfile: "gpt-image-2", __directorStoryboardSheet: { projectId: segment.project_id, segmentId, segmentRevision: segment.revision, storyboardRevision: sheet.revision, style: { id: style.id, revision: style.revision }, scriptRevision: script.revision } } });
    const nextSheet = { ...sheet, frames: sheet.frames.map(({ croppedFileId: _cropped, resolvedFrameIndex: _resolved, ...frame }) => frame), generationId: generation.id, imageFileId: undefined, firstFrameFileId: undefined, lastFrameFileId: undefined, promptSnapshot: prompt, referenceSnapshot: preflight, review: { status: "pending", summary: "整张故事板生成中", issues: [] } };
    const nextPayload = { ...payload, storyboardSheet: nextSheet, videoStale: Boolean(payload.videoFileId), dependencies: { documents: { script: script.revision }, style: { id: style.id, revision: style.revision } } };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), segmentId, userId);
    emitRender(userId, { type: "video-segment", projectId: segment.project_id, data: { id: segmentId, revision: segment.revision + 1, payload: nextPayload } });
    return generation;
}

export const createDirectorVideoSegmentGeneration = createDirectorShotGeneration;

export function listDirectorRenders(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    return (db.prepare("SELECT * FROM director_renders WHERE user_id=? AND project_id=? ORDER BY created_at DESC").all(userId, projectId) as RenderRow[]).map(renderResponse);
}

export function createDirectorRender(userId: string, projectId: string, input: unknown) {
    assertDirector(userId, projectId);
    const value = renderInput.parse(input);
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    if (timeline.revision !== value.timelineRevision) throw renderError(409, "DIRECTOR_CONFLICT", "时间线已在其他页面更新");
    const timelinePayload = parseJson<{ segmentOrder?: string[]; tracks?: Array<{ clips?: AudioClip[] }> }>(timeline.payload, {});
    const rows = db.prepare("SELECT id,position,payload,revision FROM director_shots WHERE user_id=? AND project_id=? ORDER BY position").all(userId, projectId) as ShotRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const segmentIds = timelinePayload.segmentOrder?.length ? timelinePayload.segmentOrder : rows.map((row) => row.id);
    const shots = segmentIds.map((id) => byId.get(id)).filter(Boolean) as ShotRow[];
    if (!shots.length) throw renderError(409, "DIRECTOR_RENDER_EMPTY", "时间线还没有视频段");
    const missing = shots.filter((shot) => !parseJson<Record<string, unknown>>(shot.payload, {}).videoFileId);
    if (missing.length) throw renderError(409, "DIRECTOR_RENDER_VIDEO_MISSING", `仍有 ${missing.length} 个视频段缺少视频`, { segmentIds: missing.map((shot) => shot.id) });
    const clips = (timelinePayload.tracks || []).flatMap((track) => track.clips || []).filter((clip) => !clip.muted && clip.fileId);
    const duration = shots.reduce((sum, shot) => sum + Number(parseJson<Record<string, unknown>>(shot.payload, {}).durationSeconds || 4), 0);
    const previews = shots.filter((shot) => parseJson<Record<string, unknown>>(shot.payload, {}).videoQualityPreset !== "final").length;
    const warnings = [...(clips.length ? [] : ["时间线没有声音，将导出静音 AAC 轨"]), ...(previews ? [`时间线包含 ${previews} 个快速预览片段`] : [])];
    const payload: RenderPayload = { timelineRevision: timeline.revision, segmentIds, duration, warnings };
    const id = nanoid(); const now = new Date().toISOString();
    db.prepare("INSERT INTO director_renders(id,user_id,project_id,status,payload,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)").run(id, userId, projectId, JSON.stringify(payload), now, now);
    schedule();
    return renderResponse(renderRow(userId, id)!);
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
    db.prepare("UPDATE director_renders SET status='queued',error=NULL,progress=0,updated_at=? WHERE id=? AND user_id=?").run(new Date().toISOString(), id, userId);
    schedule();
    return renderResponse(renderRow(userId, id)!);
}

export function resumeDirectorRenders() {
    db.prepare("UPDATE director_renders SET status='queued',progress=0,updated_at=? WHERE status='running'").run(new Date().toISOString());
    schedule();
}

export async function syncDirectorGeneration(row: GenerationRow) {
    if (row.status !== "succeeded") return;
    if (row.kind === "image") { await syncStoryboardImage(row); return; }
    if (row.kind === "text") { syncStoryboardReview(row); return; }
    if (row.kind !== "video") return;
    const request = parseJson<{ params?: { __directorSegment?: { projectId?: string; segmentId?: string; revision?: number; storyboardRevision?: number; mode?: string; qualityPreset?: H3QualityPreset; recipe?: ReturnType<typeof h3Recipe> } } }>(row.request, {});
    const context = request.params?.__directorSegment;
    if (!context?.projectId || !context.segmentId) return;
    const result = parseJson<{ files?: Array<{ id?: string; fileId?: string }> }>(row.result, {});
    const sourceVideoFileId = result.files?.[0]?.id || result.files?.[0]?.fileId;
    const video = sourceVideoFileId ? getStoredFile(row.user_id, sourceVideoFileId) : null;
    if (!video) return;
    const directory = await mkdtemp(join(tmpdir(), "director-frames-"));
    try {
        const first = join(directory, "first.png"); const last = join(directory, "last.png"); const audio = join(directory, "model-original.m4a"); const trimmed = join(directory, "trimmed.mp4");
        const shot = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(context.segmentId, row.user_id, context.projectId) as { payload: string; revision: number } | undefined;
        if (!shot) return;
        const currentPayload = parseJson<Record<string, unknown>>(shot.payload, {});
        const duration = Number(currentPayload.durationSeconds || 4);
        await ffmpeg(["-y", "-i", video.path, "-t", String(duration), "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", trimmed], undefined);
        const storedVideo = storeLocalFile(row.user_id, trimmed, `${context.segmentId}-${context.qualityPreset || "preview"}.mp4`, "video/mp4");
        await ffmpeg(["-y", "-i", trimmed, "-frames:v", "1", first], undefined);
        await ffmpeg(["-y", "-sseof", "-0.12", "-i", trimmed, "-frames:v", "1", last], undefined);
        const firstFile = storeLocalFile(row.user_id, first, `${context.segmentId}-first.png`, "image/png");
        const lastFile = storeLocalFile(row.user_id, last, `${context.segmentId}-last.png`, "image/png");
        let nativeAudioFileId = "";
        try { await ffmpeg(["-y", "-i", trimmed, "-vn", "-c:a", "aac", "-b:a", "192k", audio], undefined); nativeAudioFileId = storeLocalFile(row.user_id, audio, `${context.segmentId}-model-original.m4a`, "audio/mp4").id; } catch { nativeAudioFileId = ""; }
        const generationDurationMs = Math.max(0, new Date(row.updated_at).getTime() - new Date(row.created_at).getTime());
        const payload = { ...currentPayload, videoFileId: storedVideo.id, videoGenerationId: row.id, videoQualityPreset: context.qualityPreset || "preview", videoRecipeSnapshot: context.recipe, videoNativeResolution: context.recipe?.resolution || "768p", videoGenerationDurationMs: generationDurationMs, actualFirstFrameFileId: firstFile.id, actualLastFrameFileId: lastFile.id, nativeAudioFileId: nativeAudioFileId || undefined, nativeAudioStatus: nativeAudioFileId ? "ready" : "missing", videoStale: Number(asSheet(currentPayload.storyboardSheet)?.revision || 0) !== Number(context.storyboardRevision || 0) };
        db.transaction(() => {
            db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), new Date().toISOString(), context.segmentId, row.user_id);
            syncFileRefs(row.user_id, "director_shot", context.segmentId!, payload);
            if (nativeAudioFileId) upsertNativeAudioClip(row.user_id, context.projectId!, context.segmentId!, nativeAudioFileId, Number(currentPayload.durationSeconds || 4));
            markContinuationStale(row.user_id, context.projectId!, context.segmentId!);
        })();
        emitRender(row.user_id, { type: "video-segment", projectId: context.projectId, data: { id: context.segmentId, revision: shot.revision + 1, payload } });
    } finally { await rm(directory, { recursive: true, force: true }); }
}

async function syncStoryboardImage(row: GenerationRow) {
    const request = parseJson<{ params?: { __directorStoryboardSheet?: { projectId?: string; segmentId?: string; storyboardRevision?: number }; __directorStoryboardReview?: unknown } }>(row.request, {});
    const context = request.params?.__directorStoryboardSheet;
    if (!context?.projectId || !context.segmentId || request.params?.__directorStoryboardReview) return;
    const result = parseJson<{ files?: Array<{ id?: string; fileId?: string }> }>(row.result, {});
    const fileId = String(result.files?.[0]?.fileId || result.files?.[0]?.id || "");
    if (!fileId) return;
    const segment = segmentRow(row.user_id, context.segmentId);
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const sheet = asSheet(payload.storyboardSheet);
    if (!sheet || sheet.generationId !== row.id || sheet.revision !== context.storyboardRevision) return;
    const source = getStoredFile(row.user_id, fileId);
    if (!source) return;
    const crops = await extractStoryboardFrames(row.user_id, segment.id, source.path, sheet.layout, sheet.frames.length);
    const alignment = alignH3Frames(Number(payload.durationSeconds || 4));
    const frames = sheet.frames.map((frame, index) => ({ ...frame, croppedFileId: crops[index], resolvedFrameIndex: Math.min(alignment.trimFrames - 1, Math.max(0, Math.round(frame.timeSeconds * 24))) }));
    const nextSheet = { ...sheet, frames, imageFileId: fileId, firstFrameFileId: crops[0], lastFrameFileId: crops.at(-1), review: { status: "pending", summary: "正在检查宫格、素材与连续性", issues: [] } };
    const nextPayload = { ...payload, storyboardSheet: nextSheet, firstFrameFileId: crops[0], lastFrameFileId: crops.at(-1) };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), segment.id, row.user_id);
    syncFileRefs(row.user_id, "director_shot", segment.id, nextPayload);
    emitRender(row.user_id, { type: "video-segment", projectId: context.projectId, data: { id: segment.id, revision: segment.revision + 1, payload: nextPayload } });
    const model = getAiGlobalSettings().config.creativeAssetReviewModel;
    if (!model) {
        nextSheet.review = { status: "manual", summary: "未配置视觉质检模型，请人工检查", issues: [] };
        const manualPayload = { ...nextPayload, storyboardSheet: nextSheet };
        db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(manualPayload), new Date().toISOString(), segment.id, row.user_id);
        emitRender(row.user_id, { type: "video-segment", projectId: context.projectId, data: { id: segment.id, revision: segment.revision + 2, payload: manualPayload } });
        return;
    }
    const references = [{ fileId, kind: "image" as const }, ...getDirectorVideoSegmentPreflight(row.user_id, segment.id).selected.map((item) => ({ fileId: item.fileId, kind: "image" as const }))];
    createGeneration(row.user_id, { kind: "text", model, prompt: `你是长视频多宫格故事板视觉质检员。检查第一张图是否是严格 ${sheet.layout}、共 ${sheet.frames.length} 格的单张故事板；检查人物身份、服装、场景、关键道具、光线和风格是否匹配后续参考图，画格是否按时间推进，是否有意外文字、气泡、Logo、身份漂移或空间连续性错误。只输出 JSON：{"passed":boolean,"summary":string,"issues":string[],"metrics":{"panelCount":number,"identityConsistent":boolean,"assetMatch":boolean,"temporalProgression":boolean,"noUnexpectedText":boolean,"styleConsistent":boolean}}。`, references, params: { __directorStoryboardReview: { projectId: context.projectId, segmentId: segment.id, storyboardRevision: sheet.revision, sourceGenerationId: row.id, fileId } } });
}

function syncStoryboardReview(row: GenerationRow) {
    const request = parseJson<{ params?: { __directorStoryboardReview?: { projectId?: string; segmentId?: string; storyboardRevision?: number; sourceGenerationId?: string; fileId?: string } } }>(row.request, {});
    const context = request.params?.__directorStoryboardReview;
    if (!context?.projectId || !context.segmentId || !context.sourceGenerationId || !context.fileId) return;
    const segment = segmentRow(row.user_id, context.segmentId);
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const sheet = asSheet(payload.storyboardSheet);
    if (!sheet || sheet.generationId !== context.sourceGenerationId || sheet.imageFileId !== context.fileId || sheet.revision !== context.storyboardRevision) return;
    const parsed = parseVisualReview(String(parseJson<{ text?: string }>(row.result, {}).text || ""));
    sheet.review = parsed ? { status: parsed.passed ? "passed" : "failed", summary: parsed.summary, issues: parsed.issues, metrics: parsed.metrics, generationId: row.id } : { status: "manual", summary: "自动质检结果无法解析，请人工检查", issues: [], generationId: row.id };
    const nextPayload = { ...payload, storyboardSheet: sheet };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), segment.id, row.user_id);
    emitRender(row.user_id, { type: "video-segment", projectId: context.projectId, data: { id: segment.id, revision: segment.revision + 1, payload: nextPayload } });
}

function parseVisualReview(value: string) {
    try { return z.object({ passed: z.boolean(), summary: z.string().max(2_000), issues: z.array(z.string().max(500)).max(50).default([]), metrics: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).default({}) }).parse(JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))); }
    catch { return null; }
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
    const workspace = db.prepare("SELECT aspect_ratio FROM director_workspaces WHERE user_id=? AND project_id=?").get(row.user_id, row.project_id) as WorkspaceRow;
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(row.user_id, row.project_id) as TimelineRow;
    const payload = parseJson<RenderPayload>(row.payload, { timelineRevision: 0, segmentIds: [], duration: 0, warnings: [] });
    if (timeline.revision !== payload.timelineRevision) throw renderError(409, "DIRECTOR_RENDER_STALE", "时间线已变化，请创建新的合成任务");
    const shots = payload.segmentIds.map((id) => db.prepare("SELECT id,position,payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(id, row.user_id, row.project_id) as ShotRow | undefined).filter(Boolean) as ShotRow[];
    const timelinePayload = parseJson<{ tracks?: Array<{ clips?: AudioClip[] }> }>(timeline.payload, {});
    const directory = await mkdtemp(join(tmpdir(), "director-render-"));
    try {
        const [width, height] = outputSize(workspace.aspect_ratio);
        const normalized: string[] = [];
        for (let index = 0; index < shots.length; index += 1) {
            const shot = parseJson<Record<string, unknown>>(shots[index].payload, {});
            const source = getStoredFile(row.user_id, String(shot.videoFileId || ""));
            if (!source) throw new Error(`视频段 ${shots[index].id} 的视频文件不存在`);
            const output = join(directory, `shot-${String(index).padStart(4, "0")}.mp4`);
            await ffmpeg(["-y", "-i", source.path, "-t", String(Number(shot.durationSeconds || 4)), "-an", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", output], signal);
            normalized.push(output); updateRender(row, { progress: .05 + .55 * ((index + 1) / shots.length) });
        }
        const concat = join(directory, "concat.txt"); await writeFile(concat, normalized.map((path) => `file '${path}'`).join("\n"));
        const silentVideo = join(directory, "video.mp4");
        await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", silentVideo], signal);
        updateRender(row, { progress: .7 });
        const output = join(directory, "final.mp4");
        const clips = (timelinePayload.tracks || []).flatMap((track) => track.clips || []).filter((clip) => !clip.muted && clip.fileId);
        const args = ["-y", "-i", silentVideo];
        const usable: AudioClip[] = [];
        for (const clip of clips) {
            const file = getStoredFile(row.user_id, clip.fileId!); if (!file) continue;
            if (clip.loop) args.push("-stream_loop", "-1");
            if (clip.trimIn) args.push("-ss", String(clip.trimIn));
            args.push("-t", String(clip.duration), "-i", file.path); usable.push(clip);
        }
        args.push("-f", "lavfi", "-t", String(payload.duration), "-i", "anullsrc=r=48000:cl=stereo");
        if (usable.length) {
            const filters = usable.map((clip, index) => `[${index + 1}:a]atrim=0:${clip.duration},asetpts=PTS-STARTPTS,volume=${clip.volume ?? 1},adelay=${Math.max(0, Math.round(clip.start * 1000))}|${Math.max(0, Math.round(clip.start * 1000))}[a${index}]`);
            const inputs = [...usable.map((_, index) => `[a${index}]`), `[${usable.length + 1}:a]`].join("");
            args.push("-filter_complex", `${filters.join(";")};${inputs}amix=inputs=${usable.length + 1}:duration=longest:dropout_transition=0[aout]`, "-map", "0:v:0", "-map", "[aout]");
        } else args.push("-map", "0:v:0", "-map", "1:a:0");
        args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(payload.duration), "-movflags", "+faststart", output);
        await ffmpeg(args, signal, (seconds) => updateRender(row, { progress: .7 + .28 * Math.min(1, seconds / Math.max(1, payload.duration)) }));
        const stored = storeLocalFile(row.user_id, output, `director-${row.project_id}-${row.id}.mp4`, "video/mp4");
        const current = renderRow(row.user_id, row.id); if (!current || current.status === "canceled") return;
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

function markContinuationStale(userId: string, projectId: string, shotId: string) {
    const rows = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    rows.forEach((row) => { const payload = parseJson<Record<string, unknown>>(row.payload, {}); if (payload.boundary === "continue" && (payload.continuationFromSegmentId === shotId || payload.continuationFromShotId === shotId)) db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...payload, videoStale: true, needsReview: true }), new Date().toISOString(), row.id, userId); });
}
function validateShotAssetRefs(userId: string, projectId: string, payload: Record<string, unknown>) {
    const refs = [payload.characterRefs, payload.sceneRefs, payload.propRefs].flatMap((value) => Array.isArray(value) ? value : []) as Array<{ id?: string; revision?: number }>;
    for (const reference of refs) {
        const asset = db.prepare("SELECT id FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId);
        if (!asset) throw renderError(409, "DIRECTOR_ASSET_MISSING", "视频段引用的角色、场景或道具已不存在，请重新匹配素材");
    }
}
type StoryboardFrame = { id: string; position: number; shotNumber: number; timeSeconds: number; kind: "shot-start" | "keyframe" | "shot-end"; description: string; action: string; cameraAngle: string; cameraMove: string; sound: string; guideEnabled?: boolean; guideStrength?: "hard" | "semantic"; croppedFileId?: string; resolvedFrameIndex?: number };
type StoryboardSheet = { revision: number; layout: DirectorStoryboardLayout; frames: StoryboardFrame[]; imageFileId?: string; firstFrameFileId?: string; lastFrameFileId?: string; generationId?: string; promptSnapshot?: string; referenceSnapshot?: unknown; review?: Record<string, unknown> };
type FullSegmentRow = ShotRow & { id: string; user_id: string; project_id: string; sequence_id: string; title: string; status: string };
type StyleRow = { id: string; name: string; description: string; reference_files: string; status: string; revision: number };

function segmentRow(userId: string, segmentId: string) {
    const row = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(segmentId, userId) as FullSegmentRow | undefined;
    if (!row) throw renderError(404, "DIRECTOR_VIDEO_SEGMENT_NOT_FOUND", "视频段不存在");
    return row;
}
function asSheet(value: unknown): StoryboardSheet | undefined {
    if (!value || typeof value !== "object") return undefined;
    const sheet = value as StoryboardSheet;
    return Array.isArray(sheet.frames) ? { ...sheet, revision: Math.max(1, Number(sheet.revision) || 1), layout: storyboardLayout(sheet.frames.length), frames: sheet.frames.map((frame, index) => ({ ...frame, guideEnabled: frame.guideEnabled ?? defaultGuideIndex(index, sheet.frames.length), guideStrength: frame.guideStrength === "semantic" ? "semantic" : "hard" })) } : undefined;
}
function defaultSheet(segmentId: string, duration: number, payload: Record<string, unknown>): StoryboardSheet {
    const requested = Number(payload.storyboardFrameCount); const frameCount = [4, 6, 9].includes(requested) ? requested : recommendedStoryboardFrameCount(duration);
    return { revision: 1, layout: storyboardLayout(frameCount), frames: Array.from({ length: frameCount }, (_, position) => ({ id: `${segmentId}-frame-${position + 1}`, position, shotNumber: 1, timeSeconds: Number((duration * position / Math.max(1, frameCount - 1)).toFixed(2)), kind: position === 0 ? "shot-start" : position === frameCount - 1 ? "shot-end" : "keyframe", description: String(payload.description || ""), action: String(payload.action || ""), cameraAngle: String(payload.cameraAngle || ""), cameraMove: String(payload.cameraMove || ""), sound: String(payload.sound || ""), guideEnabled: defaultGuideIndex(position, frameCount), guideStrength: "hard" })) };
}
function defaultGuideIndex(index: number, length: number) {
    const guides = new Set([0, length - 1, Math.round((length - 1) / 3), Math.round((length - 1) * 2 / 3)]);
    return guides.has(index);
}
function resolveTemporalGuides(sheet: StoryboardSheet | undefined, duration: number) {
    if (!sheet) return [];
    const alignment = alignH3Frames(duration);
    return sheet.frames.filter((frame) => frame.guideEnabled && frame.croppedFileId).slice(0, 4).map((frame) => ({
        frameId: frame.id,
        fileId: frame.croppedFileId!,
        timeSeconds: frame.timeSeconds,
        frameIndex: Math.min(alignment.trimFrames - 1, Math.max(0, Math.round(frame.timeSeconds * 24))),
        strength: frame.guideStrength || "hard",
    }));
}
function activeStyle(userId: string, projectId: string) {
    const project = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as { payload: string } | undefined;
    const styleId = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload || "{}", {}).defaultVisualStyleId || "");
    return styleId ? db.prepare("SELECT * FROM visual_styles WHERE id=? AND user_id=? AND project_id=?").get(styleId, userId, projectId) as StyleRow | undefined : undefined;
}
function segmentReferenceCandidates(userId: string, projectId: string, payload: Record<string, unknown>, style?: StyleRow) {
    const refs = (value: unknown) => Array.isArray(value) ? value as Array<{ id?: string }> : [];
    const candidates: Array<{ fileId: string; name: string; purpose: "主角色" | "出镜角色" | "场景" | "关键道具" | "视觉风格"; assetId?: string }> = [];
    const append = (reference: { id?: string }, purpose: typeof candidates[number]["purpose"]) => {
        const row = db.prepare("SELECT id,name,payload FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId) as { id: string; name: string; payload: string } | undefined;
        const asset = parseJson<{ primaryImageId?: string; variants?: Array<{ id?: string; fileId?: string; kind?: string }> }>(row?.payload || "{}", {});
        const fileId = asset.variants?.find((variant) => variant.id === asset.primaryImageId && variant.kind === "image")?.fileId || asset.variants?.find((variant) => variant.kind === "image")?.fileId;
        if (row && fileId) candidates.push({ fileId, name: row.name, purpose, assetId: row.id });
    };
    refs(payload.characterRefs).forEach((reference, index) => append(reference, index ? "出镜角色" : "主角色"));
    refs(payload.sceneRefs).forEach((reference) => append(reference, "场景"));
    refs(payload.propRefs).forEach((reference) => append(reference, "关键道具"));
    if (style) {
        const files = parseJson<Record<string, string>>(style.reference_files, {});
        const fileId = files.scene || files.source || files.character || files.prop;
        if (fileId) candidates.push({ fileId, name: style.name, purpose: "视觉风格" });
    }
    return Array.from(new Map(candidates.map((item) => [item.fileId, item])).values());
}
function resolveH3Route(payload: Record<string, unknown>, sheet: StoryboardSheet | undefined, override?: "fl2va" | "ref2va") {
    const manual = override || (payload.h3ModeOverride === "fl2va" || payload.h3ModeOverride === "ref2va" ? payload.h3ModeOverride : undefined);
    if (manual) return { mode: manual, reason: "用户手动选择" } as const;
    if (payload.boundary === "continue") return { mode: "fl2va", reason: "连续边界需要使用上一段实际尾帧精确续接" } as const;
    const shots = new Set((sheet?.frames || []).map((frame) => frame.shotNumber)).size;
    if (shots > 1) return { mode: "ref2va", reason: `故事板包含 ${shots} 个内部切镜，使用整板语义控制` } as const;
    if (Array.isArray(payload.referenceVideoFileIds) && payload.referenceVideoFileIds.length || Array.isArray(payload.referenceAudioFileIds) && payload.referenceAudioFileIds.length) return { mode: "ref2va", reason: "包含参考视频或参考音频" } as const;
    return { mode: "fl2va", reason: "单镜头视频段使用首尾帧精确锚定" } as const;
}
function storyboardLayoutLabel(layout: DirectorStoryboardLayout) { return layout === "3x3" ? "3 columns by 3 rows" : layout === "3x2" ? "3 columns by 2 rows" : "2 columns by 2 rows"; }
function storyboardImageSize(layout: DirectorStoryboardLayout) { return layout === "3x3" ? "2304x1296" : layout === "3x2" ? "2304x864" : "2048x1152"; }
async function extractStoryboardFrames(userId: string, segmentId: string, source: string, layout: DirectorStoryboardLayout, frameCount: number) {
    const directory = await mkdtemp(join(tmpdir(), "director-storyboard-"));
    try {
        const columns = layout === "2x2" ? 2 : 3; const rows = layout === "3x3" ? 3 : 2;
        const normalize = "scale=1344:768:force_original_aspect_ratio=increase,crop=1344:768";
        const insetX = `iw/${columns}*0.02`; const insetY = `ih/${rows}*0.02`;
        const cell = `iw/${columns}*0.96:ih/${rows}*0.96`;
        const result: string[] = [];
        for (let index = 0; index < Math.min(frameCount, columns * rows); index += 1) {
            const output = join(directory, `frame-${index + 1}.png`); const column = index % columns; const row = Math.floor(index / columns);
            await ffmpeg(["-y", "-i", source, "-vf", `crop=${cell}:iw/${columns}*${column}+${insetX}:ih/${rows}*${row}+${insetY},${normalize}`, "-frames:v", "1", output]);
            result.push(storeLocalFile(userId, output, `${segmentId}-storyboard-${index + 1}.png`, "image/png").id);
        }
        return result;
    } finally { await rm(directory, { recursive: true, force: true }); }
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
function upsertNativeAudioClip(userId: string, projectId: string, segmentId: string, fileId: string, duration: number) {
    const row = db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string };
    const payload = parseJson<{ segmentOrder?: string[]; tracks?: Array<{ id: string; kind: string; clips: Array<Record<string, unknown>> }> }>(row.payload, {});
    const order = payload.segmentOrder || [];
    const segments = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const byId = new Map(segments.map((item) => [item.id, item]));
    const start = order.slice(0, Math.max(0, order.indexOf(segmentId))).reduce((sum, id) => sum + Number(parseJson<Record<string, unknown>>(byId.get(id)?.payload || "{}", {}).durationSeconds || 4), 0);
    const tracks = payload.tracks || []; let track = tracks.find((item) => item.id === "model-original");
    if (!track) { track = { id: "model-original", kind: "model-original", clips: [] }; tracks.push(track); }
    track.clips = [...track.clips.filter((clip) => clip.segmentId !== segmentId), { id: `model-original-${segmentId}`, segmentId, fileId, start, duration, volume: 1, muted: false }];
    db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=?").run(JSON.stringify({ ...payload, tracks }), new Date().toISOString(), userId, projectId);
}
function outputSize(ratio: string): [number, number] { if (ratio === "9:16") return [1080, 1920]; if (ratio === "1:1") return [1080, 1080]; if (ratio === "2.39:1") return [1920, 804]; return [1920, 1080]; }
function updateRender(row: RenderRow, patch: { status?: RenderRow["status"]; progress?: number; error?: string }) { db.prepare("UPDATE director_renders SET status=coalesce(?,status),progress=coalesce(?,progress),error=?,updated_at=? WHERE id=? AND user_id=?").run(patch.status || null, patch.progress ?? null, patch.error || null, new Date().toISOString(), row.id, row.user_id); const next = renderRow(row.user_id, row.id); if (next) publish(next); }
function publish(row: RenderRow) { const data = renderResponse(row); emitRender(row.user_id, { type: "render", projectId: row.project_id, data }); return data; }
function renderRow(userId: string, id: string) { return db.prepare("SELECT * FROM director_renders WHERE id=? AND user_id=?").get(id, userId) as RenderRow | undefined; }
function renderResponse(row: RenderRow) { return { id: row.id, projectId: row.project_id, status: row.status, payload: parseJson(row.payload, {}), outputFileId: row.output_file_id, error: row.error, progress: row.progress, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assertDirector(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw renderError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在"); }
function renderError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }
