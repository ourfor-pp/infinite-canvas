import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Image as AntImage, Tooltip } from "antd";
import { ArrowUp, Bot, ImageIcon, LoaderCircle, Music2, Plus, Sparkles, Square, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { CanvasPromptChipInput } from "@/components/canvas/canvas-prompt-chip-input";
import { resolveModelForCapability } from "@/stores/use-config-store";
import type { MediaEditorDraft, MediaEditorReference, MediaEditorTarget } from "./types";

export function MediaEditor({ target }: { target: MediaEditorTarget }) {
    const { message } = App.useApp();
    const targetRef = useRef(target);
    const draftRef = useRef(target.snapshot.draft);
    const dirtyRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [draft, setDraft] = useState(target.snapshot.draft);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const uploadRef = useRef<HTMLInputElement>(null);
    const imageMode = target.kind === "image" ? target.imageMode || (target.snapshot.references.length ? "edit" : "generate") : undefined;
    const snapshotSignature = JSON.stringify(target.snapshot.draft);
    targetRef.current = target;

    useEffect(() => {
        draftRef.current = target.snapshot.draft;
        dirtyRef.current = false;
        setDraft(target.snapshot.draft);
    }, [target.key]);
    useEffect(() => {
        if (dirtyRef.current) return;
        draftRef.current = target.snapshot.draft;
        setDraft(target.snapshot.draft);
    }, [snapshotSignature]);
    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (dirtyRef.current) void Promise.resolve(targetRef.current.saveDraft(draftRef.current));
    }, []);

    const editorConfig = useMemo(() => ({
        ...target.config,
        ...draft.params,
        model: resolveModelForCapability(target.config, draft.model, target.kind, imageMode),
        count: String(draft.params.count || target.config.count),
    }), [draft, imageMode, target.config, target.kind]);

    const change = (patch: Partial<MediaEditorDraft>) => {
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        dirtyRef.current = true;
        setDraft(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void save(), 600);
    };
    const save = async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!dirtyRef.current) return true;
        const snapshot = draftRef.current;
        setSaving(true);
        try {
            await targetRef.current.saveDraft(snapshot);
            if (draftRef.current === snapshot) dirtyRef.current = false;
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "媒体草稿保存失败");
            return false;
        } finally { setSaving(false); }
    };
    const updateConfig = (key: string, value: string) => {
        if (key === "model") return change({ model: value });
        const normalized = key === "count" ? Number(value) || 1 : value;
        change({ params: { ...draftRef.current.params, [key]: normalized } });
        target.updateConfig?.(key as never, value);
    };
    const canGenerate = canGenerateMedia(target, draft);
    const run = async () => {
        if (!canGenerate || target.snapshot.running) return;
        if (!await save()) return;
        setBusy(true);
        try { await targetRef.current.generate(draftRef.current); }
        catch (error) { message.error(error instanceof Error ? error.message : "生成失败"); }
        finally { setBusy(false); }
    };
    const uploadFiles = async (files: File[]) => {
        const upload = target.uploadReference;
        if (!upload || uploading) return;
        const accepted = files.filter((file) => file.type.startsWith(`${target.kind}/`));
        if (accepted.length !== files.length) message.error(target.kind === "image" ? "请上传图片文件" : "请上传音频文件");
        setUploading(true);
        try {
            for (const file of accepted) {
                try { await upload(file); }
                catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); }
            }
        } finally { setUploading(false); }
    };
    const running = target.snapshot.running;
    const promptPlaceholder = target.kind === "image" ? "补充本次要调整的画面、构图或细节（可留空）" : target.separateSpeechTranscript ? "描述音色、语速、口音与情绪" : draft.audioMode === "ambient" ? "描述空间层次、远近声场和氛围" : draft.audioMode === "sfx" ? "描述动作、材质、力度和声音质感" : "输入要朗读的文本";

    return <section className="w-full" data-canvas-no-zoom
        onDragOver={(event) => {
            if (!target.uploadReference || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault(); event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDropCapture={(event) => {
            if (!target.uploadReference || !event.dataTransfer.files.length) return;
            event.preventDefault(); event.stopPropagation(); setDragging(false);
            void uploadFiles(Array.from(event.dataTransfer.files));
        }}
        onPasteCapture={(event) => {
            if (!target.uploadReference || !event.clipboardData.files.length) return;
            event.preventDefault(); event.stopPropagation();
            void uploadFiles(Array.from(event.clipboardData.files));
        }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">{target.semanticLabel}</div><div className="mt-0.5 text-[11px] opacity-45">{saving ? "正在保存草稿" : "修改只影响下一次生成"}</div></div>{target.askAgent ? <Button type="text" size="small" icon={<Bot className="size-3.5" />} onClick={() => void target.askAgent?.(draftRef.current)}>交给 Agent</Button> : null}</div>
        {target.separateSpeechTranscript ? <input value={draft.transcript || ""} onChange={(event) => change({ transcript: event.target.value })} className="mb-2 h-9 w-full rounded-xl border border-current/10 bg-transparent px-3 text-sm outline-none focus:border-blue-400/70" placeholder="输入一句试听台词" /> : null}
        {target.snapshot.references.length || target.uploadReference ? <ReferenceShelf references={target.snapshot.references} dragging={dragging} uploadControl={target.uploadReference ? <Tooltip title={`上传参考${target.kind === "image" ? "图" : "音频"}，支持拖入或粘贴`}><button type="button" aria-label={target.kind === "image" ? "上传参考图" : "上传参考音频"} disabled={uploading} className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-current/20 bg-transparent opacity-60 transition hover:bg-black/5 hover:opacity-100 disabled:cursor-wait dark:hover:bg-white/10" onClick={() => uploadRef.current?.click()}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-5" />}</button></Tooltip> : null} onRemove={target.removeReference ? async (reference) => {
            change({ prompt: removeReferenceLabel(draftRef.current.prompt, target.mentionReferences?.find((item) => item.nodeId === reference.nodeId)?.label || reference.label) });
            try { await target.removeReference?.(reference); } catch (error) { message.error(error instanceof Error ? error.message : "移除参考素材失败"); }
        } : undefined} /> : null}
        <CanvasPromptChipInput value={draft.prompt} references={target.mentionReferences || []} onActivateReference={target.activateReference} onChange={(prompt) => change({ prompt })} onSubmit={() => void run()} className="thin-scrollbar h-56 w-full resize-none rounded-xl border border-current/10 bg-transparent px-4 py-3 text-sm leading-6 outline-none focus:border-blue-400/70" placeholder={promptPlaceholder} />

        <div className="mt-3 flex min-w-0 items-center gap-3 border-t border-current/10 pt-3">
            <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
                <ModelPicker config={editorConfig} value={editorConfig.model} onChange={(model) => updateConfig("model", model)} capability={target.kind} audioMode={draft.audioMode} imageMode={imageMode} appearance="toolbar" className="!h-9 !min-w-44 !max-w-none shrink-0" />
                {target.kind === "image" ? <CanvasImageSettingsPopover config={editorConfig} onConfigChange={(key, value) => updateConfig(String(key), value)} appearance="toolbar" buttonClassName="shrink-0" /> : <CanvasAudioSettingsPopover config={editorConfig} onConfigChange={(key, value) => updateConfig(audioSettingKey(key), value)} appearance="toolbar" buttonClassName="shrink-0" />}
            </div>
            <Button type={running ? "default" : "primary"} danger={Boolean(running)} className="!size-11 shrink-0 !rounded-full !p-0" disabled={!running && !canGenerate} icon={running ? <Square className="size-3.5 fill-current" /> : busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={() => running ? void target.stop?.() : void run()} aria-label={running ? "停止生成" : "开始生成"} />
        </div>
        {running ? <div className="mt-2 flex items-center gap-2 text-[11px] opacity-55"><Sparkles className="size-3 animate-pulse" />生成中 {Math.round(running.progress * 100)}%</div> : null}
        <input ref={uploadRef} type="file" multiple accept={target.kind === "image" ? "image/*" : "audio/*"} className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); event.currentTarget.value = ""; void uploadFiles(files); }} />
    </section>;
}

function ReferenceShelf({ references, onRemove, uploadControl, dragging }: { references: MediaEditorReference[]; onRemove?: (reference: MediaEditorReference) => void; uploadControl?: ReactNode; dragging?: boolean }) {
    const images = references.filter((reference) => reference.kind === "image" && reference.url);
    return <div tabIndex={0} aria-label="参考素材" className={`mb-2 flex min-h-12 items-center gap-2 overflow-x-auto rounded-xl border px-2 py-2 outline-none focus-visible:border-current/40 ${dragging ? "border-current/50" : "border-current/10"}`}>
        {images.length ? <AntImage.PreviewGroup classNames={{ popup: { root: "media-image-preview" } }} preview={{ zIndex: 1320 }}>{references.map((reference) => <ReferenceItem key={reference.id} reference={reference} onRemove={onRemove} />)}</AntImage.PreviewGroup> : references.map((reference) => <ReferenceItem key={reference.id} reference={reference} onRemove={onRemove} />)}
        {uploadControl}
    </div>;
}

function ReferenceItem({ reference, onRemove }: { reference: MediaEditorReference; onRemove?: (reference: MediaEditorReference) => void }) {
    return <div className="group/reference relative size-11 shrink-0 overflow-hidden rounded-lg border border-current/10 bg-black/[0.035] dark:bg-white/[0.055]" title={`${reference.source === "canvas" ? "画布连线" : "上传参考"} · ${reference.label}`}>
        {reference.kind === "image" && reference.url ? <AntImage rootClassName="size-full" src={reference.url} alt={reference.label} className="!size-full !object-cover" preview={{ mask: false }} /> : reference.kind === "audio" && reference.url ? <audio src={reference.url} controls className="absolute inset-0 size-full opacity-0" /> : <span className="grid size-full place-items-center">{reference.kind === "image" ? <ImageIcon className="size-4 opacity-50" /> : <Music2 className="size-4 opacity-50" />}</span>}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-center text-[9px] text-white">{reference.label.replace(/^@/, "")}</span>
        {onRemove && reference.removable !== false ? <button type="button" title="移除参考并断开连线" aria-label={`移除${reference.label}`} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-80 transition-opacity hover:opacity-100 focus:opacity-100" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove(reference); }}><X className="size-3" /></button> : null}
    </div>;
}

function removeReferenceLabel(prompt: string, label: string) {
    return prompt.split(label).join("").replace(/[ \t]{2,}/g, " ").trimStart();
}

function audioSettingKey(key: CanvasAudioSettingKey) {
    return key === "audioVoice" ? "audioVoice" : key === "audioFormat" ? "audioFormat" : key === "audioSpeed" ? "audioSpeed" : "audioInstructions";
}

export function canGenerateMedia(target: Pick<MediaEditorTarget, "kind" | "snapshot" | "allowEmptyPrompt" | "separateSpeechTranscript">, draft: MediaEditorDraft) {
    return Boolean((target.allowEmptyPrompt || draft.prompt.trim() || target.snapshot.references.length) && (!target.separateSpeechTranscript || draft.transcript?.trim()));
}
