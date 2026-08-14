import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

function normalizedBasePath(value: string | undefined) {
    const path = (value || "").trim();
    if (!path || path === "/") return "";
    return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

function positiveMilliseconds(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
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
    mediaExecutorUrl: process.env.MEDIA_EXECUTOR_URL?.trim().replace(/\/+$/, "") || "",
    mediaExecutorToken: process.env.MEDIA_EXECUTOR_TOKEN?.trim() || "",
    stableAudio3LicenseAccepted: process.env.STABLE_AUDIO_3_LICENSE_ACCEPTED === "1",
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 4 * 1024 * 1024 * 1024,
    orphanFileHours: Math.max(1, Number(process.env.ORPHAN_FILE_HOURS) || 24),
    aiMaxConcurrency: Math.max(1, Number(process.env.AI_MAX_CONCURRENCY) || 4),
    aiUserConcurrency: Math.max(1, Number(process.env.AI_USER_CONCURRENCY) || 2),
    aiImageMaxConcurrency: Math.max(1, Number(process.env.AI_IMAGE_MAX_CONCURRENCY) || 10),
    aiImageUserConcurrency: Math.max(1, Number(process.env.AI_IMAGE_USER_CONCURRENCY) || 10),
    aiProviderTimeouts: {
        text: positiveMilliseconds(process.env.AI_TEXT_REQUEST_TIMEOUT_MS, 10 * 60_000),
        image: positiveMilliseconds(process.env.AI_IMAGE_REQUEST_TIMEOUT_MS, 10 * 60_000),
        video: positiveMilliseconds(process.env.AI_VIDEO_REQUEST_TIMEOUT_MS, 30 * 60_000),
        audio: positiveMilliseconds(process.env.AI_AUDIO_REQUEST_TIMEOUT_MS, 10 * 60_000),
    },
    agentMaxConcurrency: Math.max(1, Number(process.env.AGENT_MAX_CONCURRENCY) || 2),
    agentUserConcurrency: Math.max(1, Number(process.env.AGENT_USER_CONCURRENCY) || 2),
    agentRoot: resolve(dataDir, "agent"),
    agentSkillsDir: resolve(process.env.AGENT_SKILLS_DIR || "./src/agent/scenes"),
};

mkdirSync(config.filesDir, { recursive: true });
mkdirSync(config.tempDir, { recursive: true });
mkdirSync(config.agentRoot, { recursive: true });
