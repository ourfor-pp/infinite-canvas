import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getStoredFile } from "./file-store.js";

import { h3StateContextSchema, type H3StateContext } from "./h3-state-context.js";
export { h3StateContextSchema, type H3StateContext } from "./h3-state-context.js";
const runtimeKeys = ["modelRevision", "videoVaeRevision", "audioVaeRevision", "width", "height", "fps"] as const;
export type H3RuntimeIdentity = Pick<H3StateContext, typeof runtimeKeys[number]>;
export async function isSameH3OwnedMedia(userId: string, left: string, right: string) {
    if (!getStoredFile(userId, left) || !getStoredFile(userId, right)) return false;
    return left === right || await ownedHash(userId, left) === await ownedHash(userId, right);
}
const bindingSchema = z.object({
    projectId: z.string().min(1), segmentId: z.string().min(1), generationId: z.string().min(1),
    videoFileId: z.string().min(1), fileId: z.string().min(1),
    videoSha256: z.string().regex(/^[a-f0-9]{64}$/), stateSha256: z.string().regex(/^[a-f0-9]{64}$/), context: h3StateContextSchema,
}).strict();

const cumulativeSchema = z.object({ fileId: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), generationId: z.string().min(1), stateSha256: z.string().regex(/^[a-f0-9]{64}$/), frames: z.number().int().positive() }).strict();

export async function createH3CumulativeBinding(userId: string, fileId: string, state: z.infer<typeof bindingSchema>) {
    const file = getStoredFile(userId, fileId);
    if (!file) throw stateError("累计音视频不存在或无权访问");
    await validateH3NativeVideo(file.path, state.context, 0);
    return cumulativeSchema.parse({ fileId, sha256: await ownedHash(userId, fileId), generationId: state.generationId, stateSha256: state.stateSha256, frames: state.context.frames });
}

export async function resolveDirectorH3Cumulative(userId: string, projectId: string, segmentId: string) {
    const read = () => db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, segmentId) as { payload: string } | undefined;
    const row = read();
    const payload = parseJson<Record<string, unknown>>(row?.payload || "{}", {});
    const expected = bindingSchema.parse(payload.h3ContinuationState);
    const state = await resolveDirectorH3Continuation(userId, projectId, segmentId, expected.context);
    const media = cumulativeSchema.parse(payload.h3CumulativeVideo);
    const generation = db.prepare("SELECT result FROM generations WHERE user_id=? AND id=?").get(userId, state.generationId) as { result: string | null };
    const result = parseJson<{ cumulativeVideos?: Array<{ fileId?: string }> }>(generation.result || "{}", {});
    if (media.generationId !== state.generationId || media.stateSha256 !== state.stateSha256 || media.frames !== state.context.frames || !result.cumulativeVideos?.some((file) => file.fileId === media.fileId) || await ownedHash(userId, media.fileId) !== media.sha256 || read()?.payload !== row?.payload) throw stateError("累计音视频与当前状态或来源生成不一致");
    const snapshots = [{ segmentId, payload: row!.payload }];
    const chain = [{ segmentId: state.segmentId, generationId: state.generationId, frames: state.context.frames }];
    let current = state;
    for (;;) {
        const source = db.prepare("SELECT request FROM generations WHERE user_id=? AND id=?").get(userId, current.generationId) as { request: string };
        const request = parseJson<{ params?: { __h3PreviousFrames?: number; __h3PreviousState?: unknown } }>(source.request, {});
        if (!request.params?.__h3PreviousState) {
            if (Number(request.params?.__h3PreviousFrames || 0) !== 0) throw stateError("累计音视频的首段来源帧数无效");
            break;
        }
        const previous = bindingSchema.parse(request.params.__h3PreviousState);
        if (previous.projectId !== projectId || previous.context.frames >= current.context.frames || request.params.__h3PreviousFrames !== previous.context.frames || chain.some((item) => item.segmentId === previous.segmentId)) throw stateError("累计音视频来源链无效");
        const priorRow = db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, previous.segmentId) as { payload: string } | undefined;
        if (!priorRow) throw stateError("累计音视频的前段不存在");
        snapshots.push({ segmentId: previous.segmentId, payload: priorRow.payload });
        current = await verifyRequestedH3Continuation(userId, previous, state.context);
        chain.unshift({ segmentId: current.segmentId, generationId: current.generationId, frames: current.context.frames });
    }
    if (snapshots.some((snapshot) => (db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, snapshot.segmentId) as { payload: string } | undefined)?.payload !== snapshot.payload)) throw stateError("累计音视频校验期间内容发生变化");
    return { ...media, context: state.context, chain };

}

async function ownedHash(userId: string, fileId: string) {
    const file = getStoredFile(userId, fileId);
    if (!file) throw stateError("续接状态或来源视频不存在，或无权访问");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file.path)) hash.update(chunk);
    return hash.digest("hex");
}

export async function createH3ContinuationBinding(userId: string, input: Omit<z.infer<typeof bindingSchema>, "videoSha256" | "stateSha256">) {
    const [videoSha256, stateSha256] = await Promise.all([ownedHash(userId, input.videoFileId), ownedHash(userId, input.fileId)]);
    return bindingSchema.parse({ ...input, videoSha256, stateSha256 });
}

export async function resolveDirectorH3Continuation(userId: string, projectId: string, segmentId: string, runtime: H3RuntimeIdentity) {
    const read = () => db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, segmentId) as { payload: string } | undefined;
    const row = read();
    if (!row) throw stateError("续接来源视频段不存在，或不属于当前项目");
    const payload = parseJson<Record<string, unknown>>(row.payload, {});
    const parsed = bindingSchema.safeParse(payload.h3ContinuationState);
    if (!parsed.success) throw stateError("前段缺少有效原生续接状态，请先用支持状态保存的模型生成前段");
    const binding = parsed.data;
    if (binding.projectId !== projectId || binding.segmentId !== segmentId || typeof payload.videoFileId !== "string" || binding.generationId !== payload.videoGenerationId || payload.videoStale) throw stateError("来源视频已变化，原生续接状态已失效");
    const generation = db.prepare("SELECT status,request,result FROM generations WHERE user_id=? AND id=?").get(userId, binding.generationId) as { status: string; request: string; result: string | null } | undefined;
    const request = parseJson<{ params?: { __directorSegment?: { projectId?: string; segmentId?: string }; __h3StateContext?: unknown } }>(generation?.request || "{}", {});
    const result = parseJson<{ continuationStates?: Array<{ fileId?: string }> }>(generation?.result || "{}", {});
    const context = h3StateContextSchema.safeParse(request.params?.__h3StateContext);
    if (generation?.status !== "succeeded" || request.params?.__directorSegment?.projectId !== projectId || request.params?.__directorSegment?.segmentId !== segmentId || !result.continuationStates?.some((file) => file.fileId === binding.fileId) || !context.success || Object.keys(context.data).some((key) => context.data[key as keyof H3StateContext] !== binding.context[key as keyof H3StateContext])) throw stateError("原生续接状态与来源生成记录不一致");
    if (runtimeKeys.some((key) => runtime[key] !== binding.context[key])) throw stateError("原生续接的模型、VAE、分辨率或帧率与前段不一致");
    const [videoHash, stateHash] = await Promise.all([ownedHash(userId, payload.videoFileId as string), ownedHash(userId, binding.fileId)]);
    if (videoHash !== binding.videoSha256 || stateHash !== binding.stateSha256 || read()?.payload !== row.payload) throw stateError("续接校验期间来源视频或状态发生变化");
    return { ...binding, videoFileId: payload.videoFileId as string };
}

function stateError(message: string) { return Object.assign(new Error(message), { status: 409, code: "DIRECTOR_H3_STATE_INVALID" }); }

export async function validateH3NativeVideo(path: string, context: H3StateContext, previousFrames: number) {
    if (!Number.isInteger(previousFrames) || previousFrames < 0 || previousFrames >= context.frames || (previousFrames !== 0 && previousFrames % 17 !== 5)) throw stateError("原生续接的来源帧数无效");
    const { stdout } = await promisify(execFile)("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,nb_read_frames", "-of", "json", path], { timeout: 60_000 });
    const streams = JSON.parse(stdout).streams as Array<{ codec_type: string; width?: number; height?: number; avg_frame_rate?: string; nb_read_frames?: string }>;
    const video = streams.find((stream) => stream.codec_type === "video");
    if (!video || video.width !== context.width || video.height !== context.height || video.avg_frame_rate !== "24/1" || Number(video.nb_read_frames) !== context.frames - previousFrames || !streams.some((stream) => stream.codec_type === "audio")) throw stateError("原生续接输出的画幅、帧数、帧率或音轨与保存状态不一致");
    return (context.frames - previousFrames) / 24;
}

export async function verifyRequestedH3Continuation(userId: string, previous: unknown, context: H3StateContext) {
    const requested = bindingSchema.parse(previous);
    const current = await resolveDirectorH3Continuation(userId, requested.projectId, requested.segmentId, context);
    if (current.generationId !== requested.generationId || current.fileId !== requested.fileId || current.stateSha256 !== requested.stateSha256 || current.videoSha256 !== requested.videoSha256) throw stateError("排队或生成期间续接来源已被替换，请重新生成当前段");
    return current;
}
