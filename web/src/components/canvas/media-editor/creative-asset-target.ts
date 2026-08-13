import { useMemo } from "react";
import { App } from "antd";

import { randomId } from "@/lib/utils";
import { requestVisualStyleFocus } from "@/lib/canvas/canvas-ui-events";
import { serverApi, serverFileUrl, uploadServerFile } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCreativeAssetStore } from "@/stores/use-creative-asset-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";
import type { CreativeAsset, CreativeAssetKind, CreativeAssetVariant } from "@/types/creative-asset";
import type { VisualStyleTemplate } from "@/types/visual-style";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { MediaEditorDraft, MediaEditorReference, MediaEditorTarget } from "./types";

const META = {
    character: { label: "角色", image: "角色设计图", audio: "角色声音" },
    scene: { label: "场景", image: "场景设计图", audio: "环境声" },
    prop: { label: "道具", image: "道具设计图", audio: "道具音效" },
} satisfies Record<CreativeAssetKind, { label: string; image: string; audio: string }>;

type CreativeAssetMediaConnections = {
    references: CanvasResourceReference[];
    visualStyleId?: string;
    connect: (reference: CanvasResourceReference) => void;
    disconnect: (nodeId: string) => void;
    connectVisualStyle: (styleId: string, name: string) => void;
    disconnectVisualStyle: () => void;
};

export function useCreativeAssetMediaTarget(asset: CreativeAsset, nodeId: string, kind: "image" | "audio", connections: CreativeAssetMediaConnections, running?: { id: string; status: string; progress: number }): MediaEditorTarget {
    const { modal } = App.useApp();
    const config = useEffectiveConfig();
    const update = useCreativeAssetStore((state) => state.update);
    const generate = useCreativeAssetStore((state) => state.generate);
    const preview = useCreativeAssetStore((state) => state.previewGeneration);
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === asset.projectId));
    const styles = useVisualStyleStore((state) => state.styles);
    const meta = META[asset.kind];
    return useMemo(() => {
        const draft = asset.payload.mediaDrafts[kind];
        const assetReferences = asset.payload.variants.filter((item) => item.kind === kind && item.usage === "reference_input");
        const references: MediaEditorReference[] = assetReferences.map((item, index) => ({ id: item.id, label: item.label || `参考${kind === "image" ? "图" : "音频"}${index + 1}`, kind, url: serverFileUrl(`server:${item.fileId}`), source: "asset" as const }));
        references.push(...connections.references.filter((item) => item.kind === kind && item.active).map((item) => ({ id: `canvas:${item.nodeId}`, nodeId: item.nodeId, label: item.label, kind, url: item.previewUrl, source: "canvas" as const })));
        const primaryId = kind === "image" ? asset.payload.primaryImageId : asset.payload.primaryAudioId;
        const variants = asset.payload.variants.filter((item) => item.kind === kind && item.usage !== "reference_input").map((item) => ({ id: item.id, label: item.label, kind, url: serverFileUrl(`server:${item.fileId}`), prompt: item.prompt, primary: item.id === primaryId, review: item.review }));
        const linkedStyleId = connections.visualStyleId;
        const projectStyle = styles.find((item) => item.id === project?.defaultVisualStyleId);
        const style = styles.find((item) => item.id === linkedStyleId) || projectStyle;
        const saveDraft = async (next: MediaEditorDraft) => {
            const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
            await update(asset.id, { payload: { mediaDrafts: { [kind]: { ...current.payload.mediaDrafts[kind], ...next, model: next.model || null } } } });
        };
        return {
            key: `creative-asset:${asset.id}:${kind}`,
            kind,
            title: asset.name,
            semanticLabel: kind === "image" ? meta.image : meta.audio,
            imageMode: kind === "image" ? references.length ? "edit" : "generate" : undefined,
            allowEmptyPrompt: kind === "image",
            separateSpeechTranscript: kind === "audio" && asset.kind === "character",
            visualStyle: style ? { id: style.id, name: style.name, status: style.status, source: linkedStyleId ? "linked" : "default", templateId: style.templateId } : null,
            projectVisualStyle: projectStyle ? { id: projectStyle.id, name: projectStyle.name, status: projectStyle.status, templateId: projectStyle.templateId } : null,
            configureVisualStyle: kind === "image" ? () => requestVisualStyleFocus(style?.id) : undefined,
            selectVisualStyleTemplate: kind === "image" ? async (template: VisualStyleTemplate) => {
                const store = useVisualStyleStore.getState();
                const current = store.styles.find((item) => item.id === linkedStyleId);
                const patch = { name: template.name, mode: "template", templateId: template.id, description: template.description, dna: { ...template.dna, exclusions: [...template.dna.exclusions] }, status: "confirmed" as const };
                if (current) return void await store.update(current.id, patch);
                const created = await store.create(asset.projectId, patch);
                connections.connectVisualStyle(created.id, created.name);
            } : undefined,
            inheritProjectVisualStyle: kind === "image" && linkedStyleId ? async () => connections.disconnectVisualStyle() : undefined,
            snapshot: { draft: { ...draft, model: draft.model || "" }, references, variants, running },
            config,
            mentionReferences: connections.references.filter((item) => item.kind === kind),
            activateReference: connections.connect,
            removeReference: async (reference) => {
                if (reference.source === "canvas" && reference.nodeId) return connections.disconnect(reference.nodeId);
                const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
                await update(asset.id, { payload: { variants: current.payload.variants.filter((item) => item.id !== reference.id) } });
            },
            saveDraft,
            preview: () => preview(asset.id, { kind, nodeId }),
            generate: async () => {
                const sending = await preview(asset.id, { kind, nodeId });
                const draftStyle = sending.warnings.find((warning) => warning.code === "VISUAL_STYLE_NOT_CONFIRMED");
                if (!draftStyle) return generate(asset.id, { kind, nodeId });
                const proceed = await new Promise<boolean>((resolve) => modal.confirm({ title: "风格尚未确认", content: `${draftStyle.message}。你可以选择模板、上传参考图后分析，或交给 Agent 设计；完成后在风格卡点击“确认当前风格”。`, okText: "仍然生成", cancelText: "去配置风格", onOk: () => resolve(true), onCancel: () => { requestVisualStyleFocus(style?.id); resolve(false); } }));
                if (!proceed) return;
                return generate(asset.id, { kind, nodeId, allowDraftStyle: true });
            },
            stop: running ? async () => { await serverApi.cancelGeneration(running.id); } : undefined,
            uploadReference: async (file: File) => {
                const uploaded = await uploadServerFile(file, file.name);
                const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
                const referenceCount = current.payload.variants.filter((item) => item.kind === kind && item.usage === "reference_input").length;
                const variant: CreativeAssetVariant = { id: randomId(), kind, fileId: uploaded.fileId, label: `参考${kind === "image" ? "图" : "音频"}${referenceCount + 1}`, prompt: "", usage: "reference_input", createdAt: new Date().toISOString() };
                await update(asset.id, { payload: { variants: [...current.payload.variants, variant] } });
            },
            askAgent: async () => {
                const store = useAgentStore.getState();
                store.prepareComposer(asset.projectId, { kind: "asset", projectId: asset.projectId, assetId: asset.id, nodeId, title: asset.name, subtitle: `${meta.label} · ${kind === "image" ? "调图" : "调声音"}` });
                if (!store.drafts[asset.projectId]?.trim()) store.setDraft(asset.projectId, `请优化“${asset.name}”的${kind === "image" ? "设计图提示词" : meta.audio + "描述"}，保留当前设定的一致性。`);
            },
        } satisfies MediaEditorTarget;
    }, [asset, config, connections, generate, kind, meta.audio, meta.image, meta.label, modal, nodeId, preview, project, running, styles, update]);
}
