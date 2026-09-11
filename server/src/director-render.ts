import { markDirectorProjectChanged } from "./director-sync.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { alignH3Frames, h3Recipe, h3ContinuationFrames, h3VideoDimensions, selectH3Acceleration, type H3Acceleration, type H3QualityPreset, type H3TemporalGuide } from "./comfy-workflows.js";
import { compileH3Prompt, compileH3NativeContinuationPrompt, h3AudioPromptReferences, h3AudioReferencesInput, isH3TurboAudioSafe, validateH3PromptPlan, validateStoryboardNarrativePlan, type H3DialogueCue, type H3ReferenceDefinition } from "./h3-prompt.js";
import { createH3ContinuationBinding, createH3CumulativeBinding, h3StateContextSchema, validateH3NativeVideo, resolveDirectorH3Continuation, resolveDirectorH3Cumulative, verifyRequestedH3Continuation, isSameH3OwnedMedia } from "./h3-continuation.js";
import { planH3CumulativeSources } from "./h3-media-plan.js";
import { recommendedStoryboardFrameCount, storyboardLayout, type DirectorStoryboardLayout } from "./director.js";
import { archiveDirectorRender, assertDirectorProjectValid, getDirectorAssetReferenceImage, syncDirectorVideoSegmentFile, syncDirectorTimelineFile } from "./director-workspace.js";

type RenderRow = { id: string; user_id: string; project_id: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; payload: string; output_file_id: string | null; error: string | null; progress: number; created_at: string; updated_at: string };
type ShotRow = { id: string; position: number; payload: string; revision: number };
type TimelineRow = { payload: string; revision: number };
type WorkspaceRow = { aspect_ratio: string; directing_rules: string; revision: number };
type AudioClip = { id: string; segmentId?: string; fileId?: string; start: number; duration: number; trimIn?: number; volume?: number; muted?: boolean; loop?: boolean };
type RenderPayload = { timelineRevision: number; segmentIds: string[]; duration: number; warnings: string[] };

const renderInput = z.object({ timelineRevision: z.number().int().positive() });
const shotGenerationInput = z.object({ revision: z.number().int().positive(), qualityPreset: z.enum(["preview", "final"]).default("preview"), recipe: z.enum(["base", "pdd-ref8"]).optional(), model: z.string().trim().optional() });
const storyboardGenerationInput = z.object({ revision: z.number().int().positive(), model: z.string().trim().optional() });
const dialogueCueInput = z.object({ speakerAssetId: z.string().min(1), speakerName: z.string().min(1).max(120), text: z.string().min(1).max(2_000), language: z.string().min(1).max(40).default("Chinese"), delivery: z.string().min(1).max(1_000), startSeconds: z.number().min(0).max(15), endSeconds: z.number().positive().max(15), offScreen: z.boolean().optional() });
const storyboardPromptFrameInput = z.object({ id: z.string().min(1), shotNumber: z.number().int().min(1).max(3), timeSeconds: z.number().min(0).max(15), kind: z.enum(["shot-start", "keyframe", "shot-end"]), description: z.string().max(4_000), action: z.string().max(4_000), cameraAngle: z.string().max(1_000), cameraMove: z.string().max(1_000), h3Visual: z.string().min(1).max(6_000), dialogues: z.array(dialogueCueInput).max(8).default([]), sound: z.string().max(2_000), dialogue: z.never().optional() });
const storyboardPromptUpdateInput = z.object({ items: z.array(z.object({ segmentId: z.string().min(1), revision: z.number().int().positive(), frames: z.array(storyboardPromptFrameInput).min(1).max(9) })).min(1).max(10) });
const running = new Map<string, AbortController>();
let scheduled = false;
let emitRender: (userId: string, entity: { type: string; projectId: string; data: unknown }) => void = () => undefined;

export function setDirectorRenderEmitter(emitter: typeof emitRender) { emitRender = emitter; }

export async function createDirectorShotGeneration(userId: string, shotId: string, input: unknown) {
    const value = shotGenerationInput.parse(input);
    const shot = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(shotId, userId) as (ShotRow & { project_id: string; status: string; title: string }) | undefined;
    if (!shot) throw renderError(404, "DIRECTOR_VIDEO_SEGMENT_NOT_FOUND", "视频段不存在");
    assertDirectorProjectValid(userId, shot.project_id);
    if (shot.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "视频段已在其他页面更新");
    const payload = parseJson<Record<string, unknown>>(shot.payload, {});
    validateShotAssetRefs(userId, shot.project_id, payload);
    const sheet = asSheet(payload.storyboardSheet) || defaultSheet(shotId, Number(payload.durationSeconds || 4), payload);
    const route = resolveH3Route(payload, sheet);
    if (route.mode === "ref2va" && !sheet.imageFileId) throw renderError(409, "DIRECTOR_STORYBOARD_REQUIRED", "请先生成当前视频段的整张故事板");
    if (route.mode === "ref2va" && payload.storyboardStale) throw renderError(409, "DIRECTOR_STORYBOARD_STALE", "故事板提示词已经修改，请先重新生成整张故事板");
    if (route.mode === "ref2va" && !getStoredFile(userId, sheet.imageFileId!)) throw renderError(409, "DIRECTOR_STORYBOARD_FILE_MISSING", "故事板图片不存在，请重新生成整张故事板");
    const workspace = db.prepare("SELECT aspect_ratio FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, shot.project_id) as WorkspaceRow;
    const modelRef = value.model || `comfyui::minimax-h3-${route.mode}-local`;
    const selection = resolveSelectableModel(modelRef, "video");
    const model = selection.model as AiModelDefinition;
    if (!model.videoModes?.includes(route.mode)) throw renderError(409, "DIRECTOR_H3_MODE_UNSUPPORTED", `所选模型不支持 ${route.mode.toUpperCase()} 模式`);
    const nativeExecutor = route.mode === "ref2va" && modelRef === "comfyui::minimax-h3-ref2va-local" && selection.comfyServerId === "media-executor";
    const acceleration = directorH3Acceleration(userId, shot.project_id, payload, route.mode, value.recipe, nativeExecutor);
    const nativeRuntime = nativeExecutor ? (acceleration === "pdd-ref8" ? getMediaExecutorCatalog().h3PddRuntime : getMediaExecutorCatalog().h3Runtime) : undefined;
    if (nativeExecutor && getMediaExecutorCatalog().comfyFeatures.nativeState && !nativeRuntime) throw renderError(409, "DIRECTOR_H3_RUNTIME_NOT_READY", "原生续接运行时指纹尚未就绪，请等待校验完成后重试");
    const nativeContinuation = Boolean(nativeRuntime && payload.boundary === "continue");
    const routeReason = nativeContinuation ? "加载前段原生双流状态，隐藏重叠参与生成，仅输出新增音视频" : route.reason;
    const references: Array<{ fileId: string; kind: "image" | "video" | "audio"; role: "reference" | "first-frame" | "last-frame" | "continuation" }> = [];
    const continuationId = String(payload.continuationFromSegmentId || payload.continuationFromShotId || "");
    const previous = payload.boundary === "continue" && continuationId ? db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(continuationId, userId, shot.project_id) as { payload: string } | undefined : undefined;
    const priorPayload = previous ? parseJson<Record<string, unknown>>(previous.payload, {}) : {};
    if (priorPayload.h3ContinuationState && !nativeRuntime) throw renderError(409, "DIRECTOR_H3_NATIVE_UNAVAILABLE", "前段采用原生续接状态，当前运行时或模型不支持，不能降级为普通视频参考");
    const preflight = getDirectorVideoSegmentPreflight(userId, shotId, Boolean(model.supportsTemporalGuides), Boolean(nativeRuntime), acceleration);
    if (preflight.blockedReasons.length) throw renderError(409, "DIRECTOR_H3_PROMPT_INVALID", preflight.blockedReasons.join("；"), preflight);
    const temporalGuides: H3TemporalGuide[] = [];
    if (route.mode === "ref2va") {
        references.push({ fileId: String(sheet.imageFileId), kind: "image", role: "reference" });
        preflight.videoSelected.forEach((item) => references.push({ fileId: item.fileId, kind: "image", role: "reference" }));
        if (payload.boundary === "continue" && !nativeContinuation) {
            if (!priorPayload.videoFileId) throw renderError(409, "DIRECTOR_CONTINUATION_VIDEO_MISSING", "连续视频段需要先生成上一段视频");
            references.push({ fileId: await extractContinuationTail(userId, shotId, String(priorPayload.videoFileId)), kind: "video", role: "continuation" });
        }
        h3AudioReferencesInput.parse(payload.audioReferences).forEach(({ fileId }) => references.push({ fileId, kind: "audio", role: "reference" }));
        if (preflight.storyboardStartGuide) {
            const fileId = await extractStoryboardStartGuide(userId, shotId, String(sheet.imageFileId), sheet.layout);
            references.push({ fileId, kind: "image", role: "reference" });
            temporalGuides.push({ fileId, frameIndex: 0 });
        }
    } else {
        const firstFrame = transitionFrame(userId, shot.project_id, String(payload.transitionFromSegmentId || ""), "actualLastFrameFileId");
        const lastFrame = transitionFrame(userId, shot.project_id, String(payload.transitionToSegmentId || ""), "actualFirstFrameFileId");
        if (!firstFrame || !lastFrame) throw renderError(409, "DIRECTOR_TRANSITION_FRAMES_REQUIRED", "首尾帧生成仅用于已准备好前后画面的连续镜头或视觉过渡");
        references.push({ fileId: firstFrame, kind: "image", role: "first-frame" }, { fileId: lastFrame, kind: "image", role: "last-frame" });
    }
    let subjectNumber = 0;
    const promptReferences: H3ReferenceDefinition[] = route.mode === "ref2va" ? [
        { tag: "<Picture 1>", purpose: "is the complete storyboard sheet; read panels left to right and top to bottom and use it only as the authoritative chronological Shot plan" },
        ...preflight.videoSelected.map((item, index) => {
            const subjectKind = item.purpose === "主角色" || item.purpose === "出镜角色" ? "character" : item.purpose === "场景" ? "scene" : item.purpose === "关键道具" ? "prop" : undefined;
            return { tag: `<Picture ${index + 2}>`, purpose: referencePurpose(item.purpose), assetId: item.assetId, subjectKind, subjectTag: subjectKind ? `<Subject ${++subjectNumber}>` : undefined } satisfies H3ReferenceDefinition;
        }),
        ...(payload.boundary === "continue" && !nativeContinuation ? [{ tag: "<Video 1>", purpose: "is the previous segment's final 22 frames; continue its motion from frame zero" }] : []),
        ...h3AudioPromptReferences(payload.audioReferences, payload.boundary === "continue" && !nativeContinuation),
    ] : [];
    const extensionFrames = nativeContinuation ? h3ContinuationFrames(Number(payload.durationSeconds || 4)) : 0;
    const prompt = nativeContinuation ? compileH3NativeContinuationPrompt(payload, sheet, promptReferences, extensionFrames) : compileH3Prompt(route.mode, payload, sheet, promptReferences);
    const turboEligible = isH3TurboAudioSafe(payload, sheet);
    const recipe = h3Recipe(route.mode, value.qualityPreset, Boolean(model.turboPreview) && turboEligible, acceleration);
    const alignment = alignH3Frames(Number(payload.durationSeconds || 4));
    const dimensions = h3VideoDimensions({ ratio: workspace.aspect_ratio, resolution: recipe.resolution });
    const previousState = nativeContinuation ? await resolveDirectorH3Continuation(userId, shot.project_id, continuationId, { ...nativeRuntime!, ...dimensions, fps: 24 }) : undefined;
    const stateContext = nativeRuntime ? h3StateContextSchema.parse({ schemaVersion: 1, fps: 24, modelRevision: nativeRuntime.modelRevision, videoVaeRevision: nativeRuntime.videoVaeRevision, audioVaeRevision: nativeRuntime.audioVaeRevision, ...dimensions, frames: previousState ? previousState.context.frames + extensionFrames : alignment.modelFrames, sourceId: `${shot.project_id}/${shotId}/${nanoid()}` }) : undefined;
    const stateParams = stateContext ? { __h3StateContext: stateContext, __h3PreviousFrames: previousState?.context.frames || 0, ...(previousState ? { __h3PreviousState: previousState } : {}) } : {};

    if (stateContext && resolveSelectableModel(modelRef, "video").comfyServerId !== selection.comfyServerId) throw renderError(409, "DIRECTOR_H3_RUNTIME_CHANGED", "生成节点已变化，请重新提交");
    const generation = createGeneration(userId, { kind: "video", model: modelRef, prompt, references, params: { ...stateParams, seconds: Number(payload.durationSeconds || 4), ratio: workspace.aspect_ratio, resolution: recipe.resolution, qualityPreset: value.qualityPreset, h3Recipe: acceleration, turboAvailable: recipe.turbo, frameAlignment: alignment, temporalGuides, __directorSegment: { projectId: shot.project_id, segmentId: shotId, revision: shot.revision, storyboardRevision: sheet.revision, mode: route.mode, reason: routeReason, qualityPreset: value.qualityPreset, recipe, previewAudioPolicy: turboEligible ? "turbo" : "base-for-planned-audio", dependencies: payload.dependencies } } });
    const { h3ModeOverride: _h3ModeOverride, firstFrameFileId: _firstFrameFileId, lastFrameFileId: _lastFrameFileId, ...cleanPayload } = payload;
    const nextPayload = { ...cleanPayload, h3Mode: route.mode, h3ModeReason: routeReason, h3PromptSnapshot: { mode: route.mode, qualityPreset: value.qualityPreset, recipe, alignment, prompt, references, temporalGuides, nativeState: stateParams, storyboardStartGuide: preflight.storyboardStartGuide, storyboardRevision: sheet.revision }, videoGenerationId: generation.id, videoStale: false };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), shotId, userId);
    syncDirectorVideoSegmentFile(userId, shot.project_id, shotId);
    emitRender(userId, { type: "video-segment", projectId: shot.project_id, data: { id: shotId, revision: shot.revision + 1, payload: nextPayload } });
    return generation;
}

function directorH3Acceleration(userId: string, projectId: string, payload: Record<string, unknown>, mode: "fl2va" | "ref2va", requested?: H3Acceleration, executor = true) {
    const previousId = String(payload.continuationFromSegmentId || payload.continuationFromShotId || "");
    const previous = payload.boundary === "continue" ? db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(previousId, userId, projectId) as { payload: string } | undefined : undefined;
    const previousPayload = parseJson<{ h3ContinuationState?: { context?: { modelRevision?: string } } }>(previous?.payload || "{}", {});
    const catalog = getMediaExecutorCatalog();
    return selectH3Acceleration({ mode, requested, pddReady: executor && Boolean(catalog.comfyFeatures.pddRef8 && catalog.h3PddRuntime), continuing: payload.boundary === "continue", previousModelRevision: previousPayload.h3ContinuationState?.context?.modelRevision, hasAudioReferences: Array.isArray(payload.audioReferences) && payload.audioReferences.length > 0 });
}

export function getDirectorVideoSegmentPreflight(userId: string, segmentId: string, supportsTemporalGuides = getMediaExecutorCatalog().comfyFeatures.temporalGuides, supportsNativeState = Boolean(getMediaExecutorCatalog().h3Runtime), requestedRecipe?: H3Acceleration) {
    const segment = segmentRow(userId, segmentId);
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const style = activeStyle(userId, segment.project_id);
    const { candidates, missing } = segmentReferenceCandidates(userId, segment.project_id, payload, style);
    const selected = candidates.slice(0, 6);
    const sheet = asSheet(payload.storyboardSheet);
    const route = resolveH3Route(payload, sheet);
    const acceleration = directorH3Acceleration(userId, segment.project_id, payload, route.mode, requestedRecipe);
    const auxiliaryFiles = (payload.boundary === "continue" && !supportsNativeState ? 1 : 0) + (Array.isArray(payload.audioReferences) ? payload.audioReferences.length : 0);
    const storyboardStartGuide = route.mode === "ref2va" && payload.boundary !== "continue" && supportsTemporalGuides
        ? { sourceFileId: sheet?.imageFileId, layout: sheet?.layout, frameIndex: 0 } : undefined;
    const guideFiles = Number(Boolean(storyboardStartGuide));
    const videoBudget = route.mode === "ref2va" ? Math.max(0, Math.min(8 - guideFiles, 11 - auxiliaryFiles - guideFiles)) : 0;
    const videoSelected = candidates.slice(0, videoBudget);
    const assetBlockedReasons = route.mode === "fl2va" ? transitionBlockedReasons(userId, segment.project_id, payload) : missing;
    const promptValidation = route.mode === "ref2va" ? validateH3PromptPlan(payload, sheet, videoSelected.filter((item) => item.purpose === "主角色" || item.purpose === "出镜角色").map((item) => String(item.assetId || "")).filter(Boolean)) : { blockedReasons: [], warnings: [] };
    if (supportsNativeState && payload.boundary === "continue" && Number(payload.durationSeconds || 4) > 340 / 24) promptValidation.blockedReasons.push("原生续接单次最多新增 14.167 秒，隐藏重叠需占用生成窗口，请调整视频段时长");
    const turboEligible = isH3TurboAudioSafe(payload, sheet);
    const audioReferences = h3AudioReferencesInput.safeParse(payload.audioReferences);
    if (audioReferences.success) audioReferences.data.forEach(({ fileId }) => {
        const file = getStoredFile(userId, fileId);
        if (!file || !file.mime_type.startsWith("audio/")) promptValidation.blockedReasons.push("音频参考文件不存在或不是音频");
    });
    if (route.mode === "fl2va" && auxiliaryFiles) promptValidation.blockedReasons.push("首尾帧过渡不支持独立音频参考或参考视频");
    const turboPreview = route.mode === "fl2va" && getMediaExecutorCatalog().comfyFeatures.turboPreview;
    const transitionInputs = route.mode === "fl2va" ? { firstFrameFileId: transitionFrame(userId, segment.project_id, String(payload.transitionFromSegmentId || ""), "actualLastFrameFileId") || undefined, lastFrameFileId: transitionFrame(userId, segment.project_id, String(payload.transitionToSegmentId || ""), "actualFirstFrameFileId") || undefined } : undefined;
    const nativeOutputFrames = supportsNativeState && route.mode === "ref2va" ? (payload.boundary === "continue" ? h3ContinuationFrames(Number(payload.durationSeconds || 4)) : alignH3Frames(Number(payload.durationSeconds || 4)).modelFrames) : undefined;
    const nativeWindow = nativeOutputFrames ? { outputFrames: nativeOutputFrames, overlapFrames: payload.boundary === "continue" ? 22 : 0, outputSeconds: nativeOutputFrames / 24 } : undefined;
    return { nativeWindow, storyboardStartGuide, storyboardFileId: sheet?.imageFileId, transitionInputs, selected, omitted: candidates.slice(6), videoSelected, videoOmitted: candidates.slice(videoBudget), assetBlockedReasons, promptValidation, blockedReasons: [...assetBlockedReasons, ...promptValidation.blockedReasons], warnings: promptValidation.warnings, route: supportsNativeState && payload.boundary === "continue" ? { ...route, reason: "加载前段原生双流状态，隐藏重叠参与生成，仅输出新增音视频" } : route, acceleration, capabilities: { turboPreview, nativeState: supportsNativeState }, previewAudioPolicy: turboEligible ? "turbo" : "base-for-planned-audio", recipes: { preview: h3Recipe(route.mode, "preview", turboPreview && turboEligible, acceleration), final: h3Recipe(route.mode, "final", false, acceleration) }, frameAlignment: alignH3Frames(Number(payload.durationSeconds || 4)) };
}

export function createDirectorStoryboardGeneration(userId: string, segmentId: string, input: unknown) {
    const value = storyboardGenerationInput.parse(input);
    const segment = segmentRow(userId, segmentId);
    if (segment.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "视频段已在其他页面更新");
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    validateShotAssetRefs(userId, segment.project_id, payload);
    assertDirectorProjectValid(userId, segment.project_id);
    const script = db.prepare("SELECT revision,content FROM director_documents WHERE user_id=? AND project_id=? AND kind='script'").get(userId, segment.project_id) as { revision: number; content: string } | undefined;
    if (!script?.content.trim()) throw renderError(409, "DIRECTOR_STAGE_GATE", "请先完成剧本");
    const style = activeStyle(userId, segment.project_id);
    if (!style) throw renderError(409, "DIRECTOR_STAGE_GATE", "请先选择当前视觉风格");
    const preflight = getDirectorVideoSegmentPreflight(userId, segmentId);
    if (preflight.assetBlockedReasons.length) throw renderError(409, "DIRECTOR_STORYBOARD_ASSETS_REQUIRED", preflight.assetBlockedReasons.join("；"), preflight);
    const modelRef = value.model || listModelDefaults().image;
    if (!modelRef) throw renderError(409, "AI_MODEL_NOT_CONFIGURED", "管理员尚未配置默认图片模型");
    const model = resolveSelectableModel(modelRef, "image").model as AiModelDefinition;
    const modelPlan = resolveStoryboardImageModelPlan(model, [...preflight.selected, ...preflight.omitted]);
    const sheet = asSheet(payload.storyboardSheet) || defaultSheet(segment.id, Number(payload.durationSeconds || 4), payload);
    const narrativePlan = validateStoryboardNarrativePlan(payload, sheet);
    if (narrativePlan.blockedReasons.length) throw renderError(409, "DIRECTOR_STORYBOARD_PLAN_INVALID", narrativePlan.blockedReasons.join("；"), narrativePlan);
    const workspace = db.prepare("SELECT directing_rules,revision FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, segment.project_id) as Pick<WorkspaceRow, "directing_rules" | "revision">;
    const prompt = compileDirectorStoryboardPrompt(segment.title, payload, sheet, style.description, parseJson<Record<string, string>>(workspace.directing_rules, {}));
    const references = modelPlan.references.map((item) => ({ fileId: item.fileId, kind: "image" as const, role: "reference" as const }));
    const generation = createGeneration(userId, { kind: "image", model: modelRef, prompt, references, params: { count: 1, size: storyboardImageSize(sheet.layout), quality: "high", imagePromptProfile: modelPlan.imagePromptProfile, __directorStoryboardSheet: { projectId: segment.project_id, segmentId, segmentRevision: segment.revision, storyboardRevision: sheet.revision, style: { id: style.id, revision: style.revision }, scriptRevision: script.revision, directingRulesRevision: workspace.revision } } });
    const nextSheet = { ...sheet, generationId: generation.id, imageFileId: undefined, promptSnapshot: prompt, referenceSnapshot: preflight, review: { status: "pending", summary: "整张故事板生成中", issues: [] } };
    const nextPayload = { ...payload, storyboardSheet: nextSheet, storyboardStale: false, h3PromptStale: false, videoStale: Boolean(payload.videoFileId), dependencies: { documents: { script: script.revision }, style: { id: style.id, revision: style.revision }, directingRules: { revision: workspace.revision } } };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), segmentId, userId);
    syncDirectorVideoSegmentFile(userId, segment.project_id, segmentId);
    emitRender(userId, { type: "video-segment", projectId: segment.project_id, data: { id: segmentId, revision: segment.revision + 1, payload: nextPayload } });
    return generation;
}

export function resolveStoryboardImageModelPlan<T>(model: Pick<AiModelDefinition, "inputs" | "maxReferenceImages" | "imagePromptProfile">, candidates: T[]) {
    const referenceLimit = model.inputs.includes("image") ? Math.max(0, model.maxReferenceImages ?? 6) : 0;
    return { imagePromptProfile: model.imagePromptProfile || "generic", references: candidates.slice(0, referenceLimit), omitted: candidates.slice(referenceLimit) };
}

export function updateDirectorStoryboardPrompts(userId: string, projectId: string, input: unknown, allowLocked = false) {
    assertDirector(userId, projectId);
    const value = storyboardPromptUpdateInput.parse(input);
    const ids = new Set(value.items.map((item) => item.segmentId));
    if (ids.size !== value.items.length) throw renderError(400, "DIRECTOR_STORYBOARD_DUPLICATE", "同一批次不能重复更新同一个视频段");
    const prepared = value.items.map((item) => {
        const segment = segmentRow(userId, item.segmentId);
        if (segment.project_id !== projectId) throw renderError(404, "DIRECTOR_VIDEO_SEGMENT_NOT_FOUND", "视频段不存在");
        if (!allowLocked && segment.status === "locked") throw renderError(423, "DIRECTOR_LOCKED", `${segment.title} 已锁定，需要审批后修改`);
        if (segment.revision !== item.revision) throw renderError(409, "DIRECTOR_CONFLICT", `${segment.title} 已在其他页面更新`);
        const payload = parseJson<Record<string, unknown>>(segment.payload, {});
        const sheet = asSheet(payload.storyboardSheet);
        if (!sheet) throw renderError(409, "DIRECTOR_STORYBOARD_REQUIRED", `${segment.title} 还没有故事板结构`);
        const patches = new Map(item.frames.map((frame) => [frame.id, frame]));
        if (patches.size !== item.frames.length || item.frames.some((frame) => !sheet.frames.some((current) => current.id === frame.id))) throw renderError(400, "DIRECTOR_STORYBOARD_FRAME_INVALID", `${segment.title} 包含不存在或重复的画格`);
        const frames = sheet.frames.map((frame) => patches.has(frame.id) ? { ...frame, ...patches.get(frame.id)!, dialogue: "" } : frame);
        validateStoryboardPlan(segment.title, frames, Number(payload.durationSeconds || 4));
        const narrativePlan = validateStoryboardNarrativePlan(payload, { frames });
        if (narrativePlan.blockedReasons.length) throw renderError(409, "DIRECTOR_STORYBOARD_PLAN_INVALID", `${segment.title}：${narrativePlan.blockedReasons.join("；")}`, narrativePlan);
        const stale = Boolean(sheet.imageFileId || sheet.generationId);
        const workspace = db.prepare("SELECT directing_rules FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as Pick<WorkspaceRow, "directing_rules">;
        const nextSheet = { ...sheet, revision: sheet.revision + 1, frames, promptSnapshot: compileDirectorStoryboardPrompt(segment.title, payload, { ...sheet, frames }, activeStyle(userId, projectId)?.description || "", parseJson<Record<string, string>>(workspace.directing_rules, {})), review: stale ? { status: "stale", summary: "提示词已修改，请重新生成故事板", issues: [] } : sheet.review };
        const h3PromptStale = Boolean(payload.h3PromptSnapshot);
        const videoStale = Boolean(payload.videoFileId || payload.videoGenerationId);
        const legacyCleared = patches.size === sheet.frames.length ? { dialogue: "", narration: "" } : {};
        return { segment, payload: { ...payload, ...legacyCleared, storyboardSheet: nextSheet, storyboardStale: stale, h3PromptStale, videoStale, needsReview: stale || h3PromptStale || videoStale }, storyboardRevision: nextSheet.revision, stale };
    });
    const now = new Date().toISOString();
    db.transaction(() => prepared.forEach(({ segment, payload }) => {
        const updated = db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?").run(JSON.stringify(payload), now, segment.id, userId, segment.revision);
        if (!updated.changes) throw renderError(409, "DIRECTOR_CONFLICT", `${segment.title} 已在其他页面更新`);
    }))();
    const updatedIds = new Set(prepared.map(({ segment }) => segment.id));
    prepared.forEach(({ segment, payload }) => { if ((payload as Record<string, unknown>).videoFileId) markContinuationStale(userId, projectId, segment.id, updatedIds); });
    prepared.forEach(({ segment }) => syncDirectorVideoSegmentFile(userId, projectId, segment.id));
    const results = prepared.map(({ segment, payload, storyboardRevision, stale }) => ({ id: segment.id, title: segment.title, revision: segment.revision + 1, storyboardRevision, storyboardStale: stale, videoStale: Boolean((payload as Record<string, unknown>).videoStale) }));
    results.forEach((result) => emitRender(userId, { type: "video-segment", projectId, data: result }));
    return { updated: results.length, items: results };
}

function validateStoryboardPlan(title: string, frames: StoryboardFrame[], duration: number) {
    if (new Set(frames.map((frame) => frame.shotNumber)).size > 3) throw renderError(400, "DIRECTOR_STORYBOARD_SHOT_LIMIT", `${title} 的一个视频段最多包含 3 个内部 Shot`);
    if (frames.some((frame, index) => frame.timeSeconds > duration || index > 0 && frame.timeSeconds < frames[index - 1]!.timeSeconds)) throw renderError(400, "DIRECTOR_STORYBOARD_TIME", `${title} 的画格时间必须递增且不能超过视频段时长`);
    if (frames.length && frames[0]!.timeSeconds !== 0) throw renderError(400, "DIRECTOR_STORYBOARD_START", `${title} 的第一格必须从 0 秒开始`);
    if (frames.length && Math.abs(frames.at(-1)!.timeSeconds - duration) > 0.01) throw renderError(400, "DIRECTOR_STORYBOARD_END", `${title} 的最后一格必须落在 ${duration} 秒视频结尾`);
}

export const createDirectorVideoSegmentGeneration = createDirectorShotGeneration;

async function resolveH3MediaSources(userId: string, projectId: string, shots: ShotRow[]) {
    const cumulative = new Map<string, Awaited<ReturnType<typeof resolveDirectorH3Cumulative>>>();
    const covered = new Set<string>();
    for (let index = shots.length - 1; index >= 0; index--) {
        const shot = shots[index];
        if (covered.has(shot.id) || !parseJson<Record<string, unknown>>(shot.payload, {}).h3ContinuationState) continue;
        const media = await resolveDirectorH3Cumulative(userId, projectId, shot.id);
        cumulative.set(shot.id, media);
        for (let chainIndex = media.chain.length - 1, position = index; chainIndex >= 0 && position >= 0 && media.chain[chainIndex].segmentId === shots[position].id; chainIndex--, position--) covered.add(shots[position].id);
    }
    return planH3CumulativeSources(shots.map((shot) => shot.id), cumulative);
}

export async function getDirectorPlaybackPlan(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    const rows = db.prepare("SELECT s.id,s.position,s.payload,s.revision FROM director_shots s JOIN director_sequences q ON q.id=s.sequence_id AND q.user_id=s.user_id WHERE s.user_id=? AND s.project_id=? ORDER BY q.position,s.position,s.id").all(userId, projectId) as ShotRow[];
    const order = parseJson<{ segmentOrder?: string[] }>(timeline.payload, {}).segmentOrder;
    const shots = order?.length ? order.map((id) => rows.find((shot) => shot.id === id)).filter(Boolean) as ShotRow[] : rows;
    const native = await resolveH3MediaSources(userId, projectId, shots);
    const segments = shots.map((shot) => {
        const payload = parseJson<Record<string, unknown>>(shot.payload, {});
        const source = native.get(shot.id) || { fileId: String(payload.videoFileId || ""), trimIn: 0, duration: directorSegmentMediaDuration(payload) };
        return { segmentId: shot.id, revision: shot.revision, ...source };
    });
    const current = db.prepare("SELECT revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    if (current.revision !== timeline.revision || shots.some((shot) => (db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=?").get(shot.id, userId) as ShotRow | undefined)?.payload !== shot.payload)) throw renderError(409, "DIRECTOR_PLAYBACK_STALE", "预览来源已变化，请刷新后重试");
    return { timelineRevision: timeline.revision, segments };
}

export function listDirectorRenders(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    return (db.prepare("SELECT * FROM director_renders WHERE user_id=? AND project_id=? ORDER BY created_at DESC").all(userId, projectId) as RenderRow[]).map(renderResponse);
}

export function createDirectorRender(userId: string, projectId: string, input: unknown) {
    assertDirector(userId, projectId);
    assertDirectorProjectValid(userId, projectId);
    const value = renderInput.parse(input);
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    if (timeline.revision !== value.timelineRevision) throw renderError(409, "DIRECTOR_CONFLICT", "时间线已在其他页面更新");
    const timelinePayload = parseJson<{ segmentOrder?: string[]; tracks?: Array<{ clips?: AudioClip[] }> }>(timeline.payload, {});
    const rows = db.prepare("SELECT s.id,s.position,s.payload,s.revision FROM director_shots s JOIN director_sequences q ON q.id=s.sequence_id AND q.user_id=s.user_id WHERE s.user_id=? AND s.project_id=? ORDER BY q.position,s.position,s.id").all(userId, projectId) as ShotRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const segmentIds = timelinePayload.segmentOrder?.length ? timelinePayload.segmentOrder : rows.map((row) => row.id);
    const shots = segmentIds.map((id) => byId.get(id)).filter(Boolean) as ShotRow[];
    if (!shots.length) throw renderError(409, "DIRECTOR_RENDER_EMPTY", "时间线还没有视频段");
    const missing = shots.filter((shot) => !parseJson<Record<string, unknown>>(shot.payload, {}).videoFileId);
    if (missing.length) throw renderError(409, "DIRECTOR_RENDER_VIDEO_MISSING", `仍有 ${missing.length} 个视频段缺少视频`, { segmentIds: missing.map((shot) => shot.id) });
    const clips = (timelinePayload.tracks || []).flatMap((track) => track.clips || []).filter((clip) => !clip.muted && clip.fileId);
    const duration = shots.reduce((sum, shot) => sum + directorSegmentMediaDuration(parseJson<Record<string, unknown>>(shot.payload, {})), 0);
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
    const timeline = db.prepare("SELECT revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, row.project_id) as { revision: number } | undefined;
    if (timeline?.revision !== parseJson<RenderPayload>(row.payload, {} as RenderPayload).timelineRevision) throw renderError(409, "DIRECTOR_RENDER_STALE", "时间线已变化，请创建新的合成任务");
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
    const request = parseJson<{ params?: { __h3StateContext?: unknown; __h3PreviousFrames?: number; __h3PreviousState?: unknown; __directorSegment?: { projectId?: string; segmentId?: string; revision?: number; storyboardRevision?: number; mode?: string; qualityPreset?: H3QualityPreset; recipe?: ReturnType<typeof h3Recipe> } } }>(row.request, {});
    const context = request.params?.__directorSegment;
    if (!context?.projectId || !context.segmentId) return;
    const result = parseJson<{ files?: Array<{ id?: string; fileId?: string }>; continuationStates?: Array<{ fileId?: string }>; cumulativeVideos?: Array<{ fileId?: string }> }>(row.result, {});
    const sourceVideoFileId = result.files?.[0]?.id || result.files?.[0]?.fileId;
    const video = sourceVideoFileId ? getStoredFile(row.user_id, sourceVideoFileId) : null;
    if (!video) return;
    const directory = await mkdtemp(join(tmpdir(), "director-frames-"));
    try {
        const first = join(directory, "first.png"); const last = join(directory, "last.png"); const audio = join(directory, "model-original.m4a"); const trimmed = join(directory, "trimmed.mp4");
        const shot = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(context.segmentId, row.user_id, context.projectId) as { payload: string; revision: number } | undefined;
        if (!shot) return;
        const currentPayload = parseJson<Record<string, unknown>>(shot.payload, {});
        if (currentPayload.videoGenerationId !== row.id) return;
        const stateContext = request.params?.__h3StateContext === undefined ? undefined : h3StateContextSchema.parse(request.params.__h3StateContext);
        if (stateContext && (result.continuationStates?.length !== 1 || !result.continuationStates[0]?.fileId)) throw renderError(409, "DIRECTOR_H3_STATE_MISSING", "生成结果缺少唯一的原生续接状态");
        if (stateContext && (result.cumulativeVideos?.length !== 1 || !result.cumulativeVideos[0]?.fileId)) throw renderError(409, "DIRECTOR_H3_CUMULATIVE_MISSING", "生成结果缺少唯一的累计音视频");
        const duration = Number(currentPayload.durationSeconds || 4);
        const renderedDuration = stateContext ? await validateH3NativeVideo(video.path, stateContext, request.params?.__h3PreviousFrames ?? 0) : duration;
        await ffmpeg(["-y", "-i", video.path, "-t", String(renderedDuration), "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", trimmed], undefined);
        const storedVideo = storeLocalFile(row.user_id, trimmed, `${context.segmentId}-${context.qualityPreset || "preview"}.mp4`, "video/mp4");
        await ffmpeg(["-y", "-i", trimmed, "-frames:v", "1", first], undefined);
        await ffmpeg(["-y", "-sseof", "-1", "-i", trimmed, "-vf", "reverse", "-frames:v", "1", last], undefined);
        const firstFile = storeLocalFile(row.user_id, first, `${context.segmentId}-first.png`, "image/png");
        const lastFile = storeLocalFile(row.user_id, last, `${context.segmentId}-last.png`, "image/png");
        let nativeAudioFileId = "";
        try { await ffmpeg(["-y", "-i", trimmed, "-vn", "-c:a", "aac", "-b:a", "192k", audio], undefined); nativeAudioFileId = storeLocalFile(row.user_id, audio, `${context.segmentId}-model-original.m4a`, "audio/mp4").id; } catch { nativeAudioFileId = ""; }
        if (stateContext && request.params?.__h3PreviousState) await verifyRequestedH3Continuation(row.user_id, request.params.__h3PreviousState, stateContext);
        const continuationState = stateContext ? await createH3ContinuationBinding(row.user_id, { projectId: context.projectId, segmentId: context.segmentId, generationId: row.id, videoFileId: storedVideo.id, fileId: result.continuationStates![0]!.fileId!, context: stateContext }) : undefined;
        const cumulativeVideo = continuationState ? await createH3CumulativeBinding(row.user_id, result.cumulativeVideos![0]!.fileId!, continuationState) : undefined;
        const latestShot = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(context.segmentId, row.user_id, context.projectId) as { payload: string; revision: number } | undefined;
        if (!latestShot) return;
        const latestPayload = parseJson<Record<string, unknown>>(latestShot.payload, {});
        if (latestPayload.videoGenerationId !== row.id || Number(latestPayload.durationSeconds || 4) !== duration) return;
        const generationDurationMs = Math.max(0, new Date(row.updated_at).getTime() - new Date(row.created_at).getTime());
        const payload = { ...latestPayload, h3CumulativeVideo: cumulativeVideo, videoDurationSeconds: renderedDuration, h3ContinuationState: continuationState, videoFileId: storedVideo.id, videoGenerationId: row.id, videoQualityPreset: context.qualityPreset || "preview", videoRecipeSnapshot: context.recipe, videoNativeResolution: context.recipe?.resolution || "768p", videoGenerationDurationMs: generationDurationMs, actualFirstFrameFileId: firstFile.id, actualLastFrameFileId: lastFile.id, nativeAudioFileId: nativeAudioFileId || undefined, nativeAudioStatus: nativeAudioFileId ? "ready" : "missing", videoStale: Number(asSheet(latestPayload.storyboardSheet)?.revision || 0) !== Number(context.storyboardRevision || 0) };
        const adopted = db.transaction(() => {
            const updated = db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?").run(JSON.stringify(payload), new Date().toISOString(), context.segmentId, row.user_id, latestShot.revision);
            if (!updated.changes) return false;
            syncFileRefs(row.user_id, "director_shot", context.segmentId!, payload);
            if (nativeAudioFileId) upsertNativeAudioClip(row.user_id, context.projectId!, context.segmentId!, nativeAudioFileId, renderedDuration);
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
    if (!getStoredFile(row.user_id, fileId)) return;
    const nextSheet = { ...sheet, imageFileId: fileId, review: { status: "pending", summary: "正在检查宫格、素材与连续性", issues: [] } };
    const nextPayload = { ...payload, storyboardSheet: nextSheet };
    db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(nextPayload), new Date().toISOString(), segment.id, row.user_id);
    syncFileRefs(row.user_id, "director_shot", segment.id, nextPayload);
    syncDirectorVideoSegmentFile(row.user_id, context.projectId, segment.id);
    emitRender(row.user_id, { type: "video-segment", projectId: context.projectId, data: { id: segment.id, revision: segment.revision + 1, payload: nextPayload } });
    const model = getAiGlobalSettings().config.creativeAssetReviewModel;
    if (!model) {
        nextSheet.review = { status: "manual", summary: "未配置视觉质检模型，请人工检查", issues: [] };
        const manualPayload = { ...nextPayload, storyboardSheet: nextSheet };
        db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(manualPayload), new Date().toISOString(), segment.id, row.user_id);
        syncDirectorVideoSegmentFile(row.user_id, context.projectId, segment.id);
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
    syncDirectorVideoSegmentFile(row.user_id, context.projectId, segment.id);
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
        const nativeSources = await resolveH3MediaSources(row.user_id, row.project_id, shots);
        const assertSourcesCurrent = () => {
            const currentTimeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(row.user_id, row.project_id) as TimelineRow;
            if (currentTimeline.revision !== timeline.revision || currentTimeline.payload !== timeline.payload || shots.some((shot) => {
                const current = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(shot.id, row.user_id, row.project_id) as ShotRow | undefined;
                return !current || current.revision !== shot.revision || current.payload !== shot.payload;
            })) throw renderError(409, "DIRECTOR_RENDER_STALE", "合成期间视频段或时间线已变化，请重新合成");
        };
        assertSourcesCurrent();

        const [width, height] = outputSize(workspace.aspect_ratio);
        const normalized: string[] = [];
        for (let index = 0; index < shots.length; index += 1) {
            const shot = parseJson<Record<string, unknown>>(shots[index].payload, {});
            const native = nativeSources.get(shots[index].id);
            if (native && Math.abs(native.duration - directorSegmentMediaDuration(shot)) > 1e-6) throw new Error("累计视频与视频段实际时长不一致");
            const source = getStoredFile(row.user_id, native?.fileId || String(shot.videoFileId || ""));
            if (!source) throw new Error(`视频段 ${shots[index].id} 的视频文件不存在`);
            const output = join(directory, `shot-${String(index).padStart(4, "0")}.mp4`);
            await ffmpeg(["-y", ...(native ? ["-ss", String(native.trimIn)] : []), "-i", source.path, "-t", String(directorSegmentMediaDuration(shot)), "-an", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", output], signal);
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
        for (const originalClip of clips) {
            const native = originalClip.segmentId ? nativeSources.get(originalClip.segmentId) : undefined;
            const segment = shots.find((shot) => shot.id === originalClip.segmentId);
            const nativeAudioId = segment ? parseJson<Record<string, unknown>>(segment.payload, {}).nativeAudioFileId : undefined;
            const clip = native && originalClip.id === `model-original-${originalClip.segmentId}` && typeof nativeAudioId === "string" && await isSameH3OwnedMedia(row.user_id, originalClip.fileId!, nativeAudioId)
                ? { ...originalClip, fileId: native.fileId, trimIn: native.trimIn + (originalClip.trimIn || 0) } : originalClip;
            const file = getStoredFile(row.user_id, clip.fileId!); if (!file) continue;
            if (clip.loop) args.push("-stream_loop", "-1");
            if (clip.trimIn) args.push("-ss", String(clip.trimIn));
            args.push("-t", String(clip.duration), "-i", file.path); usable.push(clip);
        }
        args.push("-f", "lavfi", "-t", String(payload.duration), "-i", "anullsrc=r=48000:cl=stereo");
        if (usable.length) {
            const filters = usable.map((clip, index) => `[${index + 1}:a]atrim=0:${clip.duration},asetpts=PTS-STARTPTS,volume=${clip.volume ?? 1},aformat=channel_layouts=stereo,adelay=${Math.max(0, Math.round(clip.start * 1000))}|${Math.max(0, Math.round(clip.start * 1000))}[a${index}]`);
            const inputs = [...usable.map((_, index) => `[a${index}]`), `[${usable.length + 1}:a]`].join("");
            args.push("-filter_complex", `${filters.join(";")};${inputs}amix=inputs=${usable.length + 1}:duration=longest:dropout_transition=0:normalize=0,apad=pad_dur=0.005,alimiter=limit=0.95:level=0:attack=5,atrim=start=0.005,asetpts=PTS-STARTPTS[aout]`, "-map", "0:v:0", "-map", "[aout]");
        } else args.push("-map", "0:v:0", "-map", "1:a:0");
        args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(payload.duration), "-movflags", "+faststart", output);
        await ffmpeg(args, signal, (seconds) => updateRender(row, { progress: .7 + .28 * Math.min(1, seconds / Math.max(1, payload.duration)) }));
        assertSourcesCurrent();
        const stored = storeLocalFile(row.user_id, output, `director-${row.project_id}-${row.id}.mp4`, "video/mp4");
        const current = renderRow(row.user_id, row.id); if (!current || current.status === "canceled") return;
        archiveDirectorRender(row.user_id, row.project_id, row.id, output, { timelineRevision: payload.timelineRevision, segmentIds: payload.segmentIds, duration: payload.duration, width, height, fps: 24 });
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
type StoryboardFrame = { id: string; position: number; shotNumber: number; timeSeconds: number; kind: "shot-start" | "keyframe" | "shot-end"; description: string; action: string; cameraAngle: string; cameraMove: string; h3Visual?: string; dialogues?: H3DialogueCue[]; dialogue?: string; sound: string };
type StoryboardSheet = { revision: number; layout: DirectorStoryboardLayout; frames: StoryboardFrame[]; imageFileId?: string; generationId?: string; promptSnapshot?: string; referenceSnapshot?: unknown; review?: Record<string, unknown> };
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
    return Array.isArray(sheet.frames) ? { ...sheet, revision: Math.max(1, Number(sheet.revision) || 1), layout: storyboardLayout(sheet.frames.length), frames: sheet.frames.map((frame, index) => ({ id: String(frame.id || nanoid()), position: index, shotNumber: Math.max(1, Math.round(Number(frame.shotNumber || 1))), timeSeconds: Math.max(0, Number(frame.timeSeconds) || 0), kind: frame.kind === "shot-start" || frame.kind === "shot-end" ? frame.kind : "keyframe", description: String(frame.description || ""), action: String(frame.action || ""), cameraAngle: String(frame.cameraAngle || ""), cameraMove: String(frame.cameraMove || ""), h3Visual: String(frame.h3Visual || ""), dialogues: Array.isArray(frame.dialogues) ? frame.dialogues : [], dialogue: String(frame.dialogue || ""), sound: String(frame.sound || "") })) } : undefined;
}
function defaultSheet(segmentId: string, duration: number, payload: Record<string, unknown>): StoryboardSheet {
    const requested = Number(payload.storyboardFrameCount); const frameCount = [4, 6, 9].includes(requested) ? requested : recommendedStoryboardFrameCount(duration);
    return { revision: 1, layout: storyboardLayout(frameCount), frames: Array.from({ length: frameCount }, (_, position) => ({ id: `${segmentId}-frame-${position + 1}`, position, shotNumber: 1, timeSeconds: Number((duration * position / Math.max(1, frameCount - 1)).toFixed(2)), kind: position === 0 ? "shot-start" : position === frameCount - 1 ? "shot-end" : "keyframe", description: String(payload.description || ""), action: String(payload.action || ""), cameraAngle: String(payload.cameraAngle || ""), cameraMove: String(payload.cameraMove || ""), h3Visual: "", dialogues: [], sound: String(payload.sound || "") })) };
}
function referencePurpose(purpose: string) {
    if (purpose === "主角色" || purpose === "出镜角色") return "preserve the character's face, body, hair, wardrobe, materials, and visual identity only";
    if (purpose === "场景") return "preserve the environment's architecture, layout, materials, geography, lighting logic, and atmosphere only";
    if (purpose === "关键道具") return "preserve the prop's silhouette, scale, materials, construction, wear, and identifying details only";
    return "use only its medium, color treatment, texture, lighting character, and realism level; do not copy any depicted person's identity";
}
function activeStyle(userId: string, projectId: string) {
    const project = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as { payload: string } | undefined;
    const styleId = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload || "{}", {}).defaultVisualStyleId || "");
    return styleId ? db.prepare("SELECT * FROM visual_styles WHERE id=? AND user_id=? AND project_id=?").get(styleId, userId, projectId) as StyleRow | undefined : undefined;
}
function segmentReferenceCandidates(userId: string, projectId: string, payload: Record<string, unknown>, style?: StyleRow) {
    const refs = (value: unknown) => Array.isArray(value) ? value as Array<{ id?: string; variantId?: string }> : [];
    const candidates: Array<{ fileId: string; name: string; purpose: "主角色" | "出镜角色" | "场景" | "关键道具" | "视觉风格"; assetId?: string }> = [];
    const missing: string[] = [];
    const append = (reference: { id?: string; variantId?: string }, purpose: typeof candidates[number]["purpose"]) => {
        const row = db.prepare("SELECT id,name FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId) as { id: string; name: string } | undefined;
        const fileId = row ? getDirectorAssetReferenceImage(userId, projectId, row.id, reference.variantId) : undefined;
        if (row && fileId) candidates.push({ fileId, name: row.name, purpose, assetId: row.id });
        else missing.push(row ? `${row.name}缺少${reference.variantId ? "本段形象" : "主图"}，请补充素材` : `${purpose}引用已不存在，请重新选择`);
    };
    refs(payload.characterRefs).forEach((reference, index) => append(reference, index ? "出镜角色" : "主角色"));
    refs(payload.sceneRefs).forEach((reference) => append(reference, "场景"));
    refs(payload.propRefs).forEach((reference) => append(reference, "关键道具"));
    if (style) {
        const files = parseJson<Record<string, string>>(style.reference_files, {});
        const fileId = files.board || files.source;
        if (fileId) candidates.push({ fileId, name: style.name, purpose: "视觉风格" });
    }
    return { candidates: Array.from(new Map(candidates.map((item) => [item.fileId, item])).values()), missing };
}
function groupStoryboardShots(frames: StoryboardFrame[]) {
    const groups = new Map<number, StoryboardFrame[]>();
    frames.forEach((frame) => groups.set(frame.shotNumber, [...(groups.get(frame.shotNumber) || []), frame]));
    return [...groups.entries()].sort(([left], [right]) => left - right).map(([shotNumber, items]) => ({ shotNumber, frames: items.sort((left, right) => left.position - right.position) }));
}
export function resolveH3Route(payload: Record<string, unknown>, sheet: StoryboardSheet | undefined) {
    if (payload.generationIntent === "transition") return { mode: "fl2va", reason: "视觉过渡使用前段尾帧与后段首帧生成" } as const;
    if (payload.boundary === "continue") return { mode: "ref2va", reason: "连续视频段使用上一段尾部音视频与当前完整故事板续写" } as const;
    const shots = new Set((sheet?.frames || []).map((frame) => frame.shotNumber)).size;
    return { mode: "ref2va", reason: shots > 1 ? `完整故事板包含 ${shots} 个内部切镜，按整板时序生成` : "完整故事板作为视频段构图与动作参考" } as const;
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
function storyboardLayoutLabel(layout: DirectorStoryboardLayout) { return layout === "3x3" ? "3 columns by 3 rows" : layout === "3x2" ? "3 columns by 2 rows" : "2 columns by 2 rows"; }
export function compileDirectorStoryboardPrompt(title: string, payload: Record<string, unknown>, sheet: StoryboardSheet, styleDescription: string, directingRules: Record<string, string> = {}) {
    const frameLines = sheet.frames.map((frame, index) => `Panel ${index + 1} | ${frame.timeSeconds}s | Shot ${frame.shotNumber} | ${frame.kind}: ${frame.description}; action: ${frame.action}; camera: ${frame.cameraAngle}, ${frame.cameraMove}`).join("\n");
    const shotGroups = groupStoryboardShots(sheet.frames).map(({ shotNumber, frames }) => `Shot ${shotNumber} uses panels ${frames.map((frame) => frame.position + 1).join(", ")} and begins at ${frames[0]?.timeSeconds || 0}s.`).join("\n");
    const dialogueMeaning = sheet.frames.flatMap((frame) => frame.dialogues || []).map((cue) => `${cue.speakerName}: ${cue.text}`).join(" | ") || String(payload.dialogue || payload.narration || "none");
    return [
        `Create ONE cinematic storyboard sheet for a ${Number(payload.durationSeconds || 4)}-second video segment.`,
        `Use an exact ${storyboardLayoutLabel(sheet.layout)} grid with ${sheet.frames.length} equal panels, thin neutral gutters, and no unused cells. Each panel is a distinct chronological state; panels inside the same Shot may keep the same camera setup but must advance the visible action instead of repeating an identical image.`,
        `Read the sheet from left to right and top to bottom. ${shotGroups}`,
        `Dramatic beat: ${String(payload.dramaticBeat || payload.description || title)}. Opening state: ${String(payload.openingState || "")}. Ending state: ${String(payload.endingState || "")}. Action: ${String(payload.action || "")}. Dialogue meaning only (do not render text): ${dialogueMeaning}.`,
        Object.values(directingRules).some(Boolean) ? `Project directing rules: creative positioning — ${directingRules.positioning || "not specified"}; core intent — ${directingRules.intent || "not specified"}; photography — ${directingRules.photography || "not specified"}; performance — ${directingRules.performance || "not specified"}; pacing — ${directingRules.pacing || "not specified"}; sound — ${directingRules.sound || "not specified"}; prohibitions — ${directingRules.prohibitions || "none"}. Apply only rules relevant to visible storyboard decisions; never render this text.` : "",
        frameLines,
        styleDescription ? `Visual appearance only: ${styleDescription}. Ignore any editing-rhythm, rapid-cut, montage or pacing instructions inside the style description. Maintain character identity, costume, scene geography, prop state, lighting direction, color treatment and screen direction across all panels. Within one Shot, keep the same camera setup and show continuous action progression; camera position, shot size and composition may change discontinuously only where the Shot plan calls for a cut. Reference images are authoritative.` : "Maintain character identity, costume, scene geography, prop state, lighting direction and screen direction across all panels. Within one Shot, keep the same camera setup and show continuous action progression; camera position, shot size and composition may change discontinuously only where the Shot plan calls for a cut. Reference images are authoritative.",
        "Output only the storyboard image. No title, captions, panel numbers, labels, speech bubbles, subtitles, logos, UI, decorative border, split-screen inside panels, duplicated characters, or identity drift.",
    ].join("\n\n");
}
function storyboardImageSize(layout: DirectorStoryboardLayout) { return layout === "3x3" ? "2304x1296" : layout === "3x2" ? "2304x864" : "2048x1152"; }
export async function extractDirectorStoryboardOpeningFrame(sourcePath: string, outputPath: string, layout: DirectorStoryboardLayout) {
    const columns = layout === "2x2" ? 2 : 3;
    const rows = layout === "3x3" ? 3 : 2;
    await ffmpeg(["-y", "-i", sourcePath, "-vf", `crop=floor(iw/${columns})-4:floor(ih/${rows})-4:1:1`, "-frames:v", "1", outputPath]);
}
async function extractStoryboardStartGuide(userId: string, segmentId: string, sourceFileId: string, layout: DirectorStoryboardLayout) {
    const source = getStoredFile(userId, sourceFileId);
    if (!source) throw renderError(409, "DIRECTOR_STORYBOARD_FILE_MISSING", "故事板图片不存在，请重新生成整张故事板");
    const directory = await mkdtemp(join(tmpdir(), "director-storyboard-guide-"));
    try {
        const output = join(directory, "opening.png");
        await extractDirectorStoryboardOpeningFrame(source.path, output, layout);
        return storeLocalFile(userId, output, `${segmentId}-storyboard-opening.png`, "image/png").id;
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
export function directorSegmentMediaDuration(payload: Record<string, unknown>) {
    return Number((payload.videoFileId && payload.videoDurationSeconds) || payload.durationSeconds || 4);
}
function upsertNativeAudioClip(userId: string, projectId: string, segmentId: string, fileId: string, duration: number) {
    const row = db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string };
    const payload = parseJson<{ segmentOrder?: string[]; tracks?: Array<{ id: string; kind: string; clips: Array<Record<string, unknown>> }> }>(row.payload, {});
    const segments = db.prepare("SELECT s.id,s.payload FROM director_shots s JOIN director_sequences q ON q.id=s.sequence_id AND q.user_id=s.user_id WHERE s.user_id=? AND s.project_id=? ORDER BY q.position,s.position,s.id").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const order = payload.segmentOrder?.length ? payload.segmentOrder : segments.map((segment) => segment.id);
    const byId = new Map(segments.map((item) => [item.id, item]));
    const start = order.slice(0, Math.max(0, order.indexOf(segmentId))).reduce((sum, id) => sum + directorSegmentMediaDuration(parseJson<Record<string, unknown>>(byId.get(id)?.payload || "{}", {})), 0);
    const tracks = payload.tracks || []; let track = tracks.find((item) => item.id === "model-original");
    if (!track) { track = { id: "model-original", kind: "model-original", clips: [] }; tracks.push(track); }
    track.clips = [...track.clips.filter((clip) => clip.segmentId !== segmentId), { id: `model-original-${segmentId}`, segmentId, fileId, start, duration, volume: 1, muted: false }];
    db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=?").run(JSON.stringify({ ...payload, tracks }), new Date().toISOString(), userId, projectId);
}
function outputSize(ratio: string): [number, number] { if (ratio === "9:16") return [1080, 1920]; if (ratio === "1:1") return [1080, 1080]; if (ratio === "2.39:1") return [1920, 804]; return [1920, 1080]; }
function updateRender(row: RenderRow, patch: { status?: RenderRow["status"]; progress?: number; error?: string }) { db.prepare("UPDATE director_renders SET status=coalesce(?,status),progress=coalesce(?,progress),error=?,updated_at=? WHERE id=? AND user_id=?").run(patch.status || null, patch.progress ?? null, patch.error || null, new Date().toISOString(), row.id, row.user_id); const next = renderRow(row.user_id, row.id); if (next) publish(next); }
function publish(row: RenderRow) { markDirectorProjectChanged(row.user_id, row.project_id, ["renders"]); const data = renderResponse(row); emitRender(row.user_id, { type: "render", projectId: row.project_id, data }); return data; }
function renderRow(userId: string, id: string) { return db.prepare("SELECT * FROM director_renders WHERE id=? AND user_id=?").get(id, userId) as RenderRow | undefined; }
function renderResponse(row: RenderRow) { return { id: row.id, projectId: row.project_id, status: row.status, payload: parseJson(row.payload, {}), outputFileId: row.output_file_id, ...(row.status === "succeeded" ? { outputPath: `renders/${row.id}/final.mp4`, metadataPath: `renders/${row.id}/render.json` } : {}), error: row.error, progress: row.progress, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assertDirector(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw renderError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在"); }
function renderError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }
