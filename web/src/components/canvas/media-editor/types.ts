import type { AiConfig, AudioMode } from "@/stores/use-config-store";
import type { CreativeAssetGenerationPreview } from "@/services/api/server";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type MediaEditorKind = "image" | "audio";
export type MediaEditorDraft = { prompt: string; model: string; params: Record<string, unknown>; audioMode?: AudioMode; transcript?: string };
export type MediaEditorReference = { id: string; label: string; kind: MediaEditorKind; url?: string; source: "asset" | "canvas" | "style"; nodeId?: string };
export type MediaEditorVariant = { id: string; label: string; kind: MediaEditorKind; url: string; prompt?: string; primary?: boolean; reference?: boolean; review?: { status: "pending_review" | "approved" | "rejected"; summary?: string; issues?: string[] } };
export type MediaEditorSnapshot = {
    draft: MediaEditorDraft;
    references: MediaEditorReference[];
    variants: MediaEditorVariant[];
    running?: { status: string; progress: number };
};

export type MediaEditorTarget = {
    key: string;
    kind: MediaEditorKind;
    title: string;
    semanticLabel: string;
    imageMode?: "generate" | "edit";
    allowEmptyPrompt?: boolean;
    separateSpeechTranscript?: boolean;
    visualStyle?: { id: string; name: string; status: "draft" | "confirmed"; source: "linked" | "default" } | null;
    configureVisualStyle?: () => void;
    snapshot: MediaEditorSnapshot;
    config: AiConfig;
    mentionReferences?: CanvasResourceReference[];
    activateReference?: (reference: CanvasResourceReference) => Promise<void> | void;
    removeReference?: (reference: MediaEditorReference) => Promise<void> | void;
    saveDraft: (draft: MediaEditorDraft) => Promise<void> | void;
    generate: (draft: MediaEditorDraft) => Promise<void> | void;
    stop?: () => Promise<void> | void;
    preview?: (draft: MediaEditorDraft) => Promise<CreativeAssetGenerationPreview | { prompt: string; instructions?: string }>;
    uploadReference?: (file: File) => Promise<void>;
    setPrimary?: (variantId: string) => Promise<void> | void;
    reviewVariant?: (variantId: string, accepted: boolean, setPrimary?: boolean) => Promise<void> | void;
    askAgent?: (draft: MediaEditorDraft) => Promise<void> | void;
    updateConfig?: (key: keyof AiConfig, value: string) => void;
};
