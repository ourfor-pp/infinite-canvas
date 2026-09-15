import { markDirectorProjectChanged } from "./director-sync.js";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db, parseJson } from "./database.js";
import { syncFileRefs } from "./file-store.js";
import { publishAgentProject } from "./agent/project-events.js";
import { getAiGlobalSettings } from "./provider-service.js";
import { getVisualStyle } from "./visual-styles.js";
import { applyDirectorAssetGeneration, syncDirectorAssetFile, trashDirectorAssetFolder, type DirectorAssetGenerationTarget } from "./director-workspace.js";

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
    visibleAgeCues: string;
    bodySilhouette: string;
    posture: string;
    identityAnchor: string;
    distinctivenessSummary: string;
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
    contentVersion?: string;
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
    contentVersion: z.string().optional(),
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
        visibleAgeCues: z.string().max(1_000).default(""),
        bodySilhouette: z.string().max(1_000).default(""),
        posture: z.string().max(1_000).default(""),
        identityAnchor: z.string().max(2_000).default(""),
        distinctivenessSummary: z.string().max(2_000).default(""),
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

let sendAsset: (userId: string, asset: unknown) => void = () => undefined;
export function setCreativeAssetEmitter(emitter: typeof sendAsset) { sendAsset = emitter; }
function emitAsset(userId: string, asset: unknown) {
    const projectId = (asset as { projectId?: string }).projectId;
    if (projectId) markDirectorProjectChanged(userId, projectId, ["assets", "segments", "media"]);
    sendAsset(userId, asset);
}

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
    if (isDirectorProject(projectId)) syncDirectorAssetFile(userId, projectId, assetId);
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
    if (isDirectorProject(current.project_id)) syncDirectorAssetFile(userId, current.project_id, assetId);
    return publishAsset(creativeAssetRow(userId, assetId)!);
}

export function setCreativeAssetPrimary(userId: string, assetId: string, variantId: string, revision: number, allowProtected = false) {
    const row = creativeAssetRow(userId, assetId);
    if (!row) throw creativeAssetError(404, "CREATIVE_ASSET_NOT_FOUND", "创作资产不存在或无权访问");
    if (!allowProtected && row.status !== "draft") throw creativeAssetError(409, "CREATIVE_ASSET_PROTECTED", "已确认或锁定的设定需要通过审批修改");
    const payload = creativeAssetPayloadSchema.parse(parseJson(row.payload, {}));
    const selected = payload.variants.find((item) => item.id === variantId);
    if (!selected) throw creativeAssetError(404, "CREATIVE_ASSET_VARIANT_NOT_FOUND", "媒体版本不存在");
    if (isCreativeAssetReferenceUsage(selected.usage)) throw creativeAssetError(400, "CREATIVE_ASSET_REFERENCE_NOT_PRIMARY", "参考素材不能设为主结果");
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
    if (isDirectorProject(row.project_id)) trashDirectorAssetFolder(userId, row.project_id, assetId);
    const project = projectPayload(userId, row.project_id);
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
    const removedNodeIds = new Set(project.nodes.filter((node) => requested.has(node.id)).map((node) => node.id));
    project.nodes = project.nodes.filter((node) => !removedNodeIds.has(node.id)).map((node) => {
        if (!removedNodeIds.has(String(node.metadata?.groupId || ""))) return node;
        return { ...node, metadata: { ...node.metadata, groupId: undefined } };
    });
    project.connections = project.connections.filter((connection) => !removedNodeIds.has(String(connection.fromNodeId || "")) && !removedNodeIds.has(String(connection.toNodeId || "")));
    const now = new Date().toISOString();
    db.transaction(() => {
        const updated = db.prepare("UPDATE projects SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?").run(JSON.stringify({ ...project, updatedAt: now }), now, projectId, userId, expectedRevision);
        if (!updated.changes) throw creativeAssetError(409, "PROJECT_CONFLICT", "画布已更新，请重新加载后再删除");
        syncFileRefs(userId, "project", projectId, project);
    })();
    publishProjectRow(userId, projectId);
    const saved = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as typeof row;
    return { ...parseJson<SavedProject>(saved.payload, { nodes: [], connections: [] }), id: saved.id, title: saved.title, revision: saved.revision, createdAt: saved.created_at, updatedAt: saved.updated_at };
}

export function createCreativeAssetsBatch(userId: string, projectId: string, rawItems: unknown) {
    assertProject(userId, projectId);
    const items = z.array(creativeAssetInputSchema).min(1).max(200).parse(rawItems);
    const kinds: CreativeAssetKind[] = ["character", "scene", "prop"];
    const now = new Date().toISOString();
    const created: ReturnType<typeof creativeAssetResponse>[] = [];
    db.transaction(() => {
        kinds.forEach((kind) => {
            const subset = items.filter((item) => item.kind === kind);
            if (!subset.length) return;
            subset.forEach((input) => {
                const assetId = nanoid();
                const payload = normalizeCreativeAssetPayload(kind, input.name, input.payload);
                db.prepare("INSERT INTO creative_assets(id, user_id, project_id, kind, name, status, payload, revision, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
                    .run(assetId, userId, projectId, kind, input.name, input.status, JSON.stringify(payload), now, now);
                syncFileRefs(userId, "creative_asset", assetId, payload);
                created.push(creativeAssetResponse(creativeAssetRow(userId, assetId)!));
            });
        });
    })();
    created.forEach((asset) => emitAsset(userId, asset));
    if (isDirectorProject(projectId)) created.forEach((asset) => syncDirectorAssetFile(userId, projectId, asset.id));
    return created;
}

export function syncCreativeAssetGeneration(row: { id: string; user_id: string; status: string; request: string; result: string | null }) {
    if (row.status !== "succeeded") return;
    const request = parseJson<{ kind?: "image" | "audio"; prompt?: string; params?: { __creativeAsset?: { assetId?: string; usage?: string; label?: string; transcript?: string }; __creativeAssetReview?: { assetId?: string; sourceGenerationId?: string; fileId?: string }; __directorAssetTarget?: DirectorAssetGenerationTarget; __visualStyle?: { id?: string; revision?: number } | null } }>(row.request, {});
    const reviewTarget = request.params?.__creativeAssetReview;
    if (reviewTarget?.assetId && reviewTarget.sourceGenerationId && reviewTarget.fileId) {
        applyAutomaticReview(row, reviewTarget as { assetId: string; sourceGenerationId: string; fileId: string });
        return;
    }
    const result = parseJson<{ files?: Array<{ fileId?: string; id?: string }> }>(row.result, {});
    const fileIds = (result.files || []).map((file) => String(file.fileId || file.id || "")).filter(Boolean);
    if (!fileIds.length) return;
    const directorTarget = request.params?.__directorAssetTarget;
    if (directorTarget) {
        try {
            if (applyDirectorAssetGeneration(row.user_id, directorTarget, fileIds[0])) {
                const asset = creativeAssetRow(row.user_id, directorTarget.assetId);
                if (asset) emitAsset(row.user_id, creativeAssetResponse(asset));
            }
        }
        catch (error) {
            if ((error as { code?: string }).code !== "DIRECTOR_ASSET_TARGET_CONFLICT") throw error;
        }
        return;
    }
    const target = request.params?.__creativeAsset;
    if (!target?.assetId) return;
    const asset = creativeAssetRow(row.user_id, target.assetId);
    if (!asset) return;
    const payload = creativeAssetPayloadSchema.parse(parseJson(asset.payload, {}));
    const kind = request.kind === "audio" ? "audio" : "image";
    const additions = fileIds.slice(0, 1).filter((fileId) => !payload.variants.some((item) => item.generationId === row.id && item.fileId === fileId));
    if (!additions.length) return;
    const added = additions.map((fileId) => ({ id: nanoid(), kind, fileId, label: target.label || (kind === "image" ? "生成图片" : "生成声音"), prompt: request.prompt || "", generationId: row.id, usage: target.usage, transcript: target.transcript, createdAt: new Date().toISOString() } satisfies CreativeAssetVariant));
    payload.variants = [...payload.variants.filter((item) => item.kind !== kind || isCreativeAssetReferenceUsage(item.usage) || item.usage !== target.usage), ...added];
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
    const style = styleId ? getVisualStyle(row.user_id, styleId) : undefined;
    const styleReferences = style?.references || {};
    const styleReference = styleReferences.board || styleReferences.source;
    const criteria = asset.kind === "character"
        ? `一张横版 16:9 三栏角色身份板，且只包含同一角色：左栏完整正面全身、中栏完整背面全身、右栏放大的正面头肩面部近景；两个全身视图均从头顶到鞋底完整入画，三栏年龄、体型、脸部、发型、基础服装、材质和配色完全一致；纯净中性背景、细分隔线；无额外视角、环境、剧情动作、文字、边框、Logo 或 UI。${style?.dna.mediumFamily === "live_action" ? "检查塑料皮肤、过度磨皮、偶像脸、图库模特感、商业精修、CGI 或插画感；应具有真实毛孔、符合年龄的纹理和自然轻微不对称。" : `按 ${style?.dna.mediumFamily || "当前"} 媒介检查线条或材质、形状概括、色块与阴影层级的一致性，不得用真人毛孔或摄影感作为验收标准。`}身份锚点：${payload.designProfile?.identityAnchor || payload.designProfile?.distinctivenessSummary || "以角色视觉设定为准"}。`
        : asset.kind === "scene"
            ? "空间结构、时代地理、陈设、材质和光线一致；无人、无剧情动作、无意外文字；符合视觉风格。"
            : "轮廓、比例、材质、结构、磨损和关键细节清晰一致；无人物、无环境、无文字；符合视觉风格。";
    return { kind: "text" as const, model, prompt: `你是影视美术视觉质检员。第一张参考图片是待检查的${asset.kind === "character" ? variant.label || "角色身份媒体" : asset.kind === "scene" ? "场景母版" : "道具母版"}${styleReference ? "，第二张是风格参考" : ""}。\n验收标准：${criteria}\n当前风格：${style?.description || "以待检查图片自身为准"}\n只输出 JSON：{"passed":boolean,"summary":string,"issues":string[],"metrics":object}。`, references: [{ fileId: variant.fileId, kind: "image" as const }, ...(styleReference ? [{ fileId: styleReference, kind: "image" as const }] : [])], params: { __creativeAssetReview: { assetId: asset.id, sourceGenerationId: row.id, fileId: variant.fileId } } };
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

export function buildCreativeAssetPrompt(asset: ReturnType<typeof creativeAssetResponse>, kind: "image" | "audio", extra = "", profile: "generic" | "gpt-image-2" = "generic", styleMediumFamily: "live_action" | "animation_2d" | "animation_3d" | "illustration" | "handmade" | "graphic" = "live_action", visualDescriptionOverride?: string) {
    const description = asset.payload.description.trim();
    const requirement = extra.trim();
    if (kind === "audio") return requirement || asset.payload.mediaDrafts.audio.prompt || asset.payload.description;
    const directorCharacter = asset.kind === "character" && isDirectorProject(asset.projectId);
    const visualDescription = visualDescriptionOverride?.trim() || asset.payload.visualDescription.trim();
    const instructionLayout = {
        character: directorCharacter
            ? "只生成 ONE 张横版 16:9 角色身份板。画布严格分成三个并排纵向面板：左栏为角色完整正面全身，正对镜头、中性站姿、从头顶到鞋底全部入画；中栏为同一角色完整背面全身，同样从头顶到鞋底全部入画；右栏为同一角色放大的正面头肩面部近景，清楚呈现脸型骨相、眉眼鼻唇、肤色、发际线、年龄痕迹和自然识别点。三栏必须是同一身份、同一年龄、同一体型、同一发型、同一基础服装、同一材质与配色，使用一致的中性光。纯净浅灰或白色背景，仅用细而克制的面板分隔线。不得生成三张独立图片，不得出现额外视角、环境、情节、动作、道具、文字、标注、标题、Logo、UI 或装饰边框。"
            : "横版 16:9 四格角色设定图，严格纯白无影背景：左侧约 40% 为胸像特写，右侧依次为正面、四分之三侧面、背面的 A-Pose 全身视图。四个视图必须是同一角色，面部、性别表达、年龄、发型、服装和配饰完全一致。只画角色，不画环境、情节、文字或标注。",
        scene: "横版 16:9 场景设定图，严格无人、无文字、无标注：主画面占四分之三区域，完整展示空间结构、固定陈设、光线和氛围；右下角嵌入标志性局部细节图。",
        prop: "横版 16:9 道具设定图，严格纯白无影背景：正面全视图、45 度侧视图、关键细节特写水平排列，各视图必须是同一件道具，结构、材质和比例保持一致。只画道具，不画人物、环境、文字或标注。",
    }[asset.kind];
    const positiveLayout = {
        character: directorCharacter
            ? "一张横版 16:9 三栏角色身份板：左栏完整正面全身，中栏完整背面全身，右栏放大的正面头肩面部近景。两个全身视图均从头顶到鞋底完整入画；三栏保持同一身份、年龄、体型、脸部、发型、基础服装、材质与配色，使用纯净浅灰或白色背景和一致中性光。只输出这一张完整身份板，不输出三张独立图片、额外视角、环境、剧情动作、文字、标注、标题、Logo、UI 或装饰边框。"
            : "横版 16:9 四视图角色设定图，均匀纯白背景：左侧约 40% 为胸像特写，右侧依次为正面、四分之三侧面、背面的 A-Pose 全身视图。四个视图呈现同一角色，保持面部、年龄、发型、服装和配饰一致。",
        scene: "横版 16:9 场景设定图：主画面占四分之三区域，完整展示空间结构、固定陈设、光线和氛围；右下角呈现标志性局部细节。",
        prop: "横版 16:9 道具设定图，均匀纯白背景：正面全视图、45 度侧视图、关键细节特写水平排列，各视图呈现同一件道具并保持结构、材质和比例一致。",
    }[asset.kind];
    const layout = profile === "gpt-image-2" ? instructionLayout : positiveLayout;
    const facialIdentity = directorCharacter && asset.payload.designProfile?.facialIdentity
        ? Object.entries(asset.payload.designProfile.facialIdentity).map(([key, value]) => value.trim() ? `${facialIdentityLabels[key] || key}：${value.trim()}` : "").filter(Boolean).join("；")
        : "";
    if (directorCharacter) {
        const design = asset.payload.designProfile;
        const liveAction = styleMediumFamily === "live_action";
        const subject = [
            liveAction && profile === "gpt-image-2" ? "Photorealistic real-camera casting documentation of one believable human actor." : "同一个角色的一张稳定身份参考图。",
            visualDescription,
            design?.visibleAgeCues ? `可见年龄痕迹：${design.visibleAgeCues}` : "",
            design?.bodySilhouette ? `全身剪影：${design.bodySilhouette}` : "",
            facialIdentity ? `稳定面部身份锚点：${facialIdentity}` : "",
            !facialIdentity && visualDescription && design?.identityAnchor ? `稳定身份锚点：${design.identityAnchor}` : "",
            design?.distinctivenessSummary ? `与其他角色的差异锚点：${design.distinctivenessSummary}` : "",
        ].filter(Boolean).join("\n");
        const supplement = requirement ? `[当前风格]\n${requirement}` : "";
        const renderingQuality = characterRenderingQuality(styleMediumFamily, profile === "gpt-image-2");
        const forbidden = "禁止项：背景场景、剧情动作、叙事事件、夸张情绪、换装、伤势、水印、文字、字母、数字、Logo、UI、边框和标题。";
        return profile === "gpt-image-2"
            ? [`[角色身份]\n${subject}`, supplement, `[目标媒体规格]\n${layout}`, `[媒介质量要求]\n${renderingQuality}`, `[通用禁止项]\n${forbidden}`].filter(Boolean).join("\n\n")
            : [subject, requirement, renderingQuality, layout].filter(Boolean).join("\n\n");
    }
    const sections = [
        `${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}「${asset.name}」的视觉设计参考。`,
        asset.kind === "character" ? visualDescription || description : description,
        requirement,
        layout,
        asset.kind === "character" && asset.payload.designProfile && !directorCharacter ? `身份锚点：${asset.payload.designProfile.identityAnchor}\n年龄段：${asset.payload.designProfile.ageBand}\n外观性别：${asset.payload.designProfile.apparentGender}` : "",
        "负面约束：背景场景、剧情动作、叙事事件、水印、文字、字母、数字、Logo、UI、边框标题。",
    ].filter(Boolean);
    return profile === "gpt-image-2"
        ? [`[主体视觉设定]\n${sections[0]}\n${sections[1] || ""}`, `[风格与补充要求]\n${sections.slice(2, -2).join("\n")}`, `[输出规格]\n${layout}`, `[禁止项与验收]\n${sections.at(-1)}`].join("\n\n")
        : sections.slice(0, -1).join("\n\n");
}

function characterRenderingQuality(family: "live_action" | "animation_2d" | "animation_3d" | "illustration" | "handmade" | "graphic", includeRestrictions = true) {
    const positive = family === "live_action"
        ? "真实摄影要求：真实相机拍摄的人类演员，保持自然毛孔、轻微肤色不均、真实眼下纹理、符合年龄的细纹与自然轻微不对称；中性自然光、中性放松表情、准确的人体比例。"
        : family === "animation_2d"
            ? "二维动画要求：以清晰稳定的角色轮廓、五官形状、发束、服装色块与阴影层级保持身份；三个面板的线条语言、造型简化程度和上色方式完全一致。"
            : family === "animation_3d"
                ? "三维动画要求：保持统一建模比例、拓扑感、材质和灯光响应，三个面板具有同一角色模型的稳定轮廓与身份特征。"
                : family === "illustration"
                    ? "插画要求：保持统一笔触、轮廓概括、色彩层次和纸面或数字绘画质感；风格化脸型、骨相、发型、体型和识别点清晰可辨。"
                    : family === "handmade"
                        ? "手工媒介要求：保持材料、边缘、纹理和制作痕迹统一，三个面板像由同一套实体角色工艺制作；身份轮廓和服装结构保持稳定。"
                        : "图形风格要求：保持统一的形状语言、轮廓、有限色彩和图形纹理，三个面板以脸型、发型、体型、服装剪影和识别点维持同一身份。";
    if (!includeRestrictions) return positive;
    const restrictions = family === "live_action" ? "不得美颜磨皮，不得塑料皮肤、网红脸、偶像海报、美妆广告、图库模特、商业时装精修、CGI、3D 渲染或插画质感。" : family === "animation_2d" ? "不得生成真人照片、皮肤毛孔摄影或三维渲染。" : family === "animation_3d" ? "不得生成真人照片或二维线稿拼贴。" : family === "illustration" ? "不得生成真人照片或不一致的混合媒介。" : family === "handmade" ? "不得混入真人摄影或无关数字渲染。" : "不得混入真人照片或不一致媒介。";
    return `${positive}${restrictions}`;
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

export function isCreativeAssetReferenceUsage(usage: string | undefined) {
    return ["reference_input", "identity_reference", "wardrobe_reference", "composition_reference"].includes(usage || "");
}

function cleanImageDraftPrompt(kind: CreativeAssetKind, name: string, description: string, value: unknown) {
    const prompt = typeof value === "string" ? value.trim() : "";
    if (!prompt || prompt === description.trim()) return "";
    const subject = kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
    const generatedPrefixes = [`${subject}「${name}」的视觉设计参考。`, `为${subject}“${name}”制作可用于后续镜头保持一致性的设计图。`, `为${subject}「${name}」制作可用于后续镜头保持一致性的设计图。`];
    return generatedPrefixes.some((prefix) => prompt.startsWith(prefix)) ? "" : prompt;
}

function assertPrimaryVariants(payload: CreativeAssetPayload) {
    if (payload.primaryImageId && !payload.variants.some((item) => item.id === payload.primaryImageId && item.kind === "image" && !isCreativeAssetReferenceUsage(item.usage))) throw creativeAssetError(400, "CREATIVE_ASSET_INVALID_PRIMARY_IMAGE", "主设计图必须来自生成或上传的设计版本");
    if (payload.primaryAudioId && !payload.variants.some((item) => item.id === payload.primaryAudioId && item.kind === "audio" && !isCreativeAssetReferenceUsage(item.usage))) throw creativeAssetError(400, "CREATIVE_ASSET_INVALID_PRIMARY_AUDIO", "主音频必须来自生成的媒体版本");
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
