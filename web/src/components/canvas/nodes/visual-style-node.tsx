import { useEffect, useRef, useState } from "react";
import { App, Button, Dropdown, Image, Input, Modal, Select, Tooltip } from "antd";
import { Bot, Check, ImagePlus, MoreHorizontal, Palette, Sparkles, Star, WandSparkles } from "lucide-react";

import { serverApi, serverFileUrl, uploadServerFile } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { VisualStyle, VisualStyleDna, VisualStyleReferenceRole } from "@/types/visual-style";

const referenceRoles = [
    { role: "character", label: "角色样张", hint: "白底造型" },
    { role: "scene", label: "场景样张", hint: "无人空间" },
    { role: "prop", label: "道具样张", hint: "白底材质" },
] as const;
const emptyDna: VisualStyleDna = { medium: "", rendering: "", palette: "", lighting: "", contrast: "", texture: "", lensAndDepth: "", composition: "", postProcessing: "", exclusions: [] };

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
        if (template) change({ mode: "template", templateId, name: template.name, description: template.description, status: "draft", dna: emptyDna });
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
        try { const saved = await update(style.id, { status: "confirmed" }); draftRef.current = saved; setDraft(saved); message.success("视觉风格已确认"); }
        catch (error) { message.error(error instanceof Error ? error.message : "确认失败"); }
    };
    const askAgent = async () => {
        if (!await commit()) return;
        prepareComposer(style.projectId, { kind: "style", projectId: style.projectId, styleId: style.id, nodeId: ctx.node.id, title: draft.name, subtitle: "视觉风格" });
    };
    const isDefault = project?.defaultVisualStyleId === style.id;
    const template = templates.find((item) => item.id === draft.templateId);
    const colors = template?.colors || ["#26323a", "#8b7764", "#ded6c8"];

    return <article className="relative flex size-full flex-col overflow-hidden p-4" data-canvas-no-zoom style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} onMouseDownCapture={(event) => { if ((event.target as Element)?.closest("input,textarea,button,.ant-select,.ant-image")) event.stopPropagation(); }}>
        <header className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg border" style={{ borderColor: "#d26b9870", color: "#d26b98" }}><Palette className="size-4" /></span>
            <Input variant="borderless" className="min-w-0 flex-1 !px-1 !text-lg !font-semibold" value={draft.name} onChange={(event) => change({ name: event.target.value, status: "draft" })} />
            {saving ? <span className="text-[9px] opacity-40">保存中</span> : null}
            <Tooltip title="交给 Agent"><Button type="text" size="small" icon={<Bot className="size-4" />} onClick={() => void askAgent()} /></Tooltip>
            <Dropdown menu={{ items: [{ key: "delete", danger: true, label: "永久删除风格" }], onClick: ({ key }) => key === "delete" && Modal.confirm({ title: "永久删除这个视觉风格？", content: "所有画布视图和相关连接都会移除，此操作不可撤销。", okText: "永久删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => remove(style.id) }) }} trigger={["click"]}><Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} /></Dropdown>
        </header>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
            {referenceRoles.map(({ role, label, hint }) => <ReferenceTile key={role} role={role} label={label} hint={hint} fileId={draft.references[role]} colors={colors} />)}
        </div>
        <div className="mt-2 flex items-center gap-2">
            <Button type="text" size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => fileRef.current?.click()} loading={busy === "upload"}>{draft.references.source ? "替换来源图" : "上传来源图"}</Button>
            {draft.references.source ? <Button type="text" size="small" icon={<WandSparkles className="size-3.5" />} loading={busy === "analyze"} onClick={() => void run("analyze")}>分析风格</Button> : null}
            <Button type="text" size="small" icon={<Sparkles className="size-3.5" />} loading={busy === "generate"} onClick={() => void run("generate")}>生成样张</Button>
        </div>

        <Select className="mt-2 w-full" value={draft.mode === "template" ? draft.templateId : "custom"} onChange={(value) => value === "custom" ? change({ mode: "custom", templateId: null, status: "draft" }) : selectTemplate(value)} options={[{ value: "custom", label: "自定义风格" }, { label: "真人影像", options: templates.filter((item) => item.category === "live").map((item) => ({ value: item.id, label: item.name })) }, { label: "动画风格", options: templates.filter((item) => item.category === "anim").map((item) => ({ value: item.id, label: item.name })) }]} />
        <Input.TextArea className="mt-2" value={draft.description} onChange={(event) => change({ description: event.target.value, status: "draft" })} autoSize={{ minRows: 4, maxRows: 4 }} placeholder="描述媒介、色彩、光影、线条、镜头和材质，不写具体角色或故事" />
        <button type="button" className="mt-2 flex items-center justify-between py-1 text-[10px] opacity-55 hover:opacity-80" onClick={() => setDnaOpen((value) => !value)}><span>Style DNA · {dnaSummary(draft.dna)}</span><span>{dnaOpen ? "收起" : "编辑"}</span></button>
        {dnaOpen ? <DnaEditor value={draft.dna} onChange={(dna) => change({ dna, status: "draft" })} /> : null}

        <footer className="mt-auto flex items-center gap-2 pt-3">
            {draft.status === "confirmed" ? <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-emerald-600"><Check className="size-3.5" />风格已确认</span> : <Button className="flex-1" icon={<Check className="size-3.5" />} onClick={() => void confirmStyle()}>确认当前风格</Button>}
            {isDefault ? <span className="flex items-center gap-1 text-[10px] text-amber-600"><Star className="size-3.5 fill-current" />项目默认</span> : <Button type="text" size="small" disabled={draft.status !== "confirmed"} icon={<Star className="size-3.5" />} onClick={() => void serverApi.setDefaultVisualStyle(style.id).then(() => message.success("已设为项目默认风格")).catch((error) => message.error(error.message))}>设为默认</Button>}
        </footer>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
    </article>;
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
