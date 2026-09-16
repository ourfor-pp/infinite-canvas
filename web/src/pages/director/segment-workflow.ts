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
