import { useEffect, useRef, useState } from "react";
import { App, Button, Dropdown, Input, Tooltip } from "antd";
import { BookmarkPlus, Bot, Box, Check, CircleDot, Headphones, ImageIcon, LockKeyhole, MapPinned, MoreHorizontal, SlidersHorizontal, UserRound } from "lucide-react";

import { MediaEditorPopover } from "@/components/canvas/media-editor/media-editor-popover";
import { MediaPreview } from "@/components/canvas/media-editor/media-preview";
import { useCreativeAssetMediaTarget } from "@/components/canvas/media-editor/creative-asset-target";
import { serverFileUrl } from "@/services/api/server";
import { buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { editCreativeAssetMediaEvent } from "@/lib/canvas/canvas-ui-events";
import { focusVisualStyleEvent } from "@/lib/canvas/canvas-ui-events";
import { createVisualStyleOverrideOps, inheritProjectVisualStyleOps } from "@/lib/canvas/visual-style-overrides";
import { randomId } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCreativeAssetStore } from "@/stores/use-creative-asset-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { CREATIVE_ASSET_NODE_LAYOUT, type CreativeAsset, type CreativeAssetKind } from "@/types/creative-asset";

const META = {
    character: { label: "角色", sheet: "角色设计图", audio: "角色声音", icon: UserRound, accent: "#8b78d7" },
    scene: { label: "场景", sheet: "场景设计图", audio: "环境声", icon: MapPinned, accent: "#448d80" },
    prop: { label: "道具", sheet: "道具设计图", audio: "道具音效", icon: Box, accent: "#a67b38" },
} satisfies Record<CreativeAssetKind, { label: string; sheet: string; audio: string; icon: typeof UserRound; accent: string }>;

export function CreativeAssetNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const assetId = ctx.node.metadata?.assetId || "";
    const asset = useCreativeAssetStore((state) => state.assets.find((item) => item.id === assetId));
    const generations = useCreativeAssetStore((state) => state.activeGenerations[assetId]);
    const normalized = useRef(false);
    useEffect(() => {
        if (!asset || normalized.current) return;
        normalized.current = true;
        const layout = CREATIVE_ASSET_NODE_LAYOUT[asset.kind];
        if (ctx.node.width !== layout.width || ctx.node.height !== layout.height) ctx.updateNode(layout);
    }, [asset, ctx]);
    if (!asset) return <LoadingAsset kind={(ctx.node.metadata?.assetKind || ctx.node.type) as CreativeAssetKind} ctx={ctx} />;
    return <CreativeAssetCard asset={asset} generations={generations} ctx={ctx} />;
}

function CreativeAssetCard({ asset, generations, ctx }: { asset: CreativeAsset; generations?: Partial<Record<"image" | "audio", { id: string; status: string; progress: number }>>; ctx: CanvasNodeContext }) {
    const { message, modal } = App.useApp();
    const update = useCreativeAssetStore((state) => state.update);
    const remove = useCreativeAssetStore((state) => state.remove);
    const [draft, setDraft] = useState(asset);
    const [dirty, setDirty] = useState(false);
    const [editor, setEditor] = useState<"image" | "audio" | null>(null);
    const draftRef = useRef(asset);
    const dirtyRef = useRef(false);
    const versionRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const promiseRef = useRef<Promise<boolean> | null>(null);
    const imageAnchorRef = useRef<HTMLDivElement>(null);
    const audioAnchorRef = useRef<HTMLDivElement>(null);
    const meta = META[asset.kind];
    const Icon = meta.icon;
    const primaryImage = primaryVariant(asset, "image");
    const primaryAudio = primaryVariant(asset, "audio");
    const inbound = ctx.getConnections().filter((connection) => connection.toNodeId === ctx.node.id);
    const linked = (portId: string) => inbound.filter((connection) => connection.toPortId === portId).length;
    const canvasReferences = buildCanvasResourceReferences(ctx.getNodes()).map((reference) => ({ ...reference, active: inbound.some((connection) => connection.fromNodeId === reference.nodeId && connection.toPortId === (reference.kind === "audio" ? "reference-audio" : "reference-image")) }));
    const mediaConnections = (kind: "image" | "audio") => ({
        references: canvasReferences,
        visualStyleId: ctx.getNodes().find((node) => node.id === inbound.find((connection) => connection.toPortId === "style")?.fromNodeId)?.metadata?.visualStyleId,
        connect: (reference: (typeof canvasReferences)[number]) => ctx.applyOps([{ type: "connect_nodes", fromNodeId: reference.nodeId, fromPortId: "output", toNodeId: ctx.node.id, toPortId: kind === "image" ? "reference-image" : "reference-audio" }]),
        disconnect: (sourceNodeId: string) => ctx.applyOps([{ type: "delete_connections", ids: inbound.filter((connection) => connection.fromNodeId === sourceNodeId && connection.toPortId === (kind === "image" ? "reference-image" : "reference-audio")).map((connection) => connection.id) }]),
        connectVisualStyle: (styleId: string, name: string) => ctx.applyOps(createVisualStyleOverrideOps(ctx.node, styleId, name, `visual-style-${randomId()}`)),
        disconnectVisualStyle: () => ctx.applyOps(inheritProjectVisualStyleOps(inbound, ctx.node.id)),
    });
    const imageTarget = useCreativeAssetMediaTarget(asset, ctx.node.id, "image", mediaConnections("image"), generations?.image);
    const audioTarget = useCreativeAssetMediaTarget(asset, ctx.node.id, "audio", mediaConnections("audio"), generations?.audio);

    useEffect(() => {
        const openFromCanvas = (event: Event) => {
            const detail = (event as CustomEvent<{ nodeId?: string; kind?: "image" | "audio" }>).detail;
            if (detail?.nodeId === ctx.node.id) setEditor(detail.kind || "image");
        };
        window.addEventListener(editCreativeAssetMediaEvent, openFromCanvas);
        return () => window.removeEventListener(editCreativeAssetMediaEvent, openFromCanvas);
    }, [ctx.node.id]);

    useEffect(() => { if (!dirtyRef.current) { draftRef.current = asset; setDraft(asset); } }, [asset]);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
    useEffect(() => { const close = () => setEditor(null); window.addEventListener(focusVisualStyleEvent, close); return () => window.removeEventListener(focusVisualStyleEvent, close); }, []);
    const change = (patch: Partial<CreativeAsset>) => {
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        dirtyRef.current = true;
        versionRef.current += 1;
        setDraft(next);
        setDirty(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void commit(), 600);
    };
    const commit = async (): Promise<boolean> => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (promiseRef.current) return promiseRef.current.then(() => dirtyRef.current ? commit() : true);
        if (!dirtyRef.current) return true;
        const version = versionRef.current;
        const snapshot = draftRef.current;
        dirtyRef.current = false;
        promiseRef.current = update(asset.id, { name: snapshot.name, status: snapshot.status, payload: { description: snapshot.payload.description } }).then((saved) => {
            ctx.updateNode({ title: saved.name });
            if (versionRef.current === version) { draftRef.current = saved; setDraft(saved); setDirty(false); }
            return true;
        }).catch((error) => { dirtyRef.current = true; setDirty(true); message.error(error instanceof Error ? error.message : "设定保存失败"); return false; }).finally(() => { promiseRef.current = null; });
        return promiseRef.current;
    };
    const openEditor = async (kind: "image" | "audio") => { if (await commit()) setEditor((current) => current === kind ? null : kind); };
    const askAgent = async () => {
        if (!await commit()) return;
        useAgentStore.getState().prepareComposer(asset.projectId, { kind: "asset", projectId: asset.projectId, assetId: asset.id, nodeId: ctx.node.id, title: draftRef.current.name, subtitle: meta.label });
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
        { key: "collect", label: "收藏到资产库", icon: <BookmarkPlus className="size-3.5" />, onClick: () => void collect() },
        { type: "divider" as const },
        { key: "delete", danger: true, label: `永久删除${meta.label}`, onClick: () => modal.confirm({ title: `永久删除“${asset.name}”？`, content: "该资产的所有画布视图都会移除。", okText: "永久删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => remove(asset.id) }) },
    ] };

    return <article className="group/card relative flex size-full flex-col overflow-hidden p-4" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} data-canvas-no-pan onMouseDownCapture={(event) => { if ((event.target as Element)?.closest("input,textarea,button,audio,.ant-dropdown,.ant-image")) event.stopPropagation(); }}>
        <header className="flex items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: `${meta.accent}70`, color: meta.accent }}><Icon className="size-4" /></span><Input variant="borderless" className="min-w-0 flex-1 !px-1 !text-lg !font-semibold" value={draft.name} onChange={(event) => change({ name: event.target.value })} aria-label={`${meta.label}名称`} />{dirty ? <span className="size-1.5 rounded-full" title="正在自动保存" style={{ background: meta.accent }} /> : null}{asset.status === "locked" ? <LockKeyhole className="size-3.5 opacity-45" /> : asset.status === "confirmed" ? <Check className="size-3.5 opacity-45" /> : null}<Tooltip title="交给 Agent"><Button type="text" size="small" icon={<Bot className="size-4" />} onClick={() => void askAgent()} /></Tooltip><Dropdown trigger={["click"]} menu={menu}><Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} /></Dropdown></header>

        <div ref={imageAnchorRef} className="mt-4"><div className="mb-2 flex items-center justify-between text-[10px] font-medium tracking-wide" style={{ color: ctx.theme.node.muted }}><span>{meta.sheet}</span><Button type="text" size="small" className="!-mr-2 !h-6 !px-2 !text-[11px]" icon={<SlidersHorizontal className="size-3" />} onClick={() => void openEditor("image")}>调图</Button></div><div className="relative aspect-video overflow-hidden rounded-xl border" style={{ borderColor: ctx.theme.node.stroke, background: `${meta.accent}0c` }}><MediaPreview kind="image" url={primaryImage ? serverFileUrl(`server:${primaryImage.fileId}`) : undefined} title={asset.name} emptyLabel={generations?.image ? `生成中 ${Math.round(generations.image.progress * 100)}%` : "打开调图生成设计图"} onEdit={() => void openEditor("image")} />{generations?.image ? <Progress value={generations.image.progress} color={meta.accent} /> : null}</div></div>
        <MediaEditorPopover anchorRef={imageAnchorRef} open={editor === "image"} onClose={() => setEditor(null)} target={imageTarget} />

        <label className="mt-3 block"><span className="mb-1.5 flex items-center justify-between text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}><span>描述</span><span>{linked("setting") ? `已连接 ${linked("setting")} 段设定` : ""}{linked("style") ? " · 已连接风格" : ""}</span></span><Input.TextArea value={draft.payload.description} onChange={(event) => change({ payload: { ...draft.payload, description: event.target.value } })} autoSize={{ minRows: 3, maxRows: 4 }} placeholder={descriptionPlaceholder(asset.kind)} /></label>

        {asset.kind === "character" && draft.payload.designProfile ? <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-current/10 px-2.5 py-2 text-[10px]" style={{ color: ctx.theme.node.muted }}><span>外观 {genderLabel(draft.payload.designProfile.apparentGender)}</span><span>声音 {genderLabel(draft.payload.designProfile.voiceGender)}</span>{draft.payload.designProfile.ageBand ? <span>年龄 {draft.payload.designProfile.ageBand}</span> : null}{draft.payload.designProfile.uncertainties.length ? <Tooltip title={draft.payload.designProfile.uncertainties.join("；")}><span className="text-amber-600">{draft.payload.designProfile.uncertainties.length} 项待确认</span></Tooltip> : null}</div> : null}

        <div ref={audioAnchorRef} className="mt-auto border-t pt-3" style={{ borderColor: ctx.theme.node.stroke }}><div className="flex items-center gap-2"><Headphones className="size-4" style={{ color: meta.accent }} /><span className="text-[11px] font-medium">{meta.audio}</span>{primaryAudio ? <audio src={serverFileUrl(`server:${primaryAudio.fileId}`)} controls className="h-8 min-w-0 flex-1" /> : <span className="min-w-0 flex-1 truncate text-[10px] opacity-35">{generations?.audio ? `生成中 ${Math.round(generations.audio.progress * 100)}%` : "尚未设计"}</span>}<Button type="text" size="small" className="!-mr-2 !h-7 !px-2 !text-[11px]" icon={<SlidersHorizontal className="size-3" />} onClick={() => void openEditor("audio")}>调声音</Button></div></div>
        <MediaEditorPopover anchorRef={audioAnchorRef} open={editor === "audio"} onClose={() => setEditor(null)} target={audioTarget} />
    </article>;
}

function Progress({ value, color }: { value: number; color: string }) { return <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10"><span className="block h-full transition-[width]" style={{ width: `${Math.max(4, Math.round(value * 100))}%`, background: color }} /></div>; }
function LoadingAsset({ kind, ctx }: { kind: CreativeAssetKind; ctx: CanvasNodeContext }) { const meta = META[kind] || META.character; const Icon = meta.icon; return <div className="grid size-full place-items-center" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.muted }}><div className="text-center"><Icon className="mx-auto size-8 opacity-20" /><p className="mt-3 text-[10px] tracking-[0.18em]">正在读取{meta.label}设定</p></div></div>; }
function primaryVariant(asset: CreativeAsset, kind: "image" | "audio") { const id = kind === "image" ? asset.payload.primaryImageId : asset.payload.primaryAudioId; return asset.payload.variants.find((item) => item.kind === kind && item.id === id); }
function descriptionPlaceholder(kind: CreativeAssetKind) { return kind === "character" ? "描述年龄感、体态、面部、发型、服装、配饰和标志性色彩" : kind === "scene" ? "描述空间结构、固定陈设、材质、光线、色调和标志性细节" : "描述形态、材质、尺寸、颜色、纹理、磨损和可识别细节"; }
function genderLabel(value: "female" | "male" | "androgynous" | "unspecified") { return value === "female" ? "女性" : value === "male" ? "男性" : value === "androgynous" ? "中性" : "待确认"; }
