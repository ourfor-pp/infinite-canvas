import { constants, copyFileSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { db, parseJson } from "../database.js";
import { getStoredFile, storeLocalFile } from "../file-store.js";
import { cancelGeneration, generationResponse, getGenerationForAgent } from "../generation-service.js";

export function projectMediaGeneration(userId: string, projectId: string, id: string) {
    const row = getGenerationForAgent(userId, id);
    const request = parseJson<{ metadata?: { mediaProjectId?: string; directorSegment?: { projectId?: string } } }>(row?.request || "{}", {});
    if (!row || (request.metadata?.mediaProjectId || request.metadata?.directorSegment?.projectId) !== projectId) throw Object.assign(new Error("媒体任务不存在或不属于当前项目"), { status: 404 });
    return row;
}
export function mediaGenerationStatus(userId: string, projectId: string, id: string) {
    const row = projectMediaGeneration(userId, projectId, id);
    const { request: _request, ...response } = generationResponse(row);
    return response;
}
export function cancelProjectMedia(userId: string, projectId: string, id: string) {
    projectMediaGeneration(userId, projectId, id);
    return cancelGeneration(userId, id);
}
export function importMediaReference(userId: string, projectId: string, path: string) {
    const mimeTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };
    const mime = mimeTypes[extname(path).toLowerCase()];
    if (!mime || !statSync(path).isFile()) throw new Error("参考路径必须是受支持的图片、音频或视频文件");
    const file = storeLocalFile(userId, path, basename(path), mime);
    db.prepare("INSERT OR IGNORE INTO file_refs(file_id,user_id,owner_type,owner_id) VALUES(?,?,'agent_project',?)").run(file.id, userId, projectId);
    return { fileId: file.id, kind: mime.split("/")[0] };
}
export function saveMediaResult(userId: string, projectId: string, generationId: string, fileId: string, path: string) {
    const row = projectMediaGeneration(userId, projectId, generationId);
    const result = parseJson<Record<string, unknown>>(row.result, {});
    const outputs = ["files", "cumulativeVideos", "continuationStates"].flatMap((key) => Array.isArray(result[key]) ? result[key] as Array<{ fileId?: string; id?: string }> : []);
    const file = getStoredFile(userId, fileId);
    if (row.status !== "succeeded" || !file || !outputs.some((item) => (item.fileId || item.id) === fileId)) throw new Error("文件不是当前已完成任务的结果");
    if (extname(path).toLowerCase() !== extname(file.original_name).toLowerCase()) throw new Error("结果目标路径必须保留原文件扩展名");
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(file.path, path, constants.COPYFILE_EXCL);
    return { fileId, generationId };
}
