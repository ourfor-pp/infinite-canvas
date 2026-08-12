import { useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Dropdown, Image as AntImage, Input } from "antd";
import { AudioLines, BookmarkPlus, Bot, Box, Check, CircleDot, ImagePlus, LockKeyhole, MapPinned, MoreHorizontal, Sparkles, Star, Upload, UserRound } from "lucide-react";

import { serverFileUrl, uploadServerFile } from "@/services/api/server";
import { randomId } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCreativeAssetStore } from "@/stores/use-creative-asset-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { CREATIVE_ASSET_NODE_LAYOUT, type CreativeAsset, type CreativeAssetKind, type CreativeAssetVariant } from "@/types/creative-asset";

const META = {
    character: { label: "角色", sheet: "角色设计图", icon: UserRound, accent: "#8b78d7", empty: "生成角色四视图" },
    scene: { label: "场景", sheet: "场景设计图", icon: MapPinned, accent: "#448d80", empty: "生成场景设计图" },
    prop: { label: "道具", sheet: "道具设计图", icon: Box, accent: "#a67b38", empty: "生成道具三视图" },
} satisfies Record<CreativeAssetKind, { label: string; sheet: string; icon: typeof UserRound; accent: string; empty: string }>;

export function CreativeAssetNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const assetId = ctx.node.metadata?.assetId || "";
    const asset = useCreativeAssetStore((state) => state.assets.find((item) => item.id === assetId));
    const generation = useCreativeAssetStore((state) => state.activeGenerations[assetId]);
    const normalized = useRef(false);
    useEffect(() => {
        if (!asset || normalized.current) return;
        normalized.current = true;
        const layout = CREATIVE_ASSET_NODE_LAYOUT[asset.kind];
        if (ctx.node.width !== layout.width || ctx.node.height !== layout.height) ctx.updateNode(layout);
    }, [asset, ctx]);
    if (!asset) return <LoadingAsset kind={(ctx.node.metadata?.assetKind || ctx.node.type) as CreativeAssetKind} ctx={ctx} />;
    return <CreativeAssetCard asset={asset} generation={generation} ctx={ctx} />;
}

function CreativeAssetCard({ asset, generation, ctx }: { asset: CreativeAsset; generation?: { status: string; progress: number }; ctx: CanvasNodeContext }) {
    const { message, modal } = App.useApp();
    const update = useCreativeAssetStore((state) => state.update);
    const generate = useCreativeAssetStore((state) => state.generate);
    const setPrimary = useCreativeAssetStore((state) => state.setPrimary);
    const remove = useCreativeAssetStore((state) => state.remove);
    const prepareComposer = useAgentStore((state) => state.prepareComposer);
    const [draft, setDraft] = useState(asset);
    const [sampleLine, setSampleLine] = useState("");
    const [busy, setBusy] = useState<"image" | "audio" | "upload" | "">("");
    const [dirty, setDirty] = useState(false);
    const draftRef = useRef(asset);
    const dirtyRef = useRef(false);
    const editVersionRef = useRef(0);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savePromiseRef = useRef<Promise<boolean> | null>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const meta = META[asset.kind];
    const Icon = meta.icon;
    const primaryImage = primaryVariant(asset, "image");
    const primaryAudio = primaryVariant(asset, "audio");
    const designVersions = asset.payload.variants.filter((item) => item.kind === "image" && item.usage !== "reference_input");
    const imageReferences = asset.payload.variants.filter((item) => item.kind === "image" && item.usage === "reference_input");
    const audioReferences = asset.payload.variants.filter((item) => item.kind === "audio" && item.usage === "reference_input");
    const inbound = ctx.getConnections().filter((connection) => connection.toNodeId === ctx.node.id);
    const linked = (portId: string) => inbound.filter((connection) => connection.toPortId === portId).length;

    useEffect(() => {
        if (dirtyRef.current) return;
        draftRef.current = asset;
        setDraft(asset);
    }, [asset]);
    useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

    const change = (patch: Partial<CreativeAsset>) => {
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        dirtyRef.current = true;
        editVersionRef.current += 1;
        setDirty(true);
        setDraft(next);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => void commit(), 600);
    };
    const changePayload = (patch: Partial<CreativeAsset["payload"]>) => change({ payload: { ...draftRef.current.payload, ...patch } });
    const commit = async (): Promise<boolean> => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (savePromiseRef.current) return savePromiseRef.current.then(() => dirtyRef.current ? commit() : true);
        if (!dirtyRef.current) return true;
        const version = editVersionRef.current;
        const snapshot = draftRef.current;
        dirtyRef.current = false;
        savePromiseRef.current = update(asset.id, { name: snapshot.name, status: snapshot.status, payload: { description: snapshot.payload.description, voiceDescription: snapshot.payload.voiceDescription } })
            .then((saved) => {
                ctx.updateNode({ title: saved.name });
                if (editVersionRef.current === version) { draftRef.current = saved; setDraft(saved); setDirty(false); }
                return true;
            })
            .catch((error) => {
                dirtyRef.current = true;
                setDirty(true);
                message.error(error instanceof Error ? error.message : "设定保存失败");
                return false;
            })
            .finally(() => { savePromiseRef.current = null; });
        return savePromiseRef.current;
    };
    const runGeneration = async (kind: "image" | "audio") => {
        if (kind === "audio" && !sampleLine.trim()) return message.warning("请先输入一句试听台词");
        if (!await commit()) return;
        setBusy(kind);
        try {
            await generate(asset.id, { nodeId: ctx.node.id, kind, usage: kind === "image" ? "design_sheet" : "voice_reference", label: kind === "image" ? meta.sheet : "角色声音", ...(kind === "audio" ? { transcript: sampleLine.trim() } : {}) });
            message.success(kind === "image" ? `${meta.sheet}生成已开始` : "角色声音生成已开始");
            if (kind === "audio") setSampleLine("");
        } catch (error) { message.error(error instanceof Error ? error.message : "生成失败"); }
        finally { setBusy(""); }
    };
    const uploadReference = async (kind: "image" | "audio", file: File) => {
        setBusy("upload");
        try {
            if (!await commit()) return;
            const uploaded = await uploadServerFile(file, file.name);
            const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
            const variant: CreativeAssetVariant = { id: randomId(), kind, fileId: uploaded.fileId, label: kind === "image" ? "参考图" : "参考声音", prompt: "", usage: "reference_input", createdAt: new Date().toISOString() };
            await update(asset.id, { payload: { variants: [...current.payload.variants, variant] } });
            message.success(kind === "image" ? "参考图已上传" : "参考声音已上传");
        } catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); }
        finally { setBusy(""); }
    };
    const askAgent = async () => {
        if (!await commit()) return;
        prepareComposer(asset.projectId, { kind: "asset", projectId: asset.projectId, assetId: asset.id, nodeId: ctx.node.id, title: draftRef.current.name, subtitle: meta.label });
    };
    const collect = async () => {
        if (!await commit()) return;
        const current = useCreativeAssetStore.getState().assets.find((item) => item.id === asset.id) || asset;
        const library = useAssetStore.getState();
        const existing = library.assets.find((item) => item.kind === current.kind && item.metadata?.sourceAssetId === current.id);
        const snapshot = { kind: current.kind, name: current.name, status: current.status, payload: current.payload } as const;
        const saved = { kind: current.kind, title: current.name, coverUrl: primaryImage ? serverFileUrl(`server:${primaryImage.fileId}`) : "", tags: [] as string[], source: "Canvas", note: current.payload.description, data: { snapshot }, metadata: { source: "canvas-business-node", sourceAssetId: current.id, projectId: current.projectId } } as const;
        existing ? library.updateAsset(existing.id, saved) : library.addAsset(saved);
        message.success(existing ? "资产库快照已更新" : "已收藏到资产库");
    };
    const setStatus = (status: CreativeAsset["status"]) => {
        const perform = () => change({ status });
        if (status === "draft" && asset.status !== "draft") modal.confirm({ title: "解除当前设定状态？", content: "资产会恢复为可持续修改的草稿状态。", okText: "解除", cancelText: "取消", onOk: perform });
        else perform();
    };
    const menu = { items: [
        { key: "draft", label: "设为草稿", icon: <CircleDot className="size-3.5" />, onClick: () => setStatus("draft") },
        { key: "confirmed", label: "确认设定", icon: <Check className="size-3.5" />, onClick: () => setStatus("confirmed") },
        { key: "locked", label: "锁定设定", icon: <LockKeyhole className="size-3.5" />, onClick: () => setStatus("locked") },
        { type: "divider" as const },
        { key: "reference", label: "上传参考图", icon: <Upload className="size-3.5" />, onClick: () => imageInputRef.current?.click() },
        { key: "collect", label: "收藏到资产库", icon: <BookmarkPlus className="size-3.5" />, onClick: () => void collect() },
        { type: "divider" as const },
        { key: "delete", danger: true, label: `永久删除${meta.label}`, onClick: () => modal.confirm({ title: `永久删除“${asset.name}”？`, content: "该资产的所有画布视图都会移除，媒体历史也将失去资产引用。", okText: "永久删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => remove(asset.id) }) },
    ] };
    const previewItems = [...designVersions, ...imageReferences];

    return <article className="relative flex size-full flex-col overflow-hidden p-4" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} data-canvas-no-zoom onMouseDownCapture={(event) => { if ((event.target as Element)?.closest("input,textarea,button,audio,.ant-dropdown,.ant-image")) event.stopPropagation(); }}>
        <header className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: `${meta.accent}70`, color: meta.accent }}><Icon className="size-4" /></span>
            <Input variant="borderless" className="min-w-0 flex-1 !px-1 !text-lg !font-semibold" value={draft.name} onChange={(event) => change({ name: event.target.value })} aria-label={`${meta.label}名称`} />
            {dirty ? <span className="size-1.5 rounded-full" title="正在自动保存" style={{ background: meta.accent }} /> : null}
            {asset.status === "locked" ? <LockKeyhole className="size-3.5 opacity-45" /> : asset.status === "confirmed" ? <Check className="size-3.5 opacity-45" /> : null}
            <Dropdown trigger={["click"]} menu={menu}><Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} /></Dropdown>
        </header>

        <div className="mb-2 mt-4 flex items-center justify-between text-[10px] font-medium tracking-wide" style={{ color: ctx.theme.node.muted }}><span>{meta.sheet}</span><PortHint label="参考图" count={linked("reference-image")} icon={<ImagePlus className="size-3" />} /></div>
        <AntImage.PreviewGroup>
            <div className="relative aspect-video shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: ctx.theme.node.stroke, background: `${meta.accent}0c` }}>
                {primaryImage ? <AntImage rootClassName="size-full" src={serverFileUrl(`server:${primaryImage.fileId}`)} alt={asset.name} className="!size-full !object-contain" preview={{ mask: "查看设计图" }} /> : <EmptySheet asset={asset} />}
                {generation ? <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10"><span className="block h-full transition-[width]" style={{ width: `${Math.max(4, Math.round(generation.progress * 100))}%`, background: meta.accent }} /></div> : null}
            </div>
            {previewItems.length > 1 || imageReferences.length ? <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {previewItems.map((variant) => <div key={variant.id} className="group relative aspect-video w-16 shrink-0 overflow-hidden rounded border" style={{ borderColor: variant.id === asset.payload.primaryImageId ? meta.accent : ctx.theme.node.stroke }}>
                    <AntImage rootClassName="size-full" src={serverFileUrl(`server:${variant.fileId}`)} alt={variant.label} className={`!size-full !object-cover ${variant.usage === "reference_input" ? "opacity-70" : ""}`} preview={{ mask: false }} />
                    {variant.usage === "reference_input" ? <span className="pointer-events-none absolute bottom-0 left-0 bg-black/60 px-1 text-[8px] text-white">参考</span> : variant.id !== asset.payload.primaryImageId ? <button type="button" title="设为主图" aria-label="设为主图" onClick={(event) => { event.stopPropagation(); void setPrimary(asset.id, variant.id); }} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded bg-black/55 text-white opacity-0 transition group-hover:opacity-100"><Star className="size-3" /></button> : <span className="pointer-events-none absolute right-0.5 top-0.5 grid size-5 place-items-center rounded bg-black/55 text-white"><Star className="size-3 fill-current" /></span>}
                </div>)}
            </div> : null}
        </AntImage.PreviewGroup>

        <label className="mt-3 block"><span className="mb-1.5 flex items-center justify-between text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}><span>描述</span><span className="flex gap-1"><PortHint label="设定文字" count={linked("setting")} /><PortHint label="风格" count={linked("style")} /></span></span><Input.TextArea value={draft.payload.description} onChange={(event) => changePayload({ description: event.target.value })} autoSize={{ minRows: asset.kind === "character" ? 5 : 6, maxRows: asset.kind === "character" ? 5 : 6 }} placeholder={descriptionPlaceholder(asset.kind)} /></label>

        {asset.kind === "character" ? <section className="mt-3 border-t pt-3" style={{ borderColor: ctx.theme.node.stroke }}>
            <div className="flex items-center gap-2"><AudioLines className="size-4" style={{ color: meta.accent }} /><span className="text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}>声音</span><PortHint label="参考声音" count={linked("reference-audio")} />{audioReferences.length ? <span className="text-[9px] opacity-45">已上传参考</span> : null}<button type="button" className="ml-auto flex items-center gap-1 text-[10px] opacity-50 hover:opacity-100" onClick={() => audioInputRef.current?.click()}><Upload className="size-3" />上传参考</button></div>
            <Input.TextArea className="mt-2" value={draft.payload.voiceDescription} onChange={(event) => changePayload({ voiceDescription: event.target.value })} autoSize={{ minRows: 2, maxRows: 2 }} placeholder="音色、语速、口音和情绪质感" />
            {primaryAudio ? <audio src={serverFileUrl(`server:${primaryAudio.fileId}`)} controls className="mt-2 h-8 w-full" /> : null}
            <div className="mt-2 flex items-center gap-2"><Input className="min-w-0 flex-1" size="small" value={sampleLine} onChange={(event) => setSampleLine(event.target.value)} placeholder="输入一句试听台词" /><Button size="small" icon={<Sparkles className="size-3" />} loading={busy === "audio"} onClick={() => void runGeneration("audio")}>{primaryAudio ? "重新生成" : "生成声音"}</Button></div>
        </section> : null}

        <div className="mt-auto grid grid-cols-[auto_1fr] gap-2 pt-3"><Button icon={<Bot className="size-3.5" />} onClick={() => void askAgent()}>交给 Agent</Button><Button type="primary" icon={<Sparkles className="size-3.5" />} loading={busy === "image" || Boolean(generation)} onClick={() => void runGeneration("image")}>{generation ? `生成中 ${Math.round(generation.progress * 100)}%` : primaryImage ? `重新生成${meta.sheet}` : `生成${meta.sheet}`}</Button></div>

        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadReference("image", file); }} />
        <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadReference("audio", file); }} />
    </article>;
}

function PortHint({ label, count, icon }: { label: string; count: number; icon?: ReactNode }) { return count ? <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] opacity-65">{icon}{label} · {count}</span> : null; }
function EmptySheet({ asset }: { asset: CreativeAsset }) { const meta = META[asset.kind]; const Icon = meta.icon; return <span className="grid size-full place-items-center"><span className="text-center"><Icon className="mx-auto size-12 opacity-15" /><span className="mt-2 block text-[10px] opacity-45">{meta.empty}</span></span></span>; }
function LoadingAsset({ kind, ctx }: { kind: CreativeAssetKind; ctx: CanvasNodeContext }) { const meta = META[kind] || META.character; const Icon = meta.icon; return <div className="grid size-full place-items-center" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.muted }}><div className="text-center"><Icon className="mx-auto size-8 opacity-20" /><p className="mt-3 text-[10px] tracking-[0.18em]">正在读取{meta.label}设定</p></div></div>; }
function primaryVariant(asset: CreativeAsset, kind: "image" | "audio") { const id = kind === "image" ? asset.payload.primaryImageId : asset.payload.primaryAudioId; return asset.payload.variants.find((item) => item.kind === kind && item.id === id); }
function descriptionPlaceholder(kind: CreativeAssetKind) { return kind === "character" ? "描述年龄感、体态、面部、发型、服装、配饰和标志性色彩" : kind === "scene" ? "描述空间结构、固定陈设、材质、光线、色调和标志性细节" : "描述形态、材质、尺寸、颜色、纹理、磨损和可识别细节"; }
