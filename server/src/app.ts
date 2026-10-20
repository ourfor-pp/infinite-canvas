import { videoEnhancementModels } from "./video-contract.js";
import { canvasNodeTypeSchema } from "./agent/canvas-tools.js";
import { createDirectorLookFrame, readDirectorPrevis, updateDirectorLookFrame } from "./director-previs.js";
import { cancelPrevisRender, createPrevisRender, getPrevisRender, listPrevisRenders, retryPrevisRender } from "./director-previs-render.js";
import { registerGenerationEffects } from "./generation-effects.js";
import { listMediaCapabilities } from "./media-capabilities.js";
import { createMediaGeneration, prepareMediaGeneration } from "./media-generation.js";
import { getDirectorSyncSnapshot } from "./director-sync-snapshot.js";
import { markDirectorProjectChanged } from "./director-sync.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { createReadStream } from "node:fs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { authenticate, requireAdmin } from "./auth.js";
import { config } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { db, parseJson } from "./database.js";
import { COMFY_MODELS, COMFY_REQUIREMENTS } from "./comfy-workflows.js";
import { getStoredFile, receiveUpload, sendStoredFile, storedFileResponse, syncFileRefs } from "./file-store.js";
import { cancelGeneration, cancelGenerationByAdmin, createGeneration, generationResponse, type GenerationRow } from "./generation-service.js";
import { createBackup, getBackupSettings, listBackups, restoreBackup, saveBackupSettings, testBackupConnection } from "./backup-service.js";
import { clearProviderCredentials, deleteProvider, discoverProviderModels, getAiGlobalSettings, listAdminProviders, listModelDefaults, listModelEndpoints, listPublicModels, listExecutorModels, providerInputSchema, pruneModelDefaults, saveAiGlobalSettings, saveModelDefaults, saveProvider, testProvider } from "./provider-service.js";
import { agentAdminRouter, agentRouter } from "./agent/routes.js";
import { handleAgentProviderProxy } from "./agent/provider-proxy.js";
import { removeAgentProjectWorkspace } from "./agent/service.js";
import { getMediaExecutorSettings, MEDIA_PROTOCOL, publicMediaExecutorSettings, refreshMediaExecutorCatalog, saveMediaExecutorSettings } from "./media-executor-settings.js";
import {
    createCreativeAsset,
    deleteCanvasNodes,
    deleteCreativeAsset,
    getCreativeAsset,
    listCreativeAssets,
    setCreativeAssetPrimary,
    reviewCreativeAssetVariant,
    updateCreativeAsset,
} from "./creative-assets.js";
import { createCreativeAssetGeneration, createDirectorAssetGeneration, previewCreativeAssetGeneration, previewDirectorAssetGeneration } from "./creative-asset-generation.js";
import { createVisualStyle, deleteVisualStyle, getVisualStyle, listVisualStyles, listVisualStyleTemplates, setDefaultVisualStyle, updateVisualStyle } from "./visual-styles.js";
import { createVisualStyleAnalysis, createVisualStyleReferences } from "./visual-style-generation.js";
import {
    createDirectorSequence, createDirectorSource, createDirectorVideoSegment, deleteDirectorSequence, deleteDirectorVideoSegment,
    listDirectorVideoSegments, getDirectorDocument, getDirectorScreenplayBreakdown, getDirectorState, listDirectorSequences, listDirectorSourceChunks, retryDirectorSource,
    updateDirectorDocument, updateDirectorScreenplayBreakdown, updateDirectorSequence, updateDirectorTimeline, updateDirectorVideoSegment, updateDirectorWorkspace, updateDirectorSegmentAssetReference,
} from "./director.js";
import { cancelDirectorRender, createDirectorRender,  createDirectorVideoSegmentGeneration, getDirectorVideoSegmentPreflightWithFraming, getDirectorPlaybackPlan, listDirectorRenders, retryDirectorRender } from "./director-render.js";
import { getDirectorCastReview, startDirectorCastReview } from "./director-cast-review.js";
import {
    resolveDirectorReferenceImage, resolveDirectorMediaFile,  listDirectorSegmentPlans, saveDirectorSegmentPlan, addDirectorAssetMediaInput, ensureDirectorProjectWorkspace, exportDirectorProjectZip, getDirectorAssetDetail, getDirectorValidation, importDirectorProjectZip,
    readDirectorLogicalDocument, readDirectorStyleBoard, readDirectorTextFile, removeDirectorAssetMediaInput, removeDirectorProjectWorkspace, trashDirectorAssetVariant, validateDirectorProject, writeDirectorDocumentPart, writeDirectorMarkdown,
} from "./director-workspace.js";

type ProjectKind = "canvas" | "director";
type ProjectRow = { id: string; kind: ProjectKind; title: string; payload: string; revision: number; created_at: string; updated_at: string };
type AssetRow = { id: string; kind: string; title: string; payload: string; created_at: string; updated_at: string };
type ComfyServerRow = { id: string; name: string; encrypted_url: string; enabled: number; models: string; created_at: string; updated_at: string };

const idSchema = z.string().trim().min(1).max(128);
const jsonRecord = z.record(z.string(), z.unknown());
const projectKindSchema = z.enum(["canvas", "director"]);
const projectSchema = z.object({ id: idSchema, kind: projectKindSchema.default("canvas"), title: z.string().trim().min(1).max(200), nodes: z.array(z.object({ type: canvasNodeTypeSchema }).passthrough()).optional() }).passthrough();
const assetSchema = z.object({ id: idSchema, kind: z.enum(["text", "image", "video", "character", "scene", "prop"]), title: z.string().trim().min(1).max(200) }).passthrough();
const settingsSchema = z.object({ config: jsonRecord, promptSources: jsonRecord.optional() });
const comfyServerSchema = z.object({ name: z.string().trim().min(1).max(100), url: z.string().url(), enabled: z.boolean().default(true), models: z.array(z.enum(COMFY_MODELS)).min(1) });
const generationParamsSchema = jsonRecord.superRefine((value, context) => {
    const forbidden = ["baseUrl", "apiKey", "authToken", "provider", "headers", "request", "script"];
    forbidden.forEach((key) => {
        if (key in value) context.addIssue({ code: "custom", path: [key], message: "生成参数不能包含渠道或请求配置" });
    });
});
registerGenerationEffects();

const generationSchema = z.object({
    videoInputVersion: z.literal(1).optional(), imageInputVersion: z.literal(1).optional(), audioInputVersion: z.literal(1).optional(),
    kind: z.enum(["image", "video", "audio", "text", "transcription"]),
    model: z.string().trim().min(3).optional(),
    purpose: z.enum(["default", "image-inpaint", "image-upscale-faithful", "image-upscale-generative", "image-angle"]).default("default"),
    prompt: z.string().max(200_000).optional(),
    mode: z.string().optional(),
    operation: z.string().optional(),
    continuation: z.object({ generationId: idSchema, fileId: idSchema }).optional(),
    messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(200_000) })).max(500).optional(),
    params: generationParamsSchema.optional(),
    references: z.array(z.object({ fileId: idSchema, kind: z.enum(["image", "video", "audio"]).optional(), role: z.enum(["reference", "first-frame", "last-frame", "continuation", "emotion"]).optional(), transcript: z.string().max(20_000).optional(), frameIndex: z.number().int().min(-1).optional(), includeAudio: z.boolean().optional() })).optional(),
}).superRefine((value, context) => {
    if (value.purpose === "default" && !value.model) context.addIssue({ code: "custom", path: ["model"], message: "普通生成必须指定模型" });
    if (value.kind !== "transcription" && !(value.kind === "video" && videoEnhancementModels.includes(value.model?.split("::")[1] || "")) && !value.prompt?.trim() && !value.messages?.length && !value.purpose.startsWith("image-upscale-")) context.addIssue({ code: "custom", path: ["prompt"], message: "提示词或消息不能为空" });
    if (value.purpose !== "default" && value.kind !== "image") context.addIssue({ code: "custom", path: ["purpose"], message: "专用图片工具只支持图片任务" });
    if (value.purpose === "image-inpaint" && !String(value.params?.maskFileId || "")) context.addIssue({ code: "custom", path: ["params", "maskFileId"], message: "局部编辑缺少蒙版" });
    if (value.purpose.startsWith("image-upscale-") && ![1024, 2048, 4096].includes(Number(value.params?.targetLongEdge))) context.addIssue({ code: "custom", path: ["params", "targetLongEdge"], message: "超分目标只支持 1024、2048 或 4096" });
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
    const kind = req.query.kind === undefined ? undefined : projectKindSchema.parse(req.query.kind);
    const rows = (kind
        ? db.prepare("SELECT id, kind, title, revision, created_at, updated_at FROM projects WHERE user_id=? AND kind=? ORDER BY updated_at DESC").all(req.user.id, kind)
        : db.prepare("SELECT id, kind, title, revision, created_at, updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC").all(req.user.id)) as Array<Omit<ProjectRow, "payload">>;
    res.json({ data: rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })) });
});

api.post("/projects", route((req) => {
    const value = withoutClientUserId(projectSchema.parse(req.body));
    const now = new Date().toISOString();
    const payload = { ...value, createdAt: value.createdAt || now, updatedAt: now };
    return db.transaction(() => {
        db.prepare("INSERT INTO projects(id, user_id, kind, title, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 1, ?, ?)").run(value.id, req.user.id, value.kind, value.title, JSON.stringify(payload), payload.createdAt, now);
        if (value.kind === "director") initializeDirectorProject(req.user.id, value.id, now);
        syncFileRefs(req.user.id, "project", value.id, payload);
        markDirectorProjectChanged(req.user.id, value.id, ["project"]);
        return projectResponse(db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(value.id, req.user.id) as ProjectRow);
    })();
}, 201));

api.get("/projects/:id", route((req) => {
    const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow | undefined;
    if (!row) throw apiError(404, "PROJECT_NOT_FOUND", "项目不存在");
    return projectResponse(row);
}));

api.delete("/projects/:id/nodes", route((req) => deleteCanvasNodes(
    req.user.id,
    assertProjectKind(req.user.id, routeId(req), "canvas").id,
    z.array(idSchema).min(1).max(500).parse(req.body?.ids),
    z.number().int().positive().parse(req.body?.revision),
)));

api.put("/projects/:id", route((req) => {
    const value = withoutClientUserId(projectSchema.parse({ ...req.body, id: req.params.id }));
    const expectedRevision = z.number().int().positive().parse(req.body.revision);
    const now = new Date().toISOString();
    const payload = { ...value, updatedAt: now };
    return db.transaction(() => {
        const project = assertProjectKind(req.user.id, routeId(req));
        if (value.kind !== project.kind) throw apiError(400, "PROJECT_KIND_IMMUTABLE", "项目类型不能修改");
        const result = db.prepare(`UPDATE projects SET title=?, payload=?, revision=revision+1, updated_at=?
            WHERE id=? AND user_id=? AND revision=?`).run(value.title, JSON.stringify(payload), now, req.params.id, req.user.id, expectedRevision);
        if (!result.changes) {
            const current = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow | undefined;
            if (!current) throw apiError(404, "PROJECT_NOT_FOUND", "项目不存在");
            throw apiError(409, "PROJECT_CONFLICT", "项目已在其他页面更新", { current: projectResponse(current) });
        }
        syncFileRefs(req.user.id, "project", routeId(req), payload);
        markDirectorProjectChanged(req.user.id, routeId(req), ["project"]);
        return projectResponse(db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow);
    })();
}));

api.put("/projects/:id/force", route((req) => {
    const value = withoutClientUserId(projectSchema.parse({ ...req.body, id: req.params.id }));
    const now = new Date().toISOString();
    const payload = { ...value, updatedAt: now };
    return db.transaction(() => {
        const project = assertProjectKind(req.user.id, routeId(req));
        if (value.kind !== project.kind) throw apiError(400, "PROJECT_KIND_IMMUTABLE", "项目类型不能修改");
        const result = db.prepare("UPDATE projects SET title=?, payload=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?").run(value.title, JSON.stringify(payload), now, req.params.id, req.user.id);
        if (!result.changes) throw apiError(404, "PROJECT_NOT_FOUND", "项目不存在");
        syncFileRefs(req.user.id, "project", routeId(req), payload);
        markDirectorProjectChanged(req.user.id, routeId(req), ["project"]);
        return projectResponse(db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id) as ProjectRow);
    })();
}));

api.delete("/projects/:id", route((req) => {
    const projectId = routeId(req);
    const director = Boolean(db.prepare("SELECT 1 FROM projects WHERE user_id=? AND id=? AND kind='director'").get(req.user.id, projectId));
    if (db.prepare("SELECT 1 FROM agent_sessions WHERE user_id=? AND project_id=? AND status IN ('running','waiting_for_user')").get(req.user.id, projectId)) throw apiError(409, "PROJECT_AGENT_BUSY", "Agent 正在使用这个项目，请先停止任务");
    const result = db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='creative_asset' AND owner_id IN (SELECT id FROM creative_assets WHERE user_id=? AND project_id=?)").run(req.user.id, req.user.id, projectId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='visual_style' AND owner_id IN (SELECT id FROM visual_styles WHERE user_id=? AND project_id=?)").run(req.user.id, req.user.id, projectId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type IN ('director_source','director_render') AND owner_id IN (SELECT id FROM director_sources WHERE user_id=? AND project_id=? UNION SELECT id FROM director_renders WHERE user_id=? AND project_id=?)").run(req.user.id, req.user.id, projectId, req.user.id, projectId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='director_shot' AND owner_id IN (SELECT id FROM director_shots WHERE user_id=? AND project_id=?)").run(req.user.id, req.user.id, projectId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='director_sequence' AND owner_id IN (SELECT id FROM director_sequences WHERE user_id=? AND project_id=?)").run(req.user.id, req.user.id, projectId);
        db.prepare("DELETE FROM agent_sessions WHERE user_id=? AND project_id=?").run(req.user.id, projectId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='project' AND owner_id=?").run(req.user.id, projectId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='agent_project' AND owner_id=?").run(req.user.id, projectId);
        db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(projectId, req.user.id);
        return { id: projectId };
    })();
    removeAgentProjectWorkspace(req.user.id, projectId);
    removeDirectorProjectWorkspace(req.user.id, projectId);
    if (director) markDirectorProjectChanged(req.user.id, projectId, ["project"], true);
    return result;
}));

api.get("/director/projects/:id/sync", route((req) => getDirectorSyncSnapshot(req.user.id, routeId(req), String(req.query.resources || "").split(","), req.query.refresh === "1")));

api.get("/director/projects/:id", route((req) => {
    ensureDirectorProjectWorkspace(req.user.id, routeId(req));
    return getDirectorState(req.user.id, routeId(req));
}));
api.post("/director/projects/:id/validate", route((req) => validateDirectorProject(req.user.id, routeId(req), typeof req.body?.scope === "string" ? req.body.scope : "")));
api.get("/director/projects/:id/validation", route((req) => getDirectorValidation(req.user.id, routeId(req))));
api.get("/director/projects/:id/reference-image", route((req) => resolveDirectorReferenceImage(req.user.id, routeId(req), String(req.query.path || ""))));
api.get("/director/projects/:id/reference-video", route((req) => { const value = resolveDirectorMediaFile(req.user.id, routeId(req), String(req.query.path || ""), "video"); return { fileId: value.fileId }; }));
api.get("/director/projects/:id/file", route((req) => readDirectorTextFile(req.user.id, routeId(req), String(req.query.path || ""))));
api.put("/director/projects/:id/file", route((req) => writeDirectorMarkdown(req.user.id, routeId(req), String(req.body?.path || ""), String(req.body?.content || ""), typeof req.headers["if-match"] === "string" ? req.headers["if-match"].replace(/^\"|\"$/g, "") : undefined)));
api.get("/director/projects/:id/direction/style-board", (req, res, next) => {
    try {
        const file = readDirectorStyleBoard(req.user.id, routeId(req));
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Length", file.bytes);
        res.setHeader("ETag", `\"${file.hash}\"`);
        res.setHeader("Cache-Control", "private, max-age=3600");
        createReadStream(file.path).pipe(res);
    } catch (error) { next(error); }
});
api.get("/director/projects/:id/logical-documents/:kind", route((req) => readDirectorLogicalDocument(req.user.id, routeId(req), routeParam(req, "kind"))));
api.put("/director/projects/:id/logical-documents/:kind/part", route((req) => writeDirectorDocumentPart(req.user.id, routeId(req), routeParam(req, "kind"), String(req.body?.path || ""), String(req.body?.content || ""), typeof req.headers["if-match"] === "string" ? req.headers["if-match"].replace(/^\"|\"$/g, "") : undefined)));
api.get("/director/projects/:id/export", async (req, res, next) => {
    try {
        const result = await exportDirectorProjectZip(req.user.id, routeId(req));
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
        res.send(result.buffer);
    } catch (error) { next(error); }
});
api.post("/director/projects/import", express.raw({ type: ["application/zip", "application/x-zip-compressed"], limit: config.maxUploadBytes }), async (req, res, next) => {
    try {
        if (!Buffer.isBuffer(req.body)) throw apiError(415, "DIRECTOR_IMPORT_TYPE", "请上传 ZIP 工程包");
        const projectId = nanoid();
        const now = new Date().toISOString();
        let title = "导入的导演项目";
        try { title = decodeURIComponent(String(req.headers["x-project-name"] || title)).trim().slice(0, 200) || title; } catch { /* keep safe default */ }
        db.transaction(() => {
            db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,revision,created_at,updated_at) VALUES(?,?,'director',?,?,1,?,?)").run(projectId, req.user.id, title, JSON.stringify({ id: projectId, kind: "director", title, createdAt: now, updatedAt: now }), now, now);
            initializeDirectorProject(req.user.id, projectId, now);
        })();
        try {
            const result = await importDirectorProjectZip(req.user.id, projectId, req.body);
            res.status(201).json({ data: result });
        } catch (error) {
            db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(projectId, req.user.id);
            removeDirectorProjectWorkspace(req.user.id, projectId);
            throw error;
        }
    } catch (error) { next(error); }
});
api.get("/director/projects/:id/cast-review", route((req) => getDirectorCastReview(req.user.id, routeId(req))));
api.post("/director/projects/:id/cast-review", route((req) => startDirectorCastReview(req.user.id, routeId(req)), 202));
api.put("/director/projects/:id/workspace", route((req) => updateDirectorWorkspace(req.user.id, routeId(req), req.body)));
api.post("/director/projects/:id/sources", route((req) => createDirectorSource(req.user.id, routeId(req), req.body), 202));
api.post("/director/sources/:id/retry", route((req) => retryDirectorSource(req.user.id, routeId(req)), 202));
api.get("/director/sources/:id/chunks", route((req) => listDirectorSourceChunks(req.user.id, routeId(req), req.query)));
api.get("/director/projects/:id/documents/:kind", route((req) => getDirectorDocument(req.user.id, routeId(req), routeParam(req, "kind"))));
api.put("/director/projects/:id/documents/:kind", route((req) => updateDirectorDocument(req.user.id, routeId(req), routeParam(req, "kind"), req.body)));
api.get("/director/projects/:id/screenplay-breakdown", route((req) => getDirectorScreenplayBreakdown(req.user.id, routeId(req))));
api.put("/director/projects/:id/screenplay-breakdown", route((req) => updateDirectorScreenplayBreakdown(req.user.id, routeId(req), req.body)));
api.get("/director/projects/:id/sequences", route((req) => listDirectorSequences(req.user.id, routeId(req))));
api.post("/director/projects/:id/sequences", route((req) => createDirectorSequence(req.user.id, routeId(req), req.body), 201));
api.put("/director/sequences/:id", route((req) => updateDirectorSequence(req.user.id, routeId(req), req.body)));
api.delete("/director/sequences/:id", route((req) => deleteDirectorSequence(req.user.id, routeId(req))));
api.get("/director/projects/:id/segments", route((req) => listDirectorSegmentPlans(req.user.id, routeId(req), Number(req.query.offset) || 0, Number(req.query.limit) || 50)));
api.get("/director/projects/:id/segments/:segmentId/previs", route((req) => readDirectorPrevis(req.user.id, routeId(req), String(req.params.segmentId))));
api.get("/director/projects/:id/segments/:segmentId/previs-renders", route((req) => listPrevisRenders(req.user.id, routeId(req), String(req.params.segmentId), Number(req.query.offset) || 0)));
api.post("/director/projects/:id/segments/:segmentId/previs-renders", route((req) => createPrevisRender(req.user.id, routeId(req), String(req.params.segmentId), req.body), 202));
api.get("/director/projects/:id/previs-renders/:renderId", route((req) => getPrevisRender(req.user.id, routeId(req), String(req.params.renderId))));
api.post("/director/projects/:id/previs-renders/:renderId/cancel", route((req) => cancelPrevisRender(req.user.id, routeId(req), String(req.params.renderId))));
api.post("/director/projects/:id/previs-renders/:renderId/retry", route((req) => retryPrevisRender(req.user.id, routeId(req), String(req.params.renderId)), 202));
api.post("/director/projects/:id/segments/:segmentId/look-frames", route((req) => {
    const frame = createDirectorLookFrame(req.user.id, routeId(req), String(req.params.segmentId), req.body?.time, req.body?.expectedHash, req.body?.frameId);
    const render = createPrevisRender(req.user.id, routeId(req), String(req.params.segmentId), { expectedHash: frame.sourceHash, kind: "frame", frameId: frame.id, start: frame.time });
    return { frame, render };
}, 202));
api.patch("/director/projects/:id/segments/:segmentId/look-frames/:frameId", route((req) => updateDirectorLookFrame(req.user.id, routeId(req), String(req.params.segmentId), String(req.params.frameId), req.body)));
api.put("/director/projects/:id/segments", route((req) => saveDirectorSegmentPlan(req.user.id, routeId(req), req.body)));
api.get("/director/projects/:id/production-tasks", route((req) => listDirectorVideoSegments(req.user.id, routeId(req), req.query)));
api.post("/director/projects/:id/production-tasks", route((req) => createDirectorVideoSegment(req.user.id, routeId(req), req.body), 201));
api.put("/director/production-tasks/:id", route((req) => updateDirectorVideoSegment(req.user.id, routeId(req), req.body)));
api.put("/director/production-tasks/:id/asset-reference", route((req) => updateDirectorSegmentAssetReference(req.user.id, routeId(req), req.body)));
api.delete("/director/production-tasks/:id", route((req) => deleteDirectorVideoSegment(req.user.id, routeId(req))));
api.get("/director/production-tasks/:id/preflight", asyncRoute((req) => getDirectorVideoSegmentPreflightWithFraming(req.user.id, routeId(req))));
api.post("/director/production-tasks/:id/generate", asyncRoute((req) => createDirectorVideoSegmentGeneration(req.user.id, routeId(req), req.body), 201));
api.get("/director/projects/:id/playback-plan", asyncRoute((req) => getDirectorPlaybackPlan(req.user.id, routeId(req))));
api.put("/director/projects/:id/timeline", route((req) => updateDirectorTimeline(req.user.id, routeId(req), req.body)));
api.get("/director/projects/:id/renders", route((req) => listDirectorRenders(req.user.id, routeId(req))));
api.post("/director/projects/:id/renders", asyncRoute((req) => createDirectorRender(req.user.id, routeId(req), req.body), 202));
api.post("/director/renders/:id/cancel", route((req) => cancelDirectorRender(req.user.id, routeId(req))));
api.post("/director/renders/:id/retry", route((req) => retryDirectorRender(req.user.id, routeId(req)), 202));
api.get("/director/assets/:id/detail", route((req) => getDirectorAssetDetail(req.user.id, routeId(req))));
api.post("/director/assets/:id/generation-preview", route((req) => previewDirectorAssetGeneration(req.user.id, routeId(req), req.body)));
api.post("/director/assets/:id/media-inputs", route((req) => addDirectorAssetMediaInput(req.user.id, routeId(req), req.body), 201));
api.delete("/director/assets/:id/media-inputs/:inputId", route((req) => removeDirectorAssetMediaInput(req.user.id, routeId(req), routeParam(req, "inputId"))));
api.delete("/director/assets/:id/variants/:variantId", route((req) => trashDirectorAssetVariant(req.user.id, routeId(req), routeParam(req, "variantId"))));
api.post("/director/assets/:id/generate", route((req) => createDirectorAssetGeneration(req.user.id, routeId(req), req.body), 201));

api.get("/projects/:id/creative-assets", route((req) => listCreativeAssets(req.user.id, routeId(req))));
api.post("/projects/:id/creative-assets", route((req) => createCreativeAsset(req.user.id, routeId(req), req.body), 201));
api.get("/creative-assets/:id", route((req) => getCreativeAsset(req.user.id, routeId(req))));
api.put("/creative-assets/:id", route((req) => updateCreativeAsset(req.user.id, routeId(req), req.body, true)));
api.delete("/creative-assets/:id", route((req) => deleteCreativeAsset(req.user.id, routeId(req))));
api.post("/creative-assets/:id/variants/:variantId/primary", route((req) => setCreativeAssetPrimary(req.user.id, routeId(req), routeParam(req, "variantId"), z.number().int().positive().parse(req.body?.revision), true)));
api.post("/creative-assets/:id/variants/:variantId/review", route((req) => reviewCreativeAssetVariant(req.user.id, routeId(req), routeParam(req, "variantId"), z.object({ revision: z.number().int().positive(), accepted: z.boolean(), summary: z.string().max(2_000).optional(), issues: z.array(z.string().max(500)).max(50).optional(), setPrimary: z.boolean().optional() }).parse(req.body))));
api.post("/creative-assets/:id/generation-preview", route((req) => previewCreativeAssetGeneration(req.user.id, routeId(req), req.body)));
api.post("/creative-assets/:id/generations", route((req) => createCreativeAssetGeneration(req.user.id, routeId(req), req.body), 201));

api.get("/visual-style-templates", route(() => listVisualStyleTemplates()));
api.get("/projects/:id/visual-styles", route((req) => listVisualStyles(req.user.id, routeId(req))));
api.post("/projects/:id/visual-styles", route((req) => createVisualStyle(req.user.id, routeId(req), req.body), 201));
api.get("/visual-styles/:id", route((req) => getVisualStyle(req.user.id, routeId(req))));
api.put("/visual-styles/:id", route((req) => updateVisualStyle(req.user.id, routeId(req), req.body)));
api.delete("/visual-styles/:id", route((req) => deleteVisualStyle(req.user.id, routeId(req))));
api.post("/visual-styles/:id/default", route((req) => setDefaultVisualStyle(req.user.id, routeId(req))));
api.post("/visual-styles/:id/references/generate", route((req) => createVisualStyleReferences(req.user.id, routeId(req), req.body), 201));
api.post("/visual-styles/:id/analyze", route((req) => createVisualStyleAnalysis(req.user.id, routeId(req), req.body), 201));

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
    const baseUrl = url.replace(/\/+$/, "");
    const headers: Record<string, string> = row.id === "media-executor" ? { Authorization: `Bearer ${getMediaExecutorSettings().token}`, "X-Media-Protocol": MEDIA_PROTOCOL } : {};
    const [statsResponse, infoResponse] = await Promise.all([
        fetch(`${baseUrl}/system_stats`, { headers, signal: AbortSignal.timeout(10_000), redirect: "error" }),
        fetch(`${baseUrl}/object_info`, { headers, signal: AbortSignal.timeout(10_000), redirect: "error" }),
    ]);
    if (!statsResponse.ok || !infoResponse.ok) throw apiError(502, "COMFY_UNAVAILABLE", `ComfyUI 返回 ${statsResponse.ok ? infoResponse.status : statsResponse.status}`);
    const info = await infoResponse.json() as Record<string, unknown>;
    const serialized = JSON.stringify(info);
    const enabled = new Set(parseJson<string[]>(row.models, []));
    const workflows = Object.entries(COMFY_REQUIREMENTS).filter(([id]) => enabled.has(id)).map(([id, requirement]) => {
        const missing = [
            ...(requirement?.nodes || []).filter((name) => !(name in info)).map((name) => `节点：${name}`),
            ...(requirement?.models || []).filter((model) => !serialized.includes(JSON.stringify(model.name))).map((model) => `模型：${model.name}`),
        ];
        return { id, available: !missing.length, missing };
    });
    return { available: true, workflows };
}));

api.get("/admin/media-executor/status", requireAdmin, asyncRoute(async () => {
    const executor = getMediaExecutorSettings();
    if (!executor.url || !executor.token) return { ...publicMediaExecutorSettings(executor), configured: false, available: false, models: [], catalog: [] };
    try {
        const value = await refreshMediaExecutorCatalog(executor);
        return { ...publicMediaExecutorSettings(executor), configured: true, available: value.available, models: Object.keys(value.models), modelDetails: value.models, runtimes: value.runtimes, configuredRuntimes: value.configuredRuntimes, catalog: listExecutorModels() };
    } catch {
        return { ...publicMediaExecutorSettings(executor), configured: true, available: false, models: [], catalog: [] };
    }
}));
api.put("/admin/media-executor/settings", requireAdmin, asyncRoute(async (req) => {
    const result = saveMediaExecutorSettings(req.body);
    await refreshMediaExecutorCatalog();
    return result;
}));

api.get("/generations", (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.prepare("SELECT * FROM generations WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(req.user.id, limit) as GenerationRow[];
    res.json({ data: rows.map(generationResponse) });
});
api.get("/admin/ai/generations", requireAdmin, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = db.prepare(`SELECT g.*, u.username FROM generations g JOIN users u ON u.id=g.user_id ORDER BY g.created_at DESC LIMIT ?`).all(limit) as Array<GenerationRow & { username: string }>;
    res.json({ data: rows.map((row) => { const response = generationResponse(row); return { ...response, diagnostics: response.diagnostics ? { phase: (response.diagnostics as { phase?: string }).phase } : null, user: { id: row.user_id, username: row.username }, error: redactAdminError(row.error), request: undefined, result: undefined }; }) });
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
api.get("/media/capabilities", asyncRoute(() => listMediaCapabilities()));
api.post("/media/generations/validate", asyncRoute(async (req) => ({ valid: true, plan: (await prepareMediaGeneration(req.user.id, req.body)).plan })));
api.post("/media/generations", asyncRoute((req) => createMediaGeneration(req.user.id, req.body), 201));
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

function routeParam(req: Request, key: string) {
    const value = req.params[key];
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
    return { ...parseJson<Record<string, unknown>>(row.payload, {}), id: row.id, kind: row.kind, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function initializeDirectorProject(userId: string, projectId: string, now: string) {
    db.prepare("INSERT INTO director_workspaces(project_id, user_id, directing_rules, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(projectId, userId, JSON.stringify({ positioning: "", intent: "", photography: "", performance: "", pacing: "", sound: "", prohibitions: "" }), now, now);
    const document = db.prepare("INSERT INTO director_documents(project_id, user_id, kind, created_at, updated_at) VALUES(?, ?, ?, ?, ?)");
    document.run(projectId, userId, "story", now, now);
    document.run(projectId, userId, "script", now, now);
    db.prepare("INSERT INTO director_screenplay_breakdowns(project_id, user_id, created_at, updated_at) VALUES(?, ?, ?, ?)").run(projectId, userId, now, now);
    db.prepare("INSERT INTO director_timelines(project_id, user_id, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(projectId, userId, JSON.stringify({ tracks: [], videoClips: [] }), now, now);
}

function assertProjectKind(userId: string, projectId: string, expected?: ProjectKind) {
    const row = db.prepare("SELECT id, kind FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as Pick<ProjectRow, "id" | "kind"> | undefined;
    if (!row) throw apiError(404, "PROJECT_NOT_FOUND", "项目不存在");
    if (expected && row.kind !== expected) throw apiError(409, "PROJECT_KIND_MISMATCH", expected === "canvas" ? "这不是画布项目" : "这不是导演项目");
    return row;
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
