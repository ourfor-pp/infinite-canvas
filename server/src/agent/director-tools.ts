import { createGeneration } from "../generation-service.js";
import { z } from "zod";
import { db, parseJson } from "../database.js";
import { cacheDirectorMediaFile, readDirectorMusicPrompt, materializeDirectorMusic } from "../director-workspace.js";
import { listPublicModels } from "../provider-service.js";
import { getStoredFile } from "../file-store.js";

export const directorTaskQuery = z.object({ id: z.string().min(1).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) });

type GenerationSummary = { id: string; kind: string; status: string; modelId: string; error: string | null; errorCode: string | null; progress: number; createdAt: string; updatedAt: string; result: string | null };
// Filter by project before paging; requests are never returned to the agent.
const generationProjectSql = `COALESCE(${["__directorMusic", "__agentCanvas", "__creativeAsset", "__directorShot", "__directorSegment", "__directorStoryboardSheet"].map((key) => `NULLIF(json_extract(request, '$.params.${key}.projectId'), '')`).join(",")}, '')`;

export function getDirectorGenerationTasks(userId: string, projectId: string, input: unknown) {
    assertProject(userId, projectId);
    const { id, offset, limit } = directorTaskQuery.parse(input);
    const rows = db.prepare(`SELECT id,kind,status,model_id AS modelId,error,error_code AS errorCode,progress,created_at AS createdAt,updated_at AS updatedAt,result FROM generations WHERE user_id=? AND ${generationProjectSql}=? ${id ? "AND id=?" : ""} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
        .all(userId, projectId, ...(id ? [id] : []), id ? 1 : limit + 1, id ? 0 : offset) as GenerationSummary[];
    const summarize = ({ result, ...row }: GenerationSummary) => {
        if (!id) return row;
        const files = parseJson<{ files?: Array<{ id?: string; fileId?: string }> } | null>(result, null)?.files || [];
        const music = materializeDirectorMusic(userId, projectId, row.id);
        return { ...row, ...(music ? { music } : {}), outputs: files.slice(0, 16).map((file) => {
            const fileId = file.fileId || file.id;
            if (!fileId || !getStoredFile(userId, fileId)) return { available: false, message: "产物文件已不存在" };
            return cacheDirectorMediaFile(userId, projectId, fileId);
        }), outputsTruncated: files.length > 16 };
    };
    if (id) { if (!rows[0]) throw notFound("生成任务"); return summarize(rows[0]); }
    return { items: rows.slice(0, limit).map(summarize), nextOffset: rows.length > limit ? offset + limit : null };
}

type RenderSummary = { id: string; status: string; progress: number; error: string | null; createdAt: string; updatedAt: string; durationSeconds: number; timelineRevision: number; warnings: string };
export function getDirectorRenderTasks(userId: string, projectId: string, input: unknown) {
    assertProject(userId, projectId);
    const { id, offset, limit } = directorTaskQuery.parse(input);
    const rows = db.prepare(`SELECT id,status,progress,error,created_at AS createdAt,updated_at AS updatedAt,json_extract(payload,'$.duration') AS durationSeconds,json_extract(payload,'$.timelineRevision') AS timelineRevision,json_extract(payload,'$.warnings') AS warnings FROM director_renders WHERE user_id=? AND project_id=? ${id ? "AND id=?" : ""} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
        .all(userId, projectId, ...(id ? [id] : []), id ? 1 : limit + 1, id ? 0 : offset) as RenderSummary[];
    const summarize = (row: RenderSummary) => ({ ...row, warnings: parseJson<string[]>(row.warnings, []), ...(row.status === "succeeded" ? { outputPath: `renders/${row.id}/final.mp4`, metadataPath: `renders/${row.id}/render.json` } : {}) });
    if (id) { if (!rows[0]) throw notFound("成片任务"); return summarize(rows[0]); }
    return { items: rows.slice(0, limit).map(summarize), nextOffset: rows.length > limit ? offset + limit : null };
}

export function directorMediaModels(input: { kind?: "audio" | "video" }) {
    return listPublicModels().filter((model) => ["audio", "video"].includes(model.output) && (!input.kind || model.output === input.kind))
        .map((model) => ({ value: model.value, name: model.name, output: model.output, inputs: model.inputs, ...(model.output === "audio" ? { audioModes: model.audioModes || [] } : {}) }));
}

function assertProject(userId: string, projectId: string) {
    if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw notFound("导演项目");
}
function notFound(subject: string) { return Object.assign(new Error(`${subject}不存在或不属于当前项目`), { status: 404, code: "DIRECTOR_TASK_NOT_FOUND" }); }

export function createDirectorMusicGeneration(userId: string, projectId: string, input: { promptPath: string; expectedHash: string }) {
    assertProject(userId, projectId);
    const music = readDirectorMusicPrompt(userId, projectId, input.promptPath, input.expectedHash);
    return createGeneration(userId, { kind: "audio", model: music.model, prompt: music.prompt, params: { audioMode: "music", audioOperation: "generate", seconds: music.seconds, seed: music.seed, lyrics: music.lyrics, __directorMusic: { projectId, promptPath: music.promptPath, promptHash: music.promptHash } } });
}
