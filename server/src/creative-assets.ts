import { nanoid } from "nanoid";
import { z } from "zod";

import { db, parseJson } from "./database.js";
import { syncFileRefs } from "./file-store.js";
import { publishAgentProject } from "./agent/project-events.js";
import { getAiGlobalSettings } from "./provider-service.js";

export type CreativeAssetKind = "character" | "scene" | "prop";
export type CreativeAssetStatus = "draft" | "confirmed" | "locked";
export type CreativeAssetAudioMode = "speech" | "ambient" | "sfx";
export type CreativeAssetMediaDraft = {
    prompt: string;
    model: string | null;
    params: Record<string, unknown>;
    audioMode?: CreativeAssetAudioMode;
    transcript?: string;
};
export type CharacterDesignProfile = {
    apparentGender: "female" | "male" | "androgynous" | "unspecified";
    voiceGender: "female" | "male" | "androgynous" | "unspecified";
    ageBand: string;
    identityAnchor: string;
    facialIdentity: {
        faceShape: string;
        boneStructure: string;
        brows: string;
        eyes: string;
        nose: string;
        mouth: string;
        skin: string;
        hairline: string;
        distinguishingMarks: string;
    } | null;
    uncertainties: string[];
};
export type CreativeAssetReview = {
    status: "pending_review" | "approved" | "rejected";
    source: "automatic" | "manual";
    summary?: string;
    issues?: string[];
    metrics?: Record<string, boolean | number | string>;
    reviewedAt?: string;
    reviewGenerationId?: string;
};
export type CreativeAssetVariant = {
    id: string;
    kind: "image" | "audio";
    fileId: string;
    label: string;
    prompt: string;
    generationId?: string;
    usage?: string;
    transcript?: string;
    review?: CreativeAssetReview;
    createdAt: string;
};
export type CreativeAssetPayload = {
    description: string;
    narrativeDescription: string;
    visualDescription: string;
    designProfile: CharacterDesignProfile | null;
    variants: CreativeAssetVariant[];
    primaryImageId: string | null;
    primaryAudioId: string | null;
    mediaDrafts: { image: CreativeAssetMediaDraft; audio: CreativeAssetMediaDraft };
    dependencies?: { style?: { id: string; revision: number } | null };
    needsReview?: boolean;
    staleReason?: string;
};
export type CreativeAssetRow = {
    id: string; user_id: string; project_id: string; kind: CreativeAssetKind; name: string; status: CreativeAssetStatus;
    payload: string; revision: number; created_at: string; updated_at: string;
};
type SavedProject = Record<string, unknown> & { nodes: Array<{ id: string; metadata?: Record<string, unknown> }>; connections: Array<{ fromNodeId?: string; toNodeId?: string }> };

const nodeLayout = {
    character: { width: 420, height: 540 },
    scene: { width: 420, height: 540 },
    prop: { width: 420, height: 540 },
} satisfies Record<CreativeAssetKind, { width: number; height: number }>;

const id = z.string().trim().min(1).max(128);
const text = z.string().max(20_000);
const jsonRecord = z.record(z.string(), z.unknown());
const mediaDraft = z.object({
    prompt: text.default(""),
    model: z.string().max(300).nullable().default(null),
    params: jsonRecord.default({}),
    audioMode: z.enum(["speech", "ambient", "sfx"]).optional(),
    transcript: text.optional(),
});
const mediaDraftPatch = z.object({
    prompt: text.optional(),
    model: z.string().max(300).nullable().optional(),
    params: jsonRecord.optional(),
    audioMode: z.enum(["speech", "ambient", "sfx"]).optional(),
    transcript: text.optional(),
});
const variant = z.object({
    id,
    kind: z.enum(["image", "audio"]),
    fileId: id,
    label: z.string().max(200).default(""),
    prompt: text.default(""),
    generationId: id.optional(),
    usage: z.string().max(100).optional(),
    transcript: text.optional(),
    review: z.object({
        status: z.enum(["pending_review", "approved", "rejected"]),
        source: z.enum(["automatic", "manual"]),
        summary: z.string().max(2_000).optional(),
        issues: z.array(z.string().max(500)).max(50).optional(),
        metrics: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
        reviewedAt: z.string().optional(),
        reviewGenerationId: id.optional(),
    }).optional(),
    createdAt: z.string(),
});
export const creativeAssetPayloadSchema = z.object({
    description: text.default(""),
    narrativeDescription: text.default(""),
    visualDescription: text.default(""),
    designProfile: z.object({
        apparentGender: z.enum(["female", "male", "androgynous", "unspecified"]).default("unspecified"),
        voiceGender: z.enum(["female", "male", "androgynous", "unspecified"]).default("unspecified"),
        ageBand: z.string().max(100).default(""),
        identityAnchor: z.string().max(2_000).default(""),
        facialIdentity: z.object({
            faceShape: z.string().max(500).default(""),
            boneStructure: z.string().max(500).default(""),
            brows: z.string().max(500).default(""),
            eyes: z.string().max(500).default(""),
            nose: z.string().max(500).default(""),
            mouth: z.string().max(500).default(""),
            skin: z.string().max(500).default(""),
            hairline: z.string().max(500).default(""),
            distinguishingMarks: z.string().max(500).default(""),
        }).nullable().default(null),
        uncertainties: z.array(z.string().max(500)).max(50).default([]),
    }).nullable().default(null),
    variants: z.array(variant).max(500).default([]),
    primaryImageId: id.nullable().default(null),
    primaryAudioId: id.nullable().default(null),
    mediaDrafts: z.object({ image: mediaDraft, audio: mediaDraft }),
    dependencies: z.object({ style: z.object({ id, revision: z.number().int().positive() }).nullable().optional() }).optional(),
    needsReview: z.boolean().optional(),
    staleReason: z.string().max(2_000).optional(),
});
const creativeAssetPayloadPatchSchema = z.object({
    description: text.optional(),
    narrativeDescription: text.optional(),
    visualDescription: text.optional(),
    designProfile: creativeAssetPayloadSchema.shape.designProfile.optional(),
    variants: z.array(variant).max(500).optional(),
    primaryImageId: id.nullable().optional(),
    primaryAudioId: id.nullable().optional(),
    mediaDrafts: z.object({ image: mediaDraftPatch.optional(), audio: mediaDraftPatch.optional() }).partial().optional(),
    dependencies: creativeAssetPayloadSchema.shape.dependencies.optional(),
    needsReview: z.boolean().optional(),
    staleReason: z.string().max(2_000).optional(),
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
    const payload = normalizeCreativeAssetPayload(input.kind, input.name, input.payload);
    assertPrimaryVariants(payload);
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
    const payload = creativeAssetPayloadSchema.parse({
        ...currentPayload,
        ...payloadPatch,
        mediaDrafts: payloadPatch.mediaDrafts ? {
            image: { ...currentPayload.mediaDrafts.image, ...payloadPatch.mediaDrafts.image },
            audio: { ...currentPayload.mediaDrafts.audio, ...payloadPatch.mediaDrafts.audio },
        } : currentPayload.mediaDrafts,
    });
    assertPrimaryVariants(payload);
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
    if (selected.kind === "audio" && selected.usage === "reference_input") throw creativeAssetError(400, "CREATIVE_ASSET_REFERENCE_NOT_PRIMARY", "参考音频不能设为主音频");
    if (selected.kind === "image" && selected.review?.status !== "approved") throw creativeAssetError(409, "CREATIVE_ASSET_VARIANT_REVIEW_REQUIRED", "设计图通过审核后才能设为主图");
    return updateCreativeAsset(userId, assetId, { revision, payload: selected.kind === "image" ? { primaryImageId: variantId } : { primaryAudioId: variantId } }, true);
}

export function reviewCreativeAssetVariant(userId: string, assetId: string, variantId: string, input: { revision: number; accepted: boolean; summary?: string; issues?: string[]; setPrimary?: boolean }) {
    const row = creativeAssetRow(userId, assetId);
    if (!row) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    const payload = creativeAssetPayloadSchema.parse(parseJson(row.payload, {}));
    const selected = payload.variants.find((item) => item.id === variantId);
    if (!selected || selected.kind !== "image") throw creativeAssetError(404, "CREATIVE_ASSET_VARIANT_NOT_FOUND", "设计图版本不存在");
    selected.review = {
        status: input.accepted ? "approved" : "rejected",
        source: "manual",
        summary: input.summary?.trim() || (input.accepted ? "已人工验收" : "已人工拒绝"),
        issues: input.issues || [],
        reviewedAt: new Date().toISOString(),
    };
    if (!input.accepted && payload.primaryImageId === variantId) payload.primaryImageId = null;
    if (input.accepted && input.setPrimary) payload.primaryImageId = variantId;
    return updateCreativeAsset(userId, assetId, { revision: input.revision, payload }, true);
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

export function deleteCanvasNodes(userId: string, projectId: string, nodeIds: string[], expectedRevision: number): SavedProject & { id: string; title: string; revision: number; createdAt: string; updatedAt: string } {
    const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string } | undefined;
    if (!row) throw creativeAssetError(404, "PROJECT_NOT_FOUND", "画布不存在");
    if (row.revision !== expectedRevision) throw creativeAssetError(409, "PROJECT_CONFLICT", `画布版本已从 ${expectedRevision} 更新为 ${row.revision}`);
    const project = parseJson<SavedProject>(row.payload, { nodes: [], connections: [] });
    const requested = new Set(nodeIds);
    const assetIds = new Set(project.nodes.filter((node) => requested.has(node.id)).map((node) => String(node.metadata?.assetId || "")).filter(Boolean));
    const removedNodeIds = new Set(project.nodes.filter((node) => requested.has(node.id) || assetIds.has(String(node.metadata?.assetId || ""))).map((node) => node.id));
    project.nodes = project.nodes.filter((node) => !removedNodeIds.has(node.id)).map((node) => {
        if (!removedNodeIds.has(String(node.metadata?.groupId || ""))) return node;
        return { ...node, metadata: { ...node.metadata, groupId: undefined } };
    });
    project.connections = project.connections.filter((connection) => !removedNodeIds.has(String(connection.fromNodeId || "")) && !removedNodeIds.has(String(connection.toNodeId || "")));
    const now = new Date().toISOString();
    db.transaction(() => {
        const updated = db.prepare("UPDATE projects SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?").run(JSON.stringify({ ...project, updatedAt: now }), now, projectId, userId, expectedRevision);
        if (!updated.changes) throw creativeAssetError(409, "PROJECT_CONFLICT", "画布已更新，请重新加载后再删除");
        for (const assetId of assetIds) {
            db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='creative_asset' AND owner_id=?").run(userId, assetId);
            db.prepare("DELETE FROM creative_assets WHERE id=? AND user_id=? AND project_id=?").run(assetId, userId, projectId);
        }
        syncFileRefs(userId, "project", projectId, project);
    })();
    publishProjectRow(userId, projectId);
    for (const assetId of assetIds) emitAsset(userId, { id: assetId, projectId, deleted: true });
    const saved = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as typeof row;
    return { ...parseJson<SavedProject>(saved.payload, { nodes: [], connections: [] }), id: saved.id, title: saved.title, revision: saved.revision, createdAt: saved.created_at, updatedAt: saved.updated_at };
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

export function createCreativeAssetsBatch(userId: string, projectId: string, rawItems: unknown, sourceNodeId?: string, placeOnCanvas = true) {
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
                const payload = normalizeCreativeAssetPayload(kind, input.name, input.payload);
                db.prepare("INSERT INTO creative_assets(id, user_id, project_id, kind, name, status, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
                    .run(assetId, userId, projectId, kind, input.name, input.status, JSON.stringify(payload), now, now);
                syncFileRefs(userId, "creative_asset", assetId, payload);
                if (placeOnCanvas) project.nodes.push({ id: `${kind}-${nanoid()}`, type: kind, title: input.name, position: { x: columnX, y: baseY + index * (layout.height + 32) }, ...layout, metadata: { assetId, assetKind: kind } });
                created.push(creativeAssetResponse(creativeAssetRow(userId, assetId)!));
            });
            columnX += layout.width + 90;
        });
        if (placeOnCanvas) saveProjectPayload(userId, projectId, project, false);
    })();
    created.forEach((asset) => emitAsset(userId, asset));
    if (placeOnCanvas) publishProjectRow(userId, projectId);
    return created;
}

export function syncCreativeAssetGeneration(row: { id: string; user_id: string; status: string; request: string; result: string | null }) {
    if (row.status !== "succeeded") return;
    const request = parseJson<{ kind?: "image" | "audio"; prompt?: string; params?: { __creativeAsset?: { assetId?: string; usage?: string; label?: string; transcript?: string }; __creativeAssetReview?: { assetId?: string; sourceGenerationId?: string; fileId?: string }; __visualStyle?: { id?: string; revision?: number } | null } }>(row.request, {});
    const reviewTarget = request.params?.__creativeAssetReview;
    if (reviewTarget?.assetId && reviewTarget.sourceGenerationId && reviewTarget.fileId) {
        applyAutomaticReview(row, reviewTarget as { assetId: string; sourceGenerationId: string; fileId: string });
        return;
    }
    const target = request.params?.__creativeAsset;
    if (!target?.assetId) return;
    const asset = creativeAssetRow(row.user_id, target.assetId);
    if (!asset) return;
    const result = parseJson<{ files?: Array<{ fileId?: string; id?: string }> }>(row.result, {});
    const fileIds = (result.files || []).map((file) => String(file.fileId || file.id || "")).filter(Boolean);
    if (!fileIds.length) return;
    const payload = creativeAssetPayloadSchema.parse(parseJson(asset.payload, {}));
    const kind = request.kind === "audio" ? "audio" : "image";
    const additions = fileIds.slice(0, 1).filter((fileId) => !payload.variants.some((item) => item.generationId === row.id && item.fileId === fileId));
    if (!additions.length) return;
    const added = additions.map((fileId) => ({ id: nanoid(), kind, fileId, label: target.label || (kind === "image" ? "生成图片" : "生成声音"), prompt: request.prompt || "", generationId: row.id, usage: target.usage, transcript: target.transcript, createdAt: new Date().toISOString() } satisfies CreativeAssetVariant));
    payload.variants = [...payload.variants.filter((item) => item.kind !== kind || item.usage === "reference_input"), ...added];
    if (kind === "image") {
        payload.primaryImageId = added[0].id;
        payload.dependencies = { ...payload.dependencies, style: request.params?.__visualStyle?.id && request.params.__visualStyle.revision ? { id: request.params.__visualStyle.id, revision: request.params.__visualStyle.revision } : null };
        payload.needsReview = false;
        payload.staleReason = undefined;
    }
    else payload.primaryAudioId = added[0].id;
    updateCreativeAsset(row.user_id, asset.id, { revision: asset.revision, payload }, true);
}

export function creativeAssetAutomaticReviewRequest(row: { id: string; user_id: string; kind: string; status: string; request: string; result: string | null }) {
    if (row.kind !== "image" || row.status !== "succeeded") return null;
    const request = parseJson<{ params?: { __creativeAsset?: { assetId?: string }; __creativeAssetReview?: unknown } }>(row.request, {});
    if (request.params?.__creativeAssetReview || !request.params?.__creativeAsset?.assetId) return null;
    const asset = creativeAssetRow(row.user_id, request.params.__creativeAsset.assetId);
    if (!asset) return null;
    const payload = creativeAssetPayloadSchema.parse(parseJson(asset.payload, {}));
    const variant = payload.variants.find((item) => item.kind === "image" && item.generationId === row.id);
    if (!variant || variant.review) return null;
    const model = getAiGlobalSettings().config.creativeAssetReviewModel;
    if (!model) {
        variant.review = { status: "pending_review", source: "manual", summary: "未配置视觉质检模型，请人工验收" };
        updateCreativeAsset(row.user_id, asset.id, { revision: asset.revision, payload }, true);
        return null;
    }
    variant.review = { status: "pending_review", source: "automatic", summary: "正在检查视觉一致性" };
    updateCreativeAsset(row.user_id, asset.id, { revision: asset.revision, payload }, true);
    const styleId = payload.dependencies?.style?.id;
    const style = styleId ? db.prepare("SELECT description,reference_files FROM visual_styles WHERE id=? AND user_id=? AND project_id=?").get(styleId, row.user_id, asset.project_id) as { description: string; reference_files: string } | undefined : undefined;
    const styleReference = style ? parseJson<{ source?: string; character?: string; scene?: string; prop?: string }>(style.reference_files, {})[asset.kind] || parseJson<{ source?: string }>(style.reference_files, {}).source : undefined;
    const criteria = asset.kind === "character"
        ? "恰好四个视角（正面、左侧、右侧、背面）；四个完整等高全身且不裁切；面部、体型、发型、服装、材质、配色一致；纯白背景；无文字、边框、Logo；符合视觉风格。"
        : asset.kind === "scene"
            ? "空间结构、时代地理、陈设、材质和光线一致；无人、无剧情动作、无意外文字；符合视觉风格。"
            : "轮廓、比例、材质、结构、磨损和关键细节清晰一致；无人物、无环境、无文字；符合视觉风格。";
    return { kind: "text" as const, model, prompt: `你是影视美术视觉质检员。第一张参考图片是待检查的${asset.kind === "character" ? "角色四视图" : asset.kind === "scene" ? "场景母版" : "道具母版"}${styleReference ? "，第二张是风格参考" : ""}。\n验收标准：${criteria}\n当前风格：${style?.description || "以待检查图片自身为准"}\n只输出 JSON：{"passed":boolean,"summary":string,"issues":string[],"metrics":object}。`, references: [{ fileId: variant.fileId, kind: "image" as const }, ...(styleReference ? [{ fileId: styleReference, kind: "image" as const }] : [])], params: { __creativeAssetReview: { assetId: asset.id, sourceGenerationId: row.id, fileId: variant.fileId } } };
}

function applyAutomaticReview(row: { id: string; user_id: string; result: string | null }, target: { assetId: string; sourceGenerationId: string; fileId: string }) {
    const asset = creativeAssetRow(row.user_id, target.assetId);
    if (!asset) return;
    const payload = creativeAssetPayloadSchema.parse(parseJson(asset.payload, {}));
    const variant = payload.variants.find((item) => item.kind === "image" && item.generationId === target.sourceGenerationId && item.fileId === target.fileId);
    if (!variant) return;
    const rawText = String(parseJson<{ text?: string }>(row.result, {}).text || "");
    const parsed = parseReviewResult(rawText);
    variant.review = parsed ? { status: parsed.passed ? "approved" : "rejected", source: "automatic", summary: parsed.summary, issues: parsed.issues, metrics: parsed.metrics, reviewedAt: new Date().toISOString(), reviewGenerationId: row.id } : { status: "pending_review", source: "manual", summary: "自动质检结果无法解析，请人工验收", reviewGenerationId: row.id };
    updateCreativeAsset(row.user_id, asset.id, { revision: asset.revision, payload }, true);
}

function parseReviewResult(value: string) {
    try {
        const json = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        return z.object({ passed: z.boolean(), summary: z.string().max(2_000), issues: z.array(z.string().max(500)).max(50).default([]), metrics: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).default({}) }).parse(JSON.parse(json));
    } catch { return null; }
}

export function creativeAssetResponse(row: CreativeAssetRow) {
    return { id: row.id, projectId: row.project_id, kind: row.kind, name: row.name, status: row.status, payload: creativeAssetPayloadSchema.parse(parseJson(row.payload, {})), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function buildCreativeAssetPrompt(asset: ReturnType<typeof creativeAssetResponse>, kind: "image" | "audio", extra = "", profile: "generic" | "gpt-image-2" = "generic") {
    const description = asset.payload.description.trim();
    const requirement = extra.trim();
    if (kind === "audio") return requirement || asset.payload.mediaDrafts.audio.prompt || asset.payload.description;
    const directorCharacter = asset.kind === "character" && isDirectorProject(asset.projectId);
    const visualDescription = asset.payload.visualDescription.trim();
    const layout = {
        character: directorCharacter
            ? "横版 16:9 单张角色四视图设定图，严格纯白无影背景。同一张图片内按从左到右顺序并排展示同一个角色的正面、左侧 90 度、右侧 90 度、背面 180 度全身 A-Pose；四个视图从头到脚完整入画、等比例、等高度、间距均匀，面部身份、年龄、体型、发型、服装结构、材质、配色、鞋履和配饰完全一致。只输出一张包含四个角度的完整图片，不拆成四张图片，不画胸像、四分之三视角、环境、情节、道具、文字、字母、数字、标题、标注、边框、Logo 或 UI。"
            : "横版 16:9 四格角色设定图，严格纯白无影背景：左侧约 40% 为胸像特写，右侧依次为正面、四分之三侧面、背面的 A-Pose 全身视图。四个视图必须是同一角色，面部、性别表达、年龄、发型、服装和配饰完全一致。只画角色，不画环境、情节、文字或标注。",
        scene: "横版 16:9 场景设定图，严格无人、无文字、无标注：主画面占四分之三区域，完整展示空间结构、固定陈设、光线和氛围；右下角嵌入标志性局部细节图。",
        prop: "横版 16:9 道具设定图，严格纯白无影背景：正面全视图、45 度侧视图、关键细节特写水平排列，各视图必须是同一件道具，结构、材质和比例保持一致。只画道具，不画人物、环境、文字或标注。",
    }[asset.kind];
    const facialIdentity = directorCharacter && asset.payload.designProfile?.facialIdentity
        ? Object.entries(asset.payload.designProfile.facialIdentity).map(([key, value]) => value.trim() ? `${facialIdentityLabels[key] || key}：${value.trim()}` : "").filter(Boolean).join("；")
        : "";
    if (directorCharacter) {
        const subject = [
            "同一角色的单张横版四视图设计图，一张图片内包含四个角度。",
            visualDescription,
            facialIdentity ? `稳定面部身份锚点：${facialIdentity}` : "",
        ].filter(Boolean).join("\n");
        const supplement = requirement ? `[风格与补充要求]\n${requirement}` : "";
        const forbidden = "负面约束：背景场景、剧情动作、叙事事件、情绪变化、换装、伤势、水印、文字、字母、数字、Logo、UI、边框标题。";
        return profile === "gpt-image-2"
            ? [`[主体视觉设定]\n${subject}`, supplement, `[输出规格]\n${layout}`, `[禁止项与验收]\n${forbidden}`].filter(Boolean).join("\n\n")
            : [subject, requirement, layout, forbidden].filter(Boolean).join("\n\n");
    }
    const sections = [
        `${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}「${asset.name}」的视觉设计参考。`,
        description,
        requirement,
        layout,
        asset.kind === "character" && asset.payload.designProfile && !directorCharacter ? `身份锚点：${asset.payload.designProfile.identityAnchor}\n年龄段：${asset.payload.designProfile.ageBand}\n外观性别：${asset.payload.designProfile.apparentGender}` : "",
        "负面约束：背景场景、剧情动作、叙事事件、水印、文字、字母、数字、Logo、UI、边框标题。",
    ].filter(Boolean);
    return profile === "gpt-image-2"
        ? [`[主体视觉设定]\n${sections[0]}\n${sections[1] || ""}`, `[风格与补充要求]\n${sections.slice(2, -2).join("\n")}`, `[输出规格]\n${layout}`, `[禁止项与验收]\n${sections.at(-1)}`].join("\n\n")
        : sections.join("\n\n");
}

const facialIdentityLabels: Record<string, string> = {
    faceShape: "脸型比例", boneStructure: "骨相轮廓", brows: "眉形", eyes: "眼型与眼距", nose: "鼻部", mouth: "唇形与嘴角", skin: "肤色与质感", hairline: "发际线", distinguishingMarks: "非对称识别点",
};

export function isDirectorProject(projectId: string) {
    return Boolean(db.prepare("SELECT 1 FROM projects WHERE id=? AND kind='director'").get(projectId));
}

export function creativeAssetAudioMode(kind: CreativeAssetKind): CreativeAssetAudioMode {
    return kind === "character" ? "speech" : kind === "scene" ? "ambient" : "sfx";
}

function normalizeCreativeAssetPayload(kind: CreativeAssetKind, name: string, raw: unknown) {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const drafts = value.mediaDrafts && typeof value.mediaDrafts === "object" ? value.mediaDrafts as Record<string, unknown> : {};
    const image = drafts.image && typeof drafts.image === "object" ? drafts.image as Record<string, unknown> : {};
    const audio = drafts.audio && typeof drafts.audio === "object" ? drafts.audio as Record<string, unknown> : {};
    const description = typeof value.description === "string" ? value.description : "";
    return creativeAssetPayloadSchema.parse({
        ...value,
        mediaDrafts: {
            image: { model: null, params: {}, ...image, prompt: cleanImageDraftPrompt(kind, name, description, image.prompt) },
            audio: { prompt: "", model: null, params: {}, transcript: "", ...audio, audioMode: creativeAssetAudioMode(kind) },
        },
    });
}

function cleanImageDraftPrompt(kind: CreativeAssetKind, name: string, description: string, value: unknown) {
    const prompt = typeof value === "string" ? value.trim() : "";
    if (!prompt || prompt === description.trim()) return "";
    const subject = kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
    const generatedPrefixes = [`${subject}「${name}」的视觉设计参考。`, `为${subject}“${name}”制作可用于后续镜头保持一致性的设计图。`, `为${subject}「${name}」制作可用于后续镜头保持一致性的设计图。`];
    return generatedPrefixes.some((prefix) => prompt.startsWith(prefix)) ? "" : prompt;
}

function assertPrimaryVariants(payload: CreativeAssetPayload) {
    if (payload.primaryImageId && !payload.variants.some((item) => item.id === payload.primaryImageId && item.kind === "image" && item.usage !== "reference_input")) throw creativeAssetError(400, "CREATIVE_ASSET_INVALID_PRIMARY_IMAGE", "主设计图必须来自生成或上传的设计版本");
    if (payload.primaryAudioId && !payload.variants.some((item) => item.id === payload.primaryAudioId && item.kind === "audio" && item.usage !== "reference_input")) throw creativeAssetError(400, "CREATIVE_ASSET_INVALID_PRIMARY_AUDIO", "主音频必须来自生成的媒体版本");
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
