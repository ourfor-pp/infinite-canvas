import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

function normalizedBasePath(value: string | undefined) {
    const path = (value || "").trim();
    if (!path || path === "/") return "";
    return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

const dataDir = resolve(process.env.DATA_DIR || "./data");
mkdirSync(dataDir, { recursive: true });

function appSecret() {
    if (process.env.APP_SECRET?.trim()) return process.env.APP_SECRET.trim();
    const path = resolve(dataDir, ".app-secret");
    if (!existsSync(path)) {
        writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
        chmodSync(path, 0o600);
    }
    return readFileSync(path, "utf8").trim();
}

export const config = {
    port: Number(process.env.PORT) || 3001,
    socketPath: process.env.SOCKET_PATH?.trim() || "",
    basePath: normalizedBasePath(process.env.APP_BASE_PATH),
    authMode: process.env.AUTH_MODE === "fnos" ? ("fnos" as const) : ("dev" as const),
    devUserId: process.env.DEV_USER_ID?.trim() || "dev-admin",
    devUsername: process.env.DEV_USERNAME?.trim() || "开发管理员",
    dataDir,
    filesDir: resolve(dataDir, "files"),
    tempDir: resolve(dataDir, "tmp"),
    databasePath: resolve(dataDir, "app.db"),
    appSecret: appSecret(),
    defaultComfyUrl: process.env.COMFYUI_URL?.trim().replace(/\/+$/, "") || "",
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 4 * 1024 * 1024 * 1024,
    orphanFileHours: Math.max(1, Number(process.env.ORPHAN_FILE_HOURS) || 24),
    aiMaxConcurrency: Math.max(1, Number(process.env.AI_MAX_CONCURRENCY) || 4),
    aiUserConcurrency: Math.max(1, Number(process.env.AI_USER_CONCURRENCY) || 2),
    agentMaxConcurrency: Math.max(1, Number(process.env.AGENT_MAX_CONCURRENCY) || 2),
    agentUserConcurrency: Math.max(1, Number(process.env.AGENT_USER_CONCURRENCY) || 1),
    agentRoot: resolve(dataDir, "agent"),
    agentSkillsDir: resolve(process.env.AGENT_SKILLS_DIR || "./src/agent/skills"),
};

mkdirSync(config.filesDir, { recursive: true });
mkdirSync(config.tempDir, { recursive: true });
mkdirSync(config.agentRoot, { recursive: true });
