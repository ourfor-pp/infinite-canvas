import { z } from "zod";

import { type AiGenerationRequest } from "./ai-adapters.js";
import { creativeAssetPayloadSchema, listCreativeAssets } from "./creative-assets.js";
import { db, parseJson } from "./database.js";
import { createGeneration } from "./generation-service.js";
import { getAiGlobalSettings } from "./provider-service.js";

export type DirectorCastReview = {
    projectId: string;
    assetRevisions: Record<string, number>;
    status: "running" | "passed" | "needs_review" | "manual";
    stale: boolean;
    summary: string;
    characters: Array<{ assetId: string; realismIssues: string[]; identityStrengths: string[] }>;
    pairs: Array<{ assetIds: [string, string]; similarityRisk: "low" | "medium" | "high"; overlappingFeatures: string[]; suggestions: string[] }>;
    generationId: string | null;
    createdAt: string;
    updatedAt: string;
};

type CastReviewRow = {
    project_id: string;
    user_id: string;
    status: DirectorCastReview["status"];
    summary: string;
    asset_revisions: string;
    characters: string;
    pairs: string;
    generation_id: string | null;
    created_at: string;
    updated_at: string;
};

const resultSchema = z.object({
    passed: z.boolean(),
    summary: z.string().max(4_000),
    characters: z.array(z.object({ assetId: z.string(), realismIssues: z.array(z.string().max(500)).max(30).default([]), identityStrengths: z.array(z.string().max(500)).max(30).default([]) })).max(200),
    pairs: z.array(z.object({ assetIds: z.tuple([z.string(), z.string()]), similarityRisk: z.enum(["low", "medium", "high"]), overlappingFeatures: z.array(z.string().max(500)).max(30).default([]), suggestions: z.array(z.string().max(500)).max(30).default([]) })).max(2_000),
});

export function getDirectorCastReview(userId: string, projectId: string): DirectorCastReview | null {
    assertDirector(userId, projectId);
    const row = db.prepare("SELECT * FROM director_cast_reviews WHERE user_id=? AND project_id=?").get(userId, projectId) as CastReviewRow | undefined;
    return row ? castReviewResponse(row, currentCharacterRevisions(userId, projectId)) : null;
}

export function startDirectorCastReview(userId: string, projectId: string) {
    assertDirector(userId, projectId);
    const assets = listCreativeAssets(userId, projectId).filter((asset) => asset.kind === "character");
    const reviewable = assets.flatMap((asset) => {
        const payload = creativeAssetPayloadSchema.parse(asset.payload);
        const variant = payload.variants.find((item) => item.kind === "image" && item.id === payload.primaryImageId);
        return variant ? [{ asset, payload, fileId: variant.fileId }] : [];
    });
    if (!reviewable.length) throw castReviewError(409, "DIRECTOR_CAST_REVIEW_NO_IMAGES", "至少需要一张角色主图才能进行阵容检查");
    const assetRevisions = Object.fromEntries(assets.map((asset) => [asset.id, asset.revision]));
    const model = getAiGlobalSettings().config.creativeAssetReviewModel.trim();
    if (!model) {
        saveReview(userId, projectId, { status: "manual", summary: "未配置图片输入质检模型，请人工检查角色真人感和阵容差异", assetRevisions, characters: assets.map((asset) => ({ assetId: asset.id, realismIssues: [], identityStrengths: [] })), pairs: [], generationId: null });
        return getDirectorCastReview(userId, projectId)!;
    }
    const prompt = buildReviewPrompt(reviewable.map(({ asset, payload }, index) => ({ index: index + 1, assetId: asset.id, name: asset.name, profile: payload.designProfile })));
    const request: AiGenerationRequest = {
        kind: "text",
        model,
        prompt,
        references: reviewable.map(({ fileId }) => ({ fileId, kind: "image" })),
        params: { __directorCastReview: { projectId, assetRevisions } },
    };
    const generation = createGeneration(userId, request);
    saveReview(userId, projectId, { status: "running", summary: "正在检查角色真人感与全剧差异", assetRevisions, characters: [], pairs: [], generationId: generation.id });
    return getDirectorCastReview(userId, projectId)!;
}

export function syncDirectorCastReviewGeneration(row: { id: string; user_id: string; status: string; request: string; result: string | null; error?: string | null }) {
    const request = parseJson<{ params?: { __directorCastReview?: { projectId?: string; assetRevisions?: Record<string, number> } } }>(row.request, {});
    const target = request.params?.__directorCastReview;
    if (!target?.projectId || !target.assetRevisions || !["succeeded", "failed", "canceled"].includes(row.status)) return;
    const current = db.prepare("SELECT generation_id FROM director_cast_reviews WHERE user_id=? AND project_id=?").get(row.user_id, target.projectId) as { generation_id: string | null } | undefined;
    if (current?.generation_id !== row.id) return;
    if (row.status !== "succeeded") {
        saveReview(row.user_id, target.projectId, { status: "manual", summary: row.error || "自动阵容检查失败，请人工检查", assetRevisions: target.assetRevisions, characters: [], pairs: [], generationId: row.id });
        return;
    }
    const text = String(parseJson<{ text?: string }>(row.result, {}).text || "");
    const parsed = parseResult(text, new Set(Object.keys(target.assetRevisions)));
    saveReview(row.user_id, target.projectId, parsed
        ? { status: parsed.passed ? "passed" : "needs_review", summary: parsed.summary, assetRevisions: target.assetRevisions, characters: parsed.characters, pairs: parsed.pairs, generationId: row.id }
        : { status: "manual", summary: "自动阵容检查结果无法解析，请人工检查", assetRevisions: target.assetRevisions, characters: [], pairs: [], generationId: row.id });
}

function buildReviewPrompt(items: Array<{ index: number; assetId: string; name: string; profile: unknown }>) {
    return `你是严谨的真人影视选角与角色设定图质检员。按输入图片顺序检查以下角色：\n${items.map((item) => `图片 ${item.index}：assetId=${item.assetId}；显示名=${item.name}；选角设定=${JSON.stringify(item.profile || {})}`).join("\n")}\n\n逐人检查：单张图内是否恰好四个完整等高全身视图；身份、年龄、体型、发型和服装是否一致；是否有塑料皮肤、过度磨皮、偶像脸、图库模特或 CGI 感；是否呈现真实毛孔、年龄纹理、自然轻微不对称和设定中的身份锚点。\n再进行全剧两两比较：脸型骨相、五官比例、年龄、发际线与发型、肤色质感、体态、姿态和服装剪影是否过度重合。不要因为相同性别、服装时代或统一摄影风格就误判为撞脸。\n只输出 JSON：{"passed":boolean,"summary":string,"characters":[{"assetId":string,"realismIssues":string[],"identityStrengths":string[]}],"pairs":[{"assetIds":[string,string],"similarityRisk":"low|medium|high","overlappingFeatures":string[],"suggestions":string[]}]}。assetId 必须原样使用，不得输出角色姓名代替。`;
}

function parseResult(value: string, allowedIds: Set<string>) {
    try {
        const json = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsed = resultSchema.parse(JSON.parse(json));
        if (parsed.characters.some((item) => !allowedIds.has(item.assetId)) || parsed.pairs.some((item) => item.assetIds.some((id) => !allowedIds.has(id)))) return null;
        return parsed;
    } catch { return null; }
}

function saveReview(userId: string, projectId: string, value: Omit<DirectorCastReview, "projectId" | "stale" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO director_cast_reviews(project_id,user_id,status,summary,asset_revisions,characters,pairs,generation_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,user_id) DO UPDATE SET status=excluded.status,summary=excluded.summary,asset_revisions=excluded.asset_revisions,characters=excluded.characters,pairs=excluded.pairs,generation_id=excluded.generation_id,updated_at=excluded.updated_at`)
        .run(projectId, userId, value.status, value.summary, JSON.stringify(value.assetRevisions), JSON.stringify(value.characters), JSON.stringify(value.pairs), value.generationId, now, now);
}

function castReviewResponse(row: CastReviewRow, revisions: Record<string, number>): DirectorCastReview {
    const assetRevisions = parseJson<Record<string, number>>(row.asset_revisions, {});
    return {
        projectId: row.project_id,
        assetRevisions,
        status: row.status,
        stale: JSON.stringify(assetRevisions) !== JSON.stringify(revisions),
        summary: row.summary,
        characters: parseJson(row.characters, []),
        pairs: parseJson(row.pairs, []),
        generationId: row.generation_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function currentCharacterRevisions(userId: string, projectId: string) {
    return Object.fromEntries(listCreativeAssets(userId, projectId).filter((asset) => asset.kind === "character").map((asset) => [asset.id, asset.revision]));
}

function assertDirector(userId: string, projectId: string) {
    if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId)) throw castReviewError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在或无权访问");
}

function castReviewError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}
