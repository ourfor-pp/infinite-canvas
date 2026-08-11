import Busboy from "busboy";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { db, parseJson } from "./database.js";

type StoredFileRow = { id: string; user_id: string; path: string; original_name: string; mime_type: string; bytes: number; metadata: string; created_at: string };

function safeExtension(name: string, mimeType: string) {
    const extension = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
    if (extension) return extension;
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/png") return ".png";
    if (mimeType === "video/mp4") return ".mp4";
    if (mimeType.startsWith("audio/")) return `.${mimeType.split("/")[1].replace(/[^a-z0-9]/g, "") || "audio"}`;
    return ".bin";
}

export async function receiveUpload(req: Request) {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) throw apiFileError(415, "UPLOAD_TYPE", "请使用 multipart/form-data 上传文件");
    const id = nanoid();
    const userDir = userDirectory(req.user.id);
    mkdirSync(userDir, { recursive: true });
    const tempPath = resolve(config.tempDir, `${id}.upload`);
    let fileInfo: { filename: string; mimeType: string } | null = null;
    let bytes = 0;
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: config.maxUploadBytes } });
    const completed = new Promise<void>((resolvePromise, reject) => {
        let writePromise: Promise<void> | null = null;
        busboy.on("file", (_field, stream, info) => {
            fileInfo = { filename: info.filename || "file", mimeType: info.mimeType || "application/octet-stream" };
            stream.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
            });
            stream.on("limit", () => reject(apiFileError(413, "UPLOAD_TOO_LARGE", "上传文件超过大小限制")));
            writePromise = pipeline(stream, createWriteStream(tempPath));
        });
        busboy.on("error", reject);
        busboy.on("finish", async () => {
            try {
                if (writePromise) await writePromise;
                resolvePromise();
            } catch (error) {
                reject(error);
            }
        });
    });
    req.pipe(busboy);
    try {
        await completed;
        const info = fileInfo as { filename: string; mimeType: string } | null;
        if (!info || !existsSync(tempPath) || !bytes) throw apiFileError(400, "UPLOAD_EMPTY", "没有收到可保存的文件");
        const storedName = `${id}${safeExtension(info.filename, info.mimeType)}`;
        const finalPath = resolve(userDir, storedName);
        renameSync(tempPath, finalPath);
        const now = new Date().toISOString();
        db.prepare("INSERT INTO stored_files(id, user_id, path, original_name, mime_type, bytes, metadata, created_at) VALUES(?, ?, ?, ?, ?, ?, '{}', ?)").run(id, req.user.id, relative(config.dataDir, finalPath), info.filename, info.mimeType, bytes, now);
        return fileResponse(id, info.filename, info.mimeType, bytes, {}, now);
    } catch (error) {
        if (existsSync(tempPath)) unlinkSync(tempPath);
        throw error;
    }
}

export async function storeRemoteFile(userId: string, response: globalThis.Response, originalName: string) {
    if (!response.ok || !response.body) throw apiFileError(502, "REMOTE_FILE", `读取生成结果失败（${response.status}）`);
    const declaredLength = Number(response.headers.get("content-length")) || 0;
    if (declaredLength > config.maxUploadBytes) throw apiFileError(413, "UPLOAD_TOO_LARGE", "生成结果超过大小限制");
    const id = nanoid();
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    const userDir = userDirectory(userId);
    mkdirSync(userDir, { recursive: true });
    const finalPath = resolve(userDir, `${id}${safeExtension(originalName, mimeType)}`);
    const reader = response.body.getReader();
    const output = createWriteStream(finalPath);
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > config.maxUploadBytes) throw apiFileError(413, "UPLOAD_TOO_LARGE", "生成结果超过大小限制");
            if (!output.write(value)) await new Promise<void>((resolvePromise) => output.once("drain", resolvePromise));
        }
        output.end();
        await once(output, "finish");
    } catch (error) {
        output.destroy();
        if (existsSync(finalPath)) unlinkSync(finalPath);
        throw error;
    }
    const now = new Date().toISOString();
    db.prepare("INSERT INTO stored_files(id, user_id, path, original_name, mime_type, bytes, metadata, created_at) VALUES(?, ?, ?, ?, ?, ?, '{}', ?)").run(id, userId, relative(config.dataDir, finalPath), originalName, mimeType, bytes, now);
    return fileResponse(id, originalName, mimeType, bytes, {}, now);
}

export function sendStoredFile(req: Request, res: Response) {
    const row = db.prepare("SELECT * FROM stored_files WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as StoredFileRow | undefined;
    const localPath = row ? storedPath(row.path) : "";
    if (!row || !localPath || !existsSync(localPath)) {
        res.status(404).json({ error: { code: "FILE_NOT_FOUND", message: "文件不存在" } });
        return;
    }
    const size = statSync(localPath).size;
    const range = req.headers.range;
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (!range) {
        res.setHeader("Content-Length", size);
        createReadStream(localPath).pipe(res);
        return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
        return;
    }
    if (!match[1] && !match[2]) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
        return;
    }
    const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0;
    const start = suffixLength ? Math.max(0, size - suffixLength) : Number(match[1]);
    const end = suffixLength ? size - 1 : match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start < 0 || end < start || start >= size) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
        return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    createReadStream(localPath, { start, end }).pipe(res);
}

export function getStoredFile(userId: string, id: string) {
    const row = db.prepare("SELECT * FROM stored_files WHERE id=? AND user_id=?").get(id, userId) as StoredFileRow | undefined;
    if (!row) return null;
    const path = storedPath(row.path);
    return path && existsSync(path) ? { ...row, path } : null;
}

export function syncFileRefs(userId: string, ownerType: string, ownerId: string, value: unknown) {
    const ids = collectFileIds(value);
    const update = db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type=? AND owner_id=?").run(userId, ownerType, ownerId);
        const insert = db.prepare("INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id) SELECT id, user_id, ?, ? FROM stored_files WHERE id=? AND user_id=?");
        ids.forEach((id) => insert.run(ownerType, ownerId, id, userId));
    });
    update();
}

export function collectFileIds(value: unknown, result = new Set<string>()) {
    if (!value || typeof value !== "object") return result;
    if ("fileId" in value && typeof value.fileId === "string") result.add(value.fileId);
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("server:")) result.add(value.storageKey.slice(7));
    Object.values(value).forEach((child) => {
        if (Array.isArray(child)) child.forEach((item) => collectFileIds(item, result));
        else collectFileIds(child, result);
    });
    return result;
}

export function fileResponse(id: string, name: string, mimeType: string, bytes: number, metadata: Record<string, unknown>, createdAt: string) {
    return { id, fileId: id, name, mimeType, bytes, metadata, createdAt, url: `${config.basePath}/api/files/${id}/content` };
}

export function storedFileResponse(row: StoredFileRow) {
    return fileResponse(row.id, row.original_name, row.mime_type, row.bytes, parseJson(row.metadata, {}), row.created_at);
}

export function cleanupUnreferencedFiles() {
    const cutoff = new Date(Date.now() - config.orphanFileHours * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`SELECT * FROM stored_files f WHERE f.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM file_refs r WHERE r.file_id=f.id)`).all(cutoff) as StoredFileRow[];
    const remove = db.prepare("DELETE FROM stored_files WHERE id=? AND NOT EXISTS (SELECT 1 FROM file_refs WHERE file_id=?)");
    rows.forEach((row) => {
        const path = storedPath(row.path);
        if (path && existsSync(path)) unlinkSync(path);
        remove.run(row.id, row.id);
    });
    return rows.length;
}

function apiFileError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}

function userDirectory(userId: string) {
    return resolve(config.filesDir, createHash("sha256").update(userId).digest("hex"));
}

function storedPath(path: string) {
    if (!path || path.startsWith("/") || path.includes("\\")) return "";
    const target = resolve(config.dataDir, path);
    return target.startsWith(`${config.dataDir}${sep}`) ? target : "";
}
