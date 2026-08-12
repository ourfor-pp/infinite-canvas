export type CreativeAssetKind = "character" | "scene" | "prop";
export type CreativeAssetStatus = "draft" | "confirmed" | "locked";

export const CREATIVE_ASSET_NODE_LAYOUT = {
    character: { width: 420, height: 690, title: "角色" },
    scene: { width: 420, height: 500, title: "场景" },
    prop: { width: 420, height: 500, title: "道具" },
} satisfies Record<CreativeAssetKind, { width: number; height: number; title: string }>;

export function isCreativeAssetNodeType(type: string): type is CreativeAssetKind {
    return type === "character" || type === "scene" || type === "prop";
}

export type CreativeAssetVariant = {
    id: string;
    kind: "image" | "audio";
    fileId: string;
    label: string;
    prompt: string;
    generationId?: string;
    usage?: string;
    transcript?: string;
    createdAt: string;
};

export type CreativeAssetPayload = {
    description: string;
    voiceDescription: string;
    voiceSampleText: string;
    variants: CreativeAssetVariant[];
    primaryImageId: string | null;
    primaryAudioId: string | null;
    imageModel: string | null;
    audioModel: string | null;
};

export type CreativeAsset = {
    id: string;
    projectId: string;
    kind: CreativeAssetKind;
    name: string;
    status: CreativeAssetStatus;
    payload: CreativeAssetPayload;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type CreativeAssetReference = { projectId: string; assetId: string; nodeId?: string };

export type CreativeAssetSnapshot = Pick<CreativeAsset, "kind" | "name" | "status" | "payload">;
