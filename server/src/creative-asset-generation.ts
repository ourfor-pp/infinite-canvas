import { z } from "zod";

import { buildCreativeAssetPrompt, creativeAssetAudioMode, getCreativeAsset } from "./creative-assets.js";
import { createGeneration } from "./generation-service.js";
import { listModelDefaults, listPublicModels, type AudioMode } from "./provider-service.js";
import { resolveCreativeAssetNodeInputs } from "./visual-styles.js";

const inputSchema = z.object({
    kind: z.enum(["image", "audio"]),
    revision: z.number().int().positive(),
    nodeId: z.string().trim().min(1).max(128).optional(),
});

export type CreativeAssetGenerationPreview = ReturnType<typeof previewCreativeAssetGeneration>;

export function previewCreativeAssetGeneration(userId: string, assetId: string, raw: unknown) {
    const input = inputSchema.parse(raw);
    const asset = getCreativeAsset(userId, assetId);
    if (asset.revision !== input.revision) throw generationError(409, "CREATIVE_ASSET_CONFLICT", `创作资产版本已从 ${input.revision} 更新为 ${asset.revision}`, { current: asset });
    const draft = asset.payload.mediaDrafts[input.kind];
    const modelRef = draft.model || listModelDefaults()[input.kind];
    if (!modelRef) throw generationError(409, "AI_MODEL_NOT_CONFIGURED", `管理员尚未配置默认${input.kind === "image" ? "图片" : "音频"}模型`);
    const model = listPublicModels().find((item) => item.value === modelRef && item.output === input.kind);
    if (!model) throw generationError(400, "AI_MODEL_NOT_AVAILABLE", "所选模型不存在、未启用或能力不匹配");

    const connected = resolveCreativeAssetNodeInputs(userId, asset.projectId, asset.id, input.nodeId);
    const variants = asset.payload.variants;
    const primaryImage = variants.find((item) => item.id === asset.payload.primaryImageId && item.kind === "image");
    const imageReferences = variants.filter((item) => item.kind === "image" && item.usage === "reference_input");
    const audioReferences = variants.filter((item) => item.kind === "audio" && item.usage === "reference_input");
    const audioMode = creativeAssetAudioMode(asset.kind);
    const styleImageApplied = input.kind === "image" && Boolean(connected.style?.referenceFileId && model.inputs.includes("image"));
    const references = input.kind === "image"
        ? dedupe([
            ...(styleImageApplied ? [{ fileId: connected.style!.referenceFileId!, kind: "image" as const, source: "style" as const, label: "视觉风格参考" }] : []),
            ...imageReferences.map((item) => ({ fileId: item.fileId, kind: "image" as const, source: "asset" as const, label: item.label || "资产参考图" })),
            ...connected.imageFileIds.map((fileId) => ({ fileId, kind: "image" as const, source: "canvas" as const, label: "画布参考图" })),
            ...(primaryImage && model.inputs.includes("image") ? [{ fileId: primaryImage.fileId, kind: "image" as const, source: "primary" as const, label: "当前主设计图" }] : []),
        ])
        : dedupe([
            ...audioReferences.map((item) => ({ fileId: item.fileId, kind: "audio" as const, source: "asset" as const, label: item.label || "资产参考音频" })),
            ...connected.audioFileIds.map((fileId) => ({ fileId, kind: "audio" as const, source: "canvas" as const, label: "画布参考音频" })),
        ]);
    const warnings: Array<{ code: string; message: string; blocking: boolean }> = [];
    if (references.length && !model.inputs.includes(input.kind)) warnings.push({ code: "AI_MODEL_REFERENCE_UNSUPPORTED", message: `所选模型不支持${input.kind === "image" ? "图片" : "音频"}参考`, blocking: true });
    if (input.kind === "image" && connected.style?.referenceFileId && !styleImageApplied) warnings.push({ code: "STYLE_IMAGE_NOT_APPLIED", message: "所选模型不支持图片输入，本次只应用风格文字描述", blocking: false });
    if (input.kind === "audio" && !(model.audioModes || ["speech"]).includes(audioMode as AudioMode)) warnings.push({ code: "AI_MODEL_AUDIO_MODE_UNSUPPORTED", message: `所选模型不支持${audioModeLabel(audioMode)}`, blocking: true });
    if (input.kind === "audio" && audioMode === "speech" && !draft.transcript?.trim()) warnings.push({ code: "CREATIVE_ASSET_TRANSCRIPT_REQUIRED", message: "请先填写试听台词", blocking: true });
    if (input.kind === "audio" && !references.length && !draft.prompt.trim()) warnings.push({ code: "CREATIVE_ASSET_AUDIO_PROMPT_REQUIRED", message: `没有参考音频时，请先填写${audioModeLabel(audioMode)}描述`, blocking: true });

    const prompt = input.kind === "image"
        ? buildCreativeAssetPrompt(asset, "image", [connected.style?.description ? `视觉风格：${connected.style.description}` : "", ...connected.texts, draft.prompt].filter(Boolean).join("\n\n"))
        : audioMode === "speech"
            ? draft.transcript?.trim() || ""
            : [draft.prompt, ...connected.texts].filter(Boolean).join("\n\n");
    const instructions = input.kind === "audio" && audioMode === "speech" ? draft.prompt.trim() : "";
    const usage = input.kind === "image" ? "design_sheet" : audioMode === "speech" ? "voice_sample" : audioMode === "ambient" ? "environment_sound" : "prop_sound";
    const label = input.kind === "image" ? `${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}设计图` : audioMode === "speech" ? "角色声音" : audioMode === "ambient" ? "场景环境声" : "道具音效";
    const params = {
        ...draft.params,
        ...(input.kind === "image" ? { size: "16:9" } : {}),
        ...(instructions ? { instructions } : {}),
        __creativeAsset: { projectId: asset.projectId, assetId: asset.id, nodeId: input.nodeId, usage, label, transcript: draft.transcript, assetRevision: asset.revision, audioMode: input.kind === "audio" ? audioMode : undefined },
        __visualStyle: connected.style ? { id: connected.style.id, revision: connected.style.revision, description: connected.style.description, referenceFileId: connected.style.referenceFileId, styleImageApplied } : null,
        __canvasInputs: { texts: connected.texts, imageFileIds: connected.imageFileIds, audioFileIds: connected.audioFileIds },
    };
    return {
        assetId: asset.id,
        assetRevision: asset.revision,
        kind: input.kind,
        audioMode: input.kind === "audio" ? audioMode : undefined,
        model: { value: model.value, name: model.name, providerName: model.providerName, inputs: model.inputs, audioModes: model.audioModes },
        prompt,
        instructions,
        references,
        style: connected.style ? { id: connected.style.id, revision: connected.style.revision, name: connected.style.name, description: connected.style.description, referenceFileId: connected.style.referenceFileId, imageApplied: styleImageApplied } : null,
        canvasInputs: { texts: connected.texts, imageFileIds: connected.imageFileIds, audioFileIds: connected.audioFileIds },
        warnings,
        params,
    };
}

export function createCreativeAssetGeneration(userId: string, assetId: string, raw: unknown) {
    const preview = previewCreativeAssetGeneration(userId, assetId, raw);
    const blocking = preview.warnings.find((warning) => warning.blocking);
    if (blocking) throw generationError(400, blocking.code, blocking.message);
    return createGeneration(userId, {
        kind: preview.kind,
        model: preview.model.value,
        prompt: preview.prompt,
        references: preview.references.map(({ fileId, kind }) => ({ fileId, kind })),
        params: preview.params,
    });
}

function dedupe<T extends { fileId: string }>(items: T[]) {
    const seen = new Set<string>();
    return items.filter((item) => seen.has(item.fileId) ? false : Boolean(seen.add(item.fileId)));
}

function audioModeLabel(mode: AudioMode) {
    return mode === "speech" ? "角色声音" : mode === "ambient" ? "环境声" : "道具音效";
}

function generationError(status: number, code: string, message: string, details?: unknown) {
    return Object.assign(new Error(message), { status, code, details });
}
