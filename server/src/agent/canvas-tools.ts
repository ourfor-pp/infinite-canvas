import { nanoid } from "nanoid";
import { z } from "zod";
import { db, parseJson } from "../database.js";
import { syncFileRefs } from "../file-store.js";
import { createGeneration, generationResponse, getGenerationForAgent } from "../generation-service.js";
import { listPublicModels } from "../provider-service.js";
import { publishAgentProject } from "./project-events.js";
import {
    createCreativeAssetsBatch,
    creativeAssetInputSchema,
    deleteCanvasNodes,
    deleteCreativeAsset,
    getCreativeAsset,
    listCreativeAssets,
    placeCreativeAsset,
    setCreativeAssetPrimary,
    updateCreativeAsset,
} from "../creative-assets.js";
import { createCreativeAssetGeneration } from "../creative-asset-generation.js";
import { createVisualStyle, deleteVisualStyle, getVisualStyle, listVisualStyles, listVisualStyleTemplates, placeVisualStyle, setDefaultVisualStyle, updateVisualStyle } from "../visual-styles.js";
import { createVisualStyleAnalysis, createVisualStyleReferences } from "../visual-style-generation.js";

type ProjectRow = { id: string; user_id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string };
type CanvasNode = { id: string; type?: string; title?: string; position?: { x?: number; y?: number }; metadata?: Record<string, unknown>; [key: string]: unknown };
type CanvasPayload = Record<string, unknown> & { id: string; title: string; nodes: CanvasNode[]; connections: Array<Record<string, unknown>>; revision?: number; updatedAt?: string };

const record = z.record(z.string(), z.unknown());
const canvasOp = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), id: z.string().optional(), nodeType: z.string().optional(), title: z.string().optional(), position: z.object({ x: z.number(), y: z.number() }).optional(), width: z.number().optional(), height: z.number().optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: record.optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).passthrough(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), fromPortId: z.string(), toNodeId: z.string(), toPortId: z.string() }).passthrough(),
]);
const canvasSafeOp = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), id: z.string().optional(), nodeType: z.string().optional(), title: z.string().optional(), position: z.object({ x: z.number(), y: z.number() }).optional(), width: z.number().optional(), height: z.number().optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: record.optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), fromPortId: z.string(), toNodeId: z.string(), toPortId: z.string() }).passthrough(),
]);

export const canvasToolSchemas = {
    canvas_get_state: z.object({ projectId: z.string().optional() }),
    canvas_get_selection: z.object({ projectId: z.string().optional() }),
    canvas_apply_ops: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), ops: z.array(canvasSafeOp).min(1) }),
    canvas_create_text_nodes: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), items: z.array(z.object({ text: z.string().max(1_000_000), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().min(220).max(1600).optional(), height: z.number().min(160).max(2400).optional(), fontSize: z.number().min(10).max(48).optional() })).min(1) }),
    canvas_delete_nodes: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), ids: z.array(z.string()).min(1) }),
    canvas_delete_connections: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), ids: z.array(z.string()).min(1) }),
    canvas_connect_nodes: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), connections: z.array(z.object({ fromNodeId: z.string(), fromPortId: z.string(), toNodeId: z.string(), toPortId: z.string() })).min(1) }),
    canvas_list_projects: z.object({ keyword: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    assets_list: z.object({ kind: z.enum(["all", "text", "image", "video"]).optional(), keyword: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    assets_add: z.object({ kind: z.enum(["text", "image", "video"]), title: z.string().min(1).max(200), payload: record }),
    assets_delete: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    prompts_search: z.object({ keyword: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).optional() }),
    generation_get_status: z.object({ id: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    generation_list_models: z.object({ kind: z.enum(["text", "image", "video", "audio"]).optional() }),
    generation_create: z.object({ kind: z.enum(["text", "image", "video", "audio"]), model: z.string(), prompt: z.string(), projectId: z.string().optional(), nodeId: z.string().optional(), references: z.array(z.object({ fileId: z.string(), kind: z.enum(["image", "video", "audio"]).optional(), role: z.enum(["reference", "first-frame", "last-frame", "continuation"]).optional() })).optional() }),
    creative_assets_list: z.object({ projectId: z.string().optional(), kind: z.enum(["character", "scene", "prop"]).optional() }),
    creative_asset_get: z.object({ projectId: z.string().optional(), assetId: z.string() }),
    creative_assets_create_batch: z.object({ projectId: z.string().optional(), sourceNodeId: z.string().optional(), items: z.array(creativeAssetInputSchema).min(1).max(200) }),
    creative_asset_update: z.object({ projectId: z.string().optional(), assetId: z.string(), revision: z.number().int().positive(), patch: creativeAssetInputSchema.partial() }),
    creative_asset_place: z.object({ projectId: z.string().optional(), assetId: z.string(), x: z.number().optional(), y: z.number().optional() }),
    creative_asset_generate: z.object({ projectId: z.string().optional(), assetId: z.string(), nodeId: z.string().optional(), kind: z.enum(["image", "audio"]), revision: z.number().int().positive() }),
    creative_asset_set_primary: z.object({ projectId: z.string().optional(), assetId: z.string(), variantId: z.string(), revision: z.number().int().positive() }),
    creative_asset_delete: z.object({ projectId: z.string().optional(), assetId: z.string() }),
    visual_styles_list: z.object({ projectId: z.string().optional() }),
    visual_style_templates_list: z.object({ category: z.enum(["cinematic", "genre", "eastern", "animation", "handmade", "graphic"]).optional(), keyword: z.string().trim().max(100).optional() }),
    visual_style_get: z.object({ projectId: z.string().optional(), styleId: z.string() }),
    visual_style_create: z.object({ projectId: z.string().optional(), name: z.string().min(1).max(200), mode: z.enum(["template", "custom"]), templateId: z.string().nullable().optional(), description: z.string().max(20_000).optional(), status: z.enum(["draft", "confirmed"]).optional(), dna: z.record(z.string(), z.unknown()).optional(), references: z.record(z.string(), z.string()).optional() }),
    visual_style_update: z.object({ projectId: z.string().optional(), styleId: z.string(), revision: z.number().int().positive(), name: z.string().min(1).max(200).optional(), mode: z.enum(["template", "custom"]).optional(), templateId: z.string().nullable().optional(), description: z.string().max(20_000).optional(), status: z.enum(["draft", "confirmed"]).optional(), dna: z.record(z.string(), z.unknown()).optional(), references: z.record(z.string(), z.string()).optional() }),
    visual_style_place: z.object({ projectId: z.string().optional(), styleId: z.string(), x: z.number().optional(), y: z.number().optional() }),
    visual_style_set_default: z.object({ projectId: z.string().optional(), styleId: z.string() }),
    visual_style_analyze: z.object({ projectId: z.string().optional(), styleId: z.string(), revision: z.number().int().positive() }),
    visual_style_generate_references: z.object({ projectId: z.string().optional(), styleId: z.string(), revision: z.number().int().positive(), roles: z.array(z.enum(["character", "scene", "prop"])).min(1).max(3).optional() }),
    visual_style_delete: z.object({ projectId: z.string().optional(), styleId: z.string() }),
};

export function getCanvasState(userId: string, projectId: string) {
    const row = projectRow(userId, projectId);
    const payload = normalizePayload(row);
    return { ...payload, revision: row.revision };
}

export function listProjects(userId: string, input: z.infer<typeof canvasToolSchemas.canvas_list_projects>) {
    const keyword = `%${String(input.keyword || "").trim()}%`;
    const rows = db.prepare("SELECT id, title, revision, updated_at FROM projects WHERE user_id=? AND (?='%%' OR title LIKE ?) ORDER BY updated_at DESC LIMIT ?")
        .all(userId, keyword, keyword, input.limit || 30) as Array<{ id: string; title: string; revision: number; updated_at: string }>;
    return rows.map((row) => ({ id: row.id, title: row.title, revision: row.revision, updatedAt: row.updated_at }));
}

export function applyCanvasOps(userId: string, projectId: string, ops: unknown[], expectedRevision?: number) {
    const parsed = z.array(canvasOp).parse(ops);
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
        return { projectId, revision: row.revision + 1, applied: parsed.length, project: { ...payload, revision: row.revision + 1 } };
    })();
    publishAgentProject(userId, result.project);
    return result;
}

export function createTextNodes(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.canvas_create_text_nodes>) {
    const state = getCanvasState(userId, projectId);
    if (state.revision !== input.expectedRevision) throw agentToolError("PROJECT_CONFLICT", `画布版本已从 ${input.expectedRevision} 更新为 ${state.revision}，请重新读取后再操作`);
    const startX = Math.max(0, ...state.nodes.map((node) => Number(node.position?.x) || 0)) + 420;
    return applyCanvasOps(userId, projectId, input.items.map((item, index) => ({
        type: "add_node",
        id: `text-${nanoid()}`,
        nodeType: "text",
        title: item.title || "Agent 文本",
        position: { x: item.x ?? startX, y: item.y ?? index * 240 },
        width: item.width ?? 340,
        height: item.height ?? 200,
        metadata: { content: item.text, status: "success", fontSize: item.fontSize ?? 14 },
    })), input.expectedRevision);
}

export function deleteAgentCanvasNodes(userId: string, projectId: string, ids: string[], expectedRevision: number) {
    return deleteCanvasNodes(userId, projectId, ids, expectedRevision);
}

export function listAssets(userId: string, input: z.infer<typeof canvasToolSchemas.assets_list>) {
    const keyword = `%${String(input.keyword || "").trim()}%`;
    const kind = input.kind && input.kind !== "all" ? input.kind : "";
    return (db.prepare("SELECT id, kind, title, payload, updated_at FROM assets WHERE user_id=? AND (?='' OR kind=?) AND (?='%%' OR title LIKE ?) ORDER BY updated_at DESC LIMIT ?")
        .all(userId, kind, kind, keyword, keyword, input.limit || 30) as Array<{ id: string; kind: string; title: string; payload: string; updated_at: string }>)
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

export function searchPrompts(userId: string, input: z.infer<typeof canvasToolSchemas.prompts_search>) {
    const keyword = `%${input.keyword}%`;
    return (db.prepare("SELECT id, title, payload, updated_at FROM assets WHERE user_id=? AND kind='text' AND (title LIKE ? OR payload LIKE ?) ORDER BY updated_at DESC LIMIT ?")
        .all(userId, keyword, keyword, input.limit || 20) as Array<{ id: string; title: string; payload: string; updated_at: string }>)
        .map((row) => ({ id: row.id, title: row.title, payload: parseJson(row.payload, {}), updatedAt: row.updated_at }));
}

export function generationStatus(userId: string, input: z.infer<typeof canvasToolSchemas.generation_get_status>, projectId?: string) {
    if (input.id) {
        const row = getGenerationForAgent(userId, input.id);
        if (!row) throw agentToolError("GENERATION_NOT_FOUND", "生成任务不存在");
        if (projectId && generationProjectId(row.request) !== projectId) throw agentToolError("GENERATION_NOT_FOUND", "生成任务不存在或不属于当前画布");
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

export function createAgentCreativeAssetBatch(userId: string, projectId: string, items: unknown, sourceNodeId?: string) {
    return createCreativeAssetsBatch(userId, projectId, items, sourceNodeId);
}

export function updateAgentCreativeAsset(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.creative_asset_update>) {
    const asset = getAgentCreativeAsset(userId, projectId, input.assetId);
    return updateCreativeAsset(userId, asset.id, { ...input.patch, revision: input.revision }, true);
}

export function placeAgentCreativeAsset(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.creative_asset_place>) {
    getAgentCreativeAsset(userId, projectId, input.assetId);
    return placeCreativeAsset(userId, input.assetId, { x: input.x, y: input.y });
}

export function generateAgentCreativeAsset(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.creative_asset_generate>) {
    getAgentCreativeAsset(userId, projectId, input.assetId);
    return createCreativeAssetGeneration(userId, input.assetId, { kind: input.kind, nodeId: input.nodeId, revision: input.revision });
}

export function setAgentCreativeAssetPrimary(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.creative_asset_set_primary>) {
    getAgentCreativeAsset(userId, projectId, input.assetId);
    return setCreativeAssetPrimary(userId, input.assetId, input.variantId, input.revision, true);
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
export function listAgentVisualStyleTemplates(input: z.infer<typeof canvasToolSchemas.visual_style_templates_list>) { const keyword = input.keyword?.toLowerCase(); return listVisualStyleTemplates().filter((item) => (!input.category || item.category === input.category) && (!keyword || `${item.name} ${item.tagline} ${item.description}`.toLowerCase().includes(keyword))); }
export function getAgentVisualStyle(userId: string, projectId: string, styleId: string) { return assertAgentStyle(userId, projectId, styleId); }
export function createAgentVisualStyle(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_create>) { return createVisualStyle(userId, projectId, input); }
export function updateAgentVisualStyle(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_update>) { assertAgentStyle(userId, projectId, input.styleId); const { projectId: _projectId, styleId, ...patch } = input; return updateVisualStyle(userId, styleId, patch); }
export function placeAgentVisualStyle(userId: string, projectId: string, input: z.infer<typeof canvasToolSchemas.visual_style_place>) { assertAgentStyle(userId, projectId, input.styleId); return placeVisualStyle(userId, input.styleId, input); }
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
        payload.nodes.push({ id, type: op.nodeType || "text", title: op.title, position: op.position || { x: 0, y: 0 }, width: op.width, height: op.height, metadata: op.metadata || {} });
        return;
    }
    if (op.type === "update_node") {
        const node = payload.nodes.find((item) => item.id === op.id);
        if (!node) throw agentToolError("NODE_NOT_FOUND", `节点 ${op.id} 不存在`);
        const patch = { ...(op.patch || {}) };
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
    if (node.type === "visual-style") return [{ id: "style", direction: "output", dataType: "visual-style", multiple: true }];
    if (["character", "scene", "prop"].includes(String(node.type))) return [
        { id: "reference-image", direction: "input", dataType: "image", multiple: true },
        { id: "setting", direction: "input", dataType: "text", multiple: true },
        { id: "style", direction: "input", dataType: "visual-style", multiple: false },
        { id: "reference-audio", direction: "input", dataType: "audio", multiple: false },
        { id: "asset", direction: "output", dataType: "creative-asset", multiple: true },
    ];
    if (node.type === "group") return [];
    const output = ({ text: "text", image: "image", audio: "audio", video: "video" } as Record<string, string>)[String(node.type)] || "text";
    const input: AgentPort = { id: "input", direction: "input", dataType: "text", accepts: ["text", "image", "audio", "video", "creative-asset"], multiple: true };
    return node.type === "config" ? [input] : [input, { id: "output", direction: "output", dataType: output, multiple: true }];
}

function agentToolError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

function generationProjectId(request: string) {
    const params = parseJson<{ params?: { __agentCanvas?: { projectId?: string } | null; __directorShot?: { projectId?: string } | null } }>(request, {}).params;
    return params?.__agentCanvas?.projectId || params?.__directorShot?.projectId || "";
}
