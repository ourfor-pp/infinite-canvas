import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { App, Button, Dropdown, Input, Modal, Select } from "antd";
import { ArrowUp, Bot, ChevronDown, ImagePlus, LayoutGrid, MoreHorizontal, Palette, Pencil, Sparkles, Star, WandSparkles, X } from "lucide-react";

import { VisualStyleTemplatePicker } from "@/components/visual-style-template-picker";
import { serverApi, serverFileUrl, uploadServerFile } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { VisualStyle, VisualStyleDna, VisualStyleTemplate } from "@/types/visual-style";
const emptyDna: VisualStyleDna = { mediumFamily: "live_action", medium: "", rendering: "", characterRendering: "", sceneRendering: "", propRendering: "", palette: "", lighting: "", contrast: "", texture: "", lensAndDepth: "", composition: "", postProcessing: "", exclusions: [] };
const templateAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
export const VISUAL_STYLE_NODE_LAYOUT = { width: 420, height: 615 } as const;

export function VisualStyleNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const styleId = ctx.node.metadata?.visualStyleId || "";
    const style = useVisualStyleStore((state) => state.styles.find((item) => item.id === styleId));
    if (!style) return <div className="grid size-full place-items-center" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.muted }}><Palette className="size-8 opacity-25" /></div>;
    return <VisualStyleCard style={style} ctx={ctx} />;
}

function VisualStyleCard({ style, ctx }: { style: VisualStyle; ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const templates = useVisualStyleStore((state) => state.templates);
    const update = useVisualStyleStore((state) => state.update);
    const remove = useVisualStyleStore((state) => state.remove);
    const analyze = useVisualStyleStore((state) => state.analyze);
    const generateReferences = useVisualStyleStore((state) => state.generateReferences);
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === style.projectId));
    const prepareComposer = useAgentStore((state) => state.prepareComposer);
    const [draft, setDraft] = useState(style);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState<"upload" | "analyze" | "generate" | "">("");
    const [dnaOpen, setDnaOpen] = useState(false);
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [nameEditing, setNameEditing] = useState(false);
    const dirtyRef = useRef(false);
    const draftRef = useRef(style);
    const savePromiseRef = useRef<Promise<boolean> | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLElement>(null);

    useEffect(() => { if (!dirtyRef.current) { draftRef.current = style; setDraft(style); } }, [style]);
    useEffect(() => {
        if (ctx.node.width !== VISUAL_STYLE_NODE_LAYOUT.width || ctx.node.height !== VISUAL_STYLE_NODE_LAYOUT.height) ctx.updateNode(VISUAL_STYLE_NODE_LAYOUT);
    }, [ctx.node.height, ctx.node.width]);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
    const commit = async (): Promise<boolean> => {
        if (savePromiseRef.current) return savePromiseRef.current.then(() => dirtyRef.current ? commit() : true);
        if (!dirtyRef.current) return true;
        if (timerRef.current) clearTimeout(timerRef.current);
        setSaving(true);
        const snapshot = draftRef.current;
        dirtyRef.current = false;
        savePromiseRef.current = update(style.id, { name: snapshot.name, mode: snapshot.mode, templateId: snapshot.templateId, description: snapshot.description, status: snapshot.status, dna: snapshot.dna, references: snapshot.references })
            .then((saved) => { if (!dirtyRef.current) { draftRef.current = saved; setDraft(saved); } ctx.updateNode({ title: saved.name }); return true; })
            .catch((error) => { dirtyRef.current = true; message.error(error instanceof Error ? error.message : "风格保存失败"); return false; })
            .finally(() => { savePromiseRef.current = null; setSaving(false); });
        return savePromiseRef.current;
    };
    const change = (patch: Partial<VisualStyle>) => {
        dirtyRef.current = true;
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        setDraft(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void commit(), 600);
    };
    const selectTemplate = (templateId: string) => {
        const template = templates.find((item) => item.id === templateId);
        if (template) change({ mode: "template", templateId, name: template.name, description: template.description, status: "draft", dna: { ...template.dna, exclusions: [...template.dna.exclusions] } });
        setTemplatePickerOpen(false);
    };
    const upload = async (file: File) => {
        setBusy("upload");
        try {
            if (!await commit()) return;
            const uploaded = await uploadServerFile(file, file.name);
            const current = draftRef.current;
            const saved = await update(style.id, { mode: "custom", templateId: null, status: "draft", references: { ...current.references, source: uploaded.fileId } });
            dirtyRef.current = false;
            draftRef.current = saved;
            setDraft(saved);
            message.success("来源图已上传，可让模型分析风格 DNA");
        } catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); }
        finally { setBusy(""); }
    };
    const run = async (kind: "analyze" | "generate") => {
        if (!await commit()) return;
        setBusy(kind);
        try {
            if (kind === "analyze") await analyze(style.id);
            else await generateReferences(style.id);
            message.success(kind === "analyze" ? "风格分析已进入任务队列" : "统一风格板已进入任务队列");
        } catch (error) { message.error(error instanceof Error ? error.message : "任务提交失败"); }
        finally { setBusy(""); }
    };
    const confirmStyle = async () => {
        if (!await commit()) return;
        try {
            const saved = await update(style.id, { status: "confirmed" });
            draftRef.current = saved;
            setDraft(saved);
            if (!project?.defaultVisualStyleId) await serverApi.setDefaultVisualStyle(style.id);
            message.success(project?.defaultVisualStyleId ? "视觉风格已确认" : "视觉风格已确认并设为项目默认");
        }
        catch (error) { message.error(error instanceof Error ? error.message : "确认失败"); }
    };
    const askAgent = async () => {
        if (!await commit()) return;
        prepareComposer(style.projectId, { kind: "style", projectId: style.projectId, styleId: style.id, nodeId: ctx.node.id, title: draft.name, subtitle: "视觉风格" });
        const agent = useAgentStore.getState();
        if (!agent.drafts[style.projectId]?.trim()) agent.setDraft(style.projectId, `请结合当前项目的故事内容，为“${draft.name}”设计统一视觉风格，完善风格描述和 Style DNA。不要描述具体角色、场景、道具或剧情。`);
    };
    const isDefault = project?.defaultVisualStyleId === style.id;
    const template = templates.find((item) => item.id === draft.templateId);
    const boardUrl = draft.references.board ? serverFileUrl(`server:${draft.references.board}`) : draft.references.source ? serverFileUrl(`server:${draft.references.source}`) : template ? templateAssetUrl(template.preview) : "";
    const tags = visualStyleTags(draft.dna);

    return <article ref={cardRef} className="relative flex size-full flex-col overflow-hidden px-5 py-4" data-canvas-no-pan style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} onMouseDownCapture={(event) => { if (shouldStopVisualStyleNodePointer(event.target)) event.stopPropagation(); }}>
        <header className="flex h-10 shrink-0 items-center gap-2">
            <Palette className="size-5 text-[#d26b98]" />
            <span className="text-[13px] font-medium opacity-55">视觉风格</span>
            {saving ? <span className="text-[9px] opacity-35">保存中</span> : null}
            <Dropdown menu={{ items: [{ key: "agent", label: "交给 Agent", icon: <Bot className="size-3.5" /> }, { key: "delete", danger: true, label: "永久删除风格" }], onClick: ({ key }) => key === "agent" ? void askAgent() : key === "delete" && Modal.confirm({ title: "永久删除这个视觉风格？", content: "所有画布视图和相关连接都会移除，此操作不可撤销。", okText: "永久删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => remove(style.id) }) }} trigger={["click"]}><Button aria-label="更多风格操作" type="text" size="small" className="!ml-auto" icon={<MoreHorizontal className="size-4" />} /></Dropdown>
        </header>

        <button type="button" aria-label="编辑当前视觉风格" className="group relative mt-2 aspect-[3/2] shrink-0 overflow-hidden rounded-xl border border-current/10 text-left" onClick={() => setEditorOpen(true)}>
            {boardUrl ? <img src={boardUrl} alt={`${draft.name}统一风格板`} className="size-full object-cover transition duration-300 group-hover:scale-[1.015]" /> : <div className="grid size-full place-items-center bg-black/[0.03] text-xs opacity-45"><span>选择模板或生成统一风格板</span></div>}
        </button>
        <div className="mt-4 flex min-w-0 items-center gap-2">
            {nameEditing ? <Input autoFocus variant="borderless" value={draft.name} className="min-w-0 flex-1 !px-0 !text-xl !font-semibold" onChange={(event) => change({ name: event.target.value, status: "draft" })} onBlur={() => setNameEditing(false)} onPressEnter={() => setNameEditing(false)} /> : <button type="button" className="group/name flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setNameEditing(true)}><strong className="truncate text-xl font-semibold">{draft.name}</strong><Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-40 group-focus-visible/name:opacity-50" /></button>}
            {isDefault ? <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#d26b98]"><Star className="size-4 fill-current" />项目默认</span> : <span className={`shrink-0 text-[11px] ${draft.status === "confirmed" ? "text-emerald-600" : "opacity-40"}`}>{draft.status === "confirmed" ? "已确认" : "草稿"}</span>}
        </div>
        <p className="mt-2 max-h-12 min-h-12 overflow-hidden text-[13px] leading-6 opacity-70">{draft.description || "添加视觉风格描述，统一角色、场景和道具的画面语言。"}</p>
        <div className="mt-3 grid min-h-8 grid-cols-3 gap-2 overflow-hidden">{tags.map((tag) => <span key={tag} className="truncate rounded-lg border border-current/10 px-2.5 py-1.5 text-center text-[11px] opacity-65">{tag}</span>)}</div>
        <div className="mt-4 grid grid-cols-3 border-y border-current/10 py-1">
            <button type="button" className="flex h-11 items-center justify-center gap-1.5 text-[13px] text-[#d26b98] hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setEditorOpen(true)}><Pencil className="size-4" />编辑风格</button>
            <button type="button" className="flex h-11 items-center justify-center gap-1.5 border-x border-current/10 text-[13px] hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setTemplatePickerOpen(true)}><LayoutGrid className="size-4" />更换模板</button>
            <button type="button" disabled={!draft.description.trim()} className="flex h-11 items-center justify-center gap-1.5 text-[13px] hover:bg-black/5 disabled:opacity-35 dark:hover:bg-white/10" onClick={() => void run("generate")}><Sparkles className="size-4" />{busy === "generate" ? "提交中" : "生成风格板"}</button>
        </div>
        <button type="button" className="mt-2 flex h-9 items-center gap-2 px-1 text-[12px] opacity-55 hover:opacity-90" onClick={() => { setDnaOpen(true); setEditorOpen(true); }}><ChevronDown className="size-4" />完整 Style DNA</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
        <VisualStyleEditorPopover anchorRef={cardRef} open={editorOpen} onClose={() => setEditorOpen(false)} theme={ctx.theme} draft={draft} template={template} isDefault={isDefault} busy={busy} dnaOpen={dnaOpen} setDnaOpen={setDnaOpen} change={change} openTemplates={() => setTemplatePickerOpen(true)} upload={() => fileRef.current?.click()} analyze={() => void run("analyze")} generate={() => void run("generate")} confirm={() => void confirmStyle()} setDefault={() => void serverApi.setDefaultVisualStyle(style.id).then(() => message.success("已设为项目默认风格")).catch((error) => message.error(error.message))} askAgent={() => void askAgent()} />
        <VisualStyleTemplatePicker open={templatePickerOpen} templates={templates} selectedId={draft.templateId} onClose={() => setTemplatePickerOpen(false)} onSelect={selectTemplate} />
    </article>;
}

function VisualStyleEditorPopover({ anchorRef, open, onClose, theme, draft, template, isDefault, busy, dnaOpen, setDnaOpen, change, openTemplates, upload, analyze, generate, confirm, setDefault, askAgent }: {
    anchorRef: RefObject<HTMLElement | null>;
    open: boolean;
    onClose: () => void;
    theme: CanvasNodeContext["theme"];
    draft: VisualStyle;
    template?: VisualStyleTemplate;
    isDefault: boolean;
    busy: "upload" | "analyze" | "generate" | "";
    dnaOpen: boolean;
    setDnaOpen: (open: boolean) => void;
    change: (patch: Partial<VisualStyle>) => void;
    openTemplates: () => void;
    upload: () => void;
    analyze: () => void;
    generate: () => void;
    confirm: () => void;
    setDefault: () => void;
    askAgent: () => void;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    useEffect(() => {
        if (!open) return;
        const sync = () => setRect(anchorRef.current?.getBoundingClientRect() || null);
        const outside = (event: PointerEvent) => {
            const node = event.target;
            if (!(node instanceof Node) || anchorRef.current?.contains(node) || panelRef.current?.contains(node) || (node instanceof Element && node.closest(".visual-style-template-picker,.ant-dropdown,.ant-popover"))) return;
            onClose();
        };
        sync();
        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);
        window.addEventListener("pointerdown", outside, true);
        return () => { window.removeEventListener("resize", sync); window.removeEventListener("scroll", sync, true); window.removeEventListener("pointerdown", outside, true); };
    }, [anchorRef, onClose, open]);
    if (!open || !rect) return null;
    const width = Math.min(640, window.innerWidth - 32);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2));
    const below = window.innerHeight - rect.bottom > 390 || rect.top < 390;
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    return createPortal(<div ref={panelRef} data-testid="visual-style-editor" data-canvas-no-pan className="fixed z-[1180] rounded-[20px] border p-4 shadow-[0_22px_64px_rgba(15,23,42,.18)]" style={{ width, left, ...(below ? { top: rect.bottom + 10 } : { bottom: window.innerHeight - rect.top + 10 }), background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
        <header className="flex items-start gap-3">
            <div className="min-w-0 flex-1"><strong className="block text-sm">编辑视觉风格</strong><span className="mt-0.5 block text-[10px] opacity-45">修改会应用到后续角色、场景和道具生成</span></div>
            <Button type="text" size="small" icon={<Bot className="size-3.5" />} onClick={askAgent}>交给 Agent</Button>
            <Button aria-label="关闭风格编辑器" type="text" size="small" icon={<X className="size-4" />} onClick={onClose} />
        </header>
        {draft.references.source ? <div className="mt-3 flex items-center gap-2 rounded-xl border border-current/10 p-2"><img src={serverFileUrl(`server:${draft.references.source}`)} alt="来源参考" className="size-11 rounded-lg object-cover" /><div className="min-w-0 flex-1"><span className="block text-xs font-medium">来源参考</span><span className="text-[10px] opacity-45">用于提炼媒介、色彩、光线和质感</span></div><Button type="text" size="small" loading={busy === "analyze"} icon={<WandSparkles className="size-3.5" />} onClick={analyze}>重新分析</Button></div> : <button type="button" className="mt-3 flex h-12 w-full items-center gap-2 rounded-xl border border-dashed border-current/15 px-3 text-left text-xs opacity-60 hover:opacity-90" onClick={upload}><ImagePlus className="size-4" />上传来源参考图</button>}
        <Input.TextArea value={draft.description} onChange={(event) => change({ description: event.target.value, status: "draft" })} autoSize={{ minRows: 4, maxRows: 6 }} className="mt-3 !rounded-xl !px-3 !py-2.5 !text-sm !leading-6" placeholder="描述媒介、色彩、光影、线条、镜头和材质，不写具体角色或故事" />
        {dnaOpen ? <div className="mt-3 rounded-xl border border-current/10 p-3"><div className="mb-2 flex items-center justify-between text-xs font-medium"><span>完整 Style DNA</span><button type="button" className="opacity-45 hover:opacity-80" onClick={() => setDnaOpen(false)}>收起</button></div><DnaEditor value={draft.dna} onChange={(dna) => change({ dna, status: "draft" })} /></div> : null}
        <div className="mt-3 flex min-w-0 items-center gap-1 border-t border-current/10 pt-3">
            <button type="button" className="flex h-9 min-w-0 max-w-[190px] items-center gap-2 rounded-lg px-2 text-xs hover:bg-black/5 dark:hover:bg-white/10" onClick={openTemplates}><Palette className="size-4 shrink-0 text-[#d26b98]" /><span className="truncate">{template?.name || "选择内置风格"}</span><ChevronDown className="size-3.5 shrink-0 opacity-40" /></button>
            <button type="button" className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setDnaOpen(!dnaOpen)}>完整 Style DNA<ChevronDown className={`size-3.5 opacity-40 transition-transform ${dnaOpen ? "rotate-180" : ""}`} /></button>
            <button type="button" disabled={!draft.description.trim()} className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs hover:bg-black/5 disabled:opacity-35 dark:hover:bg-white/10" onClick={generate}><Sparkles className="size-3.5 text-[#d26b98]" />{busy === "generate" ? "提交中" : "生成风格板"}</button>
            <Button aria-label="应用视觉风格" type="primary" className="ml-auto !size-10 shrink-0 !rounded-full !p-0" icon={<ArrowUp className="size-4" />} disabled={!draft.description.trim()} onClick={() => { confirm(); onClose(); }} />
        </div>
        <div className="mt-2 flex items-center gap-2 px-1 text-[10px] opacity-45"><span>{draft.status === "confirmed" ? "已确认" : "自动保存草稿"}</span><span>·</span>{isDefault ? <span>项目默认</span> : <button type="button" className="hover:opacity-100" disabled={draft.status !== "confirmed"} onClick={setDefault}>设为项目默认</button>}<button type="button" className="ml-auto hover:opacity-100" onClick={() => change({ mode: "custom", templateId: null, status: "draft", dna: emptyDna })}>切换为自定义</button></div>
    </div>, document.body);
}

export const TemplatePickerModal = VisualStyleTemplatePicker;

export function shouldStopVisualStyleNodePointer(target: EventTarget | null) {
    return target instanceof Element && !target.closest(".visual-style-template-picker") && Boolean(target.closest("input,textarea,button,.ant-select,.ant-image"));
}

function DnaEditor({ value, onChange }: { value: VisualStyleDna; onChange: (value: VisualStyleDna) => void }) {
    const fields: Array<[Exclude<keyof VisualStyleDna, "exclusions" | "mediumFamily">, string]> = [["medium", "媒介"], ["rendering", "通用渲染"], ["characterRendering", "角色呈现"], ["sceneRendering", "场景呈现"], ["propRendering", "道具呈现"], ["palette", "色彩"], ["lighting", "光线"], ["contrast", "明暗"], ["texture", "质感"], ["lensAndDepth", "镜头"], ["composition", "构图"], ["postProcessing", "后期"]];
    return <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
        <Select size="small" className="w-full" value={value.mediumFamily} options={mediumFamilyOptions} onChange={(mediumFamily) => onChange({ ...value, mediumFamily })} />
        <div className="grid grid-cols-2 gap-1.5">{fields.map(([key, label]) => <Input key={key} size="small" value={value[key]} addonBefore={label} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />)}</div>
        <Input size="small" value={value.exclusions.join("，")} addonBefore="排除" placeholder="文字，水印，品牌标志" onChange={(event) => onChange({ ...value, exclusions: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} />
    </div>;
}

const mediumFamilyOptions: Array<{ value: VisualStyleDna["mediumFamily"]; label: string }> = [{ value: "live_action", label: "真人摄影" }, { value: "animation_2d", label: "二维动画" }, { value: "animation_3d", label: "三维动画" }, { value: "illustration", label: "插画" }, { value: "handmade", label: "手工媒介" }, { value: "graphic", label: "图形风格" }];

export function visualStyleTags(dna: VisualStyleDna) {
    const tags = [dna.palette, dna.lighting, dna.texture].map((item) => item.trim().split(/[、，,；;。]/)[0]?.trim().slice(0, 12)).filter(Boolean).slice(0, 3);
    return tags.length ? tags : ["待提炼 Style DNA"];
}
