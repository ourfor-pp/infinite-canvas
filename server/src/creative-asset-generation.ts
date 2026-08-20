import { z } from "zod";

import { buildCreativeAssetPrompt, creativeAssetAudioMode, getCreativeAsset, isCreativeAssetReferenceUsage, isDirectorProject } from "./creative-assets.js";
import { createGeneration } from "./generation-service.js";
import { getAiGlobalSettings, listModelDefaults, listPublicModels, type AudioMode } from "./provider-service.js";
import { resolveCreativeAssetNodeInputs } from "./visual-styles.js";

const inputSchema = z.object({
    kind: z.enum(["image", "audio"]),
    revision: z.number().int().positive(),
    nodeId: z.string().trim().min(1).max(128).optional(),
    mediaRole: z.enum(["face_closeup", "body_front", "body_back"]).optional(),
    allowDraftStyle: z.boolean().default(false),
});

export type CreativeAssetGenerationPreview = ReturnType<typeof previewCreativeAssetGeneration>;

export function previewCreativeAssetGeneration(userId: string, assetId: string, raw: unknown) {
    const input = inputSchema.parse(raw);
    const asset = getCreativeAsset(userId, assetId);
    const directorProject = isDirectorProject(asset.projectId);
    const directorCharacter = asset.kind === "character" && directorProject;
    if (asset.revision !== input.revision) throw generationError(409, "CREATIVE_ASSET_CONFLICT", `创作资产版本已从 ${input.revision} 更新为 ${asset.revision}`, { current: asset });
    const draft = asset.payload.mediaDrafts[input.kind];
    const connected = resolveCreativeAssetNodeInputs(userId, asset.projectId, asset.id, input.nodeId);
    const variants = asset.payload.variants;
    const audioMode = creativeAssetAudioMode(asset.kind);
    const hasAudioReference = variants.some((item) => item.kind === "audio" && item.usage === "reference_input") || connected.audioReferences.length > 0;
    const audioOperation = audioMode === "speech" && hasAudioReference ? "clone" : "generate";
    const models = listPublicModels();
    const audioDefault = getAiGlobalSettings().audioDefaults[audioMode]?.[audioOperation];
    const modelRef = draft.model || (input.kind === "audio" && models.some((item) => item.value === audioDefault) ? audioDefault : listModelDefaults()[input.kind]);
    if (!modelRef) throw generationError(409, "AI_MODEL_NOT_CONFIGURED", `管理员尚未配置默认${input.kind === "image" ? "图片" : "音频"}模型`);
    const model = models.find((item) => item.value === modelRef && item.output === input.kind);
    if (!model) throw generationError(400, "AI_MODEL_NOT_AVAILABLE", "所选模型不存在、未启用或能力不匹配");

    const imageReferences = variants.filter((item) => item.kind === "image" && isCreativeAssetReferenceUsage(item.usage));
    const audioReferences = variants.filter((item) => item.kind === "audio" && item.usage === "reference_input");
    const candidateStyleReferenceFileId = (!connected.style?.boardStale && connected.style?.references?.board) || (directorProject ? null : connected.style?.references?.source) || null;
    const styleMediumFamily = connected.style?.dna.mediumFamily || "live_action";
    const styleReferenceFileId = directorCharacter && styleMediumFamily === "live_action" ? null : candidateStyleReferenceFileId;
    const supportsImageReferences = model.inputs.includes("image") && model.imageModes?.includes("edit") === true;
    const requestedSubjectReferences = [...imageReferences]
        .sort((left, right) => referencePriority(left.usage) - referencePriority(right.usage))
        .map((item) => ({ fileId: item.fileId, kind: "image" as const, source: "asset" as const, label: item.label || referenceUsageLabel(item.usage), purpose: item.usage || "reference_input" }));
    const requestedCompositionReferences = connected.imageReferences.map((item) => ({ ...item, kind: "image" as const, source: "canvas" as const }));
    const requestedImageReferences = dedupe([
        ...requestedSubjectReferences,
        ...(styleReferenceFileId ? [{ fileId: styleReferenceFileId, kind: "image" as const, source: "style" as const, label: "视觉风格参考", purpose: "style_reference" }] : []),
        ...requestedCompositionReferences,
    ]);
    let references = input.kind === "image"
        ? supportsImageReferences ? requestedImageReferences : []
        : dedupe([
            ...audioReferences.map((item) => ({ fileId: item.fileId, kind: "audio" as const, source: "asset" as const, label: item.label || "资产参考音频", transcript: item.transcript })),
            ...connected.audioReferences.map((item) => ({ ...item, kind: "audio" as const, source: "canvas" as const })),
        ]);
    const warnings: Array<{ code: string; message: string; blocking: boolean }> = [];
    const referenceLimit = input.kind === "image" ? model.maxReferenceImages : undefined;
    if (referenceLimit != null && references.length > referenceLimit) {
        references = references.slice(0, referenceLimit);
        warnings.push({ code: "AI_MODEL_REFERENCE_LIMIT", message: `所选模型最多接收 ${referenceLimit} 张参考图，已按主体、风格、构图顺序截取`, blocking: false });
    }
    const styleImageApplied = input.kind === "image" && references.some((item) => item.source === "style");
    const excludedReferences = directorCharacter && styleMediumFamily === "live_action" && candidateStyleReferenceFileId ? [{ fileId: candidateStyleReferenceFileId, source: "style" as const, label: "统一风格板", reason: "真人角色只使用风格文字，避免风格板示例面貌污染演员身份" }] : [];
    const requiredImageReferences = requestedSubjectReferences.length + requestedCompositionReferences.length;
    if ((input.kind === "image" ? requiredImageReferences : references.length) && (input.kind === "image" ? !supportsImageReferences : !model.inputs.includes(input.kind))) warnings.push({ code: "AI_MODEL_REFERENCE_UNSUPPORTED", message: `所选模型不支持${input.kind === "image" ? "图片" : "音频"}参考`, blocking: true });
    if (input.kind === "image" && styleReferenceFileId && !styleImageApplied) warnings.push({ code: "STYLE_IMAGE_NOT_APPLIED", message: "所选模型不支持风格参考图，本次只应用风格文字描述", blocking: false });
    if (input.kind === "image" && !directorProject && connected.style?.status === "draft" && !input.allowDraftStyle) warnings.push({ code: "VISUAL_STYLE_NOT_CONFIRMED", message: "当前视觉风格尚未确认；确认继续后仍可生成，但结果的一致性可能变化", blocking: true });
    if (input.kind === "image" && directorCharacter && !asset.payload.visualDescription.trim()) warnings.push({ code: "DIRECTOR_CHARACTER_VISUAL_DESCRIPTION_REQUIRED", message: "请先让 Agent 完成角色的纯视觉设定，再生成身份媒体", blocking: true });
    if (input.kind === "image" && directorCharacter && styleMediumFamily !== "live_action" && /(photorealistic|real-camera|真实相机|真人摄影|禁止插画)/i.test(asset.payload.visualDescription)) warnings.push({ code: "DIRECTOR_CHARACTER_STYLE_CONFLICT", message: "角色视觉设定混入了真人摄影媒介要求，请让 Agent 只保留脸型、体型、发型、服装和识别点", blocking: true });
    if (input.kind === "audio" && !(model.audioModes || ["speech"]).includes(audioMode as AudioMode)) warnings.push({ code: "AI_MODEL_AUDIO_MODE_UNSUPPORTED", message: `所选模型不支持${audioModeLabel(audioMode)}`, blocking: true });
    if (input.kind === "audio" && audioMode === "speech" && !draft.transcript?.trim()) warnings.push({ code: "CREATIVE_ASSET_TRANSCRIPT_REQUIRED", message: "请先填写试听台词", blocking: true });
    if (input.kind === "audio" && !references.length && !draft.prompt.trim()) warnings.push({ code: "CREATIVE_ASSET_AUDIO_PROMPT_REQUIRED", message: `没有参考音频时，请先填写${audioModeLabel(audioMode)}描述`, blocking: true });
    if (input.kind === "audio" && asset.kind === "character" && voiceGenderConflict(asset.payload.designProfile?.voiceGender, draft.prompt)) warnings.push({ code: "CREATIVE_ASSET_VOICE_GENDER_CONFLICT", message: "音色描述与角色设计画像中的声音性别冲突，请先修正设定", blocking: true });

    const basePrompt = input.kind === "image"
        ? buildCreativeAssetPrompt(asset, "image", [connected.style ? visualStyleText(connected.style, directorCharacter, asset.kind) : "", ...(directorCharacter ? [] : connected.texts), ...(directorCharacter ? [] : [draft.prompt])].filter(Boolean).join("\n\n"), model.imagePromptProfile || "generic", styleMediumFamily, input.mediaRole)
        : audioMode === "speech"
            ? draft.transcript?.trim() || ""
            : [draft.prompt, ...connected.texts].filter(Boolean).join("\n\n");
    const prompt = input.kind === "image" && directorCharacter && references.length
        ? `${basePrompt}\n\n[图片参考用途]\n${references.map((reference, index) => `图片 ${index + 1}：${referencePurposeInstruction("purpose" in reference ? String(reference.purpose) : "composition_reference")}。不得混合不同参考图片中的人物身份。`).join("\n")}`
        : basePrompt;
    const instructions = input.kind === "audio" && audioMode === "speech" ? draft.prompt.trim() : "";
    const characterMediaRole = directorCharacter ? input.mediaRole || "body_front" : undefined;
    const usage = input.kind === "image" ? characterMediaRole ? `${characterMediaRole}_reference` : "design_sheet" : audioMode === "speech" ? "voice_sample" : audioMode === "ambient" ? "environment_sound" : "prop_sound";
    const label = input.kind === "image" ? characterMediaRole === "face_closeup" ? "面部身份特写" : characterMediaRole === "body_back" ? "背面身体参考" : characterMediaRole === "body_front" ? "正面身体参考" : `${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}设计图` : audioMode === "speech" ? "角色声音" : audioMode === "ambient" ? "场景环境声" : "道具音效";
    const params = {
        ...draft.params,
        count: 1,
        ...(input.kind === "image" ? { size: model.imagePromptProfile === "gpt-image-2" ? directorCharacter ? "2560x1440" : "1536x1024" : "16:9", quality: model.imagePromptProfile === "gpt-image-2" || directorCharacter ? "high" : undefined, imagePromptProfile: model.imagePromptProfile || "generic" } : {}),
        ...(instructions ? { instructions } : {}),
        ...(input.kind === "audio" ? { audioMode, audioOperation } : {}),
        __creativeAsset: { projectId: asset.projectId, assetId: asset.id, nodeId: input.nodeId, usage, label, transcript: draft.transcript, assetRevision: asset.revision, audioMode: input.kind === "audio" ? audioMode : undefined },
        __promptPackage: input.kind === "image" ? { profile: model.imagePromptProfile || "generic", asset: { id: asset.id, revision: asset.revision, kind: asset.kind }, style: connected.style ? { id: connected.style.id, revision: connected.style.revision, mediumFamily: styleMediumFamily } : null, purpose: usage, references: references.map((reference) => ({ fileId: reference.fileId, source: reference.source, label: reference.label, purpose: "purpose" in reference ? reference.purpose : "composition_reference" })), excludedReferences, checks: asset.kind === "character" ? [characterMediaRole || "design_sheet", "identity_consistency", "anatomy", "cast_distinctiveness", "style_consistency", "plain_background", "no_text", ...(styleMediumFamily === "live_action" ? ["real_camera", "natural_skin"] : [])] : ["identity_consistency", "style_consistency", "no_text"] } : undefined,
        __visualStyle: connected.style ? { id: connected.style.id, revision: connected.style.revision, description: connected.style.description, referenceFileId: styleReferenceFileId, styleImageApplied } : null,
        __canvasInputs: { texts: connected.texts, imageFileIds: connected.imageFileIds, audioFileIds: connected.audioFileIds, imageReferences: connected.imageReferences, audioReferences: connected.audioReferences },
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
        style: connected.style ? { id: connected.style.id, revision: connected.style.revision, name: connected.style.name, description: connected.style.description, referenceFileId: styleReferenceFileId, imageApplied: styleImageApplied } : null,
        excludedReferences,
        canvasInputs: { texts: connected.texts, imageFileIds: connected.imageFileIds, audioFileIds: connected.audioFileIds, imageReferences: connected.imageReferences, audioReferences: connected.audioReferences },
        warnings,
        params,
    };
}

function referencePriority(usage: string | undefined) {
    return usage === "identity_reference" || usage === "reference_input" ? 0 : usage === "wardrobe_reference" ? 1 : 2;
}

function referenceUsageLabel(usage: string | undefined) {
    return usage === "wardrobe_reference" ? "服装参考" : usage === "composition_reference" ? "构图参考" : "身份参考";
}

function referencePurposeInstruction(usage: string) {
    if (usage === "style_reference") return "只继承媒介、线条或材质、色块、阴影层级和整体配色，绝不继承示例人物的面貌、体型、发型、服装或身份";
    if (usage === "wardrobe_reference") return "只锁定服装轮廓、结构、材质与配色，不继承人物面貌或体型";
    if (usage === "composition_reference") return "只参考版式与构图，不继承人物身份";
    return "只锁定授权人物的面貌、年龄感、肤色与体型身份，不复制背景、光线或服装";
}

function visualStyleText(style: NonNullable<ReturnType<typeof resolveCreativeAssetNodeInputs>["style"]>, characterMaster = false, assetKind: "character" | "scene" | "prop" = "character") {
    const dna = style.dna;
    if (characterMaster) return [
        `媒介分类：${dna.mediumFamily}`,
        dna.medium && `媒介：${dna.medium}`,
        (dna.characterRendering || dna.rendering) && `角色呈现：${dna.characterRendering || dna.rendering}`,
        dna.palette && `统一配色：${dna.palette}`,
        dna.texture && `材质表现：${dna.texture}`,
        dna.exclusions.length ? `风格排除：${dna.exclusions.join("、")}` : "",
    ].filter(Boolean).join("\n");
    const targetRendering = assetKind === "scene" ? dna.sceneRendering : assetKind === "prop" ? dna.propRendering : dna.characterRendering;
    return [
        `整片统一视觉风格：${style.description}`,
        `媒介分类：${dna.mediumFamily}`,
        dna.medium && `媒介：${dna.medium}`,
        (targetRendering || dna.rendering) && `${assetKind === "scene" ? "场景" : assetKind === "prop" ? "道具" : "角色"}呈现：${targetRendering || dna.rendering}`,
        dna.palette && `统一配色：${dna.palette}`,
        dna.texture && `材质表现：${dna.texture}`,
        dna.exclusions.length ? `风格排除：${dna.exclusions.join("、")}` : "",
    ].filter(Boolean).join("\n");
}

function voiceGenderConflict(expected: "female" | "male" | "androgynous" | "unspecified" | undefined, prompt: string) {
    if (!expected || expected === "unspecified" || expected === "androgynous") return false;
    const value = prompt.toLowerCase();
    const female = /(女性|女声|少女|老妇|woman|female)/.test(value);
    const male = /(男性|男声|少年|老者|man|male)/.test(value);
    return expected === "female" ? male && !female : female && !male;
}

export function createCreativeAssetGeneration(userId: string, assetId: string, raw: unknown) {
    const preview = previewCreativeAssetGeneration(userId, assetId, raw);
    const blocking = preview.warnings.find((warning) => warning.blocking);
    if (blocking) throw generationError(400, blocking.code, blocking.message);
    return createGeneration(userId, {
        kind: preview.kind,
        model: preview.model.value,
        prompt: preview.prompt,
        references: preview.references.map(({ fileId, kind, source, label, ...reference }) => ({ fileId, kind, source, label, ...("purpose" in reference && typeof reference.purpose === "string" ? { purpose: reference.purpose as "reference_input" | "identity_reference" | "wardrobe_reference" | "composition_reference" } : {}), ...("transcript" in reference && typeof reference.transcript === "string" ? { transcript: reference.transcript } : {}) })),
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
