import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createClient, type WebDAVClient } from "webdav";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { db } from "./database.js";

export type BackupSettings = { url: string; username: string; password: string; directory: string };
type ManifestFile = { path: string; bytes: number; sha256: string };
type BackupManifest = { format: "infinite-canvas-backup"; version: 1; id: string; createdAt: string; files: ManifestFile[] };

export function getBackupSettings() {
    const row = db.prepare("SELECT encrypted_payload, updated_at FROM backup_settings WHERE id=1").get() as { encrypted_payload: string; updated_at: string } | undefined;
    if (!row) return null;
    const value = decryptJson<BackupSettings>(row.encrypted_payload, config.appSecret);
    return { url: value.url, username: value.username, directory: value.directory, passwordConfigured: Boolean(value.password), updatedAt: row.updated_at };
}

export function saveBackupSettings(input: Partial<BackupSettings>) {
    const current = readBackupSettings() || { url: "", username: "", password: "", directory: "infinite-canvas" };
    const value = normalizeSettings({ ...current, ...input, password: input.password === undefined || input.password === "" ? current.password : input.password });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO backup_settings(id, encrypted_payload, updated_at) VALUES(1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload, updated_at=excluded.updated_at`).run(encryptJson(value, config.appSecret), now);
    return getBackupSettings();
}

export async function testBackupConnection() {
    const { client, root } = backupClient();
    await client.createDirectory(root, { recursive: true });
    const marker = `${root}/.connection-${nanoid()}`;
    await client.putFileContents(marker, Buffer.from("ok"), { overwrite: true });
    await client.deleteFile(marker);
    return { available: true };
}

export async function createBackup() {
    const { client, root } = backupClient();
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;
    const localRoot = resolve(config.tempDir, `backup-${id}`);
    const remoteRoot = `${root}/${id}`;
    mkdirSync(localRoot, { recursive: true });
    try {
        const databaseFile = resolve(localRoot, "app.db");
        await db.backup(databaseFile);
        const sourceFiles = walkFiles(config.filesDir);
        const files: ManifestFile[] = [];
        await client.createDirectory(remoteRoot, { recursive: true });
        await uploadSnapshotFile(client, remoteRoot, databaseFile, "app.db", files);
        for (const source of sourceFiles) {
            const path = `files/${relative(config.filesDir, source).split(sep).join("/")}`;
            await uploadSnapshotFile(client, remoteRoot, source, path, files);
        }
        const manifest: BackupManifest = { format: "infinite-canvas-backup", version: 1, id, createdAt: new Date().toISOString(), files };
        await client.putFileContents(`${remoteRoot}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), { overwrite: true });
        return { id, createdAt: manifest.createdAt, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    } finally {
        rmSync(localRoot, { recursive: true, force: true });
    }
}

export async function listBackups() {
    const settings = readBackupSettings();
    if (!settings?.url) return [];
    const { client, root } = backupClient(settings);
    if (!(await client.exists(root))) return [];
    const entries = await client.getDirectoryContents(root) as Array<{ basename: string; type: string }>;
    const result: Array<{ id: string; createdAt: string; files: number; bytes: number }> = [];
    for (const entry of entries.filter((item) => item.type === "directory" && safeBackupId(item.basename))) {
        try {
            const manifest = await readManifest(client, root, entry.basename);
            result.push({ id: manifest.id, createdAt: manifest.createdAt, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) });
        } catch {
            // Incomplete uploads are intentionally omitted.
        }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreBackup(id: string) {
    if (!safeBackupId(id)) throw backupError(400, "BACKUP_ID_INVALID", "备份编号不正确");
    const activeTasks = Number((db.prepare("SELECT count(*) count FROM generations WHERE status IN ('queued','running')").get() as { count: number }).count);
    if (activeTasks) throw backupError(409, "BACKUP_TASKS_RUNNING", "仍有生成任务运行，暂不能恢复备份");
    const { client, root } = backupClient();
    const manifest = await readManifest(client, root, id);
    const staging = resolve(config.tempDir, `restore-${id}-${nanoid(5)}`);
    mkdirSync(staging, { recursive: true });
    try {
        for (const file of manifest.files) {
            const target = safeLocalPath(staging, file.path);
            mkdirSync(dirname(target), { recursive: true });
            await pipeline(client.createReadStream(`${root}/${id}/${file.path}`), createWriteStream(target));
            if (statSync(target).size !== file.bytes || await hashFile(target) !== file.sha256) throw backupError(422, "BACKUP_HASH_MISMATCH", `备份文件校验失败：${file.path}`);
        }
        const stagedDatabase = resolve(staging, "app.db");
        if (!existsSync(stagedDatabase)) throw backupError(422, "BACKUP_DATABASE_MISSING", "备份中缺少数据库");
        const check = new Database(stagedDatabase, { readonly: true });
        const integrity = check.pragma("integrity_check", { simple: true });
        const databaseFiles = check.prepare("SELECT path, bytes FROM stored_files").all() as Array<{ path: string; bytes: number }>;
        check.close();
        if (integrity !== "ok") throw backupError(422, "BACKUP_DATABASE_INVALID", "备份数据库完整性校验失败");
        const manifestPaths = new Set(manifest.files.map((file) => file.path));
        databaseFiles.forEach((file) => {
            const target = safeLocalPath(staging, file.path);
            if (!file.path.startsWith("files/") || !manifestPaths.has(file.path) || !existsSync(target) || statSync(target).size !== file.bytes) throw backupError(422, "BACKUP_MEDIA_INVALID", `数据库媒体文件不完整：${file.path}`);
        });

        const safetyId = `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const safetyRoot = resolve(config.dataDir, "restore-safety", safetyId);
        mkdirSync(safetyRoot, { recursive: true });
        await db.backup(resolve(safetyRoot, "app.db"));
        db.close();
        [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`].forEach((path) => {
            if (existsSync(path)) renameSync(path, resolve(safetyRoot, `live-${basename(path)}`));
        });
        if (existsSync(config.filesDir)) renameSync(config.filesDir, resolve(safetyRoot, "files-live"));
        copyFileSync(stagedDatabase, config.databasePath);
        const stagedFiles = resolve(staging, "files");
        if (existsSync(stagedFiles)) renameSync(stagedFiles, config.filesDir);
        else mkdirSync(config.filesDir, { recursive: true });
        setTimeout(() => process.exit(0), 500).unref();
        return { restored: true, safetyId, restartRequired: true };
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

function readBackupSettings() {
    const row = db.prepare("SELECT encrypted_payload FROM backup_settings WHERE id=1").get() as { encrypted_payload: string } | undefined;
    return row ? decryptJson<BackupSettings>(row.encrypted_payload, config.appSecret) : null;
}

function backupClient(provided?: BackupSettings) {
    const settings = provided || readBackupSettings();
    if (!settings?.url) throw backupError(409, "BACKUP_NOT_CONFIGURED", "请先配置 WebDAV 备份");
    return { client: createClient(settings.url, { username: settings.username, password: settings.password }), root: `/${settings.directory.replace(/^\/+|\/+$/g, "")}/snapshots` };
}

function normalizeSettings(value: BackupSettings): BackupSettings {
    const url = new URL(value.url);
    if (!/^https?:$/.test(url.protocol)) throw backupError(400, "WEBDAV_URL_INVALID", "WebDAV 只支持 HTTP/HTTPS 地址");
    const directory = value.directory.trim().replace(/^\/+|\/+$/g, "");
    if (!directory || directory.includes("..")) throw backupError(400, "WEBDAV_DIRECTORY_INVALID", "备份目录不正确");
    return { url: url.toString().replace(/\/+$/, ""), username: value.username.trim(), password: value.password, directory };
}

async function uploadSnapshotFile(client: WebDAVClient, remoteRoot: string, localPath: string, path: string, manifest: ManifestFile[]) {
    const remoteDirectory = dirname(`${remoteRoot}/${path}`).split(sep).join("/");
    await client.createDirectory(remoteDirectory, { recursive: true });
    const bytes = statSync(localPath).size;
    await client.putFileContents(`${remoteRoot}/${path}`, createReadStream(localPath), { overwrite: true, contentLength: bytes });
    manifest.push({ path, bytes, sha256: await hashFile(localPath) });
}

async function readManifest(client: WebDAVClient, root: string, id: string) {
    const raw = await client.getFileContents(`${root}/${id}/manifest.json`, { format: "text" });
    const value = JSON.parse(String(raw)) as BackupManifest;
    if (value.format !== "infinite-canvas-backup" || value.version !== 1 || value.id !== id || !Array.isArray(value.files)) throw backupError(422, "BACKUP_MANIFEST_INVALID", "备份清单格式不受支持");
    const paths = new Set<string>();
    value.files.forEach((file) => {
        if (!file || typeof file.path !== "string" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw backupError(422, "BACKUP_MANIFEST_INVALID", "备份文件清单不正确");
        safeLocalPath(config.tempDir, file.path);
        if (paths.has(file.path)) throw backupError(422, "BACKUP_MANIFEST_INVALID", "备份清单包含重复文件");
        paths.add(file.path);
    });
    if (!paths.has("app.db")) throw backupError(422, "BACKUP_DATABASE_MISSING", "备份中缺少数据库");
    return value;
}

function walkFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
    });
}

function safeLocalPath(root: string, path: string) {
    if (!path || path.startsWith("/") || path.includes("\\")) throw backupError(422, "BACKUP_PATH_INVALID", "备份中包含非法路径");
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw backupError(422, "BACKUP_PATH_INVALID", "备份中包含越界路径");
    return target;
}

function safeBackupId(value: string) {
    return /^[a-zA-Z0-9._-]{1,128}$/.test(value) && !value.includes("..");
}

function hashFile(path: string) {
    return new Promise<string>((resolvePromise, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(path);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolvePromise(hash.digest("hex")));
    });
}

function backupError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}
