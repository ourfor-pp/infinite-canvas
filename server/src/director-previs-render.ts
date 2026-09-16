import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { z } from "zod";
import { db } from "./database.js";
import { previsLocation, validDirectorPrevis } from "./director-previs.js";
import { directorProjectRoot, registerDirectorMediaFile, safeWorkspacePath } from "./director-workspace.js";
import { markDirectorProjectChanged } from "./director-sync.js";

db.exec(`CREATE TABLE IF NOT EXISTS director_previs_renders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, segment_id TEXT NOT NULL,
    status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, snapshot TEXT NOT NULL, result TEXT,
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id,user_id) REFERENCES projects(id,user_id) ON DELETE CASCADE
); CREATE INDEX IF NOT EXISTS idx_previs_queue ON director_previs_renders(status,created_at);`);
import type { PrevisExportSnapshot as Snapshot } from "./previs/export.js";
export { exportPrevis } from "./previs/export.js";
type Job = { id: string; user_id: string; project_id: string; segment_id: string; status: string; progress: number; snapshot: string; result: string | null; error: string | null; created_at: string; updated_at: string };
let active: { id: string; abort: AbortController } | undefined;
function dimensions(aspect: string) {
    const [w, h] = aspect.split(":").map(Number), ratio = w / h;
    if (!Number.isFinite(ratio) || ratio < .125 || ratio > 8) throw new Error("项目画幅无效");
    return { width: Math.round((ratio >= 1 ? 480 * ratio : 480) / 2) * 2, height: Math.round((ratio >= 1 ? 480 : 480 / ratio) / 2) * 2 };
}
const requestSchema = z.object({ expectedHash: z.string(), start: z.number().nonnegative().default(0), end: z.number().positive().optional(), kind: z.enum(["video", "frame"]).default("video"), frameId: z.string().regex(/^[\w-]+$/).optional() }).strict();
export function createPrevisRender(userId: string, projectId: string, segmentId: string, input: unknown) {
    const request = requestSchema.parse(input), state = validDirectorPrevis(userId, projectId, segmentId, request.expectedHash);
    const end = request.end ?? state.plan.duration;
    if (request.start > state.plan.duration || end > state.plan.duration || (request.kind === "video" && end <= request.start)) throw new Error("导出范围超出分镜段");
    if (request.kind === "video" && Math.abs((end - request.start) * 24 - Math.round((end - request.start) * 24)) > 1e-6) throw new Error("预演导出时长必须对齐 24 fps 的整帧，请明确调整时间范围");
    const { root, folder } = previsLocation(userId, projectId, segmentId), id = randomUUID();
    let output = relative(root, resolve(folder, "previs-exports", `${id}.mp4`)).replaceAll("\\", "/");
    let captureId: string | undefined;
    if (request.kind === "frame") {
        const frame = state.lookFrames.find((item) => item.id === request.frameId);
        if (!frame || (frame.captureHash || frame.sourceHash) !== state.hash || frame.time !== request.start) throw new Error("定妆帧与当前预演时刻不匹配");
        captureId = frame.captureId;
        output = `${frame.path}/inputs/previs.png`;
    }
    const snapshot: Snapshot = { scene: state.scene, plan: state.plan, hash: state.hash, start: request.start, end, frames: request.kind === "frame" ? 1 : Math.max(1, Math.round((end - request.start) * 24)), ...dimensions(state.aspectRatio), kind: request.kind, output, captureId };
    const now = new Date().toISOString();
    db.prepare("INSERT INTO director_previs_renders(id,user_id,project_id,segment_id,status,snapshot,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?,?)").run(id, userId, projectId, segmentId, JSON.stringify(snapshot), now, now);
    markDirectorProjectChanged(userId, projectId, ["renders"]); queueMicrotask(() => void pump());
    return getPrevisRender(userId, projectId, id);
}
export function getPrevisRender(userId: string, projectId: string, id: string) {
    const job = db.prepare("SELECT * FROM director_previs_renders WHERE id=? AND user_id=? AND project_id=?").get(id, userId, projectId) as Job | undefined;
    if (!job) throw Object.assign(new Error("预演导出任务不存在"), { status: 404 });
    return summary(job);
}
function summary(job: Job) {
    const snapshot: Snapshot = JSON.parse(job.snapshot);
    return { id: job.id, segmentId: job.segment_id, status: job.status, progress: job.progress, error: job.error, sourceHash: snapshot.hash, start: snapshot.start, end: snapshot.end, kind: snapshot.kind, result: job.result ? JSON.parse(job.result) : null, createdAt: job.created_at };
}
export function listPrevisRenders(userId: string, projectId: string, segmentId: string, offset = 0, limit = 20) {
    previsLocation(userId, projectId, segmentId);
    const rows = db.prepare("SELECT * FROM director_previs_renders WHERE user_id=? AND project_id=? AND segment_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").all(userId, projectId, segmentId, Math.max(1, Math.min(50, limit)), Math.max(0, offset)) as Job[];
    return { items: rows.map(summary), offset };
}
export function cancelPrevisRender(userId: string, projectId: string, id: string) {
    const job = getPrevisRender(userId, projectId, id);
    if (["queued", "running"].includes(job.status)) {
        db.prepare("UPDATE director_previs_renders SET status='cancelled',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
        if (active?.id === id) active.abort.abort();
        markDirectorProjectChanged(userId, projectId, ["renders"]);
    }
    return getPrevisRender(userId, projectId, id);
}
export function retryPrevisRender(userId: string, projectId: string, id: string) {
    const job = getPrevisRender(userId, projectId, id);
    if (!["failed", "cancelled"].includes(job.status)) throw new Error("仅失败或取消的任务可以重试");
    if (active?.id === id) throw new Error("任务正在停止，请稍后重试");
    db.prepare("UPDATE director_previs_renders SET status='queued',progress=0,error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    queueMicrotask(() => void pump()); return getPrevisRender(userId, projectId, id);
}
export function resumePrevisRenders() {
    db.prepare("UPDATE director_previs_renders SET status='queued',progress=0 WHERE status='running'").run();
    void pump();
}
async function pump() {
    if (active || !db.open) return;
    const job = db.prepare("SELECT * FROM director_previs_renders WHERE status='queued' ORDER BY created_at,id LIMIT 1").get() as Job | undefined;
    if (!job) return;
    active = { id: job.id, abort: new AbortController() };
    const abort = active.abort;
    const update = (status: string, progress: number, error: string | null = null, result: unknown = null) => {
        if (!db.open) return;
        db.prepare("UPDATE director_previs_renders SET status=?,progress=?,error=?,result=?,updated_at=? WHERE id=? AND status!='cancelled'").run(status, progress, error, result ? JSON.stringify(result) : null, new Date().toISOString(), job.id);
        markDirectorProjectChanged(job.user_id, job.project_id, ["renders"]);
    };
    update("running", 0);
    const snapshot: Snapshot = JSON.parse(job.snapshot), root = directorProjectRoot(job.user_id, job.project_id);
    try {
        const target = safeWorkspacePath(root, snapshot.output), temporary = `${target}.${job.id}.partial`;
        mkdirSync(dirname(target), { recursive: true });
        try {
            await runPrevisWorker(snapshot, temporary, abort.signal, (progress) => update("running", progress));
            abort.signal.throwIfAborted();
            if (!db.prepare("SELECT 1 FROM projects WHERE user_id=? AND id=?").get(job.user_id, job.project_id)) throw new Error("导演项目已移除");
            if (snapshot.kind === "frame") {
                const manifestPath = resolve(dirname(target), "../frame.json");
                if (!existsSync(manifestPath)) throw new Error("定妆帧已移除，提取结果不再写入");
                const frame = JSON.parse(readFileSync(manifestPath, "utf8"));
                if ((frame.captureHash || frame.sourceHash) !== snapshot.hash || frame.time !== snapshot.start || frame.captureId !== snapshot.captureId) throw new Error("定妆帧已重新提取，此次旧结果不再写入");
            }
            renameSync(temporary, target);
            const fileId = registerDirectorMediaFile(job.user_id, job.project_id, root, target);
            const result = { fileId, path: snapshot.output, hash: snapshot.hash, width: snapshot.width, height: snapshot.height, fps: 24, frames: snapshot.frames, duration: snapshot.kind === "video" ? snapshot.frames / 24 : 0 };
            if (snapshot.kind === "video") writeFileSync(target.replace(/\.[^.]+$/, ".json"), JSON.stringify({ version: 1, ...result, segmentId: job.segment_id, sourceHash: snapshot.hash, start: snapshot.start, end: snapshot.end, contentHash: createHash("sha256").update(readFileSync(target)).digest("hex") }, null, 2) + "\n");
            if (snapshot.kind === "frame") writeFileSync(resolve(dirname(target), "capture.json"), JSON.stringify({ sourceHash: snapshot.hash, time: snapshot.start, captureId: snapshot.captureId, contentHash: createHash("sha256").update(readFileSync(target)).digest("hex") }, null, 2));
            update("succeeded", 1, null, result); markDirectorProjectChanged(job.user_id, job.project_id, ["segments", "media"]);
        } finally { rmSync(temporary, { force: true }); }
    } catch (error) { update("failed", 0, error instanceof Error ? error.message : String(error)); }
    finally { active = undefined; queueMicrotask(() => void pump()); }
}

function runPrevisWorker(snapshot: Snapshot, target: string, signal: AbortSignal, progress: (value: number) => void) {
    return new Promise<void>((resolve, reject) => {
        const child = fork(fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./director-previs-worker.ts" : "./director-previs-worker.js", import.meta.url)), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
        let error = "", complete = false;
        child.stderr?.on("data", (chunk) => { error = (error + chunk).slice(-4000); });
        const cancel = () => { if (child.connected) child.send({ cancel: true }); };
        signal.addEventListener("abort", cancel, { once: true });
        child.on("message", (message: any) => { if (typeof message.progress === "number") progress(message.progress); if (message.error) error = message.error; if (message.complete) complete = true; });
        child.once("error", reject);
        child.once("exit", (code) => { signal.removeEventListener("abort", cancel); if (signal.aborted) reject(signal.reason); else if (code === 0 && complete) resolve(); else reject(new Error(error || `预演进程退出：${code}`)); });
        child.send({ snapshot, target });
        if (signal.aborted) cancel();
    });
}
