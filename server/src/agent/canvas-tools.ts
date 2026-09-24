import type { AiGenerationRequest } from "../ai-adapters.js";
import { config } from "../config.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, parseJson } from "../database.js";
import { getStoredFile, syncFileRefs } from "../file-store.js";
import { createGeneration, generationResponse, getGenerationForAgent } from "../generation-service.js";
import { listPublicModels } from "../provider-service.js";
import { publishAgentProject } from "./project-events.js";
import {
    createCreativeAssetsBatch,
    creativeAssetInputSchema,
    deleteCreativeAsset,
    getCreativeAsset,
    listCreativeAssets,
    updateCreativeAsset,
} from "../creative-assets.js";
import { createVisualStyle, deleteVisualStyle, getVisualStyle, listVisualStyles, listVisualStyleTemplates, setDefaultVisualStyle, updateVisualStyle } from "../visual-styles.js";
import { createVisualStyleAnalysis, createVisualStyleReferences } from "../visual-style-generation.js";

type ProjectRow = { id: string; user_id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string };
type CanvasNode = { id: string; type?: string; title?: string; position?: { x?: number; y?: number }; metadata?: Record<string, unknown>; [key: string]: unknown };
type CanvasPayload = Record<string, unknown> & { id: string; title: string; nodes: CanvasNode[]; connections: Array<Record<string, unknown>>; revision?: number; updatedAt?: string };

const record = z.record(z.string(), z.unknown());
export const canvasNodeTypeSchema = z.string().refine((type) => ["text", "image", "video", "audio", "config", "group"].includes(type) || /^[^:]+:[^:]+$/.test(type), "画布只支持通用节点和已命名的插件节点");
const canvasOp = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), id: z.string().optional(), nodeType: canvasNodeTypeSchema.optional(), title: z.string().optional(), position: z.object({ x: z.number(), y: z.number() }).optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: record.optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).passthrough(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), fromPortId: z.string(), toNodeId: z.string(), toPortId: z.string() }).passthrough(),
]);
const canvasSafeOp = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), id: z.string().optional(), nodeType: canvasNodeTypeSchema.optional(), title: z.string().optional(), position: z.object({ x: z.number(), y: z.number() }).optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: record.optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), fromPortId: z.string(), toNodeId: z.string(), toPortId: z.string() }).passthrough(),
]);

export const canvasToolSchemas = {
    canvas_get_state: z.object({ projectId: z.string().optional(), view: z.enum(["summary", "nodes", "connections", "content"]).default("nodes"), nodeIds: z.array(z.string()).max(50).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20), contentOffset: z.number().int().min(0).default(0), contentLimit: z.number().int().min(1).max(16_000).default(8_000), expectedRevision: z.number().int().positive().optional() }),
    canvas_delete: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), nodeIds: z.array(z.string()).max(200).default([]), connectionIds: z.array(z.string()).max(200).default([]) }),
    canvas_adopt_result: z.object({ generationId: z.string().min(1), fileId: z.string().min(1).optional(), expectedRevision: z.number().int().positive(), nodeId: z.string().min(1).optional(), title: z.string().max(200).optional(), position: z.object({ x: z.number(), y: z.number() }).optional() }),
    canvas_apply_ops: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), ops: z.array(canvasSafeOp).min(1).max(100) }),
    assets_list: z.object({ kind: z.enum(["all", "text", "image", "video"]).optional(), keyword: z.string().max(200).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }),
    assets_add: z.object({ kind: z.enum(["text", "image", "video"]), title: z.string().min(1).max(200), payload: record }),
    assets_delete: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    generation_get_status: z.object({ id: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    generation_list_models: z.object({ kind: z.enum(["text", "image", "video", "audio"]).optional() }),
    generation_create: z.object({ kind: z.enum(["text", "image", "video", "audio"]), model: z.string(), prompt: z.string(), projectId: z.string().optional(), nodeId: z.string().optional(), references: z.array(z.object({ fileId: z.string(), kind: z.enum(["image", "video", "audio"]).optional(), role: z.enum(["reference", "first-frame", "last-frame", "continuation"]).optional() })).optional() }),
    creative_assets_list: z.object({ projectId: z.string().optional(), kind: z.enum(["character", "scene", "prop"]).optional() }),
    creative_asset_get: z.object({ projectId: z.string().optional(), assetId: z.string() }),
    creative_assets_create_batch: z.object({ projectId: z.string().optional(), items: z.array(creativeAssetInputSchema).min(1).max(200) }),
    creative_asset_update: z.object({ projectId: z.string().optional(), assetId: z.string(), revision: z.number().int().positive(), patch: creativeAssetInputSchema.partial() }),
    creative_asset_delete: z.object({ projectId: z.string().optional(), assetId: z.string() }),
    visual_styles_list: z.object({ projectId: z.string().optional() }),
    visual_style_templates_list: z.object({
        mediumFamily: z.enum(["live_action", "animation_2d", "animation_3d", "illustration", "handmade", "graphic"]).optional(),
        category: z.enum(["cinematic", "genre", "eastern", "animation", "handmade", "graphic"]).optional(),
        tag: z.string().trim().max(30).optional(),
        keyword: z.string().trim().max(100).optional(),
    }),
    visual_style_get: z.object({ projectId: z.string().optional(), styleId: z.string() }),
    visual_style_create: z.object({ projectId: z.string().optional(), name: z.string().min(1).max(200), mode: z.enum(["template", "custom"]), templateId: z.string().nullable().optional(), description: z.string().max(20_000).optional(), status: z.enum(["draft", "confirmed"]).optional(), dna: z.record(z.string(), z.unknown()).optional(), references: z.record(z.string(), z.string()).optional() }),
    visual_style_update: z.object({ projectId: z.string().optional(), styleId: z.string(), revision: z.number().int().positive(), name: z.string().min(1).max(200).optional(), mode: z.enum(["template", "custom"]).optional(), templateId: z.string().nullable().optional(), description: z.string().max(20_000).optional(), status: z.enum(["draft", "confirmed"]).optional(), dna: z.record(z.string(), z.unknown()).optional(), references: z.record(z.string(), z.string()).optional() }),
    visual_style_set_default: z.object({ projectId: z.string().optional(), styleId: z.string() }),
    visual_style_analyze: z.object({ projectId: z.string().optional(), styleId: z.string(), revision: z.number().int().positive() }),
    visual_style_generate_references: z.object({ projectId: z.string().optional(), styleId: z.string(), revision: z.number().int().positive() }),
    visual_style_delete: z.object({ projectId: z.string().optional(), styleId: z.string() }),
};

export function getCanvasState(userId: string, projectId: string) {
    const row = projectRow(userId, projectId);
    const payload = normalizePayload(row);
    return { ...payload, revision: row.revision };
}

export function readCanvasState(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.canvas_get_state>) {
    const state = getCanvasState(userId, projectId);
    if (input.expectedRevision && state.revision !== input.expectedRevision) throw agentToolError("PROJECT_CONFLICT", "画布已更新，请从第一页重新读取");
    const summary = { id: state.id, title: state.title, revision: state.revision, nodeCount: state.nodes.length, connectionCount: state.connections.length };
    if (input.view === "summary") return summary;
    const nodes = state.nodes.filter((node) => !input.nodeIds || input.nodeIds.includes(node.id));
    if (input.view === "content") {
        if (input.nodeIds?.length !== 1) throw agentToolError("NODE_REQUIRED", "读取正文必须指定一个 nodeId（nodeIds 数组仅一项）");
        if (!nodes.length) throw agentToolError("NODE_NOT_FOUND", "节点不存在");
        const content = String(nodes[0].metadata?.content || "");
        const end = Math.min(content.length, input.contentOffset + input.contentLimit);
        return { ...summary, nodeId: nodes[0].id, content: content.slice(input.contentOffset, end), totalCharacters: content.length, nextContentOffset: end < content.length ? end : null };
    }
    const items = input.view === "connections" ? state.connections.filter((item) => !input.nodeIds || input.nodeIds.includes(String(item.fromNodeId)) || input.nodeIds.includes(String(item.toNodeId))) : nodes;
    const page = items.slice(input.offset, input.offset + input.limit).map((item) => input.view === "connections"
        ? Object.fromEntries(["id", "fromNodeId", "fromPortId", "toNodeId", "toPortId"].map((key) => [key, item[key]]))
        : { id: item.id, type: item.type, title: String(item.title || "").slice(0, 200), position: item.position, width: item.width, height: item.height,
            metadata: Object.fromEntries(["status", "storageKey", "mimeType", "agentGenerationId", "agentGenerationStatus"].map((key) => [key, String((item as CanvasNode).metadata?.[key] || "").slice(0, 500)])),
            contentLength: String((item as CanvasNode).metadata?.content || "").length });
    return { ...summary, [input.view]: page, total: items.length, offset: input.offset, nextOffset: input.offset + page.length < items.length ? input.offset + page.length : null };
}

export function canvasMutationSummary(result: ReturnType<typeof applyCanvasOps>) {
    return { projectId: result.projectId, revision: result.revision, applied: result.applied, nodeIds: result.nodeIds };
}

export function adoptCanvasResult(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.canvas_adopt_result>) {
    const row = getGenerationForAgent(userId, input.generationId);
    if (!row || generationProjectId(row.request) !== projectId || row.status !== "succeeded") throw agentToolError("GENERATION_NOT_FOUND", "任务未完成或不属于当前项目");
    const result = parseJson<{ text?: string; files?: Array<{ id?: string; fileId?: string }>; cumulativeVideos?: Array<{ id?: string; fileId?: string }> }>(row.result, {});
    const file = input.fileId ? getStoredFile(userId, input.fileId) : undefined;
    if (input.fileId && (!file || ![...(result.files || []), ...(result.cumulativeVideos || [])].some((item) => (item.fileId || item.id) === input.fileId))) throw agentToolError("RESULT_FILE_INVALID", "文件不是当前任务的输出");
    const kind = file ? file.mime_type.split("/")[0] : "text";
    if (!["text", "image", "video", "audio"].includes(kind) || (!file && !result.text)) throw agentToolError("RESULT_UNSUPPORTED", "请选择图片、视频、音频结果文件或文本结果");
    const state = getCanvasState(userId, projectId);
    const node = input.nodeId ? state.nodes.find((item) => item.id === input.nodeId) : state.nodes.find(item => item.metadata?.agentGenerationId === row.id);
    if (input.nodeId && (!node || node.type !== kind)) throw agentToolError("NODE_TYPE_MISMATCH", "目标节点不存在或类型与结果不匹配");
    const id = node?.id || `${kind}-${nanoid()}`;
    const request = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
    const metadata = { ...generationNodeInputs(request), agentGenerationAdopted: true, content: file ? `${config.basePath}/api/files/${file.id}/content` : result.text, ...(file ? { storageKey: `server:${file.id}`, mimeType: file.mime_type, bytes: file.bytes } : {}), status: "success", agentGenerationId: row.id, agentGenerationStatus: row.status, errorDetails: null };
    const mutation = applyCanvasOps(userId, projectId, [node ? { type: "update_node", id, metadata, patch: { ...(input.title ? { title: input.title } : {}), ...(input.position ? { position: input.position } : {}) } } : { type: "add_node", id, nodeType: kind, title: input.title || "生成结果", position: input.position, width: 320, height: kind === "audio" ? 120 : 200, metadata }, ...generationReferenceOps(userId, request, id, state.nodes, input.position || { x: Number(node?.position?.x || 0), y: Number(node?.position?.y || 0) })], input.expectedRevision);
    return { ...canvasMutationSummary(mutation), nodeId: id };
}

export function generationNodeInputs(request: AiGenerationRequest) {
    return { prompt: request.prompt || "", composerContent: request.prompt || "", model: request.model,
        generationRequest: request, ...(request.kind === "audio" ? { audioParams: request.params, audioOperation: request.operation } : {}),
        ...(request.params?.seconds !== undefined ? { seconds: String(request.params.seconds) } : {}) };
}

export function generationReferenceOps(userId: string, request: AiGenerationRequest, targetId: string, nodes: CanvasNode[], position: { x: number; y: number }) {
    const ops: unknown[] = [];
    const inputs = [...(request.references || []), ...(request.continuation ? [{ fileId: request.continuation.fileId, kind: "video" as const, role: "continuation" as const }] : [])];
    const references = new Map(inputs.map(ref => [ref.fileId, ref]));
    for (const [fileId, reference] of references) {
        let source = nodes.find(node => node.id !== targetId && node.type === (reference.kind || "image") && (node.metadata?.storageKey === `server:${fileId}` || node.metadata?.content === `${config.basePath}/api/files/${fileId}/content`));
        if (!source) {
            const file = getStoredFile(userId, fileId);
            if (!file) throw agentToolError("REFERENCE_NOT_FOUND", "生成参考文件不存在或无权访问");
            const id = `reference-${nanoid()}`;
            source = { id };
            ops.push({ type: "add_node", id, nodeType: reference.kind || "image", title: file.original_name, position: { x: position.x - 380, y: position.y + ops.length * 120 }, width: 280, height: reference.kind === "audio" ? 120 : 200, metadata: { content: `${config.basePath}/api/files/${fileId}/content`, storageKey: `server:${fileId}`, mimeType: file.mime_type, status: "success" } });
        }
        ops.push({ type: "connect_nodes", fromNodeId: source.id, fromPortId: "output", toNodeId: targetId, toPortId: "input" });
    }
    return ops;
}

export function applyCanvasOps(userId: string, projectId: string, ops: unknown[], expectedRevision?: number) {
    const parsed = z.array(canvasOp).parse(ops);
    for (const op of parsed) if (op.type === "add_node" && !op.id) op.id = `${op.nodeType || "text"}-${nanoid()}`;
    const result = db.transaction(() => {
        const row = projectRow(userId, projectId);
        if (expectedRevision && row.revision !== expectedRevision) throw agentToolError("PROJECT_CONFLICT", `画布版本已从 ${expectedRevision} 更新为 ${row.revision}，请重新读取后再操作`);
        const payload = normalizePayload(row);
        for (const op of parsed) applyOp(payload, op);
        const now = new Date().toISOString();
        payload.updatedAt = now;
        const result = db.prepare("UPDATE projects SET payload=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=? AND revision=?")
            .run(JSON.stringify(payload), now, projectId, userId, row.revision);
        if (!result.changes) throw agentToolError("PROJECT_CONFLICT", "画布已在其他页面更新，请重新读取后再操作");
        syncFileRefs(userId, "project", projectId, payload);
        return { projectId, revision: row.revision + 1, applied: parsed.length, nodeIds: parsed.filter((op) => op.type === "add_node" || op.type === "update_node").map((op) => op.id!), project: { ...payload, revision: row.revision + 1 } };
    })();
    publishAgentProject(userId, result.project);
    return result;
}

export function listAssets(userId: string, input: z.infer<typeof canvasToolSchemas.assets_list>) {
    const keyword = `%${String(input.keyword || "").trim()}%`;
    const kind = input.kind && input.kind !== "all" ? input.kind : "";
    return (db.prepare("SELECT id, kind, title, payload, updated_at FROM assets WHERE user_id=? AND (?='' OR kind=?) AND (?='%%' OR title LIKE ? OR (kind='text' AND payload LIKE ?)) ORDER BY updated_at DESC, id LIMIT ? OFFSET ?")
        .all(userId, kind, kind, keyword, keyword, keyword, input.limit || 30, input.offset || 0) as Array<{ id: string; kind: string; title: string; payload: string; updated_at: string }>)
        .map((row) => ({ id: row.id, kind: row.kind, title: row.title, payload: parseJson(row.payload, {}), updatedAt: row.updated_at }));
}

export function addAsset(userId: string, input: z.infer<typeof canvasToolSchemas.assets_add>) {
    const id = nanoid();
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("INSERT INTO assets(id, user_id, kind, title, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)").run(id, userId, input.kind, input.title, JSON.stringify({ ...input.payload, id, kind: input.kind, title: input.title, createdAt: now, updatedAt: now }), now, now);
        syncFileRefs(userId, "asset", id, input.payload);
    })();
    return { id, ...input, createdAt: now, updatedAt: now };
}

export function deleteAssets(userId: string, input: z.infer<typeof canvasToolSchemas.assets_delete>) {
    const remove = db.transaction(() => {
        const placeholders = input.ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM file_refs WHERE user_id=? AND owner_type='asset' AND owner_id IN (${placeholders})`).run(userId, ...input.ids);
        return db.prepare(`DELETE FROM assets WHERE user_id=? AND id IN (${placeholders})`).run(userId, ...input.ids).changes;
    });
    return { deleted: remove() };
}

export function generationStatus(userId: string, input: z.infer<typeof canvasToolSchemas.generation_get_status>, projectId?: string) {
    if (input.id) {
        const row = getGenerationForAgent(userId, input.id);
        if (!row) throw agentToolError("GENERATION_NOT_FOUND", "生成任务不存在");
        if (projectId && generationProjectId(row.request) !== projectId) throw agentToolError("GENERATION_NOT_FOUND", "生成任务不存在或不属于当前项目");
        return generationResponse(row);
    }
    const rows = db.prepare("SELECT * FROM generations WHERE user_id=? ORDER BY created_at DESC LIMIT 200").all(userId) as Parameters<typeof generationResponse>[0][];
    return rows.filter((row) => !projectId || generationProjectId(row.request) === projectId).slice(0, input.limit || 20).map(generationResponse);
}

export function generationModels(input: z.infer<typeof canvasToolSchemas.generation_list_models>) {
    return listPublicModels().filter((model) => !input.kind || model.output === input.kind).map(({ value, name, providerName, output, inputs }) => ({ value, name, providerName, output, inputs }));
}

export function createAgentGeneration(userId: string, input: z.infer<typeof canvasToolSchemas.generation_create>, defaultProjectId?: string) {
    const { projectId, nodeId, ...request } = input;
    const targetProjectId = projectId || defaultProjectId;
    if (targetProjectId) projectRow(userId, targetProjectId);
    if (nodeId && !targetProjectId) throw agentToolError("PROJECT_REQUIRED", "关联节点前必须提供 projectId");
    return createGeneration(userId, { ...request, params: { __agentCanvas: targetProjectId ? { projectId: targetProjectId, nodeId: nodeId || null } : null } });
}

export function listAgentCreativeAssets(userId: string, projectId: string, kind?: "character" | "scene" | "prop") {
    return listCreativeAssets(userId, projectId).filter((asset) => !kind || asset.kind === kind);
}

export function getAgentCreativeAsset(userId: string, projectId: string, assetId: string) {
    const asset = getCreativeAsset(userId, assetId);
    if (asset.projectId !== projectId) throw agentToolError("CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或不属于当前画布");
    return asset;
}

export function createAgentCreativeAssetBatch(userId: string, projectId: string, items: unknown) {
    return createCreativeAssetsBatch(userId, projectId, items);
}

export function updateAgentCreativeAsset(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.creative_asset_update>) {
    const asset = getAgentCreativeAsset(userId, projectId, input.assetId);
    return updateCreativeAsset(userId, asset.id, { ...input.patch, revision: input.revision }, true);
}

export function deleteAgentCreativeAsset(userId: string, projectId: string, assetId: string) {
    getAgentCreativeAsset(userId, projectId, assetId);
    return deleteCreativeAsset(userId, assetId);
}

function assertAgentStyle(userId: string, projectId: string, styleId: string) {
    const style = getVisualStyle(userId, styleId);
    if (style.projectId !== projectId) throw agentToolError("VISUAL_STYLE_NOT_FOUND", "视觉风格不存在或不属于当前画布");
    return style;
}
export function listAgentVisualStyles(userId: string, projectId: string) { return listVisualStyles(userId, projectId); }
export function listAgentVisualStyleTemplates(input: z.infer<typeof canvasToolSchemas.visual_style_templates_list>) {
    const keyword = input.keyword?.toLowerCase();
    return listVisualStyleTemplates().filter((item) => {
        if (input.mediumFamily && item.dna.mediumFamily !== input.mediumFamily) return false;
        if (input.category && item.category !== input.category) return false;
        if (input.tag && !item.tags.includes(input.tag)) return false;
        const dna = Object.values(item.dna).flat().join(" ");
        return !keyword || `${item.name} ${item.tagline} ${item.description} ${item.tags.join(" ")} ${dna}`.toLowerCase().includes(keyword);
    });
}
export function getAgentVisualStyle(userId: string, projectId: string, styleId: string) { return assertAgentStyle(userId, projectId, styleId); }
export function createAgentVisualStyle(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_create>) { return createVisualStyle(userId, projectId, input); }
export function updateAgentVisualStyle(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_update>) { assertAgentStyle(userId, projectId, input.styleId); const { projectId: _projectId, styleId, ...patch } = input; return updateVisualStyle(userId, styleId, patch); }
export function defaultAgentVisualStyle(userId: string, projectId: string, styleId: string) { assertAgentStyle(userId, projectId, styleId); return setDefaultVisualStyle(userId, styleId); }
export function analyzeAgentVisualStyle(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_analyze>) { assertAgentStyle(userId, projectId, input.styleId); return createVisualStyleAnalysis(userId, input.styleId, input); }
export function generateAgentVisualStyleReferences(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_generate_references>) { assertAgentStyle(userId, projectId, input.styleId); return createVisualStyleReferences(userId, input.styleId, input); }
export function deleteAgentVisualStyle(userId: string, projectId: string, styleId: string) { assertAgentStyle(userId, projectId, styleId); return deleteVisualStyle(userId, styleId); }

function projectRow(userId: string, projectId: string) {
    const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as ProjectRow | undefined;
    if (!row) throw agentToolError("PROJECT_NOT_FOUND", "画布不存在或无权访问");
    return row;
}

function normalizePayload(row: ProjectRow): CanvasPayload {
    const payload = parseJson<CanvasPayload>(row.payload, { id: row.id, title: row.title, nodes: [], connections: [] });
    payload.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    payload.connections = Array.isArray(payload.connections) ? payload.connections.filter((item) => typeof item.fromPortId === "string" && typeof item.toPortId === "string") : [];
    return payload;
}

function applyOp(payload: CanvasPayload, op: z.infer<typeof canvasOp>) {
    if (op.type === "add_node") {
        const id = op.id || `${op.nodeType || "node"}-${nanoid()}`;
        if (payload.nodes.some((node) => node.id === id)) throw agentToolError("NODE_EXISTS", `节点 ${id} 已存在`);
        payload.nodes.push({ id, type: op.nodeType || "text", title: op.title, position: op.position || { x: 0, y: 0 }, width: op.width || 320, height: op.height || (op.nodeType === "audio" ? 120 : 200), metadata: op.metadata || {} });
        return;
    }
    if (op.type === "update_node") {
        const node = payload.nodes.find((item) => item.id === op.id);
        if (!node) throw agentToolError("NODE_NOT_FOUND", `节点 ${op.id} 不存在`);
        const patch = { ...(op.patch || {}) };
        if (patch.type !== undefined) patch.type = canvasNodeTypeSchema.parse(patch.type);
        delete patch.id;
        delete patch.metadata;
        Object.assign(node, patch);
        if (op.metadata) node.metadata = { ...(node.metadata || {}), ...op.metadata };
        return;
    }
    if (op.type === "delete_node") {
        const ids = new Set(op.ids || (op.id ? [op.id] : []));
        payload.nodes = payload.nodes.filter((node) => !ids.has(node.id));
        payload.connections = payload.connections.filter((connection) => !ids.has(String(connection.fromNodeId || "")) && !ids.has(String(connection.toNodeId || "")));
        return;
    }
    if (op.type === "delete_connections") {
        const ids = new Set(op.ids || (op.id ? [op.id] : []));
        payload.connections = op.all ? [] : payload.connections.filter((connection) => !ids.has(String(connection.id || "")));
        return;
    }
    const id = op.id || `connection-${nanoid()}`;
    const sourceNode = payload.nodes.find((node) => node.id === op.fromNodeId);
    const targetNode = payload.nodes.find((node) => node.id === op.toNodeId);
    if (!sourceNode || !targetNode) throw agentToolError("NODE_NOT_FOUND", "连线节点不存在");
    const sourcePort = agentNodePorts(sourceNode).find((port) => port.id === op.fromPortId && port.direction === "output");
    const targetPort = agentNodePorts(targetNode).find((port) => port.id === op.toPortId && port.direction === "input");
    if (!sourcePort || !targetPort || !(sourcePort.dataType === targetPort.dataType || targetPort.accepts?.includes(sourcePort.dataType))) throw agentToolError("CANVAS_PORT_INCOMPATIBLE", "节点端口不存在或类型不兼容");
    if (!targetPort.multiple && payload.connections.some((connection) => connection.toNodeId === op.toNodeId && connection.toPortId === op.toPortId)) throw agentToolError("CANVAS_PORT_OCCUPIED", "目标端口只允许一条连接");
    if (!payload.connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.fromPortId === op.fromPortId && connection.toNodeId === op.toNodeId && connection.toPortId === op.toPortId)) payload.connections.push({ id, fromNodeId: op.fromNodeId, fromPortId: op.fromPortId, toNodeId: op.toNodeId, toPortId: op.toPortId });
}

type AgentPort = { id: string; direction: "input" | "output"; dataType: string; multiple: boolean; accepts?: string[] };
function agentNodePorts(node: CanvasNode): AgentPort[] {
    if (node.type === "group") return [];
    const output = ({ text: "text", image: "image", audio: "audio", video: "video" } as Record<string, string>)[String(node.type)] || "text";
    const input: AgentPort = { id: "input", direction: "input", dataType: "text", accepts: ["text", "image", "audio", "video"], multiple: true };
    return node.type === "config" ? [input] : [input, { id: "output", direction: "output", dataType: output, multiple: true }];
}

function agentToolError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

function generationProjectId(request: string) {
    const value = parseJson<{ metadata?: { mediaProjectId?: string; directorSegment?: { projectId?: string } }; params?: Record<string, { projectId?: string } | null> }>(request, {});
    if (value.metadata?.mediaProjectId || value.metadata?.directorSegment?.projectId) return value.metadata.mediaProjectId || value.metadata.directorSegment!.projectId!;
    const params = value.params;
    for (const key of ["__agentCanvas", "__creativeAsset", "__directorShot", "__directorSegment", "__directorStoryboardSheet"]) {
        if (params?.[key]?.projectId) return params[key].projectId;
    }
    return "";
}
