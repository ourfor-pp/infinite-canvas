import { z } from "zod";
import { h3AudioReferenceInput } from "./h3-prompt.js";

export const projectMediaPath = z.string().min(1).refine((path) => !path.startsWith("/") && !path.includes("\\") && !path.split("/").some((part) => !part || part === "." || part === "..") && !/^[a-z]+:/i.test(path), "必须使用工程根目录内的相对文件路径");
const id = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(128);
const reference = z.union([id, z.object({ id, variantId: id.optional() }).passthrough()]);
export const segmentRangeSchema = z.object({ segmentId: id, start: z.number().nonnegative(), end: z.number().positive() }).strict().refine((range) => range.end > range.start, "制作范围结束时间必须晚于开始时间");
export const videoReferenceSchema = z.object({ path: projectMediaPath, purpose: z.string().min(1), sourceHash: z.string().optional(), segmentId: id.optional(), start: z.number().nonnegative().optional(), end: z.number().positive().optional(), includeAudio: z.boolean().default(false) }).strict();
export const segmentFileSchema = z.object({
    id, kind: z.literal("production-task"), sequenceId: id, order: z.number().int().positive(), durationSeconds: z.number().positive(),
    segmentRanges: z.array(segmentRangeSchema).min(1), referenceImages: z.array(projectMediaPath).default([]), videoReferences: z.array(videoReferenceSchema).max(3).default([]),
    sourceSceneId: id.optional(), sourceBeatIds: z.array(id).optional(), sourceDurationSeconds: z.number().positive().optional(),
    dramaticBeat: z.string().optional(), openingState: z.string().optional(), endingState: z.string().optional(),
    boundary: z.enum(["cut", "continue"]).optional(), continuationFromSegmentId: id.optional(),
    generationIntent: z.enum(["reference", "transition"]).optional(), transitionFromSegmentId: id.optional(), transitionToSegmentId: id.optional(),
    h3VisualDescription: z.string().optional(), h3Soundscape: z.string().optional(), h3NonDiegeticMusic: z.string().optional(),
    references: z.object({ characters: z.array(reference).optional(), locations: z.array(reference).optional(), props: z.array(reference).optional() }).optional(),
    audioReferences: z.array(z.object({ path: projectMediaPath, purpose: h3AudioReferenceInput.shape.purpose, description: h3AudioReferenceInput.shape.description, speakerAssetId: h3AudioReferenceInput.shape.speakerAssetId }).superRefine((value, ctx) => { const result = h3AudioReferenceInput.safeParse({ ...value, fileId: value.path }); if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message }); })).max(3).optional(),
}).passthrough().superRefine((value, ctx) => {
    const required = value.generationIntent === "transition" ? ["transitionFromSegmentId", "transitionToSegmentId"] as const : value.boundary === "continue" ? ["continuationFromSegmentId"] as const : [];
    for (const field of required) if (!value[field] || value[field] === value.id) ctx.addIssue({ code: "custom", path: [field], message: "必须引用另一个视频段" });
});
export const timelineFileSchema = z.object({
    videoClips: z.array(z.object({ id, taskId: id, trimIn: z.number().nonnegative(), trimOut: z.number().positive(), linkedAudio: z.boolean().default(true) }).refine((clip) => clip.trimOut > clip.trimIn, "出点必须晚于入点")).default([]),
    tracks: z.array(z.object({ id, kind: z.enum(["dialogue", "narration", "ambient", "sfx", "music", "model-original"]), clips: z.array(z.object({ id, taskId: id.optional(), path: projectMediaPath.optional(), fileId: z.never().optional(), start: z.number().nonnegative(), duration: z.number().positive(), trimIn: z.number().nonnegative().optional(), fadeIn: z.number().nonnegative().optional(), fadeOut: z.number().nonnegative().optional(), trimOut: z.number().nonnegative().optional(), volume: z.number().nonnegative().optional(), muted: z.boolean().optional(), loop: z.boolean().optional() }).superRefine((clip, ctx) => {
        for (const field of ["fadeIn", "fadeOut"] as const) if ((clip[field] || 0) > clip.duration) ctx.addIssue({ code: "custom", path: [field], message: "淡入淡出时长不能超过声音片段时长" });
    })) })).optional(),
}).strict().superRefine((timeline, ctx) => {
    const unique = (values: string[], path: (string | number)[]) => { if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", path, message: "ID 不得重复" }); };
    unique(timeline.videoClips.map((clip) => clip.id), ["videoClips"]);
    unique((timeline.tracks || []).map((track) => track.id), ["tracks"]);
    unique((timeline.tracks || []).flatMap((track) => track.clips.map((clip) => clip.id)), ["tracks"]);
});

const screenplayBeat = z.object({ id: id, summary: z.string().trim().min(1).max(2_000), estimatedSeconds: z.number().int().min(1).max(3_600) });
export const screenplayScene = z.object({
    id, heading: z.string().trim().min(1).max(500), title: z.string().trim().min(1).max(300),
    location: z.string().trim().min(1).max(300), timeOfDay: z.string().trim().min(1).max(100),
    interiorExterior: z.enum(["interior", "exterior", "mixed"]), characterNames: z.array(z.string().trim().min(1).max(200)).max(100),
    propNames: z.array(z.string().trim().min(1).max(200)).max(100), openingState: z.string().max(2_000), endingState: z.string().max(2_000),
    dramaticTurn: z.string().max(2_000), requiredDialogue: z.array(z.string().trim().min(1).max(2_000)).max(100),
    beats: z.array(screenplayBeat).min(1).max(100), estimatedSeconds: z.number().int().min(1).max(86_400),
});
export const screenplayReviewIssue = z.object({
    type: z.enum(["duration", "repetition", "causality", "scene_function", "coverage"]),
    sceneIds: z.array(id).max(100), summary: z.string().trim().min(1).max(2_000), suggestion: z.string().trim().min(1).max(2_000),
});

export const segmentDesignFileSchema = z.object({
    id, kind: z.literal("segment-design"), name: z.string().min(1), sequenceId: id, order: z.number().int().positive(),
    sourceSceneId: id.optional(), sourceBeatIds: z.array(id).default([]), estimatedSeconds: z.number().positive().optional(),
    purpose: z.string().default(""), staging: z.string().default(""), camera: z.string().default(""),
    action: z.string().default(""), dialogue: z.string().default(""), sound: z.string().default(""),
    openingState: z.string().default(""), endingState: z.string().default(""), connection: z.string().default(""),
    referenceImages: z.array(projectMediaPath).default([]), previsMode: z.enum(["required", "skip"]).default("required"),
}).passthrough();
export type ShotDesignFile = z.infer<typeof segmentDesignFileSchema>;
export type ProductionTaskFile = z.infer<typeof segmentFileSchema>;
export type DirectorEdit = z.infer<typeof timelineFileSchema>;
