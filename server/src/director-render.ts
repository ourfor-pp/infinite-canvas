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

type RenderRow = { id: string; user_id: string; project_id: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; payload: string; output_file_id: string | null; error: string | null; progress: number; created_at: string; updated_at: string };
type ShotRow = { id: string; position: number; payload: string; revision: number };
type TimelineRow = { payload: string; revision: number };
type WorkspaceRow = { aspect_ratio: string };
type AudioClip = { id: string; fileId: string; start: number; duration: number; trimIn?: number; volume?: number; muted?: boolean; loop?: boolean };
type RenderPayload = { timelineRevision: number; shotIds: string[]; duration: number; warnings: string[] };

const renderInput = z.object({ timelineRevision: z.number().int().positive() });
const shotGenerationInput = z.object({ revision: z.number().int().positive(), model: z.string().trim().optional(), seconds: z.number().min(1).max(30).optional(), nativeExtend: z.boolean().default(true) });
const storyboardGenerationInput = z.object({ revision: z.number().int().positive(), panelIds: z.array(z.string().trim().min(1).max(128)).max(9).optional(), model: z.string().trim().optional() });
const running = new Map<string, AbortController>();
let scheduled = false;
let emitRender: (userId: string, entity: { type: string; projectId: string; data: unknown }) => void = () => undefined;

export function setDirectorRenderEmitter(emitter: typeof emitRender) { emitRender = emitter; }

export function createDirectorShotGeneration(userId: string, shotId: string, input: unknown) {
    const value = shotGenerationInput.parse(input);
    const shot = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(shotId, userId) as (ShotRow & { project_id: string; status: string; title: string }) | undefined;
    if (!shot) throw renderError(404, "DIRECTOR_SHOT_NOT_FOUND", "镜头不存在");
    if (shot.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "镜头已在其他页面更新");
    if (!["confirmed", "locked"].includes(shot.status)) throw renderError(409, "DIRECTOR_STAGE_GATE", "请先确认镜头，再生成视频");
    const payload = parseJson<Record<string, unknown>>(shot.payload, {});
    if (payload.needsReview) throw renderError(409, "DIRECTOR_DEPENDENCY_STALE", "镜头引用已过期，请先检查并确认");
    validateShotAssetRefs(userId, shot.project_id, payload);
    const project = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=?").get(shot.project_id, userId) as { payload: string } | undefined;
    const activeStyle = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload || "{}", {}).defaultVisualStyleId || "");
    const style = activeStyle ? db.prepare("SELECT 1 FROM visual_styles WHERE id=? AND user_id=? AND project_id=? AND status='confirmed'").get(activeStyle, userId, shot.project_id) : undefined;
    if (!style) throw renderError(409, "DIRECTOR_STAGE_GATE", "请先确认视觉风格，再生成镜头视频");
    const workspace = db.prepare("SELECT aspect_ratio FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, shot.project_id) as WorkspaceRow;
    const modelRef = value.model || listModelDefaults().video;
    if (!modelRef) throw renderError(409, "AI_MODEL_NOT_CONFIGURED", "管理员尚未配置默认视频模型");
    const model = resolveSelectableModel(modelRef, "video").model as AiModelDefinition;
    const references: Array<{ fileId: string; kind: "image" | "video"; role: "reference" | "first-frame" | "last-frame" | "continuation" }> = [];
    const previous = payload.boundary === "continue" && payload.continuationFromShotId ? db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(String(payload.continuationFromShotId), userId, shot.project_id) as { payload: string } | undefined : undefined;
    const priorPayload = previous ? parseJson<Record<string, unknown>>(previous.payload, {}) : {};
    if (payload.boundary === "continue" && value.nativeExtend && model.videoExtend && model.videoReferenceRoles?.includes("continuation") && priorPayload.videoFileId) references.push({ fileId: String(priorPayload.videoFileId), kind: "video", role: "continuation" });
    else {
        const firstFrame = payload.boundary === "continue" ? priorPayload.actualLastFrameFileId : payload.firstFrameFileId;
        if (firstFrame && model.inputs.includes("image")) references.push({ fileId: String(firstFrame), kind: "image", role: model.videoReferenceRoles?.includes("first-frame") ? "first-frame" : "reference" });
        if (payload.lastFrameFileId && model.videoReferenceRoles?.includes("last-frame")) references.push({ fileId: String(payload.lastFrameFileId), kind: "image", role: "last-frame" });
    }
    const prompt = [payload.description, payload.action, payload.dialogue && `对白：${payload.dialogue}`, payload.shotSize, payload.cameraAngle, payload.cameraMove].filter(Boolean).join("\n") || shot.title;
    return createGeneration(userId, { kind: "video", model: modelRef, prompt, references, params: { seconds: value.seconds || Number(payload.durationSeconds || 4), ratio: workspace.aspect_ratio, __directorShot: { projectId: shot.project_id, shotId, revision: shot.revision, dependencies: payload.dependencies } } });
}

export function createDirectorStoryboardPanelGeneration(userId: string, sequenceId: string, panelId: string, input: unknown) {
    const value = storyboardGenerationInput.parse(input);
    return queueStoryboardPanel(userId, sequenceId, panelId, value.model, value.revision);
}

export function createDirectorStoryboardGeneration(userId: string, sequenceId: string, input: unknown) {
    const value = storyboardGenerationInput.parse(input);
    const sequence = storyboardSequence(userId, sequenceId);
    if (sequence.revision !== value.revision) throw renderError(409, "DIRECTOR_CONFLICT", "故事板已在其他页面更新");
    const panels = storyboardPanels(sequence.payload);
    const targets = (value.panelIds?.length ? panels.filter((panel) => value.panelIds!.includes(String(panel.id))) : panels.filter((panel) => !panel.imageFileId)).map((panel) => String(panel.id));
    if (!targets.length) throw renderError(409, "DIRECTOR_STORYBOARD_COMPLETE", "故事板没有缺失画面");
    return targets.map((panelId, index) => queueStoryboardPanel(userId, sequenceId, panelId, value.model, index ? undefined : value.revision));
}

function queueStoryboardPanel(userId: string, sequenceId: string, panelId: string, requestedModel?: string, expectedRevision?: number) {
    const sequence = storyboardSequence(userId, sequenceId);
    if (expectedRevision && sequence.revision !== expectedRevision) throw renderError(409, "DIRECTOR_CONFLICT", "故事板已在其他页面更新");
    const script = db.prepare("SELECT revision,status FROM director_documents WHERE user_id=? AND project_id=? AND kind='script'").get(userId, sequence.project_id) as { revision: number; status: string } | undefined;
    if (!script || !["confirmed", "locked"].includes(script.status)) throw renderError(409, "DIRECTOR_STAGE_GATE", "请先确认剧本");
    const project = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=? AND kind='director'").get(sequence.project_id, userId) as { payload: string } | undefined;
    const styleId = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload || "{}", {}).defaultVisualStyleId || "");
    const style = styleId ? db.prepare("SELECT * FROM visual_styles WHERE id=? AND user_id=? AND project_id=?").get(styleId, userId, sequence.project_id) as { id: string; name: string; description: string; dna: string; reference_files: string; status: string; revision: number } | undefined : undefined;
    if (!style || style.status !== "confirmed") throw renderError(409, "DIRECTOR_STAGE_GATE", "请先应用并确认当前视觉风格");
    const panels = storyboardPanels(sequence.payload);
    const index = panels.findIndex((panel) => String(panel.id) === panelId);
    if (index < 0) throw renderError(404, "DIRECTOR_STORYBOARD_PANEL_NOT_FOUND", "故事板分格不存在");
    const panel = panels[index];
    validateStoryboardRefs(userId, sequence.project_id, panel);
    const modelRef = requestedModel || listModelDefaults().image;
    if (!modelRef) throw renderError(409, "AI_MODEL_NOT_CONFIGURED", "管理员尚未配置默认图片模型");
    const model = resolveSelectableModel(modelRef, "image").model as AiModelDefinition;
    const references = storyboardReferences(userId, sequence.project_id, panels[index - 1], panel, style, model.maxReferenceImages || Infinity);
    const prompt = [
        "为长视频制作一张独立故事板分格画面。只输出单幅电影画面，不要多宫格、文字、字幕、标注、边框、Logo 或 UI。",
        `叙事目的：${String(panel.purpose || panel.title || sequence.title)}`,
        `画面动作：${String(panel.action || panel.description || sequence.summary)}`,
        panel.dialogue ? `对白语义（不要在画面中写字）：${String(panel.dialogue)}` : "",
        panel.narration ? `旁白语义（不要在画面中写字）：${String(panel.narration)}` : "",
        `镜头语言：${String(panel.shotSize || "中景")}；${String(panel.cameraAngle || "平视")}；${String(panel.cameraMove || "固定机位")}`,
        `视觉风格：${style.description}`,
        model.imagePromptProfile === "gpt-image-2" ? "保持主体身份和空间关系明确，优先服从参考图中的角色、场景与道具身份；画面应具有可继续剪辑的动作瞬间和清楚的屏幕方向。" : "",
        "禁止：身份漂移、角色重复、肢体错误、空间矛盾、意外文字、画中画、拼贴。",
    ].filter(Boolean).join("\n\n");
    const generation = createGeneration(userId, { kind: "image", model: modelRef, prompt, references, params: { count: 1, size: model.imagePromptProfile === "gpt-image-2" ? "1536x1024" : "16:9", quality: "high", imagePromptProfile: model.imagePromptProfile || "generic", __directorStoryboard: { projectId: sequence.project_id, sequenceId, sequenceRevision: sequence.revision, panelId, style: { id: style.id, revision: style.revision }, scriptRevision: script.revision } } });
    panel.generationId = generation.id;
    panel.promptSnapshot = prompt;
    panel.review = { status: "pending", summary: "等待画面生成", issues: [] };
    const payload = { ...parseJson<Record<string, unknown>>(sequence.payload, {}), storyboard: panels, dependencies: { documents: { script: script.revision }, style: { id: style.id, revision: style.revision } } };
    db.prepare("UPDATE director_sequences SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), new Date().toISOString(), sequenceId, userId);
    emitRender(userId, { type: "sequence", projectId: sequence.project_id, data: { id: sequenceId, revision: sequence.revision + 1, payload } });
    return generation;
}

export function listDirectorRenders(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    return (db.prepare("SELECT * FROM director_renders WHERE user_id=? AND project_id=? ORDER BY created_at DESC").all(userId, projectId) as RenderRow[]).map(renderResponse);
}

export function createDirectorRender(userId: string, projectId: string, input: unknown) {
    assertDirector(userId, projectId);
    const value = renderInput.parse(input);
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    if (timeline.revision !== value.timelineRevision) throw renderError(409, "DIRECTOR_CONFLICT", "时间线已在其他页面更新");
    const timelinePayload = parseJson<{ shotOrder?: string[]; tracks?: Array<{ clips?: AudioClip[] }> }>(timeline.payload, {});
    const rows = db.prepare("SELECT id,position,payload,revision FROM director_shots WHERE user_id=? AND project_id=? ORDER BY position").all(userId, projectId) as ShotRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const shotIds = timelinePayload.shotOrder?.length ? timelinePayload.shotOrder : rows.map((row) => row.id);
    const shots = shotIds.map((id) => byId.get(id)).filter(Boolean) as ShotRow[];
    if (!shots.length) throw renderError(409, "DIRECTOR_RENDER_EMPTY", "时间线还没有镜头");
    const missing = shots.filter((shot) => !parseJson<Record<string, unknown>>(shot.payload, {}).videoFileId);
    if (missing.length) throw renderError(409, "DIRECTOR_RENDER_VIDEO_MISSING", `仍有 ${missing.length} 个镜头缺少视频`, { shotIds: missing.map((shot) => shot.id) });
    const clips = (timelinePayload.tracks || []).flatMap((track) => track.clips || []).filter((clip) => !clip.muted);
    const duration = shots.reduce((sum, shot) => sum + Number(parseJson<Record<string, unknown>>(shot.payload, {}).durationSeconds || 4), 0);
    const payload: RenderPayload = { timelineRevision: timeline.revision, shotIds, duration, warnings: clips.length ? [] : ["时间线没有声音，将导出静音 AAC 轨"] };
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
    if (row.kind === "image") { syncStoryboardImage(row); return; }
    if (row.kind === "text") { syncStoryboardReview(row); return; }
    if (row.kind !== "video") return;
    const request = parseJson<{ params?: { __directorShot?: { projectId?: string; shotId?: string; revision?: number } } }>(row.request, {});
    const context = request.params?.__directorShot;
    if (!context?.projectId || !context.shotId) return;
    const result = parseJson<{ files?: Array<{ id?: string; fileId?: string }> }>(row.result, {});
    const videoFileId = result.files?.[0]?.id || result.files?.[0]?.fileId;
    const video = videoFileId ? getStoredFile(row.user_id, videoFileId) : null;
    if (!video) return;
    const directory = await mkdtemp(join(tmpdir(), "director-frames-"));
    try {
        const first = join(directory, "first.png"); const last = join(directory, "last.png");
        await ffmpeg(["-y", "-i", video.path, "-frames:v", "1", first], undefined);
        await ffmpeg(["-y", "-sseof", "-0.12", "-i", video.path, "-frames:v", "1", last], undefined);
        const firstFile = storeLocalFile(row.user_id, first, `${context.shotId}-first.png`, "image/png");
        const lastFile = storeLocalFile(row.user_id, last, `${context.shotId}-last.png`, "image/png");
        const shot = db.prepare("SELECT payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(context.shotId, row.user_id, context.projectId) as { payload: string; revision: number } | undefined;
        if (!shot) return;
        const payload = { ...parseJson<Record<string, unknown>>(shot.payload, {}), videoFileId, videoGenerationId: row.id, actualFirstFrameFileId: firstFile.id, actualLastFrameFileId: lastFile.id, videoStale: false };
        db.transaction(() => {
            db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), new Date().toISOString(), context.shotId, row.user_id);
            syncFileRefs(row.user_id, "director_shot", context.shotId!, payload);
            markContinuationStale(row.user_id, context.projectId!, context.shotId!);
        })();
        emitRender(row.user_id, { type: "shot", projectId: context.projectId, data: { id: context.shotId, revision: shot.revision + 1, payload } });
    } finally { await rm(directory, { recursive: true, force: true }); }
}

function syncStoryboardImage(row: GenerationRow) {
    const request = parseJson<{ params?: { __directorStoryboard?: { projectId?: string; sequenceId?: string; panelId?: string }; __directorStoryboardReview?: unknown } }>(row.request, {});
    const context = request.params?.__directorStoryboard;
    if (!context?.projectId || !context.sequenceId || !context.panelId || request.params?.__directorStoryboardReview) return;
    const result = parseJson<{ files?: Array<{ id?: string; fileId?: string }> }>(row.result, {});
    const fileId = String(result.files?.[0]?.fileId || result.files?.[0]?.id || "");
    if (!fileId) return;
    const sequence = storyboardSequence(row.user_id, context.sequenceId);
    const panels = storyboardPanels(sequence.payload);
    const panel = panels.find((item) => String(item.id) === context.panelId);
    if (!panel || panel.generationId !== row.id) return;
    panel.imageFileId = fileId;
    panel.review = { status: "pending", summary: "正在检查叙事与连续性", issues: [] };
    const payload = { ...parseJson<Record<string, unknown>>(sequence.payload, {}), storyboard: panels };
    db.prepare("UPDATE director_sequences SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), new Date().toISOString(), sequence.id, row.user_id);
    syncFileRefs(row.user_id, "director_sequence", sequence.id, payload);
    emitRender(row.user_id, { type: "sequence", projectId: context.projectId, data: { id: sequence.id, revision: sequence.revision + 1, payload } });
    const model = getAiGlobalSettings().config.creativeAssetReviewModel;
    if (!model) {
        panel.review = { status: "manual", summary: "未配置视觉质检模型，请人工检查", issues: [] };
        const manualPayload = { ...payload, storyboard: panels };
        db.prepare("UPDATE director_sequences SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(manualPayload), new Date().toISOString(), sequence.id, row.user_id);
        emitRender(row.user_id, { type: "sequence", projectId: context.projectId, data: { id: sequence.id, revision: sequence.revision + 2, payload: manualPayload } });
        return;
    }
    const previous = panels[panels.indexOf(panel) - 1];
    const project = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=?").get(context.projectId, row.user_id) as { payload: string } | undefined;
    const styleId = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload || "{}", {}).defaultVisualStyleId || "");
    const style = styleId ? db.prepare("SELECT reference_files FROM visual_styles WHERE id=? AND user_id=? AND project_id=?").get(styleId, row.user_id, context.projectId) as { reference_files: string } | undefined : undefined;
    const identityReferences = style ? storyboardReferences(row.user_id, context.projectId, undefined, panel, style, 8) : [];
    const references = Array.from(new Map([{ fileId, kind: "image" as const }, ...(previous?.imageFileId ? [{ fileId: String(previous.imageFileId), kind: "image" as const }] : []), ...identityReferences].map((item) => [item.fileId, item])).values());
    createGeneration(row.user_id, { kind: "text", model, prompt: `你是长视频故事板视觉质检员。检查第一张参考图是否表达当前分格叙事，并在提供第二张时检查与前一格的屏幕方向、空间、动作和状态连续性。叙事目的：${String(panel.purpose || panel.title || "")}; 动作：${String(panel.action || panel.description || "")}。检查角色、场景、关键道具身份匹配，以及意外文字和身份漂移。只输出 JSON：{"passed":boolean,"summary":string,"issues":string[],"metrics":object}。`, references, params: { __directorStoryboardReview: { projectId: context.projectId, sequenceId: sequence.id, panelId: panel.id, sourceGenerationId: row.id, fileId } } });
}

function syncStoryboardReview(row: GenerationRow) {
    const request = parseJson<{ params?: { __directorStoryboardReview?: { projectId?: string; sequenceId?: string; panelId?: string; sourceGenerationId?: string; fileId?: string } } }>(row.request, {});
    const context = request.params?.__directorStoryboardReview;
    if (!context?.projectId || !context.sequenceId || !context.panelId || !context.sourceGenerationId || !context.fileId) return;
    const sequence = storyboardSequence(row.user_id, context.sequenceId);
    const panels = storyboardPanels(sequence.payload);
    const panel = panels.find((item) => String(item.id) === context.panelId);
    if (!panel || panel.generationId !== context.sourceGenerationId || panel.imageFileId !== context.fileId) return;
    const parsed = parseVisualReview(String(parseJson<{ text?: string }>(row.result, {}).text || ""));
    panel.review = parsed ? { status: parsed.passed ? "passed" : "failed", summary: parsed.summary, issues: parsed.issues, metrics: parsed.metrics, generationId: row.id } : { status: "manual", summary: "自动质检结果无法解析，请人工检查", issues: [], generationId: row.id };
    const payload = { ...parseJson<Record<string, unknown>>(sequence.payload, {}), storyboard: panels };
    db.prepare("UPDATE director_sequences SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), new Date().toISOString(), sequence.id, row.user_id);
    emitRender(row.user_id, { type: "sequence", projectId: context.projectId, data: { id: sequence.id, revision: sequence.revision + 1, payload } });
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
    const payload = parseJson<RenderPayload>(row.payload, { timelineRevision: 0, shotIds: [], duration: 0, warnings: [] });
    if (timeline.revision !== payload.timelineRevision) throw renderError(409, "DIRECTOR_RENDER_STALE", "时间线已变化，请创建新的合成任务");
    const shots = payload.shotIds.map((id) => db.prepare("SELECT id,position,payload,revision FROM director_shots WHERE id=? AND user_id=? AND project_id=?").get(id, row.user_id, row.project_id) as ShotRow | undefined).filter(Boolean) as ShotRow[];
    const timelinePayload = parseJson<{ tracks?: Array<{ clips?: AudioClip[] }> }>(timeline.payload, {});
    const directory = await mkdtemp(join(tmpdir(), "director-render-"));
    try {
        const [width, height] = outputSize(workspace.aspect_ratio);
        const normalized: string[] = [];
        for (let index = 0; index < shots.length; index += 1) {
            const shot = parseJson<Record<string, unknown>>(shots[index].payload, {});
            const source = getStoredFile(row.user_id, String(shot.videoFileId || ""));
            if (!source) throw new Error(`镜头 ${shots[index].id} 的视频文件不存在`);
            const output = join(directory, `shot-${String(index).padStart(4, "0")}.mp4`);
            await ffmpeg(["-y", "-i", source.path, "-t", String(Number(shot.durationSeconds || 4)), "-an", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", output], signal);
            normalized.push(output); updateRender(row, { progress: .05 + .55 * ((index + 1) / shots.length) });
        }
        const concat = join(directory, "concat.txt"); await writeFile(concat, normalized.map((path) => `file '${path}'`).join("\n"));
        const silentVideo = join(directory, "video.mp4");
        await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", silentVideo], signal);
        updateRender(row, { progress: .7 });
        const output = join(directory, "final.mp4");
        const clips = (timelinePayload.tracks || []).flatMap((track) => track.clips || []).filter((clip) => !clip.muted);
        const args = ["-y", "-i", silentVideo];
        const usable: AudioClip[] = [];
        for (const clip of clips) {
            const file = getStoredFile(row.user_id, clip.fileId); if (!file) continue;
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
    rows.forEach((row) => { const payload = parseJson<Record<string, unknown>>(row.payload, {}); if (payload.boundary === "continue" && payload.continuationFromShotId === shotId) db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...payload, videoStale: true, needsReview: true }), new Date().toISOString(), row.id, userId); });
}
function validateShotAssetRefs(userId: string, projectId: string, payload: Record<string, unknown>) {
    const refs = [payload.characterRefs, payload.sceneRefs, payload.propRefs].flatMap((value) => Array.isArray(value) ? value : []) as Array<{ id?: string; revision?: number }>;
    for (const reference of refs) {
        const asset = db.prepare("SELECT revision,status FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId) as { revision: number; status: string } | undefined;
        if (!asset || asset.revision !== reference.revision || !["confirmed", "locked"].includes(asset.status)) throw renderError(409, "DIRECTOR_ASSET_STALE", "镜头引用的角色、场景或道具尚未确认或版本已变化");
    }
}
type StoryboardPanel = Record<string, unknown> & { id: string; position?: number; imageFileId?: string; generationId?: string; review?: Record<string, unknown> };
type StoryboardSequenceRow = { id: string; user_id: string; project_id: string; title: string; summary: string; status: string; payload: string; revision: number };
function storyboardSequence(userId: string, sequenceId: string) {
    const row = db.prepare("SELECT * FROM director_sequences WHERE id=? AND user_id=?").get(sequenceId, userId) as StoryboardSequenceRow | undefined;
    if (!row) throw renderError(404, "DIRECTOR_SEQUENCE_NOT_FOUND", "剧情段落不存在");
    return row;
}
function storyboardPanels(payload: string) {
    const panels = parseJson<{ storyboard?: StoryboardPanel[] }>(payload, {}).storyboard;
    return Array.isArray(panels) ? panels.map((panel) => ({ ...panel })) : [];
}
function validateStoryboardRefs(userId: string, projectId: string, panel: StoryboardPanel) {
    const refs = [panel.characterRefs, panel.sceneRefs, panel.propRefs].flatMap((value) => Array.isArray(value) ? value : []) as Array<{ id?: string; revision?: number }>;
    refs.forEach((reference) => {
        const asset = db.prepare("SELECT revision,status FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId) as { revision: number; status: string } | undefined;
        if (!asset || asset.revision !== reference.revision || !["confirmed", "locked"].includes(asset.status)) throw renderError(409, "DIRECTOR_ASSET_STALE", "故事板引用的角色、场景或道具尚未确认或版本已变化");
    });
}
function storyboardReferences(userId: string, projectId: string, previous: StoryboardPanel | undefined, panel: StoryboardPanel, style: { reference_files: string }, limit: number) {
    const assetFile = (reference: { id?: string }) => {
        const row = db.prepare("SELECT payload FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").get(reference.id, userId, projectId) as { payload: string } | undefined;
        const payload = parseJson<{ primaryImageId?: string; variants?: Array<{ id?: string; fileId?: string; kind?: string }> }>(row?.payload || "{}", {});
        return payload.variants?.find((variant) => variant.id === payload.primaryImageId && variant.kind === "image")?.fileId;
    };
    const refs = (value: unknown) => Array.isArray(value) ? value as Array<{ id?: string }> : [];
    const styleRefs = parseJson<{ source?: string; character?: string; scene?: string; prop?: string }>(style.reference_files, {});
    const ordered = [
        previous?.imageFileId,
        ...refs(panel.characterRefs).map(assetFile),
        ...refs(panel.sceneRefs).map(assetFile),
        ...refs(panel.propRefs).map(assetFile),
        styleRefs.scene || styleRefs.source || styleRefs.character || styleRefs.prop,
    ].filter((value): value is string => Boolean(value));
    return Array.from(new Set(ordered)).slice(0, limit).map((fileId) => ({ fileId, kind: "image" as const, role: "reference" as const }));
}
function outputSize(ratio: string): [number, number] { if (ratio === "9:16") return [1080, 1920]; if (ratio === "1:1") return [1080, 1080]; if (ratio === "2.39:1") return [1920, 804]; return [1920, 1080]; }
function updateRender(row: RenderRow, patch: { status?: RenderRow["status"]; progress?: number; error?: string }) { db.prepare("UPDATE director_renders SET status=coalesce(?,status),progress=coalesce(?,progress),error=?,updated_at=? WHERE id=? AND user_id=?").run(patch.status || null, patch.progress ?? null, patch.error || null, new Date().toISOString(), row.id, row.user_id); const next = renderRow(row.user_id, row.id); if (next) publish(next); }
function publish(row: RenderRow) { const data = renderResponse(row); emitRender(row.user_id, { type: "render", projectId: row.project_id, data }); return data; }
function renderRow(userId: string, id: string) { return db.prepare("SELECT * FROM director_renders WHERE id=? AND user_id=?").get(id, userId) as RenderRow | undefined; }
function renderResponse(row: RenderRow) { return { id: row.id, projectId: row.project_id, status: row.status, payload: parseJson(row.payload, {}), outputFileId: row.output_file_id, error: row.error, progress: row.progress, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assertDirector(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw renderError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在"); }
function renderError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }
