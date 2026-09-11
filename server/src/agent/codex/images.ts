import { realpathSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { storeLocalFile } from "../../file-store.js";
import { db } from "../../database.js";

export function registerCodexImage(userId: string, projectId: string, workspace: string, savedPath: string) {
    const prefix = "/codex-home/generated_images/";
    if (!savedPath.startsWith(prefix)) throw new Error("Codex 图片未保存到当前作品图片目录");
    const root = realpathSync(resolve(workspace, ".cache/codex-images"));
    const path = realpathSync(resolve(root, savedPath.slice(prefix.length)));
    if (!path.startsWith(`${root}${sep}`)) throw new Error("Codex 图片路径越界");
    const file = storeLocalFile(userId, path, basename(path), "image/png");
    db.prepare("INSERT OR IGNORE INTO file_refs(file_id,user_id,owner_type,owner_id) VALUES(?,?,'agent_project',?)").run(file.id, userId, projectId);
    return { fileId: file.id, url: file.url, title: "Codex 生成图片", mimeType: "image/png", bytes: file.bytes };
}
