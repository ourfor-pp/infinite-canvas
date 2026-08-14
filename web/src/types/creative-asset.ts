export type CreativeAssetKind = "character" | "scene" | "prop";
export type CreativeAssetStatus = "draft" | "confirmed" | "locked";
export type CreativeAssetAudioMode = "speech" | "ambient" | "sfx";
export type CreativeAssetMediaDraft = {
    prompt: string;
    model: string | null;
    params: Record<string, unknown>;
    audioMode?: CreativeAssetAudioMode;
    transcript?: string;
};
export type CharacterDesignProfile = { apparentGender: "female" | "male" | "androgynous" | "unspecified"; voiceGender: "female" | "male" | "androgynous" | "unspecified"; ageBand: string; identityAnchor: string; uncertainties: string[] };

export const CREATIVE_ASSET_NODE_LAYOUT = {
    character: { width: 420, height: 540, title: "角色" },
    scene: { width: 420, height: 540, title: "场景" },
    prop: { width: 420, height: 540, title: "道具" },
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
    review?: { status: "pending_review" | "approved" | "rejected"; source: "automatic" | "manual"; summary?: string; issues?: string[]; metrics?: Record<string, boolean | number | string>; reviewedAt?: string; reviewGenerationId?: string };
    createdAt: string;
};

export type CreativeAssetPayload = {
    description: string;
    narrativeDescription: string;
    visualDescription: string;
    designProfile: CharacterDesignProfile | null;
    variants: CreativeAssetVariant[];
    primaryImageId: string | null;
    primaryAudioId: string | null;
    mediaDrafts: { image: CreativeAssetMediaDraft; audio: CreativeAssetMediaDraft };
    dependencies?: { style?: { id: string; revision: number } | null };
    needsReview?: boolean;
    staleReason?: string;
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
