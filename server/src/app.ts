import express, { type NextFunction, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { authenticate, requireAdmin } from "./auth.js";
import { config } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { db, parseJson } from "./database.js";
import { COMFY_MODELS } from "./comfy-workflows.js";
import { getStoredFile, receiveUpload, sendStoredFile, storedFileResponse, syncFileRefs } from "./file-store.js";
import { cancelGeneration, cancelGenerationByAdmin, createGeneration, generationResponse, type GenerationRow } from "./generation-service.js";
import { createBackup, getBackupSettings, listBackups, restoreBackup, saveBackupSettings, testBackupConnection } from "./backup-service.js";
import { clearProviderCredentials, deleteProvider, discoverProviderModels, getAiGlobalSettings, listAdminProviders, listModelDefaults, listModelEndpoints, listPublicModels, providerInputSchema, pruneModelDefaults, saveAiGlobalSettings, saveModelDefaults, saveProvider, testProvider } from "./provider-service.js";
import { agentAdminRouter, agentRouter } from "./agent/routes.js";
import { handleAgentProviderProxy } from "./agent/provider-proxy.js";
import { removeAgentWorkspace } from "./agent/service.js";

type ProjectRow = { id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string };
type AssetRow = { id: string; kind: string; title: string; payload: string; created_at: string; updated_at: string };
type ComfyServerRow = { id: string; name: string; encrypted_url: string; enabled: number; models: string; created_at: string; updated_at: string };

const idSchema = z.string().trim().min(1).max(128);
const jsonRecord = z.record(z.string(), z.unknown());
const projectSchema = z.object({ id: idSchema, title: z.string().trim().min(1).max(200) }).passthrough();
const assetSchema = z.object({ id: idSchema, kind: z.enum(["text", "image", "video"]), title: z.string().trim().min(1).max(200) }).passthrough();
const settingsSchema = z.object({ config: jsonRecord, promptSources: jsonRecord.optional() });
const comfyServerSchema = z.object({ name: z.string().trim().min(1).max(100), url: z.string().url(), enabled: z.boolean().default(true), models: z.array(z.enum(COMFY_MODELS)).min(1) });
const generationParamsSchema = jsonRecord.superRefine((value, context) => {
    const forbidden = ["baseUrl", "apiKey", "authToken", "provider", "headers", "request", "script"];
    forbidden.forEach((key) => {
        if (key in value) context.addIssue({ code: "custom", path: [key], message: "生成参数不能包含渠道或请求配置" });
    });
});
const generationSchema = z.object({
    kind: z.enum(["image", "video", "audio", "text"]),
    model: z.string().trim().min(3),
    prompt: z.string().max(200_000).optional(),
    messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(200_000) })).max(500).optional(),
    params: generationParamsSchema.optional(),
    references: z.array(z.object({ fileId: idSchema, kind: z.enum(["image", "video", "audio"]).optional() })).optional(),
}).superRefine((value, context) => {
    if (!value.prompt?.trim() && !value.messages?.length) context.addIssue({ code: "custom", path: ["prompt"], message: "提示词或消息不能为空" });
});

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));
app.post(`${config.basePath}/api/agent/provider-proxy/v1/messages`, (req, res, next) => void handleAgentProviderProxy(req, res).catch(next));

const api = express.Router();
api.use(authenticate);
api.use("/agent", agentRouter);
api.use("/admin", agentAdminRouter);

api.get("/session", (req, res) => {
    const counts = {
        projects: Number((db.prepare("SELECT count(*) count FROM projects WHERE user_id=?").get(req.user.id) as { count: number }).count),
        assets: Number((db.prepare("SELECT count(*) count FROM assets WHERE user_id=?").get(req.user.id) as { count: number }).count),
        generations: Number((db.prepare("SELECT count(*) count FROM generations WHERE user_id=?").get(req.user.id) as { count: number }).count),
        settings: Number((db.prepare("SELECT count(*) count FROM user_settings WHERE user_id=?").get(req.user.id) as { count: number }).count),
    };
    res.json({ data: { user: req.user, counts, authMode: config.authMode } });
});

api.get("/projects", (req, res) => {
    const rows = db.prepare("SELECT id, title, revision, created_at, updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC").all(req.user.id) as Array<Omit<ProjectRow, "payload">>;
    res.json({ data: rows.map((row) => ({ id: row.id, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })) });
});

api.post("/projects", route((req) => {
    const value = withoutClientUserId(projectSchema.parse(req.body));
    const now = new Date().toISOString();
    const payload = { ...value, createdAt: value.createdAt || now, updatedAt: now };
    return db.transaction(() => {
        db.prepare("INSERT INTO projects(id, user_id, title, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, 1, ?, ?)").run(value.id, req.user.id, value.title, JSON.stringify(payload), payload.createdAt, now);
        syncFileRefs(req.user.id, "project", value.id, payload);
        return projectResponse(db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(value.id, req.user.id) as ProjectRow);
    })();
}, 201));

api.get("/projects/:id", route((req) => {
    const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow | undefined;
    if (!row) throw apiError(404, "PROJECT_NOT_FOUND", "画布不存在");
    return projectResponse(row);
}));

api.put("/projects/:id", route((req) => {
    const value = withoutClientUserId(projectSchema.parse({ ...req.body, id: req.params.id }));
    const expectedRevision = z.number().int().positive().parse(req.body.revision);
    const now = new Date().toISOString();
    const payload = { ...value, updatedAt: now };
    return db.transaction(() => {
        const result = db.prepare(`UPDATE projects SET title=?, payload=?, revision=revision+1, updated_at=?
            WHERE id=? AND user_id=? AND revision=?`).run(value.title, JSON.stringify(payload), now, req.params.id, req.user.id, expectedRevision);
        if (!result.changes) {
            const current = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow | undefined;
            if (!current) throw apiError(404, "PROJECT_NOT_FOUND", "画布不存在");
            throw apiError(409, "PROJECT_CONFLICT", "画布已在其他页面更新", { current: projectResponse(current) });
        }
        syncFileRefs(req.user.id, "project", routeId(req), payload);
        return projectResponse(db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow);
    })();
}));

api.put("/projects/:id/force", route((req) => {
    const value = withoutClientUserId(projectSchema.parse({ ...req.body, id: req.params.id }));
    const now = new Date().toISOString();
    const payload = { ...value, updatedAt: now };
    return db.transaction(() => {
        const result = db.prepare("UPDATE projects SET title=?, payload=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?").run(value.title, JSON.stringify(payload), now, req.params.id, req.user.id);
        if (!result.changes) throw apiError(404, "PROJECT_NOT_FOUND", "画布不存在");
        syncFileRefs(req.user.id, "project", routeId(req), payload);
        return projectResponse(db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow);
    })();
}));

api.delete("/projects/:id", route((req) => {
    if (db.prepare("SELECT 1 FROM agent_sessions WHERE user_id=? AND owner_type='project' AND owner_id=? AND status IN ('running','waiting_for_user')").get(req.user.id, req.params.id)) throw apiError(409, "PROJECT_AGENT_BUSY", "Agent 正在使用这个画布，请先停止任务");
    const sessions = db.prepare("SELECT id FROM agent_sessions WHERE user_id=? AND owner_type='project' AND owner_id=?").all(req.user.id, req.params.id) as Array<{ id: string }>;
    const result = db.transaction(() => {
        sessions.forEach((session) => db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='agent_session' AND owner_id=?").run(req.user.id, session.id));
        db.prepare("DELETE FROM agent_sessions WHERE user_id=? AND owner_type='project' AND owner_id=?").run(req.user.id, req.params.id);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='project' AND owner_id=?").run(req.user.id, req.params.id);
        db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
        return { id: req.params.id };
    })();
    sessions.forEach((session) => removeAgentWorkspace(req.user.id, session.id));
    return result;
}));

api.get("/assets", (_req, res) => {
    const req = _req as Request;
    const rows = db.prepare("SELECT * FROM assets WHERE user_id=? ORDER BY updated_at DESC").all(req.user.id) as AssetRow[];
    res.json({ data: rows.map(assetResponse) });
});

api.post("/assets", route((req) => saveAsset(req, false), 201));
api.put("/assets/:id", route((req) => saveAsset(req, true)));
api.delete("/assets/:id", route((req) => {
    return db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='asset' AND owner_id=?").run(req.user.id, req.params.id);
        db.prepare("DELETE FROM assets WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
        return { id: req.params.id };
    })();
}));

api.post("/files", asyncRoute(async (req) => receiveUpload(req), 201));
api.get("/files/:id", route((req) => {
    const file = getStoredFile(req.user.id, routeId(req));
    if (!file) throw apiError(404, "FILE_NOT_FOUND", "文件不存在");
    return storedFileResponse(file);
}));
api.get("/files/:id/content", sendStoredFile);

api.get("/settings", route((req) => {
    const row = db.prepare("SELECT encrypted_payload, updated_at FROM user_settings WHERE user_id=?").get(req.user.id) as { encrypted_payload: string; updated_at: string } | undefined;
    if (!row) return null;
    const value = settingsSchema.parse(decryptJson<Record<string, unknown>>(row.encrypted_payload, config.appSecret));
    return { ...sanitizeUserSettings(value), updatedAt: row.updated_at };
}));
api.put("/settings", route((req) => {
    const value = sanitizeUserSettings(settingsSchema.parse(req.body));
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO user_settings(user_id, encrypted_payload, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload, updated_at=excluded.updated_at`).run(req.user.id, encryptJson(value, config.appSecret), now);
    return { ...value, updatedAt: now };
}));

api.get("/ai/models", (_req, res) => {
    res.json({ data: listPublicModels() });
});
api.get("/ai/model-defaults", (_req, res) => {
    res.json({ data: listModelDefaults() });
});
api.get("/ai/config", (_req, res) => {
    res.json({ data: getAiGlobalSettings() });
});

api.get("/admin/ai/providers", requireAdmin, (_req, res) => {
    res.json({ data: listAdminProviders() });
});
api.get("/admin/ai/model-endpoints", requireAdmin, (_req, res) => {
    res.json({ data: listModelEndpoints() });
});
api.put("/admin/ai/model-defaults", requireAdmin, route((req) => saveModelDefaults(req.body)));
api.put("/admin/ai/config", requireAdmin, route((req) => saveAiGlobalSettings(req.body)));
api.post("/admin/ai/providers", requireAdmin, route((req) => saveProvider(providerInputSchema.parse(req.body)), 201));
api.put("/admin/ai/providers/:id", requireAdmin, route((req) => saveProvider(providerInputSchema.parse(req.body), routeId(req))));
api.delete("/admin/ai/providers/:id", requireAdmin, route((req) => deleteProvider(routeId(req))));
api.post("/admin/ai/providers/:id/test", requireAdmin, asyncRoute((req) => testProvider(routeId(req))));
api.post("/admin/ai/providers/:id/models/discover", requireAdmin, asyncRoute((req) => discoverProviderModels(routeId(req))));
api.post("/admin/ai/providers/:id/credentials/clear", requireAdmin, route((req) => clearProviderCredentials(routeId(req))));

api.get("/admin/comfyui/servers", requireAdmin, (_req, res) => {
    const rows = db.prepare("SELECT * FROM comfy_servers ORDER BY created_at").all() as ComfyServerRow[];
    res.json({ data: rows.map(adminComfyResponse) });
});
api.post("/admin/comfyui/servers", requireAdmin, route((req) => saveComfyServer(req, false), 201));
api.put("/admin/comfyui/servers/:id", requireAdmin, route((req) => saveComfyServer(req, true)));
api.delete("/admin/comfyui/servers/:id", requireAdmin, route((req) => {
    assertComfyServerIdle(routeId(req));
    db.prepare("DELETE FROM comfy_servers WHERE id=?").run(req.params.id);
    pruneModelDefaults();
    return { id: req.params.id };
}));
api.post("/admin/comfyui/servers/:id/test", requireAdmin, asyncRoute(async (req) => {
    const row = db.prepare("SELECT * FROM comfy_servers WHERE id=?").get(req.params.id) as ComfyServerRow | undefined;
    if (!row) throw apiError(404, "COMFY_NOT_FOUND", "ComfyUI 节点不存在");
    const { url } = decryptJson<{ url: string }>(row.encrypted_url, config.appSecret);
    const response = await fetch(`${url.replace(/\/+$/, "")}/system_stats`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw apiError(502, "COMFY_UNAVAILABLE", `ComfyUI 返回 ${response.status}`);
    return { available: true };
}));

api.get("/generations", (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.prepare("SELECT * FROM generations WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(req.user.id, limit) as GenerationRow[];
    res.json({ data: rows.map(generationResponse) });
});
api.get("/admin/ai/generations", requireAdmin, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = db.prepare(`SELECT g.*, u.username FROM generations g JOIN users u ON u.id=g.user_id ORDER BY g.created_at DESC LIMIT ?`).all(limit) as Array<GenerationRow & { username: string }>;
    res.json({ data: rows.map((row) => ({ ...generationResponse(row), user: { id: row.user_id, username: row.username }, error: redactAdminError(row.error), request: undefined, result: undefined })) });
});
api.post("/admin/ai/generations/:id/cancel", requireAdmin, route((req) => {
    const updated = cancelGenerationByAdmin(routeId(req));
    if (!updated) throw apiError(409, "GENERATION_NOT_RUNNING", "任务不存在或已经结束");
    return updated;
}));
api.get("/generations/:id", route((req) => {
    const row = db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as GenerationRow | undefined;
    if (!row) throw apiError(404, "GENERATION_NOT_FOUND", "生成任务不存在");
    return generationResponse(row);
}));
api.post("/generations", route((req) => createGeneration(req.user.id, generationSchema.parse(req.body)), 201));
api.post("/generations/:id/cancel", route((req) => {
    const updated = cancelGeneration(req.user.id, routeId(req));
    if (!updated) throw apiError(409, "GENERATION_NOT_RUNNING", "任务不存在或已经结束");
    return updated;
}));
api.delete("/generations/:id", route((req) => {
    return db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='generation' AND owner_id=?").run(req.user.id, req.params.id);
        db.prepare("DELETE FROM generations WHERE id=? AND user_id=? AND status NOT IN ('queued','running')").run(req.params.id, req.user.id);
        return { id: req.params.id };
    })();
}));

api.post("/imports/browser", route((req) => importBrowserData(req), 201));

api.get("/admin/backups/settings", requireAdmin, route(() => getBackupSettings()));
api.put("/admin/backups/settings", requireAdmin, route((req) => saveBackupSettings(z.object({ url: z.string().url(), username: z.string().default(""), password: z.string().optional(), directory: z.string().min(1) }).parse(req.body))));
api.post("/admin/backups/test", requireAdmin, asyncRoute(() => testBackupConnection()));
api.post("/admin/backups", requireAdmin, asyncRoute(() => createBackup(), 201));
api.get("/admin/backups", requireAdmin, asyncRoute(() => listBackups()));
api.post("/admin/backups/:id/restore", requireAdmin, asyncRoute((req) => restoreBackup(routeId(req))));

api.use((_req, res) => res.status(404).json({ error: { code: "API_NOT_FOUND", message: "接口不存在" } }));

app.use(`${config.basePath}/api`, api);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "请求参数不正确", details: error.issues } });
        return;
    }
    const typed = error as Error & { status?: number; code?: string; details?: unknown };
    res.status(typed.status || 500).json({ error: { code: typed.code || "INTERNAL_ERROR", message: typed.status ? typed.message : "服务处理请求失败", ...(typed.details === undefined ? {} : { details: typed.details }) } });
});

function saveAsset(req: Request, update: boolean) {
    const value = withoutClientUserId(assetSchema.parse({ ...req.body, ...(update ? { id: req.params.id } : {}) }));
    const now = new Date().toISOString();
    const payload = { ...value, createdAt: value.createdAt || now, updatedAt: now };
    return db.transaction(() => {
        if (update) {
            const result = db.prepare("UPDATE assets SET kind=?, title=?, payload=?, updated_at=? WHERE id=? AND user_id=?").run(value.kind, value.title, JSON.stringify(payload), now, value.id, req.user.id);
            if (!result.changes) throw apiError(404, "ASSET_NOT_FOUND", "素材不存在");
        } else {
            db.prepare("INSERT INTO assets(id, user_id, kind, title, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)").run(value.id, req.user.id, value.kind, value.title, JSON.stringify(payload), payload.createdAt, now);
        }
        syncFileRefs(req.user.id, "asset", value.id, payload);
        return assetResponse(db.prepare("SELECT * FROM assets WHERE id=? AND user_id=?").get(value.id, req.user.id) as AssetRow);
    })();
}

function saveComfyServer(req: Request, update: boolean) {
    const value = comfyServerSchema.parse(req.body);
    const url = validatedComfyUrl(value.url);
    const id = update ? routeId(req) : nanoid();
    const now = new Date().toISOString();
    if (update) {
        assertComfyServerIdle(id);
        const result = db.prepare("UPDATE comfy_servers SET name=?, encrypted_url=?, enabled=?, models=?, updated_at=? WHERE id=?").run(value.name, encryptJson({ url }, config.appSecret), Number(value.enabled), JSON.stringify(value.models), now, id);
        if (!result.changes) throw apiError(404, "COMFY_NOT_FOUND", "ComfyUI 节点不存在");
    } else {
        db.prepare("INSERT INTO comfy_servers(id, name, encrypted_url, enabled, models, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)").run(id, value.name, encryptJson({ url }, config.appSecret), Number(value.enabled), JSON.stringify(value.models), now, now);
    }
    pruneModelDefaults();
    return adminComfyResponse(db.prepare("SELECT * FROM comfy_servers WHERE id=?").get(id) as ComfyServerRow);
}

function assertComfyServerIdle(id: string) {
    const active = Number((db.prepare("SELECT count(*) count FROM generations WHERE comfy_server_id=? AND status IN ('queued','running')").get(id) as { count: number }).count);
    if (active) throw apiError(409, "COMFY_SERVER_BUSY", "仍有生成任务使用该 ComfyUI 节点");
}

function routeId(req: Request) {
    const value = req.params.id;
    return Array.isArray(value) ? value[0] || "" : value;
}

function importBrowserData(req: Request) {
    const value = z.object({
        importId: idSchema,
        projects: z.array(projectSchema),
        assets: z.array(assetSchema),
        generations: z.array(jsonRecord).default([]),
        settings: settingsSchema.optional(),
    }).parse(req.body);
    const existing = db.prepare("SELECT 1 FROM browser_imports WHERE user_id=? AND import_id=?").get(req.user.id, value.importId);
    if (existing) return { imported: false, duplicate: true };
    const transaction = db.transaction(() => {
        const insertProject = db.prepare("INSERT OR IGNORE INTO projects(id, user_id, title, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, 1, ?, ?)");
        value.projects.map(withoutClientUserId).forEach((project) => {
            const now = new Date().toISOString();
            insertProject.run(project.id, req.user.id, project.title, JSON.stringify(project), String(project.createdAt || now), String(project.updatedAt || now));
            syncFileRefs(req.user.id, "project", project.id, project);
        });
        const insertAsset = db.prepare("INSERT OR IGNORE INTO assets(id, user_id, kind, title, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)");
        value.assets.map(withoutClientUserId).forEach((asset) => {
            const now = new Date().toISOString();
            insertAsset.run(asset.id, req.user.id, asset.kind, asset.title, JSON.stringify(asset), String(asset.createdAt || now), String(asset.updatedAt || now));
            syncFileRefs(req.user.id, "asset", asset.id, asset);
        });
        const insertGeneration = db.prepare(`INSERT OR IGNORE INTO generations(id, user_id, kind, status, model_id, request, result, error, error_code, progress, created_at, updated_at)
            VALUES(?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`);
        value.generations.forEach((generation) => {
            const now = new Date().toISOString();
            const id = typeof generation.id === "string" && generation.id ? generation.id : nanoid();
            const kind = ["image", "video", "audio", "text"].includes(String(generation.kind)) ? String(generation.kind) : "image";
            const rawStatus = String(generation.status || "succeeded");
            const status = rawStatus === "pending" || rawStatus === "running" ? "failed" : rawStatus === "failed" ? "failed" : rawStatus === "canceled" ? "canceled" : "succeeded";
            const createdAt = String(generation.createdAt || now);
            const error = status === "failed" && rawStatus !== "failed" ? "浏览器任务已在迁移前中断" : typeof generation.error === "string" ? generation.error : null;
            insertGeneration.run(id, req.user.id, kind, status, JSON.stringify({ legacy: true, prompt: generation.prompt || "" }), JSON.stringify(generation), error, error ? "LEGACY_GENERATION_FAILED" : null, status === "succeeded" ? 1 : 0, createdAt, String(generation.updatedAt || createdAt));
            syncFileRefs(req.user.id, "generation", id, generation);
        });
        if (value.settings) {
            const now = new Date().toISOString();
            db.prepare("INSERT OR REPLACE INTO user_settings(user_id, encrypted_payload, updated_at) VALUES(?, ?, ?)").run(req.user.id, encryptJson(sanitizeUserSettings(value.settings), config.appSecret), now);
        }
        db.prepare("INSERT INTO browser_imports(user_id, import_id, imported_at) VALUES(?, ?, ?)").run(req.user.id, value.importId, new Date().toISOString());
    });
    transaction();
    return { imported: true, projects: value.projects.length, assets: value.assets.length, generations: value.generations.length };
}

function projectResponse(row: ProjectRow) {
    return { ...parseJson<Record<string, unknown>>(row.payload, {}), id: row.id, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function assetResponse(row: AssetRow) {
    return { ...parseJson<Record<string, unknown>>(row.payload, {}), id: row.id, kind: row.kind, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function adminComfyResponse(row: ComfyServerRow) {
    return { id: row.id, name: row.name, url: decryptJson<{ url: string }>(row.encrypted_url, config.appSecret).url, enabled: Boolean(row.enabled), models: parseJson<string[]>(row.models, []), createdAt: row.created_at, updatedAt: row.updated_at };
}

function validatedComfyUrl(value: string) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw apiError(400, "COMFY_URL_INVALID", "ComfyUI 地址只支持不含凭据的 HTTP/HTTPS URL");
    if (url.hostname === "169.254.169.254" || url.hostname.endsWith(".internal")) throw apiError(400, "COMFY_URL_BLOCKED", "禁止访问该内部地址");
    return url.toString().replace(/\/+$/, "");
}

function route(handler: (req: Request) => unknown, status = 200) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            res.status(status).json({ data: handler(req) });
        } catch (error) {
            next(error);
        }
    };
}

function asyncRoute(handler: (req: Request) => Promise<unknown>, status = 200) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req).then((data) => res.status(status).json({ data })).catch(next);
}

function apiError(status: number, code: string, message: string, details?: unknown) {
    return Object.assign(new Error(message), { status, code, details });
}

function withoutClientUserId<T extends Record<string, unknown>>(value: T) {
    const result = { ...value };
    delete result.userId;
    return result;
}

function sanitizeUserSettings<T extends { config: Record<string, unknown>; promptSources?: Record<string, unknown> }>(value: T): T {
    const blocked = new Set(["channels", "baseUrl", "apiKey", "authToken", "apiFormat", "models", "channelMode", "script"]);
    const configValue = Object.fromEntries(Object.entries(value.config).filter(([key]) => !blocked.has(key)));
    return { ...value, config: configValue };
}

function redactAdminError(value: string | null) {
    if (!value) return null;
    return value
        .replace(/https?:\/\/\S+/gi, "[URL]")
        .replace(/(?:sk|key|token|bearer)[-_\s:=]+[A-Za-z0-9._-]{8,}/gi, "[凭据已隐藏]")
        .slice(0, 500);
}
