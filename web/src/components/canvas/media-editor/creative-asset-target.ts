import { useMemo } from "react";

import { randomId } from "@/lib/utils";
import { serverApi, serverFileUrl, uploadServerFile } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCreativeAssetStore } from "@/stores/use-creative-asset-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type { CreativeAsset, CreativeAssetKind, CreativeAssetVariant } from "@/types/creative-asset";
import type { MediaEditorDraft, MediaEditorReference, MediaEditorTarget } from "./types";

const META = {
    character: { label: "角色", image: "角色设计图", audio: "角色声音" },
    scene: { label: "场景", image: "场景设计图", audio: "环境声" },
    prop: { label: "道具", image: "道具设计图", audio: "道具音效" },
} satisfies Record<CreativeAssetKind, { label: string; image: string; audio: string }>;

export function useCreativeAssetMediaTarget(asset: CreativeAsset, nodeId: string, kind: "image" | "audio", connected: { images: number; audios: number }, running?: { id: string; status: string; progress: number }): MediaEditorTarget {
    const config = useEffectiveConfig();
    const update = useCreativeAssetStore((state) => state.update);
    const generate = useCreativeAssetStore((state) => state.generate);
    const preview = useCreativeAssetStore((state) => state.previewGeneration);
    const setPrimary = useCreativeAssetStore((state) => state.setPrimary);
    const meta = META[asset.kind];
    return useMemo(() => {
        const draft = asset.payload.mediaDrafts[kind];
        const references: MediaEditorReference[] = asset.payload.variants.filter((item) => item.kind === kind && item.usage === "reference_input").map((item) => ({ id: item.id, label: item.label || (kind === "image" ? "参考图" : "参考音频"), kind, url: serverFileUrl(`server:${item.fileId}`), source: "asset" as const }));
        const linked = kind === "image" ? connected.images : connected.audios;
        for (let index = 0; index < linked; index += 1) references.push({ id: `canvas-${kind}-${index}`, label: kind === "image" ? "画布参考图" : "画布参考音频", kind, source: "canvas" });
        const primaryId = kind === "image" ? asset.payload.primaryImageId : asset.payload.primaryAudioId;
        const variants = asset.payload.variants.filter((item) => item.kind === kind && item.usage !== "reference_input").map((item) => ({ id: item.id, label: item.label, kind, url: serverFileUrl(`server:${item.fileId}`), prompt: item.prompt, primary: item.id === primaryId }));
        const saveDraft = async (next: MediaEditorDraft) => {
            const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
            await update(asset.id, { payload: { mediaDrafts: { [kind]: { ...current.payload.mediaDrafts[kind], ...next, model: next.model || null } } } });
        };
        return {
            key: `creative-asset:${asset.id}:${kind}`,
            kind,
            title: asset.name,
            semanticLabel: kind === "image" ? meta.image : meta.audio,
            allowEmptyPrompt: kind === "image",
            separateSpeechTranscript: kind === "audio" && asset.kind === "character",
            snapshot: { draft: { ...draft, model: draft.model || "" }, references, variants, running },
            config,
            saveDraft,
            preview: () => preview(asset.id, { kind, nodeId }),
            generate: () => generate(asset.id, { kind, nodeId }),
            stop: running ? async () => { await serverApi.cancelGeneration(running.id); } : undefined,
            uploadReference: async (file: File) => {
                const uploaded = await uploadServerFile(file, file.name);
                const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
                const variant: CreativeAssetVariant = { id: randomId(), kind, fileId: uploaded.fileId, label: kind === "image" ? "参考图" : "参考音频", prompt: "", usage: "reference_input", createdAt: new Date().toISOString() };
                await update(asset.id, { payload: { variants: [...current.payload.variants, variant] } });
            },
            setPrimary: (variantId: string) => setPrimary(asset.id, variantId),
            askAgent: async () => {
                const store = useAgentStore.getState();
                store.prepareComposer(asset.projectId, { kind: "asset", projectId: asset.projectId, assetId: asset.id, nodeId, title: asset.name, subtitle: `${meta.label} · ${kind === "image" ? "调图" : "调声音"}` });
                if (!store.drafts[asset.projectId]?.trim()) store.setDraft(asset.projectId, `请优化“${asset.name}”的${kind === "image" ? "设计图提示词" : meta.audio + "描述"}，保留当前设定的一致性。`);
            },
        } satisfies MediaEditorTarget;
    }, [asset, config, connected.audios, connected.images, generate, kind, meta.audio, meta.image, meta.label, nodeId, preview, running, setPrimary, update]);
}
