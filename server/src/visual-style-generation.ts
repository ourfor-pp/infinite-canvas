import { z } from "zod";

import { createGeneration } from "./generation-service.js";
import { buildVisualStyleBoardPrompt } from "./visual-style-contract.js";
import { getVisualStyle } from "./visual-styles.js";
import { listModelDefaults, listPublicModels } from "./provider-service.js";

const inputSchema = z.object({
    revision: z.number().int().positive(),
});
const analysisSchema = z.object({ revision: z.number().int().positive() });

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
    return createGeneration(userId, {
        kind: "image",
        model: modelRef,
        prompt: buildVisualStyleBoardPrompt(style.name, style.description, style.dna),
        references: sourceReference,
        params: {
            size: "16:9",
            count: 1,
            __visualStyleBoard: { styleId: style.id, styleRevision: style.revision },
        },
    });
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
        prompt: `分析这张图片的视觉风格，只返回 JSON，不要 Markdown。字段必须是 description 和 dna；dna 必须包含 mediumFamily、medium、rendering、characterRendering、sceneRendering、propRendering、palette、lighting、contrast、texture、lensAndDepth、composition、postProcessing、exclusions。mediumFamily 只能是 live_action、animation_2d、animation_3d、illustration、handmade、graphic 之一。三个 Rendering 字段分别描述同一风格如何呈现角色、场景和道具；description 用一段可直接复用到生图提示词的中文描述。不要把具体人物面貌、地点、道具或故事情节写入风格。`,
        references: [{ fileId: style.references.source, kind: "image" }],
        params: { temperature: 0.2, __visualStyleAnalysis: { styleId: style.id, styleRevision: style.revision } },
    });
}

function styleGenerationError(status: number, code: string, message: string, details?: unknown) {
    return Object.assign(new Error(message), { status, code, details });
}
