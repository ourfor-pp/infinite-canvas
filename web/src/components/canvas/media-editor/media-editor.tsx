import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Image as AntImage, Input, Popover, Tag, Tooltip } from "antd";
import { ArrowUp, Bot, Check, ChevronDown, ImageIcon, LoaderCircle, Music2, Palette, Paperclip, Search, Sparkles, Square, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { CanvasPromptChipInput } from "@/components/canvas/canvas-prompt-chip-input";
import { filterVisualStyleTemplates } from "@/lib/canvas/visual-style-templates";
import { resolveModelForCapability } from "@/stores/use-config-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";
import type { VisualStyleTemplateCategory } from "@/types/visual-style";
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
        model: resolveModelForCapability(target.config, draft.model, target.kind, imageMode),
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
        {target.snapshot.references.length ? <ReferenceShelf references={target.snapshot.references} onRemove={target.removeReference ? async (reference) => {
            change({ prompt: removeReferenceLabel(draftRef.current.prompt, reference.label) });
            try { await target.removeReference?.(reference); } catch (error) { message.error(error instanceof Error ? error.message : "移除参考素材失败"); }
        } : undefined} /> : null}
        <CanvasPromptChipInput value={draft.prompt} references={target.mentionReferences || []} onActivateReference={target.activateReference} onChange={(prompt) => change({ prompt })} onSubmit={() => void run()} className="thin-scrollbar h-56 w-full resize-none rounded-xl border border-current/10 bg-transparent px-4 py-3 text-sm leading-6 outline-none focus:border-blue-400/70" placeholder={promptPlaceholder} />

        <div className="mt-3 flex min-w-0 items-center gap-3 border-t border-current/10 pt-3">
            <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
                {target.kind === "image" && target.selectVisualStyleTemplate ? <VisualStyleControl target={target} /> : null}
                <ModelPicker config={editorConfig} value={editorConfig.model} onChange={(model) => updateConfig("model", model)} capability={target.kind} audioMode={draft.audioMode} imageMode={imageMode} appearance="toolbar" className="!h-9 !min-w-44 !max-w-60 shrink-0" />
                {target.kind === "image" ? <CanvasImageSettingsPopover config={editorConfig} onConfigChange={(key, value) => updateConfig(String(key), value)} appearance="toolbar" buttonClassName="shrink-0" /> : <CanvasAudioSettingsPopover config={editorConfig} onConfigChange={(key, value) => updateConfig(audioSettingKey(key), value)} appearance="toolbar" buttonClassName="shrink-0" />}
                {target.uploadReference ? <Tooltip title={`上传参考${target.kind === "image" ? "图" : "音频"}`}><Button type="text" className="!size-10 shrink-0 !p-0" icon={<Paperclip className="size-4" />} onClick={() => uploadRef.current?.click()} /></Tooltip> : null}
                {target.preview ? <Popover open={previewOpen} onOpenChange={(open) => void setPreviewVisible(open)} placement="topLeft" trigger="click" arrow={false} zIndex={1280} content={<PreviewDetails preview={preview} />} overlayClassName="media-request-preview-popover"><Button type="text" className="shrink-0 !h-10 !px-2" icon={<ChevronDown className={`size-3.5 transition-transform ${previewOpen ? "rotate-180" : ""}`} />}>最终提示词</Button></Popover> : null}
            </div>
            <Button type={running ? "default" : "primary"} danger={Boolean(running)} className="!size-11 shrink-0 !rounded-full !p-0" disabled={!running && !canGenerate} icon={running ? <Square className="size-3.5 fill-current" /> : busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={() => running ? void target.stop?.() : void run()} aria-label={running ? "停止生成" : "开始生成"} />
        </div>
        {running ? <div className="mt-2 flex items-center gap-2 text-[11px] opacity-55"><Sparkles className="size-3 animate-pulse" />生成中 {Math.round(running.progress * 100)}%</div> : null}
        <input ref={uploadRef} type="file" accept={target.kind === "image" ? "image/*" : "audio/*"} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void target.uploadReference?.(file).catch((error) => message.error(error instanceof Error ? error.message : "上传失败")); }} />
    </section>;
}

const mediaStyleCategories: Array<{ value: "all" | VisualStyleTemplateCategory; label: string }> = [{ value: "all", label: "全部" }, { value: "cinematic", label: "电影" }, { value: "genre", label: "类型" }, { value: "eastern", label: "东方" }, { value: "animation", label: "动画" }, { value: "handmade", label: "手工" }, { value: "graphic", label: "图形" }];
const mediaStyleAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

function VisualStyleControl({ target }: { target: MediaEditorTarget }) {
    const { message } = App.useApp();
    const templates = useVisualStyleStore((state) => state.templates);
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState<"all" | VisualStyleTemplateCategory>("all");
    const [query, setQuery] = useState("");
    const [applying, setApplying] = useState(false);
    const visible = filterVisualStyleTemplates(templates, category, query);
    const projectTemplate = templates.find((item) => item.id === target.projectVisualStyle?.templateId);
    const content = <div style={{ width: "min(620px, calc(100vw - 32px))" }}>
        <div className="flex items-center gap-3 px-1 pb-3"><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">视觉风格</div><div className="mt-0.5 truncate text-[10px] opacity-40">{target.visualStyle?.source === "linked" ? `当前节点 · ${target.visualStyle.name}` : `继承项目 · ${target.projectVisualStyle?.name || "未设置"}`}</div></div><Input value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search className="size-3 opacity-35" />} placeholder="搜索" size="small" style={{ width: 168, flex: "none" }} /></div>
        <div className="thin-scrollbar flex max-w-full flex-nowrap gap-4 overflow-x-auto border-y border-current/10 px-1 py-2">{mediaStyleCategories.map((item) => <button key={item.value} type="button" className={`relative shrink-0 whitespace-nowrap py-0.5 text-[11px] transition-opacity ${category === item.value ? "font-medium opacity-100 after:absolute after:inset-x-0 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-blue-500" : "opacity-45 hover:opacity-80"}`} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
        <div className="thin-scrollbar grid max-h-[min(390px,48vh)] grid-cols-2 gap-x-2 gap-y-3 overflow-y-auto px-1 py-3 sm:grid-cols-3">
            <StyleTile name="项目风格" tagline={target.projectVisualStyle?.name || "尚未设置默认风格"} preview={projectTemplate?.preview} selected={target.visualStyle?.source === "default"} disabled={!target.projectVisualStyle && !target.inheritProjectVisualStyle} badge="默认" onClick={async () => { if (!target.inheritProjectVisualStyle) return; setApplying(true); try { await target.inheritProjectVisualStyle(); setOpen(false); message.success("已恢复使用项目风格"); } catch (error) { message.error(error instanceof Error ? error.message : "恢复项目风格失败"); } finally { setApplying(false); } }} />
            {visible.map((item) => <StyleTile key={item.id} name={item.name} tagline={item.tagline} preview={item.preview} selected={target.visualStyle?.source === "linked" && target.visualStyle.templateId === item.id} disabled={applying} onClick={async () => { setApplying(true); try { await target.selectVisualStyleTemplate?.(item); setOpen(false); message.success(`已为当前节点使用“${item.name}”`); } catch (error) { message.error(error instanceof Error ? error.message : "应用风格失败"); } finally { setApplying(false); } }} />)}
            {!visible.length ? <div className="col-span-full py-16 text-center text-xs opacity-35">没有匹配的风格</div> : null}
        </div>
        <div className="flex items-center justify-between border-t border-current/10 px-1 pt-2 text-[10px] opacity-45"><span>{target.visualStyle?.source === "linked" ? "仅覆盖当前节点" : "随项目风格更新"}</span>{target.configureVisualStyle ? <button type="button" className="transition-opacity hover:opacity-100" onClick={() => { setOpen(false); target.configureVisualStyle?.(); }}>高级设置</button> : null}</div>
    </div>;
    const buttonLabel = target.visualStyle?.source === "linked" ? target.visualStyle.name : "项目风格";
    return <Popover open={open} onOpenChange={setOpen} content={content} placement="topLeft" trigger="click" arrow={false} zIndex={1290}><Button data-control-appearance="toolbar" type="text" loading={applying} className="!h-9 shrink-0 !rounded-lg !border-0 !bg-transparent !px-2 !shadow-none hover:!bg-black/5 dark:hover:!bg-white/10" icon={<Palette className="size-4" />}>{buttonLabel}<ChevronDown className={`ml-0.5 size-3.5 opacity-45 transition-transform ${open ? "rotate-180" : ""}`} /></Button></Popover>;
}

function StyleTile({ name, tagline, preview, selected, disabled, badge, onClick }: { name: string; tagline: string; preview?: string; selected?: boolean; disabled?: boolean; badge?: string; onClick: () => void | Promise<void> }) {
    return <button type="button" disabled={disabled} className={`group min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-35 ${selected ? "opacity-100" : "opacity-85 hover:opacity-100"}`} onClick={() => void onClick()}>
        <span className={`relative block aspect-video overflow-hidden rounded-xl bg-black/[0.035] ring-1 transition-all dark:bg-white/[0.055] ${selected ? "ring-2 ring-blue-500" : "ring-black/10 group-hover:ring-black/25 dark:ring-white/10 dark:group-hover:ring-white/25"}`}>
            {preview ? <img src={mediaStyleAssetUrl(preview)} alt={`${name}预览`} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.025]" /> : <span className="grid size-full place-items-center"><Palette className="size-5 opacity-25" /></span>}
            {badge ? <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] tracking-wide text-white backdrop-blur-sm">{badge}</span> : null}
            {selected ? <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-blue-600 text-white shadow-sm"><Check className="size-3" /></span> : null}
        </span>
        <span className="block min-w-0 px-0.5 pt-1.5"><strong className="block truncate text-[11px] font-medium">{name}</strong><span className="mt-0.5 block truncate text-[9px] opacity-40">{tagline}</span></span>
    </button>;
}

function PreviewDetails({ preview }: { preview: Awaited<ReturnType<NonNullable<MediaEditorTarget["preview"]>>> | null }) {
    if (!preview) return <div className="w-[min(560px,calc(100vw-48px))] p-3 text-xs opacity-45">正在组装最终提示词…</div>;
    const warnings = "warnings" in preview ? preview.warnings : [];
    return <div className="w-[min(560px,calc(100vw-48px))] p-3"><div className="mb-2 text-xs font-semibold">后端最终使用的提示词</div><div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/[0.035] p-3 text-xs leading-5 dark:bg-white/[0.055]">{preview.prompt}</div>{preview.instructions ? <div className="mt-3"><span className="text-[11px] opacity-45">声音指令</span><div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/[0.035] p-3 text-xs leading-5 dark:bg-white/[0.055]">{preview.instructions}</div></div> : null}{warnings.length ? <div className="mt-3 flex flex-wrap gap-1">{warnings.map((warning) => <Tag key={warning.code} color={warning.blocking ? "error" : "warning"}>{warning.message}</Tag>)}</div> : null}</div>;
}

function ReferenceShelf({ references, onRemove }: { references: MediaEditorReference[]; onRemove?: (reference: MediaEditorReference) => void }) {
    const images = references.filter((reference) => reference.kind === "image" && reference.url);
    return <div className="mb-2 flex min-h-12 items-center gap-2 overflow-x-auto rounded-xl border border-current/10 px-2 py-2">
        {images.length ? <AntImage.PreviewGroup classNames={{ popup: { root: "media-image-preview" } }} preview={{ zIndex: 1320 }}>{references.map((reference) => <ReferenceItem key={reference.id} reference={reference} onRemove={onRemove} />)}</AntImage.PreviewGroup> : references.map((reference) => <ReferenceItem key={reference.id} reference={reference} onRemove={onRemove} />)}
    </div>;
}

function ReferenceItem({ reference, onRemove }: { reference: MediaEditorReference; onRemove?: (reference: MediaEditorReference) => void }) {
    return <div className="group/reference relative size-11 shrink-0 overflow-hidden rounded-lg border border-current/10 bg-black/[0.035] dark:bg-white/[0.055]" title={`${reference.source === "canvas" ? "画布连线" : "上传参考"} · ${reference.label}`}>
        {reference.kind === "image" && reference.url ? <AntImage rootClassName="size-full" src={reference.url} alt={reference.label} className="!size-full !object-cover" preview={{ mask: false }} /> : reference.kind === "audio" && reference.url ? <audio src={reference.url} controls className="absolute inset-0 size-full opacity-0" /> : <span className="grid size-full place-items-center">{reference.kind === "image" ? <ImageIcon className="size-4 opacity-50" /> : <Music2 className="size-4 opacity-50" />}</span>}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-center text-[9px] text-white">{reference.label.replace(/^@/, "")}</span>
        {onRemove ? <button type="button" aria-label={`移除${reference.label}`} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/reference:opacity-100 focus:opacity-100" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove(reference); }}><X className="size-3" /></button> : null}
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
