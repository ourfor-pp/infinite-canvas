import type { DirectorVideoSegment } from "@/types/director";
import type { CreativeAssetKind } from "@/types/creative-asset";

export const assetKinds = ["character", "scene", "prop"] as const;
export const assetKindLabels = { character: "角色", scene: "场景", prop: "道具" };
export const assetRefKeys = { character: "characterRefs", scene: "sceneRefs", prop: "propRefs" } as const;

export function segmentAssetRefs(segment: DirectorVideoSegment) {
    return assetKinds.flatMap((kind) => (segment.payload[assetRefKeys[kind]] || []).map((ref) => ({ ...ref, kind })));
}

export function segmentAssetRef(segment: DirectorVideoSegment, kind: CreativeAssetKind, id: string) {
    return segment.payload[assetRefKeys[kind]]?.find((ref) => ref.id === id);
}

export function segmentShots(segment: DirectorVideoSegment) {
    const frames = [...(segment.payload.storyboardSheet?.frames || [])].sort((a, b) => a.position - b.position);
    const groups: Array<{ number: number; start: number; end: number; frames: typeof frames }> = [];
    for (const frame of frames) {
        let group = groups.at(-1);
        if (!group || group.number !== frame.shotNumber) {
            if (group) group.end = frame.timeSeconds;
            group = { number: frame.shotNumber, start: frame.timeSeconds, end: segment.payload.durationSeconds || 4, frames: [] };
            groups.push(group);
        }
        group.frames.push(frame);
    }
    return groups;
}
