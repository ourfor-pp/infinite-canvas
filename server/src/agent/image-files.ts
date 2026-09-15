import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { getStoredFile } from "../file-store.js";

// Expose only owned images already returned by an authorized scene tool.
export function exposeImagePaths(userId: string, value: unknown, resolvePath: (path: string) => string): unknown {
    if (Array.isArray(value)) return value.map((item) => exposeImagePaths(userId, item, resolvePath));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, exposeImagePaths(userId, item, resolvePath)]));
    const fileId = typeof record.storageKey === "string" && record.storageKey.startsWith("server:") ? record.storageKey.slice(7)
        : typeof record.mimeType === "string" && record.mimeType.startsWith("image/") ? String(record.fileId || record.id || "") : "";
    if (!fileId) return result;
    const file = getStoredFile(userId, fileId);
    if (!file?.mime_type.startsWith("image/")) return result;
    const path = `.cache/image-inputs/${file.id}${extname(file.path)}`;
    const target = resolvePath(path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.path, target);
    return { ...result, path };
}
