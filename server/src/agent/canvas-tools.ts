import { nanoid } from "nanoid";
import { z } from "zod";
import { db, parseJson } from "../database.js";
import { syncFileRefs } from "../file-store.js";
import { createGeneration, generationResponse, getGenerationForAgent } from "../generation-service.js";
import { listPublicModels } from "../provider-service.js";
import { publishAgentProject } from "./project-events.js";

type ProjectRow = { id: string; user_id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string };
type CanvasNode = { id: string; type?: string; title?: string; position?: { x?: number; y?: number }; metadata?: Record<string, unknown>; [key: string]: unknown };
type CanvasPayload = Record<string, unknown> & { id: string; title: string; nodes: CanvasNode[]; connections: Array<Record<string, unknown>>; revision?: number };

const record = z.record(z.string(), z.unknown());
const canvasOp = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), id: z.string().optional(), nodeType: z.string().optional(), title: z.string().optional(), position: z.object({ x: z.number(), y: z.number() }).optional(), width: z.number().optional(), height: z.number().optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: record.optional(), metadata: record.optional() }).passthrough(),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).passthrough(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), toNodeId: z.string() }).passthrough(),
]);

export const canvasToolSchemas = {
    canvas_get_state: z.object({ projectId: z.string().optional() }),
    canvas_get_selection: z.object({ projectId: z.string().optional() }),
    canvas_apply_ops: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), ops: z.array(canvasOp).min(1) }),
    canvas_create_text_nodes: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), items: z.array(z.object({ text: z.string(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional() })).min(1) }),
    canvas_delete_nodes: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), ids: z.array(z.string()).min(1) }),
    canvas_connect_nodes: z.object({ projectId: z.string().optional(), expectedRevision: z.number().int().positive(), connections: z.array(z.object({ fromNodeId: z.string(), toNodeId: z.string() })).min(1) }),
    canvas_list_projects: z.object({ keyword: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    assets_list: z.object({ kind: z.enum(["all", "text", "image", "video"]).optional(), keyword: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    assets_add: z.object({ kind: z.enum(["text", "image", "video"]), title: z.string().min(1).max(200), payload: record }),
    assets_delete: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    prompts_search: z.object({ keyword: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).optional() }),
    generation_get_status: z.object({ id: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    generation_list_models: z.object({ kind: z.enum(["text", "image", "video", "audio"]).optional() }),
    generation_create: z.object({ kind: z.enum(["text", "image", "video", "audio"]), model: z.string(), prompt: z.string(), projectId: z.string().optional(), nodeId: z.string().optional(), references: z.array(z.object({ fileId: z.string(), kind: z.enum(["image", "video", "audio"]).optional() })).optional() }),
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
        width: 340,
        height: 200,
        metadata: { content: item.text, status: "success", fontSize: 14 },
    })), input.expectedRevision);
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

function projectRow(userId: string, projectId: string) {
    const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as ProjectRow | undefined;
    if (!row) throw agentToolError("PROJECT_NOT_FOUND", "画布不存在或无权访问");
    return row;
}

function normalizePayload(row: ProjectRow): CanvasPayload {
    const payload = parseJson<CanvasPayload>(row.payload, { id: row.id, title: row.title, nodes: [], connections: [] });
    payload.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    payload.connections = Array.isArray(payload.connections) ? payload.connections : [];
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
    if (!payload.nodes.some((node) => node.id === op.fromNodeId) || !payload.nodes.some((node) => node.id === op.toNodeId)) throw agentToolError("NODE_NOT_FOUND", "连线节点不存在");
    if (!payload.connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.toNodeId === op.toNodeId)) payload.connections.push({ id, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId });
}

function agentToolError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

function generationProjectId(request: string) {
    return parseJson<{ params?: { __agentCanvas?: { projectId?: string } | null } }>(request, {}).params?.__agentCanvas?.projectId || "";
}
