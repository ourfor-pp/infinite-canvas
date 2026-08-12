import { useEffect, useRef, useState } from "react";
import { App, Button, Dropdown, Image, Input, Modal, Select } from "antd";
import { Bot, Check, ImagePlus, MoreHorizontal, Palette, Star } from "lucide-react";

import { serverApi, serverFileUrl, uploadServerFile } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { VisualStyle } from "@/types/visual-style";

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
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === style.projectId));
    const prepareComposer = useAgentStore((state) => state.prepareComposer);
    const [draft, setDraft] = useState(style);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
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
        savePromiseRef.current = update(style.id, { name: snapshot.name, mode: snapshot.mode, templateId: snapshot.templateId, description: snapshot.description, referenceFileId: snapshot.referenceFileId })
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
        if (template) change({ mode: "template", templateId, name: template.name, description: template.description, referenceFileId: null });
    };
    const upload = async (file: File) => {
        setUploading(true);
        try {
            if (!await commit()) return;
            const uploaded = await uploadServerFile(file, file.name);
            const current = draftRef.current;
            const updated = await update(style.id, { name: current.name, mode: "custom", templateId: null, description: current.description, referenceFileId: uploaded.fileId });
            dirtyRef.current = false;
            draftRef.current = updated;
            setDraft(updated);
            message.success("风格参考图已上传");
        } catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); }
        finally { setUploading(false); }
    };
    const askAgent = async () => {
        if (!await commit()) return;
        prepareComposer(style.projectId, { kind: "style", projectId: style.projectId, styleId: style.id, nodeId: ctx.node.id, title: draft.name, subtitle: "视觉风格" });
    };
    const isDefault = project?.defaultVisualStyleId === style.id;
    const template = templates.find((item) => item.id === draft.templateId);
    const colors = template?.colors || ["#2f263d", "#956c82", "#dec9b8"];

    return <article className="relative flex size-full flex-col overflow-hidden p-4" data-canvas-no-zoom style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} onMouseDownCapture={(event) => { if ((event.target as Element)?.closest("input,textarea,button,.ant-select,.ant-image")) event.stopPropagation(); }}>
        <header className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg border" style={{ borderColor: "#d26b9870", color: "#d26b98" }}><Palette className="size-4" /></span>
            <Input variant="borderless" className="min-w-0 flex-1 !px-1 !text-lg !font-semibold" value={draft.name} onChange={(event) => change({ name: event.target.value })} />
            {saving ? <span className="text-[9px] opacity-40">保存中</span> : null}
            {isDefault ? <span title="项目默认风格" className="grid size-7 place-items-center"><Star className="size-3.5 fill-current text-amber-500" /></span> : <Button type="text" size="small" title="设为项目默认" icon={<Star className="size-3.5" />} onClick={() => void serverApi.setDefaultVisualStyle(style.id).then(() => message.success("已设为项目默认风格"))} />}
            <Dropdown menu={{ items: [{ key: "delete", danger: true, label: "永久删除风格" }], onClick: ({ key }) => key === "delete" && Modal.confirm({ title: "永久删除这个视觉风格？", content: "所有画布视图和相关连接都会移除，此操作不可撤销。", okText: "永久删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => remove(style.id) }) }} trigger={["click"]}><Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} /></Dropdown>
        </header>

        <div className="relative mt-4 aspect-video overflow-hidden rounded-xl border" style={{ borderColor: ctx.theme.node.stroke, background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]} 55%, ${colors[2]})` }}>
            {draft.referenceFileId ? <Image rootClassName="size-full" src={serverFileUrl(`server:${draft.referenceFileId}`)} alt={draft.name} className="!size-full !object-cover" preview={{ mask: "预览风格参考" }} /> : <div className="absolute inset-0 grid place-items-center"><div className="rounded-full border border-white/30 bg-black/15 px-4 py-1.5 text-xs text-white backdrop-blur">{template?.name || "自定义视觉风格"}</div></div>}
            <button type="button" className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/45 px-2 py-1 text-[10px] text-white backdrop-blur hover:bg-black/60" onClick={() => fileRef.current?.click()}><ImagePlus className="size-3" />{draft.referenceFileId ? "替换参考" : "上传参考"}</button>
        </div>

        <label className="mt-3 block text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}>风格来源</label>
        <Select className="mt-1 w-full" value={draft.mode === "template" ? draft.templateId : "custom"} onChange={(value) => value === "custom" ? change({ mode: "custom", templateId: null }) : selectTemplate(value)} options={[{ value: "custom", label: "自定义描述 / 参考图" }, { label: "真人影像", options: templates.filter((item) => item.category === "live").map((item) => ({ value: item.id, label: item.name })) }, { label: "动画风格", options: templates.filter((item) => item.category === "anim").map((item) => ({ value: item.id, label: item.name })) }]} />
        <label className="mt-3 block text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}>风格描述</label>
        <Input.TextArea className="mt-1" value={draft.description} onChange={(event) => change({ description: event.target.value, mode: draft.mode })} autoSize={{ minRows: 6, maxRows: 6 }} placeholder="媒介、色彩、光影、线条、镜头和材质质感" />

        <div className="mt-auto flex items-center gap-2 pt-3">
            <Button block icon={<Bot className="size-3.5" />} onClick={() => void askAgent()}>{draft.referenceFileId ? "让 Agent 分析并完善" : "交给 Agent 完善"}</Button>
            {isDefault ? <span className="grid size-8 shrink-0 place-items-center rounded-lg" title="已应用为默认"><Check className="size-4 text-emerald-500" /></span> : null}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
        {uploading ? <div className="absolute inset-0 grid place-items-center bg-black/20 text-xs text-white backdrop-blur-sm">正在上传参考图…</div> : null}
    </article>;
}
