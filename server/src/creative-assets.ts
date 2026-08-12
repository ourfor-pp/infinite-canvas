import { nanoid } from "nanoid";
import { z } from "zod";

import { db, parseJson } from "./database.js";
import { syncFileRefs } from "./file-store.js";
import { publishAgentProject } from "./agent/project-events.js";

export type CreativeAssetKind = "character" | "scene" | "prop";
export type CreativeAssetStatus = "draft" | "confirmed" | "locked";
export type CreativeAssetVariant = {
    id: string;
    kind: "image" | "audio";
    fileId: string;
    label: string;
    prompt: string;
    generationId?: string;
    usage?: string;
    transcript?: string;
    createdAt: string;
};
export type CreativeAssetPayload = {
    description: string;
    voiceDescription: string;
    variants: CreativeAssetVariant[];
    primaryImageId: string | null;
    primaryAudioId: string | null;
    imageModel: string | null;
    audioModel: string | null;
};
export type CreativeAssetRow = {
    id: string; user_id: string; project_id: string; kind: CreativeAssetKind; name: string; status: CreativeAssetStatus;
    payload: string; revision: number; created_at: string; updated_at: string;
};

const nodeLayout = {
    character: { width: 420, height: 760 },
    scene: { width: 420, height: 610 },
    prop: { width: 420, height: 610 },
} satisfies Record<CreativeAssetKind, { width: number; height: number }>;

const id = z.string().trim().min(1).max(128);
const text = z.string().max(20_000);
const variant = z.object({
    id,
    kind: z.enum(["image", "audio"]),
    fileId: id,
    label: z.string().max(200).default(""),
    prompt: text.default(""),
    generationId: id.optional(),
    usage: z.string().max(100).optional(),
    transcript: text.optional(),
    createdAt: z.string(),
});
export const creativeAssetPayloadSchema = z.object({
    description: text.default(""),
    voiceDescription: text.default(""),
    variants: z.array(variant).max(500).default([]),
    primaryImageId: id.nullable().default(null),
    primaryAudioId: id.nullable().default(null),
    imageModel: z.string().max(300).nullable().default(null),
    audioModel: z.string().max(300).nullable().default(null),
});
const creativeAssetPayloadPatchSchema = z.object({
    description: text.optional(),
    voiceDescription: text.optional(),
    variants: z.array(variant).max(500).optional(),
    primaryImageId: id.nullable().optional(),
    primaryAudioId: id.nullable().optional(),
    imageModel: z.string().max(300).nullable().optional(),
    audioModel: z.string().max(300).nullable().optional(),
});
export const creativeAssetInputSchema = z.object({
    kind: z.enum(["character", "scene", "prop"]),
    name: z.string().trim().min(1).max(200),
    status: z.enum(["draft", "confirmed", "locked"]).default("draft"),
    payload: creativeAssetPayloadPatchSchema.default({}),
});
export const creativeAssetUpdateSchema = creativeAssetInputSchema.partial().extend({ revision: z.number().int().positive() });

let emitAsset: (userId: string, asset: unknown) => void = () => undefined;
export function setCreativeAssetEmitter(emitter: typeof emitAsset) { emitAsset = emitter; }

export function listCreativeAssets(userId: string, projectId: string) {
    assertProject(userId, projectId);
    return (db.prepare("SELECT * FROM creative_assets WHERE user_id=? AND project_id=? ORDER BY kind, updated_at DESC").all(userId, projectId) as CreativeAssetRow[]).map(creativeAssetResponse);
}

export function getCreativeAsset(userId: string, assetId: string) {
    const row = creativeAssetRow(userId, assetId);
    if (!row) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    return creativeAssetResponse(row);
}

export function createCreativeAsset(userId: string, projectId: string, raw: unknown) {
    assertProject(userId, projectId);
    const input = creativeAssetInputSchema.parse(raw);
    const assetId = nanoid();
    const now = new Date().toISOString();
    const payload = creativeAssetPayloadSchema.parse(input.payload);
    db.prepare("INSERT INTO creative_assets(id, user_id, project_id, kind, name, status, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .run(assetId, userId, projectId, input.kind, input.name, input.status, JSON.stringify(payload), now, now);
    syncFileRefs(userId, "creative_asset", assetId, payload);
    return publishAsset(creativeAssetRow(userId, assetId)!);
}

export function updateCreativeAsset(userId: string, assetId: string, raw: unknown, allowProtected = false) {
    const input = creativeAssetUpdateSchema.parse(raw);
    const current = creativeAssetRow(userId, assetId);
    if (!current) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    if (!allowProtected && current.status !== "draft") throw creativeAssetError(409, "CREATIVE_ASSET_PROTECTED", "已确认或锁定的设定需要通过审批修改");
    const currentPayload = creativeAssetPayloadSchema.parse(parseJson(current.payload, {}));
    const nextKind = input.kind || current.kind;
    const payloadPatch = input.payload || {};
    const payload = creativeAssetPayloadSchema.parse({ ...currentPayload, ...payloadPatch });
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE creative_assets SET kind=?, name=?, status=?, payload=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=? AND revision=?")
        .run(nextKind, input.name || current.name, input.status || current.status, JSON.stringify(payload), now, assetId, userId, input.revision);
    if (!result.changes) throwConflict(userId, assetId);
    syncFileRefs(userId, "creative_asset", assetId, payload);
    if (input.name || input.kind) {
        const project = projectPayload(userId, current.project_id);
        let changed = false;
        project.nodes = project.nodes.map((node) => {
            if (String(node.metadata?.assetId || "") !== assetId) return node;
            changed = true;
            const kind = nextKind;
            return { ...node, type: kind, title: input.name || current.name, metadata: { ...node.metadata, assetKind: kind } };
        });
        if (changed) saveProjectPayload(userId, current.project_id, project);
    }
    return publishAsset(creativeAssetRow(userId, assetId)!);
}

export function setCreativeAssetPrimary(userId: string, assetId: string, variantId: string, revision: number, allowProtected = false) {
    const row = creativeAssetRow(userId, assetId);
    if (!row) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    if (!allowProtected && row.status !== "draft") throw creativeAssetError(409, "CREATIVE_ASSET_PROTECTED", "已确认或锁定的设定需要通过审批修改");
    const payload = creativeAssetPayloadSchema.parse(parseJson(row.payload, {}));
    const selected = payload.variants.find((item) => item.id === variantId);
    if (!selected) throw creativeAssetError(404, "CREATIVE_ASSET_VARIANT_NOT_FOUND", "媒体版本不存在");
    return updateCreativeAsset(userId, assetId, { revision, payload: selected.kind === "image" ? { primaryImageId: variantId } : { primaryAudioId: variantId } }, true);
}

export function deleteCreativeAsset(userId: string, assetId: string) {
    const row = creativeAssetRow(userId, assetId);
    if (!row) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    const project = projectPayload(userId, row.project_id);
    project.nodes = project.nodes.filter((node) => String(node.metadata?.assetId || "") !== assetId);
    project.connections = project.connections.filter((connection) => project.nodes.some((node) => node.id === connection.fromNodeId) && project.nodes.some((node) => node.id === connection.toNodeId));
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("UPDATE projects SET payload=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...project, updatedAt: now }), now, row.project_id, userId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='creative_asset' AND owner_id=?").run(userId, assetId);
        db.prepare("DELETE FROM creative_assets WHERE id=? AND user_id=?").run(assetId, userId);
    })();
    publishProjectRow(userId, row.project_id);
    emitAsset(userId, { id: assetId, projectId: row.project_id, deleted: true });
    return { id: assetId, projectId: row.project_id };
}

export function placeCreativeAsset(userId: string, assetId: string, input: { x?: number; y?: number } = {}) {
    const row = creativeAssetRow(userId, assetId);
    if (!row) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    const project = projectPayload(userId, row.project_id);
    const nodeId = `${row.kind}-${nanoid()}`;
    const layout = nodeLayout[row.kind];
    const x = Number.isFinite(input.x) ? Number(input.x) : Math.max(0, ...project.nodes.map((node) => Number(node.position?.x) || 0)) + 420;
    const y = Number.isFinite(input.y) ? Number(input.y) : project.nodes.filter((node) => ["character", "scene", "prop"].includes(String(node.type))).length * 260;
    project.nodes.push({ id: nodeId, type: row.kind, title: row.name, position: { x, y }, ...layout, metadata: { assetId, assetKind: row.kind } });
    saveProjectPayload(userId, row.project_id, project);
    return { nodeId, projectId: row.project_id };
}

export function createCreativeAssetsBatch(userId: string, projectId: string, rawItems: unknown, sourceNodeId?: string) {
    assertProject(userId, projectId);
    const items = z.array(creativeAssetInputSchema).min(1).max(200).parse(rawItems);
    const project = projectPayload(userId, projectId);
    const source = project.nodes.find((node) => node.id === sourceNodeId);
    const baseX = source ? Number(source.position?.x || 0) + Number(source.width || 320) + 180 : Math.max(0, ...project.nodes.map((node) => Number(node.position?.x) || 0)) + 320;
    const baseY = source ? Number(source.position?.y || 0) : 80;
    const kinds: CreativeAssetKind[] = ["character", "scene", "prop"];
    const now = new Date().toISOString();
    const created: ReturnType<typeof creativeAssetResponse>[] = [];
    db.transaction(() => {
        let columnX = baseX;
        kinds.forEach((kind) => {
            const subset = items.filter((item) => item.kind === kind);
            if (!subset.length) return;
            const layout = nodeLayout[kind];
            subset.forEach((input, index) => {
                const assetId = nanoid();
                const payload = creativeAssetPayloadSchema.parse(input.payload);
                db.prepare("INSERT INTO creative_assets(id, user_id, project_id, kind, name, status, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
                    .run(assetId, userId, projectId, kind, input.name, input.status, JSON.stringify(payload), now, now);
                syncFileRefs(userId, "creative_asset", assetId, payload);
                project.nodes.push({ id: `${kind}-${nanoid()}`, type: kind, title: input.name, position: { x: columnX, y: baseY + index * (layout.height + 32) }, ...layout, metadata: { assetId, assetKind: kind } });
                created.push(creativeAssetResponse(creativeAssetRow(userId, assetId)!));
            });
            columnX += layout.width + 90;
        });
        saveProjectPayload(userId, projectId, project, false);
    })();
    created.forEach((asset) => emitAsset(userId, asset));
    publishProjectRow(userId, projectId);
    return created;
}

export function syncCreativeAssetGeneration(row: { id: string; user_id: string; status: string; request: string; result: string | null }) {
    if (row.status !== "succeeded") return;
    const request = parseJson<{ kind?: "image" | "audio"; prompt?: string; params?: { __creativeAsset?: { assetId?: string; usage?: string; label?: string; transcript?: string } } }>(row.request, {});
    const target = request.params?.__creativeAsset;
    if (!target?.assetId) return;
    const asset = creativeAssetRow(row.user_id, target.assetId);
    if (!asset) return;
    const result = parseJson<{ files?: Array<{ fileId?: string; id?: string }> }>(row.result, {});
    const fileIds = (result.files || []).map((file) => String(file.fileId || file.id || "")).filter(Boolean);
    if (!fileIds.length) return;
    const payload = creativeAssetPayloadSchema.parse(parseJson(asset.payload, {}));
    const kind = request.kind === "audio" ? "audio" : "image";
    const additions = fileIds.filter((fileId) => !payload.variants.some((item) => item.generationId === row.id && item.fileId === fileId));
    if (!additions.length) return;
    const added = additions.map((fileId, index) => ({ id: nanoid(), kind, fileId, label: target.label || `${kind === "image" ? "生成图片" : "生成声音"}${additions.length > 1 ? ` ${index + 1}` : ""}`, prompt: request.prompt || "", generationId: row.id, usage: target.usage, transcript: target.transcript, createdAt: new Date().toISOString() } satisfies CreativeAssetVariant));
    payload.variants.push(...added);
    if (target.usage === "design_sheet" && kind === "image") payload.primaryImageId = added.at(-1)?.id || payload.primaryImageId;
    if (target.usage === "voice_reference" && kind === "audio") payload.primaryAudioId = added.at(-1)?.id || payload.primaryAudioId;
    updateCreativeAsset(row.user_id, asset.id, { revision: asset.revision, payload }, true);
}

export function creativeAssetResponse(row: CreativeAssetRow) {
    return { id: row.id, projectId: row.project_id, kind: row.kind, name: row.name, status: row.status, payload: creativeAssetPayloadSchema.parse(parseJson(row.payload, {})), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function buildCreativeAssetPrompt(asset: ReturnType<typeof creativeAssetResponse>, kind: "image" | "audio", extra = "") {
    const description = asset.payload.description.trim();
    const requirement = extra.trim();
    if (kind === "audio") return requirement || asset.payload.voiceDescription || asset.payload.description;
    const layout = {
        character: "横版 16:9 四格角色设计稿，纯白背景：左侧约 40% 为胸像特写，右侧三个等宽面板依次为正面、四分之三侧面、背面的 A-Pose 全身视图。四个面板中的面部、发型、服装和配饰必须完全一致。",
        scene: "横版 16:9 场景设计稿：主画面占四分之三区域，完整展示空间结构、固定陈设、光线和氛围；右下角嵌入标志性局部细节图。画面中没有人物出镜。",
        prop: "横版 16:9 道具设计稿，纯净浅灰背景：正面全视图、45 度侧视图、关键细节特写水平排列，各视图必须是同一件道具，结构、材质和比例保持一致。画面中没有人物出镜。",
    }[asset.kind];
    return [
        `${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}「${asset.name}」的视觉设计参考。`,
        description,
        requirement,
        layout,
        "画面避免：水印、多余文字、Logo。",
    ].filter(Boolean).join("\n\n");
}

function creativeAssetRow(userId: string, assetId: string) {
    return db.prepare("SELECT * FROM creative_assets WHERE id=? AND user_id=?").get(assetId, userId) as CreativeAssetRow | undefined;
}

function assertProject(userId: string, projectId: string) {
    if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=?").get(projectId, userId)) throw creativeAssetError(404, "PROJECT_NOT_FOUND", "画布不存在或无权访问");
}

type ProjectNode = { id: string; type?: string; title?: string; position?: { x?: number; y?: number }; width?: number; height?: number; metadata?: Record<string, unknown> };
type ProjectPayload = Record<string, unknown> & { nodes: ProjectNode[]; connections: Array<{ fromNodeId?: string; toNodeId?: string; [key: string]: unknown }> };
function projectPayload(userId: string, projectId: string) {
    const row = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { payload: string } | undefined;
    if (!row) throw creativeAssetError(404, "PROJECT_NOT_FOUND", "画布不存在或无权访问");
    const payload = parseJson<ProjectPayload>(row.payload, { nodes: [], connections: [] });
    payload.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    payload.connections = Array.isArray(payload.connections) ? payload.connections.filter((item) => typeof item.fromPortId === "string" && typeof item.toPortId === "string") : [];
    return payload;
}

function saveProjectPayload(userId: string, projectId: string, payload: ProjectPayload, publish = true) {
    const now = new Date().toISOString();
    db.prepare("UPDATE projects SET payload=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...payload, updatedAt: now }), now, projectId, userId);
    syncFileRefs(userId, "project", projectId, payload);
    if (publish) publishProjectRow(userId, projectId);
}

function publishProjectRow(userId: string, projectId: string) {
    const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string };
    publishAgentProject(userId, { ...parseJson<Record<string, unknown>>(row.payload, {}), id: row.id, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
}

function publishAsset(row: CreativeAssetRow) {
    const asset = creativeAssetResponse(row);
    emitAsset(row.user_id, asset);
    return asset;
}

function throwConflict(userId: string, assetId: string): never {
    const current = creativeAssetRow(userId, assetId);
    throw creativeAssetError(409, "CREATIVE_ASSET_CONFLICT", "创作资产已在其他页面更新", { current: current ? creativeAssetResponse(current) : null });
}

function creativeAssetError(status: number, code: string, message: string, details?: unknown) {
    return Object.assign(new Error(message), { status, code, details });
}
