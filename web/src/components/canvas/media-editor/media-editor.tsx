import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Image as AntImage, Popover, Tag, Tooltip } from "antd";
import { ArrowUp, Bot, Check, ChevronDown, Download, LoaderCircle, Paperclip, Sparkles, Square, Star, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { CanvasPromptChipInput } from "@/components/canvas/canvas-prompt-chip-input";
import { resolveModelForCapability } from "@/stores/use-config-store";
import type { MediaEditorDraft, MediaEditorTarget } from "./types";

export function MediaEditor({ target }: { target: MediaEditorTarget }) {
    const { message } = App.useApp();
    const targetRef = useRef(target);
    const draftRef = useRef(target.snapshot.draft);
    const dirtyRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [draft, setDraft] = useState(target.snapshot.draft);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [preview, setPreview] = useState<Awaited<ReturnType<NonNullable<MediaEditorTarget["preview"]>>> | null>(null);
    const uploadRef = useRef<HTMLInputElement>(null);
    const imageMode = target.kind === "image" ? target.imageMode || (target.snapshot.references.length ? "edit" : "generate") : undefined;
    const snapshotSignature = JSON.stringify(target.snapshot.draft);
    targetRef.current = target;

    useEffect(() => {
        draftRef.current = target.snapshot.draft;
        dirtyRef.current = false;
        setDraft(target.snapshot.draft);
        setPreview(null);
        setPreviewOpen(false);
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
        model: draft.model || resolveModelForCapability(target.config, undefined, target.kind, imageMode),
        count: String(draft.params.count || target.config.count),
    }), [draft, imageMode, target.config, target.kind]);

    const change = (patch: Partial<MediaEditorDraft>) => {
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        dirtyRef.current = true;
        setDraft(next);
        setPreview(null);
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
    const setPreviewVisible = async (open: boolean) => {
        setPreviewOpen(open);
        if (!open || preview || !target.preview || !await save()) return;
        try { setPreview(await target.preview(draftRef.current)); }
        catch (error) { message.error(error instanceof Error ? error.message : "无法读取发送预览"); }
    };
    const running = target.snapshot.running;
    const promptPlaceholder = target.kind === "image" ? "补充本次要调整的画面、构图或细节（可留空）" : target.separateSpeechTranscript ? "描述音色、语速、口音与情绪" : draft.audioMode === "ambient" ? "描述空间层次、远近声场和氛围" : draft.audioMode === "sfx" ? "描述动作、材质、力度和声音质感" : "输入要朗读的文本";

    return <section className="w-full" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">{target.semanticLabel}</div><div className="mt-0.5 text-[11px] opacity-45">{saving ? "正在保存草稿" : "修改只影响下一次生成"}</div></div>{target.askAgent ? <Button type="text" size="small" icon={<Bot className="size-3.5" />} onClick={() => void target.askAgent?.(draftRef.current)}>交给 Agent</Button> : null}</div>
        {target.separateSpeechTranscript ? <input value={draft.transcript || ""} onChange={(event) => change({ transcript: event.target.value })} className="mb-2 h-9 w-full rounded-xl border border-current/10 bg-transparent px-3 text-sm outline-none focus:border-blue-400/70" placeholder="输入一句试听台词" /> : null}
        <CanvasPromptChipInput value={draft.prompt} references={target.mentionReferences || []} onChange={(prompt) => change({ prompt })} onSubmit={() => void run()} className="thin-scrollbar h-56 w-full resize-none rounded-xl border border-current/10 bg-transparent px-4 py-3 text-sm leading-6 outline-none focus:border-blue-400/70" placeholder={promptPlaceholder} />

        {target.snapshot.references.length ? <div className="mt-2 flex flex-wrap gap-1.5">{target.snapshot.references.map((reference) => <Tag key={reference.id} className="!m-0 !rounded-full">{reference.source === "canvas" ? "已连接" : reference.source === "style" ? "风格" : "参考"} · {reference.label}</Tag>)}</div> : null}
        <div className="mt-3 flex min-w-0 items-center gap-3 border-t border-current/10 pt-3">
            <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
                <ModelPicker config={editorConfig} value={editorConfig.model} onChange={(model) => updateConfig("model", model)} capability={target.kind} audioMode={draft.audioMode} imageMode={imageMode} className="!h-10 !min-w-48 !max-w-60 shrink-0" />
                {target.kind === "image" ? <CanvasImageSettingsPopover config={editorConfig} onConfigChange={(key, value) => updateConfig(String(key), value)} buttonClassName="!h-10 !max-w-[180px] shrink-0" /> : <CanvasAudioSettingsPopover config={editorConfig} onConfigChange={(key, value) => updateConfig(audioSettingKey(key), value)} buttonClassName="!h-10 !max-w-[180px] shrink-0" />}
                {target.uploadReference ? <Tooltip title={`上传参考${target.kind === "image" ? "图" : "音频"}`}><Button type="text" className="!size-10 shrink-0 !p-0" icon={<Paperclip className="size-4" />} onClick={() => uploadRef.current?.click()} /></Tooltip> : null}
                {target.preview ? <Popover open={previewOpen} onOpenChange={(open) => void setPreviewVisible(open)} placement="topLeft" trigger="click" arrow={false} zIndex={1280} content={<PreviewDetails preview={preview} />} overlayClassName="media-request-preview-popover"><Button type="text" className="shrink-0 !h-10 !px-2" icon={<ChevronDown className={`size-3.5 transition-transform ${previewOpen ? "rotate-180" : ""}`} />}>最终提示词</Button></Popover> : null}
            </div>
            <Button type={running ? "default" : "primary"} danger={Boolean(running)} className="!size-11 shrink-0 !rounded-full !p-0" disabled={!running && !canGenerate} icon={running ? <Square className="size-3.5 fill-current" /> : busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={() => running ? void target.stop?.() : void run()} aria-label={running ? "停止生成" : "开始生成"} />
        </div>
        {running ? <div className="mt-2 flex items-center gap-2 text-[11px] opacity-55"><Sparkles className="size-3 animate-pulse" />生成中 {Math.round(running.progress * 100)}%</div> : null}
        {target.snapshot.variants.length ? <VariantHistory target={target} /> : null}
        <input ref={uploadRef} type="file" accept={target.kind === "image" ? "image/*" : "audio/*"} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void target.uploadReference?.(file).catch((error) => message.error(error instanceof Error ? error.message : "上传失败")); }} />
    </section>;
}

function PreviewDetails({ preview }: { preview: Awaited<ReturnType<NonNullable<MediaEditorTarget["preview"]>>> | null }) {
    if (!preview) return <div className="w-[min(560px,calc(100vw-48px))] p-3 text-xs opacity-45">正在组装最终提示词…</div>;
    const warnings = "warnings" in preview ? preview.warnings : [];
    return <div className="w-[min(560px,calc(100vw-48px))] p-3"><div className="mb-2 text-xs font-semibold">后端最终使用的提示词</div><div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/[0.035] p-3 text-xs leading-5 dark:bg-white/[0.055]">{preview.prompt}</div>{preview.instructions ? <div className="mt-3"><span className="text-[11px] opacity-45">声音指令</span><div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/[0.035] p-3 text-xs leading-5 dark:bg-white/[0.055]">{preview.instructions}</div></div> : null}{warnings.length ? <div className="mt-3 flex flex-wrap gap-1">{warnings.map((warning) => <Tag key={warning.code} color={warning.blocking ? "error" : "warning"}>{warning.message}</Tag>)}</div> : null}</div>;
}

function VariantHistory({ target }: { target: MediaEditorTarget }) {
    return <div className="mt-3 border-t border-current/10 pt-3"><div className="mb-2 text-[11px] font-medium opacity-45">生成候选与历史</div>{target.kind === "image" ? <AntImage.PreviewGroup classNames={{ popup: { root: "media-image-preview" } }} preview={{ zIndex: 1320 }}><div className="thin-scrollbar flex gap-2 overflow-x-auto pb-1">{target.snapshot.variants.map((variant) => <div key={variant.id} className={`group relative h-[88px] w-32 shrink-0 overflow-hidden rounded-lg border ${variant.review?.status === "rejected" ? "border-red-400/50 opacity-60" : variant.review?.status === "approved" ? "border-emerald-400/50" : "border-amber-400/40"}`}><AntImage rootClassName="size-full" src={variant.url} alt={variant.label} className="!size-full !object-cover" preview={{ mask: false }} />{variant.primary ? <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-md bg-black/65 text-white"><Star className="size-3 fill-current" /></span> : variant.review?.status === "approved" && target.setPrimary && !variant.reference ? <button type="button" title="设为主图" className="absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-black/65 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={(event) => { event.stopPropagation(); void target.setPrimary?.(variant.id); }}><Star className="size-3.5" /></button> : null}<div className="absolute inset-x-1 bottom-1 flex items-center gap-1"><span title={variant.review?.summary} className={`rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] text-white ${variant.review?.status === "approved" ? "text-emerald-200" : variant.review?.status === "rejected" ? "text-red-200" : "text-amber-100"}`}>{variant.review?.status === "approved" ? "已通过" : variant.review?.status === "rejected" ? "未通过" : "待验收"}</span>{variant.review?.status === "pending_review" && target.reviewVariant ? <><button type="button" title="验收并设为主图" className="grid size-6 place-items-center rounded-md bg-emerald-600 text-white" onClick={(event) => { event.stopPropagation(); void target.reviewVariant?.(variant.id, true, true); }}><Check className="size-3.5" /></button><button type="button" title="拒绝这个版本" className="grid size-6 place-items-center rounded-md bg-red-600 text-white" onClick={(event) => { event.stopPropagation(); void target.reviewVariant?.(variant.id, false); }}><X className="size-3.5" /></button></> : null}<a href={variant.url} download className="ml-auto grid size-6 place-items-center rounded-md bg-black/65 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={(event) => event.stopPropagation()}><Download className="size-3.5" /></a></div></div>)}</div></AntImage.PreviewGroup> : <div className="thin-scrollbar flex gap-2 overflow-x-auto pb-1">{target.snapshot.variants.map((variant) => <div key={variant.id} className="w-72 shrink-0 rounded-lg border border-current/10 px-2.5 py-2"><div className="mb-1 flex items-center gap-2 text-[10px]"><span className="min-w-0 flex-1 truncate opacity-50">{variant.label}</span>{variant.primary ? <Tag className="!m-0">主音频</Tag> : target.setPrimary && !variant.reference ? <Button type="text" size="small" onClick={() => void target.setPrimary?.(variant.id)}>设为主音频</Button> : null}</div><audio src={variant.url} controls className="h-8 w-full" /></div>)}</div>}</div>;
}

function audioSettingKey(key: CanvasAudioSettingKey) {
    return key === "audioVoice" ? "audioVoice" : key === "audioFormat" ? "audioFormat" : key === "audioSpeed" ? "audioSpeed" : "audioInstructions";
}

export function canGenerateMedia(target: Pick<MediaEditorTarget, "kind" | "snapshot" | "allowEmptyPrompt" | "separateSpeechTranscript">, draft: MediaEditorDraft) {
    return Boolean((target.allowEmptyPrompt || draft.prompt.trim() || target.snapshot.references.length) && (!target.separateSpeechTranscript || draft.transcript?.trim()));
}
