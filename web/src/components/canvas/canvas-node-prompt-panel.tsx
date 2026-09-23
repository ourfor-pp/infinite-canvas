import { videoDefaults, videoRequestParams, videoReferenceRole, validateVideoInput } from "../../../../server/src/video-contract";
import { imageContractForMode, imageDefaults } from "../../../../server/src/image-contract";
import { audioDefaults } from "../../../../server/src/audio-contract";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, LoaderCircle, Maximize2, Square } from "lucide-react";
import { App, Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, getAvailableModel, resolveModelForCapability, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasPromptChipInput, type CanvasPromptInputHandle } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useMissingModelNotice } from "@/hooks/use-missing-model-notice";
import { MediaEditor, ReferenceShelf } from "./media-editor/media-editor";
import type { MediaEditorTarget } from "./media-editor/types";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    generationProgress?: MediaEditorTarget["snapshot"]["running"];
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, audioConfig?: Partial<AiConfig>) => void;
    onStop: (nodeId: string) => void;
    onUploadReference?: (nodeId: string, kind: "image" | "audio", file: File) => Promise<void>;
    onRemoveReference?: (connectionId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onActivateReference?: (reference: CanvasResourceReference) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
    projectId?: string;
};

export function CanvasNodePromptPanel({ node, isRunning, generationProgress, onPromptChange, onConfigChange, onGenerate, onStop, onUploadReference, onRemoveReference, onActivateReference, mentionReferences = [], onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const promptRef = useRef<CanvasPromptInputHandle>(null);
    const uploadRef = useRef<HTMLInputElement>(null);
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useMissingModelNotice();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const imageMode = mentionReferences.some((item) => item.kind === "image" && item.active) ? "edit" : "generate";
    const config = buildNodeConfig(globalConfig, node, mode, imageMode);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const videoContract = mode === "video" ? getAvailableModel(config.model)?.videoContract : undefined;
    let imageIndex = 0;
    const videoErrors = mode === "video" ? videoContract ? validateVideoInput(videoContract, prompt, videoRequestParams(videoContract, config), mentionReferences.filter(r => r.active && r.kind !== "text").map(r => ({ kind: r.kind, role: videoReferenceRole(videoContract, r.kind, r.kind === "image" ? imageIndex++ : 0) }))) : ["当前模型缺少视频输入定义"] : [];
    const videoMentions = mentionReferences.map(item => ({ ...item, label: `@${item.label}` }));
    const videoReferences = videoMentions.filter(item => item.active && item.kind !== "text");
    const removeVideoReference = (id: string) => {
        const removed = videoReferences.find(item => item.id === id);
        if (!removed?.connectionId) return;
        const counts = new Map<string, number>();
        const labels = new Map(videoReferences.map(item => {
            if (item.id === id) return [item.label, ""];
            const index = (counts.get(item.kind) || 0) + 1;
            counts.set(item.kind, index);
            return [item.label, item.label.replace(/\d+$/, String(index))];
        }));
        const escaped = [...labels.keys()].sort((a, b) => b.length - a.length).map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        updatePrompt(prompt.replace(new RegExp(`(?:${escaped.join("|")})(?!\\d)`, "g"), label => labels.get(label)!));
        onRemoveReference?.(removed.connectionId);
    };
    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning || videoErrors.length) return;
        onGenerate(node.id, mode, text, mode === "video" ? config : undefined);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    if (mode === "image" || mode === "audio") {
        const primaryImageId = node.metadata?.primaryImageId || node.metadata?.images?.[0]?.id;
        const rawImageContract = mode === "image" ? getAvailableModel(config.model)?.imageContract : undefined;
        const imageContract = rawImageContract ? imageContractForMode(rawImageContract, imageMode === "edit") : undefined;
        const audioContract = mode === "audio" ? getAvailableModel(config.model)?.audioContract : undefined;
        const mediaTarget: MediaEditorTarget = {
            key: `canvas-node:${node.id}:${mode}`,
            kind: mode,
            title: node.title,
            semanticLabel: mode === "image" ? (hasImageContent ? "调整图片" : "生成图片") : "生成音频",
            imageMode: mode === "image" ? imageMode : undefined,
            config,
            mentionReferences: mode === "image" ? mentionReferences.map((item) => ({ ...item, label: `@${item.label}` })) : mentionReferences,
            activateReference: onActivateReference,
            snapshot: {
                draft: { prompt, model: config.model, params: mode === "audio" ? node.metadata?.audioParams || (audioContract ? audioDefaults(audioContract) : {}) : { ...(imageContract ? { ...imageDefaults(imageContract), count: Math.min(Number(config.count) || 1, imageContract.maxCount) } : {}), ...metadataParams(node), count: 1 }, operation: node.metadata?.audioOperation || audioContract?.operations[0], referenceInputs: node.metadata?.audioReferenceInputs },
                references: mentionReferences.filter((item) => item.active && item.kind === mode).map((item) => ({ id: item.id, nodeId: item.nodeId, label: mode === "image" ? `@${item.label}` : item.title, kind: mode, url: item.previewUrl, durationMs: item.durationMs, source: "canvas", removable: Boolean(item.connectionId) })),
                variants: mode === "image" ? (node.metadata?.images || []).filter((item) => item.content).map((item) => ({ id: item.id, label: item.prompt || node.title, kind: "image", url: item.content, prompt: item.prompt, primary: item.id === primaryImageId })) : node.metadata?.content ? [{ id: node.id, label: node.title, kind: "audio", url: node.metadata.content, primary: true }] : [],
                running: isRunning ? generationProgress || { status: "running" } : undefined,
            },
            saveDraft: (draft) => {
                setPrompt(draft.prompt);
                onConfigChange(node.id, { composerContent: draft.prompt, model: draft.model, ...(mode === "audio" ? { audioParams: draft.params, audioOperation: draft.operation, audioReferenceInputs: draft.referenceInputs } : draft.params) });
            },
            generate: (draft) => onGenerate(node.id, mode, draft.prompt, mode === "audio" ? { model: draft.model, audioParams: draft.params, audioOperation: draft.operation, audioReferenceInputs: draft.referenceInputs } : { model: draft.model, size: String(draft.params.size ?? config.size), quality: String(draft.params.quality ?? config.quality), background: String(draft.params.background ?? config.background), count: "1" }),
            stop: () => onStop(node.id),
            removeReference: onRemoveReference ? (reference) => {
                const connectionId = mentionReferences.find((item) => item.id === reference.id)?.connectionId;
                if (connectionId) onRemoveReference(connectionId);
            } : undefined,
            uploadReference: onUploadReference ? (file) => onUploadReference(node.id, mode, file) : undefined,
        };
        return <div data-canvas-no-zoom className="w-full rounded-[20px] border p-4 shadow-2xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}><MediaEditor target={mediaTarget} /></div>;
    }

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {mode === "video" ? <ReferenceShelf flat references={videoReferences.map(item => ({ id: item.id, nodeId: item.nodeId, kind: item.kind as "image" | "video" | "audio", label: item.label, url: item.previewUrl, source: "canvas", removable: Boolean(item.connectionId) }))}
                onInsert={reference => { const mention = videoMentions.find(item => item.id === reference.id); if (mention) promptRef.current?.insertReference(mention); }}
                onRemove={reference => removeVideoReference(reference.id)}
                uploadControl={onUploadReference && (!videoContract || videoContract.maxImages > 0) ? <button type="button" aria-label="上传参考图" className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-current/20 opacity-60 hover:opacity-100" onClick={() => uploadRef.current?.click()}><Plus className="size-5" /></button> : null} /> : null}
            <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={event => {
                const files = Array.from(event.target.files || []); event.currentTarget.value = "";
                void (async () => { try { for (const file of files) await onUploadReference?.(node.id, "image", file); } catch (error) { message.error(error instanceof Error ? error.message : "上传参考图失败"); } })();
            }} />
            <CanvasPromptChipInput
                ref={promptRef}
                textReferences={mode === "video"}
                onActivateReference={onActivateReference}
                value={prompt}
                references={mode === "video" ? videoMentions : mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")} />
                    </Tooltip>
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => { const c = getAvailableModel(model)?.videoContract; const d = c ? videoDefaults(c) : undefined; onConfigChange(node.id, { model, ...(d ? { size: d.size, seconds: d.videoSeconds, vquality: d.vquality, generateAudio: d.videoGenerateAudio, watermark: d.videoWatermark } : {}) }); }} capability="video" appearance="toolbar" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-9 !max-w-[240px] !justify-start !rounded-lg !px-2.5" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasTextSettingsPopover config={config} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} />
                        </>
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && (!prompt.trim() || videoErrors.length > 0)}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate")}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">{t("canvas.promptPanel.stop")}</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
            {videoErrors.length ? <div role="status" className="mt-2 text-xs opacity-65">{videoErrors.join("；")}</div> : null}
            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasPromptChipInput
                        textReferences={mode === "video"}
                        onActivateReference={onActivateReference}
                        value={prompt}
                        references={mode === "video" ? videoMentions : mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function metadataParams(node: CanvasNodeData) {
    const metadata = node.metadata || {};
    return Object.fromEntries(["quality", "size", "background", "count", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions"].flatMap((key) => metadata[key as keyof typeof metadata] === undefined ? [] : [[key, metadata[key as keyof typeof metadata]]])) as Record<string, unknown>;
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode, imageMode: "generate" | "edit"): AiConfig {
    const result = {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode, mode === "image" ? imageMode : undefined),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
    const contract = mode === "video" ? getAvailableModel(result.model)?.videoContract : undefined;
    return contract ? { ...result, ...videoDefaults(contract),
        ...(node?.metadata?.size ? { size: node.metadata.size } : {}),
        ...(node?.metadata?.seconds ? { videoSeconds: node.metadata.seconds } : {}),
        ...(node?.metadata?.vquality ? { vquality: node.metadata.vquality } : {}),
        ...(node?.metadata?.generateAudio ? { videoGenerateAudio: node.metadata.generateAudio } : {}),
        ...(node?.metadata?.watermark ? { videoWatermark: node.metadata.watermark } : {}),
    } : result;
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}
