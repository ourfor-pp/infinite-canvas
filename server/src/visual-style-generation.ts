import { z } from "zod";

import { createGeneration } from "./generation-service.js";
import { getVisualStyle, type VisualStyleReferenceRole } from "./visual-styles.js";
import { listModelDefaults, listPublicModels } from "./provider-service.js";

const inputSchema = z.object({
    revision: z.number().int().positive(),
    roles: z.array(z.enum(["character", "scene", "prop"])).min(1).max(3).default(["character", "scene", "prop"]),
});
const analysisSchema = z.object({ revision: z.number().int().positive() });

const roleRequirements: Record<Exclude<VisualStyleReferenceRole, "source">, string> = {
    character: "生成一张不对应任何具体故事角色的风格样张：同一虚构人物的胸像与全身造型，严格纯白无影背景，无文字、无标注。重点展示画风、用色、光影、线条和材质。",
    scene: "生成一张不对应任何具体故事的空场景风格样张：清晰空间层次与代表性光影，严格无人、无文字、无标注。重点展示环境渲染、色彩、镜头和质感。",
    prop: "生成一张不对应任何具体故事的通用道具风格样张：单件中性道具的多角度展示，严格纯白无影背景，无人物、无文字、无标注。重点展示材质、轮廓和渲染语言。",
};

export function createVisualStyleReferences(userId: string, styleId: string, raw: unknown) {
    const input = inputSchema.parse(raw);
    const style = getVisualStyle(userId, styleId);
    if (style.revision !== input.revision) throw styleGenerationError(409, "VISUAL_STYLE_CONFLICT", `视觉风格版本已从 ${input.revision} 更新为 ${style.revision}`, { current: style });
    const modelRef = listModelDefaults().image;
    if (!modelRef) throw styleGenerationError(409, "AI_MODEL_NOT_CONFIGURED", "管理员尚未配置默认图片模型");
    const model = listPublicModels().find((item) => item.value === modelRef && item.output === "image");
    if (!model) throw styleGenerationError(400, "AI_MODEL_NOT_AVAILABLE", "默认图片模型不存在、未启用或能力不匹配");
    const acceptsStyleReference = model.inputs.includes("image") && model.maxReferenceImages !== 0;
    const sourceReference = style.references.source && acceptsStyleReference ? [{ fileId: style.references.source, kind: "image" as const }] : [];
    return input.roles.map((role) => createGeneration(userId, {
        kind: "image",
        model: modelRef,
        prompt: [
            `视觉风格「${style.name}」参考样张。`,
            style.description,
            roleRequirements[role],
            `统一排除：${style.dna.exclusions.join("、") || "水印、Logo、文字、边框、UI、故事情节"}。`,
        ].filter(Boolean).join("\n\n"),
        references: sourceReference,
        params: {
            size: "16:9",
            __visualStyleReference: { styleId: style.id, styleRevision: style.revision, role },
        },
    }));
}

export function createVisualStyleAnalysis(userId: string, styleId: string, raw: unknown) {
    const input = analysisSchema.parse(raw);
    const style = getVisualStyle(userId, styleId);
    if (style.revision !== input.revision) throw styleGenerationError(409, "VISUAL_STYLE_CONFLICT", `视觉风格版本已从 ${input.revision} 更新为 ${style.revision}`, { current: style });
    if (!style.references.source) throw styleGenerationError(400, "VISUAL_STYLE_SOURCE_REQUIRED", "请先上传一张风格来源图");
    const modelRef = listModelDefaults().text;
    const model = listPublicModels().find((item) => item.value === modelRef && item.output === "text" && item.inputs.includes("image"));
    if (!modelRef || !model) throw styleGenerationError(409, "VISION_MODEL_NOT_CONFIGURED", "请将支持图片输入的文本模型设为默认文本模型");
    return createGeneration(userId, {
        kind: "text",
        model: modelRef,
        prompt: `分析这张图片的视觉风格，只返回 JSON，不要 Markdown。字段必须是 description 和 dna；dna 必须包含 medium、rendering、palette、lighting、contrast、texture、lensAndDepth、composition、postProcessing、exclusions。description 用一段可直接复用到生图提示词的中文描述；不要描述具体人物、地点、道具或故事情节。`,
        references: [{ fileId: style.references.source, kind: "image" }],
        params: { temperature: 0.2, __visualStyleAnalysis: { styleId: style.id, styleRevision: style.revision } },
    });
}

function styleGenerationError(status: number, code: string, message: string, details?: unknown) {
    return Object.assign(new Error(message), { status, code, details });
}
