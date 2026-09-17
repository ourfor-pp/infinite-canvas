import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100);
const number = z.number().finite();
export const vec3 = z.tuple([number, number, number]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const transform = z.object({ position: vec3, yaw: number.default(0) }).strict();
export const sceneSchema = z.object({
    version: z.literal(1), id, name: z.string().min(1).max(200), order: z.number().int().positive().default(1), summary: z.string().max(10000).default(""),
    objects: z.array(z.object({
        id, name: z.string().min(1).max(200), assetId: id.optional(),
        kind: z.enum(["human", "animal", "quadruped", "box", "sphere", "ground", "slope", "platform", "bridge"]),
        position: vec3, rotation: vec3.default([0, 0, 0]), size: vec3.default([1, 1, 1]),
        color: color.default("#94a3b8"), height: number.min(.1).max(30).default(1.7),
        build: number.min(.3).max(3).default(1), ears: number.min(0).max(1).default(.15), tail: number.min(0).max(2).default(0),
    }).strict()).max(200),
}).strict();
const cameraKey = z.object({ time: number.min(0), position: vec3, target: vec3, fov: number.min(10).max(120).default(45), follow: id.optional() }).strict();
export const previsSchema = z.object({
    version: z.literal(1), segmentId: id, duration: number.positive().max(3600),
    initial: z.record(id, transform),
    tracks: z.array(z.object({ objectId: id, keys: z.array(transform.extend({ time: number.min(0) })).min(1).max(2000) }).strict()).max(200).default([]),
    actions: z.array(z.object({
        id, objectId: id, kind: z.enum(["stand", "walk", "run", "turn", "look", "raise", "point", "hold", "give", "touch"]),
        start: number.min(0), end: number.positive(), phaseSeconds: number.min(0).optional(), side: z.enum(["left", "right"]).default("right"), target: id.optional(),
    }).strict()).max(2000).default([]),
    attachments: z.array(z.object({ time: number.min(0), objectId: id, parentId: id.nullable(), hand: z.enum(["left", "right"]).default("right"), offset: vec3.default([0, 0, 0]), position: vec3.optional() }).strict()).max(2000).default([]),
    shots: z.array(z.object({ id, name: z.string().min(1).max(200), start: number.min(0), end: number.positive(), keys: z.array(cameraKey).min(1).max(2000) }).strict()).min(1).max(200),
    dialogue: z.array(z.object({ id, objectId: id.optional(), start: number.min(0), end: number.positive(), text: z.string().max(4000) }).strict()).max(1000).default([]),
}).strict();
export type PrevisAssetReference = { objectIds: string[]; name: string; assetId?: string; variantId?: string; fileId?: string; status: "ready" | "unbound" | "missing-image"; reason?: string };
export type PrevisScene = z.infer<typeof sceneSchema>;
export type PrevisPlan = z.infer<typeof previsSchema>;
export type Vec3 = z.infer<typeof vec3>;
export type PrevisObject = PrevisScene["objects"][number];
export const isActor = (object: PrevisObject) => ["human", "animal", "quadruped"].includes(object.kind);

export function parsePrevis(sceneInput: unknown, planInput: unknown) {
    const scene = sceneSchema.parse(sceneInput), plan = previsSchema.parse(planInput);
    const errors: string[] = [], objects = new Map(scene.objects.map((object) => [object.id, object]));
    const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) errors.push(`${label} ID 重复`); };
    unique(scene.objects.map((o) => o.id), "对象"); unique(plan.tracks.map((t) => t.objectId), "轨迹");
    unique(plan.actions.map((a) => a.id), "动作"); unique(plan.shots.map((s) => s.id), "镜头"); unique(plan.dialogue.map((d) => d.id), "对白");
    const known = (value: string) => { if (!objects.has(value)) errors.push(`对象不存在：${value}`); };
    const interval = (start: number, end: number) => { if (end <= start || end > plan.duration) errors.push(`时间区间越界：${start}–${end}`); };
    for (const object of scene.objects) {
        if (object.size.some((value) => value <= 0)) errors.push(`对象尺寸必须为正：${object.id}`);
        if (isActor(object) && !plan.initial[object.id]) errors.push(`角色缺少显式初始状态：${object.id}`);
    }
    Object.keys(plan.initial).forEach(known);
    for (const track of plan.tracks) {
        known(track.objectId);
        track.keys.forEach((key, i) => { if (key.time > plan.duration || (i > 0 && key.time <= track.keys[i - 1].time)) errors.push(`轨迹时间无序或越界：${track.objectId}`); });
    }
    for (const action of plan.actions) {
        known(action.objectId); if (action.target) known(action.target); interval(action.start, action.end);
        if (!objects.get(action.objectId) || !isActor(objects.get(action.objectId)!)) errors.push(`动作主体必须是角色：${action.objectId}`);
        if (["look", "point", "give", "touch"].includes(action.kind) && !action.target) errors.push(`动作缺少目标：${action.id}`);
    }
    const attachedAt = new Set<string>();
    for (const event of plan.attachments) {
        known(event.objectId);
        if (event.time > plan.duration) errors.push("附着时间越界");
        const key = `${event.objectId}:${event.time}`;
        if (attachedAt.has(key)) errors.push(`同一时刻重复附着：${key}`);
        attachedAt.add(key);
        if (isActor(objects.get(event.objectId) || {} as PrevisObject)) errors.push("不能将角色附着到手部");
        if (event.parentId) {
            known(event.parentId);
            if (!objects.get(event.parentId) || !isActor(objects.get(event.parentId)!)) errors.push("附着父对象必须是角色");
        } else if (!event.position) errors.push("放下道具必须指定世界坐标");
    }
    plan.shots.forEach((shot, i) => {
        interval(shot.start, shot.end);
        if (shot.start !== (i ? plan.shots[i - 1].end : 0)) errors.push("镜头必须从零开始连续覆盖分镜段");
        if (shot.keys[0].time !== shot.start) errors.push(`镜头首关键帧必须位于镜头起点：${shot.id}`);
        shot.keys.forEach((key, k) => {
            if (key.follow) known(key.follow);
            if (key.time < shot.start || key.time > shot.end || (k > 0 && key.time <= shot.keys[k - 1].time)) errors.push(`摄影关键帧无序或越界：${shot.id}`);
            if (key.position.every((v, axis) => v === key.target[axis])) errors.push(`摄影机位置不能等于目标：${shot.id}`);
        });
    });
    if (plan.shots.at(-1)!.end !== plan.duration) errors.push("末镜头必须覆盖到分镜段结束");
    for (const cue of plan.dialogue) { if (cue.objectId) known(cue.objectId); interval(cue.start, cue.end); }
    if (errors.length) throw new Error(errors.join("；"));
    return { scene, plan };
}
