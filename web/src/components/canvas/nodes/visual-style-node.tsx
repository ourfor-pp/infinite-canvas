import { useEffect, useRef, useState } from "react";
import { App, Button, Dropdown, Image, Input, Modal, Tooltip } from "antd";
import { Bot, Check, ImagePlus, MoreHorizontal, Palette, Search, Sparkles, Star, WandSparkles } from "lucide-react";

import { serverApi, serverFileUrl, uploadServerFile } from "@/services/api/server";
import { filterVisualStyleTemplates } from "@/lib/canvas/visual-style-templates";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { VisualStyle, VisualStyleDna, VisualStyleReferenceRole, VisualStyleTemplate, VisualStyleTemplateCategory } from "@/types/visual-style";

const referenceRoles = [
    { role: "character", label: "角色样张", hint: "白底造型" },
    { role: "scene", label: "场景样张", hint: "无人空间" },
    { role: "prop", label: "道具样张", hint: "白底材质" },
] as const;
const emptyDna: VisualStyleDna = { medium: "", rendering: "", palette: "", lighting: "", contrast: "", texture: "", lensAndDepth: "", composition: "", postProcessing: "", exclusions: [] };
const templateCategories: Array<{ value: "all" | VisualStyleTemplateCategory; label: string }> = [{ value: "all", label: "全部" }, { value: "cinematic", label: "电影基底" }, { value: "genre", label: "类型片" }, { value: "eastern", label: "东方影像" }, { value: "animation", label: "动画" }, { value: "handmade", label: "手工媒介" }, { value: "graphic", label: "图形实验" }];
const templateAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

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
    const dirtyRef = useRef(false);
    const draftRef = useRef(style);
    const savePromiseRef = useRef<Promise<boolean> | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (!dirtyRef.current) { draftRef.current = style; setDraft(style); } }, [style]);
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
            message.success(kind === "analyze" ? "风格分析已进入任务队列" : "三类风格样张已进入任务队列");
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
    const colors = template?.colors || ["#26323a", "#8b7764", "#ded6c8"];
    const hasGeneratedReferences = referenceRoles.some(({ role }) => Boolean(draft.references[role]));

    return <article className="relative flex size-full flex-col overflow-hidden p-4" data-canvas-no-zoom style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} onMouseDownCapture={(event) => { if (shouldStopVisualStyleNodePointer(event.target)) event.stopPropagation(); }}>
        <header className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg border" style={{ borderColor: "#d26b9870", color: "#d26b98" }}><Palette className="size-4" /></span>
            <Input variant="borderless" className="min-w-0 flex-1 !px-1 !text-lg !font-semibold" value={draft.name} onChange={(event) => change({ name: event.target.value, status: "draft" })} />
            {saving ? <span className="text-[9px] opacity-40">保存中</span> : null}
            <Tooltip title="交给 Agent"><Button type="text" size="small" icon={<Bot className="size-4" />} onClick={() => void askAgent()} /></Tooltip>
            <Dropdown menu={{ items: [{ key: "delete", danger: true, label: "永久删除风格" }], onClick: ({ key }) => key === "delete" && Modal.confirm({ title: "永久删除这个视觉风格？", content: "所有画布视图和相关连接都会移除，此操作不可撤销。", okText: "永久删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => remove(style.id) }) }} trigger={["click"]}><Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} /></Dropdown>
        </header>

        {draft.status === "draft" ? <div className="mt-2 rounded-lg border border-current/10 px-2.5 py-2 text-[10px] leading-4 opacity-65"><strong className="font-medium opacity-100">选择一种起步方式：</strong>选下方模板最快；有参考图就上传并分析；也可以点击右上角 Agent 生成风格描述。样张用于检查三类资产是否统一，满意后点击底部确认。</div> : null}

        {template && !hasGeneratedReferences ? <button type="button" className="group relative mt-3 aspect-video overflow-hidden rounded-xl border border-current/10 text-left" onClick={() => setTemplatePickerOpen(true)}>
            <img src={templateAssetUrl(template.preview)} alt={`${template.name}风格预览`} className="size-full object-cover transition duration-300 group-hover:scale-[1.015]" />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-white"><strong className="block text-xs font-medium">{template.name}</strong><span className="text-[9px] opacity-75">人物 · 场景 · 道具统一预览</span></span>
        </button> : <div className="mt-3 grid grid-cols-3 gap-1.5">{referenceRoles.map(({ role, label, hint }) => <ReferenceTile key={role} role={role} label={label} hint={hint} fileId={draft.references[role]} colors={colors} />)}</div>}
        <div className="mt-2 flex items-center gap-2">
            <Button type="text" size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => fileRef.current?.click()} loading={busy === "upload"}>{draft.references.source ? "替换来源图" : "上传来源图"}</Button>
            {draft.references.source ? <Button type="text" size="small" icon={<WandSparkles className="size-3.5" />} loading={busy === "analyze"} onClick={() => void run("analyze")}>分析风格</Button> : null}
            <Button type="text" size="small" disabled={!draft.description.trim()} icon={<Sparkles className="size-3.5" />} loading={busy === "generate"} onClick={() => void run("generate")}>生成样张</Button>
        </div>

        <div className="mt-2 flex gap-1.5"><Button className="min-w-0 flex-1" onClick={() => setTemplatePickerOpen(true)} icon={<Palette className="size-3.5" />}>{template ? `内置 · ${template.name}` : "浏览内置风格"}</Button><Button onClick={() => change({ mode: "custom", templateId: null, status: "draft", dna: emptyDna })}>自定义</Button></div>
        <Input.TextArea className="mt-2" value={draft.description} onChange={(event) => change({ description: event.target.value, status: "draft" })} autoSize={{ minRows: 4, maxRows: 4 }} placeholder="描述媒介、色彩、光影、线条、镜头和材质，不写具体角色或故事" />
        <button type="button" className="mt-2 flex items-center justify-between py-1 text-[10px] opacity-55 hover:opacity-80" onClick={() => setDnaOpen((value) => !value)}><span>Style DNA · {dnaSummary(draft.dna)}</span><span>{dnaOpen ? "收起" : "编辑"}</span></button>
        {dnaOpen ? <DnaEditor value={draft.dna} onChange={(dna) => change({ dna, status: "draft" })} /> : null}

        <footer className="mt-auto flex items-center gap-2 pt-3">
            {draft.status === "confirmed" ? <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-emerald-600"><Check className="size-3.5" />风格已确认</span> : <Button className="flex-1" disabled={!draft.description.trim()} icon={<Check className="size-3.5" />} onClick={() => void confirmStyle()}>确认当前风格</Button>}
            {isDefault ? <span className="flex items-center gap-1 text-[10px] text-amber-600"><Star className="size-3.5 fill-current" />项目默认</span> : <Button type="text" size="small" disabled={draft.status !== "confirmed"} icon={<Star className="size-3.5" />} onClick={() => void serverApi.setDefaultVisualStyle(style.id).then(() => message.success("已设为项目默认风格")).catch((error) => message.error(error.message))}>设为默认</Button>}
        </footer>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
        <TemplatePickerModal open={templatePickerOpen} templates={templates} selectedId={draft.templateId} onClose={() => setTemplatePickerOpen(false)} onSelect={selectTemplate} />
    </article>;
}

export function TemplatePickerModal({ open, templates, selectedId, onClose, onSelect }: { open: boolean; templates: VisualStyleTemplate[]; selectedId: string | null; onClose: () => void; onSelect: (id: string) => void }) {
    const [category, setCategory] = useState<"all" | VisualStyleTemplateCategory>("all");
    const [query, setQuery] = useState("");
    const visible = filterVisualStyleTemplates(templates, category, query);
    const stopCanvasEvent = (event: { stopPropagation: () => void }) => event.stopPropagation();
    return <div className="contents" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent} onDoubleClick={stopCanvasEvent} onContextMenu={stopCanvasEvent} onWheel={stopCanvasEvent} onKeyDown={stopCanvasEvent}><Modal rootClassName="visual-style-template-picker" open={open} onCancel={onClose} footer={null} width={1040} centered title={<div className="flex items-center gap-3 pr-8"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-current/10"><Palette className="size-4" /></span><div><div className="text-[15px] font-semibold leading-5">浏览影视视觉风格</div><div className="mt-0.5 text-[11px] font-normal leading-4 opacity-50">人物、场景与道具共享同一套 Style DNA</div></div></div>} destroyOnHidden>
        <div className="mb-4 flex min-w-0 items-end gap-4 border-b border-current/10">
            <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">{templateCategories.map((item) => <button key={item.value} type="button" className={`relative shrink-0 whitespace-nowrap px-0.5 pb-2.5 pt-1 text-[13px] transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full ${category === item.value ? "text-blue-600 after:bg-blue-600" : "opacity-60 after:bg-transparent hover:opacity-100"}`} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
            <Input variant="borderless" value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search className="size-3.5 opacity-40" />} placeholder="搜索风格或题材" className="mb-1.5 !h-8 !w-56 shrink-0 !rounded-lg !bg-black/[0.035] !px-2.5 dark:!bg-white/[0.06]" />
        </div>
        <div className="grid max-h-[68vh] grid-cols-2 gap-3 overflow-y-auto pr-1 md:grid-cols-3">
            {visible.map((item) => <button key={item.id} data-testid={`visual-style-template-${item.id}`} type="button" className={`group overflow-hidden rounded-xl border text-left transition-colors ${selectedId === item.id ? "border-blue-500 ring-2 ring-blue-500/15" : "border-current/10 hover:border-current/25"}`} onClick={() => onSelect(item.id)}>
                <div className="relative aspect-video overflow-hidden"><img src={templateAssetUrl(item.preview)} alt={`${item.name}人物场景道具预览`} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.02]" />{selectedId === item.id ? <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-blue-600 text-white"><Check className="size-3.5" /></span> : null}</div>
                <div className="px-3 py-2.5"><strong className="block text-[13px] font-semibold">{item.name}</strong><span className="mt-0.5 block text-[11px] leading-4 opacity-50">{item.tagline}</span></div>
            </button>)}
        </div>
        {!visible.length ? <div className="py-16 text-center text-sm opacity-45">没有匹配的风格</div> : null}
    </Modal></div>;
}

export function shouldStopVisualStyleNodePointer(target: EventTarget | null) {
    return target instanceof Element && !target.closest(".visual-style-template-picker") && Boolean(target.closest("input,textarea,button,.ant-select,.ant-image"));
}

function ReferenceTile({ role, label, hint, fileId, colors }: { role: VisualStyleReferenceRole; label: string; hint: string; fileId?: string; colors: readonly string[] }) {
    return <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-current/10" title={label} style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]} 55%, ${colors[2]})` }}>
        {fileId ? <Image rootClassName="size-full" src={serverFileUrl(`server:${fileId}`)} alt={label} className="!size-full !object-cover" preview={{ mask: false }} /> : <div className="absolute inset-0 grid place-items-center bg-black/10 px-1 text-center text-[9px] text-white/85"><span><strong className="block font-medium">{label}</strong>{hint}</span></div>}
    </div>;
}

function DnaEditor({ value, onChange }: { value: VisualStyleDna; onChange: (value: VisualStyleDna) => void }) {
    const fields: Array<[Exclude<keyof VisualStyleDna, "exclusions">, string]> = [["medium", "媒介"], ["rendering", "渲染"], ["palette", "色彩"], ["lighting", "光线"], ["contrast", "明暗"], ["texture", "质感"], ["lensAndDepth", "镜头"], ["composition", "构图"], ["postProcessing", "后期"]];
    return <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-1.5">{fields.map(([key, label]) => <Input key={key} size="small" value={value[key]} addonBefore={label} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />)}</div>
        <Input size="small" value={value.exclusions.join("，")} addonBefore="排除" placeholder="文字，水印，品牌标志" onChange={(event) => onChange({ ...value, exclusions: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} />
    </div>;
}

function dnaSummary(dna: VisualStyleDna) {
    const values = [dna.medium, dna.palette, dna.lighting].filter(Boolean);
    return values.length ? values.join(" · ") : "尚未提炼";
}
