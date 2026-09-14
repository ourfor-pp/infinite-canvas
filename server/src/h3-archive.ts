import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import type AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getStoredFile, storeLocalFile, syncFileRefs } from "./file-store.js";
import { h3StateContextSchema, resolveDirectorH3Continuation, resolveDirectorH3Cumulative, validateH3NativeVideo } from "./h3-continuation.js";

const manifestPath = ".h3/manifest.json";
const media = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const entrySchema = z.object({
    segmentId: z.string().min(1), parentSegmentId: z.string().min(1).optional(),
    sourceGenerationId: z.string().min(1), model: z.string(), prompt: z.string(),
    qualityPreset: z.enum(["preview", "final"]), context: h3StateContextSchema,
    video: media, state: media, cumulative: media,
}).strict();
const manifestSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(1000) }).strict();
type Entry = z.infer<typeof entrySchema>;
type Binding = Awaited<ReturnType<typeof resolveDirectorH3Continuation>>;
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400, code: "DIRECTOR_H3_ARCHIVE_INVALID" }); }
function archivePath(root: string, path: string) {
    const target = resolve(root, path);
    if (!path.startsWith(".h3/") || path.includes("\\") || path.split("/").includes("..") || !target.startsWith(`${resolve(root)}${sep}`)) invalid("原生工程文件路径无效");
    return target;
}

export async function addH3Archive(zip: AdmZip, userId: string, projectId: string, externalId: (id: string) => string) {
    const rows = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const entries: Entry[] = [];
    for (const row of rows) {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        if (!payload.h3ContinuationState) continue;
        const cumulative = await resolveDirectorH3Cumulative(userId, projectId, row.id);
        const state = await resolveDirectorH3Continuation(userId, projectId, row.id, cumulative.context);
        const generation = db.prepare("SELECT model_id,request FROM generations WHERE user_id=? AND id=?").get(userId, state.generationId) as { model_id: string; request: string };
        const request = parseJson<{ prompt?: string; metadata?: { directorSegment?: { previousState?: { segmentId: string } }; archiveImport?: { sourceGenerationId: string } } }>(generation.request, {});
        const folder = `.h3/${entries.length}`;
        const add = (fileId: string, name: string, expected: string) => {
            const file = getStoredFile(userId, fileId);
            if (!file) invalid("原生工程来源文件不存在");
            const data = readFileSync(file.path);
            if (hash(data) !== expected) invalid("导出期间原生工程来源发生变化");
            const path = `${folder}/${name}`; zip.addFile(path, data);
            return { path, sha256: expected };
        };
        entries.push({ segmentId: externalId(row.id), ...(request.metadata?.directorSegment?.previousState ? { parentSegmentId: externalId(request.metadata!.directorSegment!.previousState.segmentId) } : {}), sourceGenerationId: request.metadata?.archiveImport?.sourceGenerationId || state.generationId, model: generation.model_id, prompt: String(request.prompt || ""), qualityPreset: payload.videoQualityPreset === "final" ? "final" : "preview", context: state.context,
            video: add(state.videoFileId, "source.mp4", state.videoSha256), state: add(state.fileId, "state.safetensors", state.stateSha256), cumulative: add(cumulative.fileId, "cumulative.mp4", cumulative.sha256) });
    }
    if (rows.some((row) => (db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, row.id) as { payload: string } | undefined)?.payload !== row.payload)) invalid("导出期间视频段发生变化");
    if (entries.length) zip.addFile(manifestPath, Buffer.from(JSON.stringify(manifestSchema.parse({ version: 1, entries }), null, 2)));
}

export async function validateH3Archive(root: string) {
    try {
        if (!existsSync(resolve(root, manifestPath))) return [];
        const { entries } = manifestSchema.parse(JSON.parse(readFileSync(resolve(root, manifestPath), "utf8")));
        const byId = new Map(entries.map((entry) => [entry.segmentId, entry]));
        if (byId.size !== entries.length) invalid("原生工程视频段重复");
        for (const entry of entries) {
            const parent = entry.parentSegmentId ? byId.get(entry.parentSegmentId) : undefined;
            if (entry.parentSegmentId && (!parent || parent.context.frames >= entry.context.frames)) invalid("原生工程来源链缺失或循环");
            if (parent && ["modelRevision", "videoVaeRevision", "audioVaeRevision", "width", "height", "fps"].some((key) => parent.context[key as keyof typeof parent.context] !== entry.context[key as keyof typeof entry.context])) invalid("原生工程来源运行时不一致");
            for (const file of [entry.video, entry.state, entry.cumulative]) if (hash(readFileSync(archivePath(root, file.path))) !== file.sha256) invalid("原生工程文件内容校验失败");
            await validateH3NativeVideo(archivePath(root, entry.video.path), entry.context, parent?.context.frames || 0);
            await validateH3NativeVideo(archivePath(root, entry.cumulative.path), entry.context, 0);
        }
        return entries.sort((a, b) => a.context.frames - b.context.frames);
    } catch (error) { invalid(`原生工程校验失败：${error instanceof Error ? error.message : String(error)}`); }
}

export function restoreH3Archive(userId: string, projectId: string, root: string, entries: Entry[], segmentId: (id: string) => string) {
    const bindings = new Map<string, Binding>();
    const createdPaths: string[] = [];
    try { db.transaction(() => {
        for (const entry of entries) {
            const id = segmentId(entry.segmentId);
            const row = db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, id) as { payload: string } | undefined;
            if (!row) invalid("原生工程引用的视频段不存在");
            const payload = parseJson<Record<string, unknown>>(row.payload, {});
            if (entry.parentSegmentId && payload.continuationFromSegmentId !== segmentId(entry.parentSegmentId)) invalid("原生工程来源链与视频段续接关系不一致");
            const adoptedVideo = getStoredFile(userId, String(payload.videoFileId || ""));
            if (!adoptedVideo || hash(readFileSync(adoptedVideo.path)) !== entry.video.sha256) invalid("原生状态与导入采用视频不一致");
            const state = storeLocalFile(userId, archivePath(root, entry.state.path), "state.safetensors");
            createdPaths.push(getStoredFile(userId, state.fileId)!.path);
            const cumulative = storeLocalFile(userId, archivePath(root, entry.cumulative.path), "cumulative.mp4", "video/mp4");
            createdPaths.push(getStoredFile(userId, cumulative.fileId)!.path);
            const generationId = nanoid(), now = new Date().toISOString();
            const binding = { projectId, segmentId: id, generationId, videoFileId: adoptedVideo.id, fileId: state.fileId, videoSha256: entry.video.sha256, stateSha256: entry.state.sha256, context: entry.context };
            const parent = entry.parentSegmentId ? bindings.get(entry.parentSegmentId) : undefined;
            if (entry.parentSegmentId && !parent) invalid("原生工程前段未恢复");
            const request = { kind: "video", prompt: entry.prompt, metadata: { directorSegment: { projectId, segmentId: id, previousState: parent }, archiveImport: { version: 1, sourceGenerationId: entry.sourceGenerationId } }, ...(parent ? { continuation: { generationId: parent.generationId, fileId: parent.fileId } } : {}) };
            const result = { imported: true, files: [{ fileId: adoptedVideo.id }], continuationStates: [{ ...state, sha256: entry.state.sha256, context: entry.context }], cumulativeVideos: [cumulative], execution: { context: entry.context } };
            db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,result,progress,created_at,updated_at) VALUES(?,?,'video','succeeded',?,?,?,1,?,?)").run(generationId, userId, entry.model, JSON.stringify(request), JSON.stringify(result), now, now);
            const next = { ...payload, videoGenerationId: generationId, videoStale: false, videoQualityPreset: entry.qualityPreset, videoDurationSeconds: (entry.context.frames - Number(parent?.context.frames || 0)) / 24, h3ContinuationState: binding, h3CumulativeVideo: { fileId: cumulative.fileId, sha256: entry.cumulative.sha256, generationId, stateSha256: entry.state.sha256, frames: entry.context.frames } };
            db.prepare("UPDATE director_shots SET payload=?,revision=revision+1 WHERE user_id=? AND project_id=? AND id=?").run(JSON.stringify(next), userId, projectId, id);
            syncFileRefs(userId, "generation", generationId, result); syncFileRefs(userId, "director_shot", id, next);
            bindings.set(entry.segmentId, binding);
        }
    })(); } catch (error) { for (const path of createdPaths) rmSync(path, { force: true }); throw error; }
}
