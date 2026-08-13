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
import { listModelDefaults, resolveSelectableModel, type AiModelDefinition } from "./provider-service.js";

type RenderRow = { id: string; user_id: string; project_id: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; payload: string; output_file_id: string | null; error: string | null; progress: number; created_at: string; updated_at: string };
type ShotRow = { id: string; position: number; payload: string; revision: number };
type TimelineRow = { payload: string; revision: number };
type WorkspaceRow = { aspect_ratio: string };
type AudioClip = { id: string; fileId: string; start: number; duration: number; trimIn?: number; volume?: number; muted?: boolean; loop?: boolean };
type RenderPayload = { timelineRevision: number; shotIds: string[]; duration: number; warnings: string[] };

const renderInput = z.object({ timelineRevision: z.number().int().positive() });
const shotGenerationInput = z.object({ revision: z.number().int().positive(), model: z.string().trim().optional(), seconds: z.number().min(1).max(30).optional(), nativeExtend: z.boolean().default(true) });
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
    const style = db.prepare("SELECT 1 FROM visual_styles WHERE user_id=? AND project_id=? AND status IN ('confirmed','locked') LIMIT 1").get(userId, shot.project_id);
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
    if (row.kind !== "video" || row.status !== "succeeded") return;
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
function outputSize(ratio: string): [number, number] { if (ratio === "9:16") return [1080, 1920]; if (ratio === "1:1") return [1080, 1080]; if (ratio === "2.39:1") return [1920, 804]; return [1920, 1080]; }
function updateRender(row: RenderRow, patch: { status?: RenderRow["status"]; progress?: number; error?: string }) { db.prepare("UPDATE director_renders SET status=coalesce(?,status),progress=coalesce(?,progress),error=?,updated_at=? WHERE id=? AND user_id=?").run(patch.status || null, patch.progress ?? null, patch.error || null, new Date().toISOString(), row.id, row.user_id); const next = renderRow(row.user_id, row.id); if (next) publish(next); }
function publish(row: RenderRow) { const data = renderResponse(row); emitRender(row.user_id, { type: "render", projectId: row.project_id, data }); return data; }
function renderRow(userId: string, id: string) { return db.prepare("SELECT * FROM director_renders WHERE id=? AND user_id=?").get(id, userId) as RenderRow | undefined; }
function renderResponse(row: RenderRow) { return { id: row.id, projectId: row.project_id, status: row.status, payload: parseJson(row.payload, {}), outputFileId: row.output_file_id, error: row.error, progress: row.progress, createdAt: row.created_at, updatedAt: row.updated_at }; }
function assertDirector(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw renderError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在"); }
function renderError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }
