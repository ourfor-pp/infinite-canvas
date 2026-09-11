import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { db } from "../database.js";
import { getStoredFile, storeLocalFile } from "../file-store.js";
import { runTextModelOnce } from "../generation-service.js";
import { cacheDirectorMediaFile, resolveDirectorMediaFile } from "../director-workspace.js";

const execFileAsync = promisify(execFile);

export async function understandDirectorAudios(userId: string, projectId: string, modelRef: string, input: { items: Array<{ path: string; prompt?: string }> }) {
    const files = input.items.map(({ path, prompt }) => ({ fileId: resolveDirectorMediaFile(userId, projectId, path, "audio").fileId, prompt }));
    const results = await understandProjectAudios(userId, projectId, modelRef, { items: files });
    return results.map(({ text, structured }, index) => ({ path: input.items[index].path, text, ...(structured === undefined ? {} : { structured }) }));
}

export async function sampleDirectorVideo(userId: string, projectId: string, input: { path: string; mode: "overview" | "frames"; count?: number; timesSeconds?: number[] }) {
    const { fileId } = resolveDirectorMediaFile(userId, projectId, input.path, "video");
    if (input.mode === "overview") {
        if (input.timesSeconds?.length) throw mediaError("MEDIA_SAMPLE_OPTIONS", "指定时间抽帧请使用 frames 模式");
        const result = await prepareProjectVideoOverview(userId, projectId, { fileId, frameCount: input.count });
        return { path: input.path, mode: input.mode, probe: result.probe, frameCount: result.frameCount, layout: result.layout, image: cacheDirectorMediaFile(userId, projectId, result.contactSheet.fileId) };
    }
    const result = await sampleProjectVideoFrames(userId, projectId, { fileId, count: input.count, timesSeconds: input.timesSeconds });
    return { path: input.path, mode: input.mode, probe: result.probe, frames: result.frames.map(({ timeSeconds, file }) => ({ timeSeconds, ...cacheDirectorMediaFile(userId, projectId, file.fileId) })) };
}

export async function understandProjectImages(userId: string, projectId: string, modelRef: string, input: { fileIds: string[]; prompt?: string; detail?: "low" | "high" | "xhigh" }) {
    requireMediaModel(modelRef);
    const files = input.fileIds.map((id) => requireMediaFile(userId, projectId, id, "image"));
    const detail = input.detail || "low";
    const prompt = `${input.prompt?.trim() || "客观描述这些图片的主体、构图、风格、可见文字、明显缺陷和不确定之处。"}\n\n按输入顺序分析 ${files.length} 张图片。只根据可见证据回答，不要臆测。输出简洁 JSON：{"observations":[{"inputIndex":0,"observation":"...","visibleText":[],"uncertainty":[]}],"sequenceSummary":"..."}。视觉细节等级：${detail}。`;
    const result = await runTextModelOnce(userId, modelRef, { prompt, references: input.fileIds.map((fileId) => ({ fileId, kind: "image" as const })), params: { temperature: 0.1 } });
    return mediaUnderstandingResult(modelRef, input.fileIds, result);
}

export async function understandProjectAudios(userId: string, projectId: string, modelRef: string, input: { items: Array<{ fileId: string; prompt?: string }> }) {
    requireMediaModel(modelRef);
    return Promise.all(input.items.map(async (item) => {
        requireMediaFile(userId, projectId, item.fileId, "audio");
        const prompt = `${item.prompt?.trim() || "分析这段声音中的语音内容、说话人数、语气、音乐、环境声、动作声和异常声音。"}\n\n这是声音语义理解，不是精确转写。只报告听到的证据；不确定的台词明确标注不确定，不要编造逐词时间。输出简洁 JSON：{"summary":"...","speech":[],"music":[],"ambience":[],"soundEvents":[],"uncertainty":[]}。`;
        const result = await runTextModelOnce(userId, modelRef, { prompt, references: [{ fileId: item.fileId, kind: "audio" }], params: { temperature: 0.1 } });
        return mediaUnderstandingResult(modelRef, [item.fileId], result);
    }));
}

export async function prepareProjectVideoOverview(userId: string, projectId: string, input: { fileId: string; frameCount?: number }) {
    const file = requireMediaFile(userId, projectId, input.fileId, "video");
    const probe = await probeVideo(file.path);
    const frameCount = Math.max(4, Math.min(20, Math.floor(input.frameCount || 9)));
    const columns = Math.ceil(Math.sqrt(frameCount));
    const rows = Math.ceil(frameCount / columns);
    const work = mkdtempSync(resolve(tmpdir(), "infinite-canvas-video-overview-"));
    const output = resolve(work, "contact-sheet.jpg");
    try {
        const rate = Math.max(0.001, frameCount / Math.max(0.1, probe.durationSeconds));
        await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file.path, "-vf", `fps=${rate},scale=480:-2,tile=${columns}x${rows}:nb_frames=${frameCount}:padding=4:margin=4:color=white`, "-frames:v", "1", "-q:v", "2", output], { maxBuffer: 4 * 1024 * 1024 });
        const stored = storeLocalFile(userId, output, `${file.original_name}-contact-sheet.jpg`, "image/jpeg");
        addProjectFileRef(userId, projectId, stored.fileId);
        return { sourceFileId: input.fileId, probe, frameCount, layout: `${columns}x${rows}`, contactSheet: stored };
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

export async function sampleProjectVideoFrames(userId: string, projectId: string, input: { fileId: string; count?: number; timesSeconds?: number[] }) {
    const file = requireMediaFile(userId, projectId, input.fileId, "video");
    const probe = await probeVideo(file.path);
    const count = Math.max(1, Math.min(16, Math.floor(input.count || 6)));
    const times = input.timesSeconds?.length
        ? input.timesSeconds.slice(0, 16).map((value) => Math.max(0, Math.min(probe.durationSeconds, value)))
        : Array.from({ length: count }, (_, index) => probe.durationSeconds * (index + 0.5) / count);
    const work = mkdtempSync(resolve(tmpdir(), "infinite-canvas-video-frames-"));
    try {
        const frames = [];
        for (let index = 0; index < times.length; index += 1) {
            const output = resolve(work, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
            await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(times[index]), "-i", file.path, "-frames:v", "1", "-q:v", "2", output], { maxBuffer: 4 * 1024 * 1024 });
            const stored = storeLocalFile(userId, output, `${file.original_name}-frame-${index + 1}.jpg`, "image/jpeg");
            addProjectFileRef(userId, projectId, stored.fileId);
            frames.push({ timeSeconds: Number(times[index].toFixed(3)), file: stored });
        }
        return { sourceFileId: input.fileId, probe, frames };
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

async function probeVideo(path: string) {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", path], { maxBuffer: 2 * 1024 * 1024 });
    const payload = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string }>; format?: { duration?: string } };
    const stream = payload.streams?.[0] || {};
    const [numerator, denominator] = String(stream.avg_frame_rate || "0/1").split("/").map(Number);
    return { durationSeconds: Number(Number(payload.format?.duration || 0).toFixed(3)), width: Number(stream.width || 0), height: Number(stream.height || 0), fps: denominator ? Number((numerator / denominator).toFixed(3)) : 0 };
}

function requireMediaFile(userId: string, projectId: string, fileId: string, kind: "image" | "audio" | "video") {
    const file = getStoredFile(userId, fileId);
    if (!file) throw mediaError("MEDIA_FILE_NOT_FOUND", "媒体文件不存在或无权访问");
    if (!projectOwnsFile(userId, projectId, fileId)) throw mediaError("MEDIA_FILE_PROJECT_FORBIDDEN", "媒体文件不属于当前项目");
    if (!file.mime_type.startsWith(`${kind}/`)) throw mediaError("MEDIA_TYPE_INVALID", `请选择${kind === "image" ? "图片" : kind === "audio" ? "音频" : "视频"}文件`);
    return file;
}

function projectOwnsFile(userId: string, projectId: string, fileId: string) {
    return Boolean(db.prepare(`SELECT 1 FROM file_refs r WHERE r.user_id=? AND r.file_id=? AND (
        (r.owner_type IN ('project','agent_project','director_project') AND r.owner_id=?) OR
        (r.owner_type='creative_asset' AND EXISTS(SELECT 1 FROM creative_assets a WHERE a.id=r.owner_id AND a.user_id=r.user_id AND a.project_id=?)) OR
        (r.owner_type='visual_style' AND EXISTS(SELECT 1 FROM visual_styles s WHERE s.id=r.owner_id AND s.user_id=r.user_id AND s.project_id=?)) OR
        (r.owner_type='director_shot' AND EXISTS(SELECT 1 FROM director_shots d WHERE d.id=r.owner_id AND d.user_id=r.user_id AND d.project_id=?)) OR
        (r.owner_type='director_sequence' AND EXISTS(SELECT 1 FROM director_sequences d WHERE d.id=r.owner_id AND d.user_id=r.user_id AND d.project_id=?)) OR
        (r.owner_type='director_source' AND EXISTS(SELECT 1 FROM director_sources d WHERE d.id=r.owner_id AND d.user_id=r.user_id AND d.project_id=?)) OR
        (r.owner_type='director_render' AND EXISTS(SELECT 1 FROM director_renders d WHERE d.id=r.owner_id AND d.user_id=r.user_id AND d.project_id=?))
    ) LIMIT 1`).get(userId, fileId, projectId, projectId, projectId, projectId, projectId, projectId, projectId));
}

function requireMediaModel(modelRef: string) {
    if (!modelRef) throw mediaError("MEDIA_UNDERSTANDING_MODEL_NOT_CONFIGURED", "管理员尚未配置媒体理解模型");
}

function addProjectFileRef(userId: string, projectId: string, fileId: string) {
    db.prepare("INSERT OR IGNORE INTO file_refs(file_id,user_id,owner_type,owner_id) VALUES(?,?,'agent_project',?)").run(fileId, userId, projectId);
}

function mediaUnderstandingResult(modelRef: string, fileIds: string[], result: Record<string, unknown>) {
    const text = String(result.text || "").trim();
    let structured: unknown;
    try { structured = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { structured = undefined; }
    return { modelRef, fileIds, text, ...(structured === undefined ? {} : { structured }), usage: result.usage };
}

function mediaError(code: string, message: string) { return Object.assign(new Error(message), { code, status: 400 }); }
