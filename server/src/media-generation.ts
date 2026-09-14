import { nanoid } from "nanoid";
import { z } from "zod";
import { createGeneration } from "./generation-service.js";
import { resolveSelectableModel } from "./provider-service.js";
import { executorComfyModels, validateMediaGeneration } from "./media-capabilities.js";

export const mediaGenerationShape = {
    kind: z.enum(["video", "audio"]),
    model: z.string().min(1),
    mode: z.string().min(1),
    operation: z.string().min(1).default("generate"),
    prompt: z.string().min(1).max(200_000),
    params: z.record(z.string(), z.unknown()).default({}).refine((value) => !Object.keys(value).some((key) => key.startsWith("__") || ["baseUrl", "apiKey", "authToken", "headers", "script"].includes(key)), "仅接受媒体能力参数"),
    references: z.array(z.object({ fileId: z.string().min(1), kind: z.enum(["image", "video", "audio"]), role: z.enum(["reference", "first-frame", "last-frame", "continuation"]).optional(), frameIndex: z.number().int().min(-1).optional(), includeAudio: z.boolean().optional(), transcript: z.string().max(20_000).optional() })).max(12).default([]),
    continuation: z.object({ generationId: z.string().min(1), fileId: z.string().min(1) }).optional(),
};
export const mediaGenerationSchema = z.object(mediaGenerationShape);

export async function prepareMediaGeneration(userId: string, input: unknown) {
    const request = mediaGenerationSchema.parse(input);
    const selection = resolveSelectableModel(request.model, request.kind);
    if (selection.providerId !== "local-media" && !(selection.comfyServerId === "media-executor" && executorComfyModels.has(selection.modelId))) throw Object.assign(new Error("所选模型不属于媒体能力执行器"), { status: 400, code: "MEDIA_MODEL_UNSUPPORTED" });
    const id = nanoid();
    const { plan } = await validateMediaGeneration(userId, id, selection.modelId, request);
    request.params = { ...request.params, seed: plan.seed, ...(plan.recipe ? { recipe: plan.recipe } : {}) };
    return { id, request, plan };
}

export async function createMediaGeneration(userId: string, input: unknown, projectId?: string) {
    const { id, request, plan } = await prepareMediaGeneration(userId, input);
    return { ...createGeneration(userId, { ...request, ...(projectId ? { metadata: { mediaProjectId: projectId } } : {}) }, id), plan };
}
