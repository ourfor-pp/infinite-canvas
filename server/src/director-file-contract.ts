import { z } from "zod";
import { h3AudioReferenceInput } from "./h3-prompt.js";

export const projectMediaPath = z.string().min(1).refine((path) => !path.startsWith("/") && !path.includes("\\") && !path.split("/").some((part) => !part || part === "." || part === "..") && !/^[a-z]+:/i.test(path), "必须使用工程根目录内的相对文件路径");
const id = z.string().min(1);
const reference = z.union([id, z.object({ id, variantId: id.optional() }).passthrough()]);
export const segmentFileSchema = z.object({
    id, kind: z.literal("video-segment"), sequenceId: id, order: z.number().int().positive(), durationSeconds: z.number().min(4).max(15),
    sourceSceneId: id.optional(), sourceBeatIds: z.array(id).optional(), sourceDurationSeconds: z.number().positive().optional(),
    dramaticBeat: z.string().optional(), openingState: z.string().optional(), endingState: z.string().optional(),
    boundary: z.enum(["cut", "continue"]).optional(), continuationFromSegmentId: id.optional(),
    generationIntent: z.enum(["storyboard", "transition"]).optional(), transitionFromSegmentId: id.optional(), transitionToSegmentId: id.optional(),
    h3VisualDescription: z.string().optional(), h3Soundscape: z.string().optional(), h3NonDiegeticMusic: z.string().optional(),
    references: z.object({ characters: z.array(reference).optional(), locations: z.array(reference).optional(), props: z.array(reference).optional() }).optional(),
    audioReferences: z.array(z.object({ path: projectMediaPath, purpose: h3AudioReferenceInput.shape.purpose, description: h3AudioReferenceInput.shape.description, speakerAssetId: h3AudioReferenceInput.shape.speakerAssetId }).superRefine((value, ctx) => { const result = h3AudioReferenceInput.safeParse({ ...value, fileId: value.path }); if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message }); })).max(3).optional(),
}).passthrough().superRefine((value, ctx) => {
    const required = value.generationIntent === "transition" ? ["transitionFromSegmentId", "transitionToSegmentId"] as const : value.boundary === "continue" ? ["continuationFromSegmentId"] as const : [];
    for (const field of required) if (!value[field] || value[field] === value.id) ctx.addIssue({ code: "custom", path: [field], message: "必须引用另一个视频段" });
});
const dialogue = z.object({ speakerAssetId: id, speakerName: id, text: id, language: id, delivery: id, startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(), offScreen: z.boolean().optional() }).refine((cue) => cue.endSeconds > cue.startSeconds, "对白结束时间必须晚于开始时间");
export const storyboardFileSchema = z.object({
    version: z.literal(1), segmentId: id, layout: z.enum(["2x2", "3x2", "3x3"]),
    frames: z.array(z.object({ id, position: z.number().int().nonnegative().optional(), shotNumber: z.number().int().min(1).max(3), timeSeconds: z.number().min(0).max(15), kind: z.enum(["shot-start", "keyframe", "shot-end"]), description: z.string(), action: z.string(), cameraAngle: z.string(), cameraMove: z.string(), h3Visual: z.string().optional(), dialogues: z.array(dialogue).max(8).optional(), sound: z.string(), dialogue: z.never().optional() })).max(9),
}).superRefine((board, ctx) => {
    if (board.frames.length !== ({ "2x2": 4, "3x2": 6, "3x3": 9 })[board.layout]) ctx.addIssue({ code: "custom", path: ["frames"], message: "画格数量必须与版式一致" });
    const ids = new Set<string>();
    board.frames.forEach((frame, index) => {
        if (index === 0 && (frame.shotNumber !== 1 || frame.kind !== "shot-start") || index === board.frames.length - 1 && frame.kind !== "shot-end") ctx.addIssue({ code: "custom", path: ["frames", index, "kind"], message: "第一格必须从 Shot 1 的 shot-start 开始，最后一格必须为 shot-end" });
        if (ids.has(frame.id)) ctx.addIssue({ code: "custom", path: ["frames", index, "id"], message: "画格 ID 重复" });
        ids.add(frame.id);
        if (index === 0 ? frame.timeSeconds !== 0 : frame.timeSeconds <= board.frames[index - 1].timeSeconds) ctx.addIssue({ code: "custom", path: ["frames", index, "timeSeconds"], message: "画格时间必须从 0 开始并严格递增" });
        if (index && (frame.shotNumber < board.frames[index - 1].shotNumber || frame.shotNumber > board.frames[index - 1].shotNumber + 1)) ctx.addIssue({ code: "custom", path: ["frames", index, "shotNumber"], message: "Shot 编号必须连续且不能回退" });
    });
});
export const timelineFileSchema = z.object({
    segmentOrder: z.array(id).optional(),
    tracks: z.array(z.object({ id, kind: z.enum(["dialogue", "narration", "ambient", "sfx", "music", "model-original"]), clips: z.array(z.object({ id, segmentId: id.optional(), path: projectMediaPath.optional(), fileId: z.never().optional(), start: z.number().nonnegative(), duration: z.number().positive(), trimIn: z.number().nonnegative().optional(), fadeIn: z.number().nonnegative().optional(), fadeOut: z.number().nonnegative().optional(), trimOut: z.number().nonnegative().optional(), volume: z.number().nonnegative().optional(), muted: z.boolean().optional(), loop: z.boolean().optional() }).superRefine((clip, ctx) => {
        for (const field of ["fadeIn", "fadeOut"] as const) if ((clip[field] || 0) > clip.duration) ctx.addIssue({ code: "custom", path: [field], message: "淡入淡出时长不能超过声音片段时长" });
    })) })).optional(),
}).strict().superRefine((timeline, ctx) => {
    const unique = (values: string[], path: (string | number)[]) => { if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", path, message: "ID 不得重复" }); };
    unique(timeline.segmentOrder || [], ["segmentOrder"]);
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
