import { MathUtils } from "three";
import type { PrevisPlan, PrevisScene, Vec3 } from "./model.js";

const lerp3 = (a: Vec3, b: Vec3, t: number) => a.map((v, i) => MathUtils.lerp(v, b[i], t)) as Vec3;
function pair<T extends { time: number }>(keys: T[], time: number): [T, T, number] {
    const next = keys.findIndex((key) => key.time > time);
    if (next === 0) return [keys[0], keys[0], 0];
    if (next < 0) return [keys[keys.length - 1], keys[keys.length - 1], 0];
    return [keys[next - 1], keys[next], (time - keys[next - 1].time) / (keys[next].time - keys[next - 1].time)];
}

// Absolute-time evaluation: seeking never depends on the previously rendered frame.
export function evaluatePrevis(scene: PrevisScene, plan: PrevisPlan, seconds: number) {
    const time = MathUtils.clamp(seconds, 0, plan.duration);
    const poses = Object.fromEntries(scene.objects.map((object) => {
        const initial = plan.initial[object.id] || { position: object.position, yaw: object.rotation[1] };
        const track = plan.tracks.find((item) => item.objectId === object.id);
        if (!track) return [object.id, initial];
        const keys = track.keys[0].time > 0 ? [{ ...initial, time: 0 }, ...track.keys] : track.keys;
        const [a, b, t] = pair(keys, time);
        const delta = MathUtils.euclideanModulo(b.yaw - a.yaw + Math.PI, Math.PI * 2) - Math.PI;
        return [object.id, { position: lerp3(a.position, b.position, t), yaw: a.yaw + delta * t }];
    }));
    const shot = plan.shots.find((item) => time >= item.start && time < item.end) || plan.shots[plan.shots.length - 1];
    const [a, b, t] = pair(shot.keys, time);
    const resolve = (key: typeof a, field: "position" | "target") => key.follow ? key[field].map((value, i) => value + poses[key.follow!].position[i]) as Vec3 : key[field];
    const attachments = new Map<string, PrevisPlan["attachments"][number]>();
    for (const event of [...plan.attachments].sort((x, y) => x.time - y.time)) if (event.time <= time) attachments.set(event.objectId, event);
    return { time, poses, shotId: shot.id, camera: { position: lerp3(resolve(a, "position"), resolve(b, "position"), t), target: lerp3(resolve(a, "target"), resolve(b, "target"), t), fov: MathUtils.lerp(a.fov, b.fov, t) },
        actions: plan.actions.filter((action) => time >= action.start && time < action.end), attachments,
        dialogue: plan.dialogue.filter((cue) => time >= cue.start && time < cue.end) };
}
