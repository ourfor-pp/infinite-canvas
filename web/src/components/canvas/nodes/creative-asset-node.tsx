import { useEffect, useRef, useState } from "react";
import { App, Button, Image as AntImage, Input, Select } from "antd";
import { AudioLines, BookmarkPlus, Box, Image as ImageIcon, MapPinned, Save, Send, Sparkles, Upload, UserRound } from "lucide-react";

import { agentApi } from "@/services/api/agent";
import { serverFileUrl, uploadServerFile } from "@/services/api/server";
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
    const { message } = App.useApp();
    const update = useCreativeAssetStore((state) => state.update);
    const generate = useCreativeAssetStore((state) => state.generate);
    const setPrimary = useCreativeAssetStore((state) => state.setPrimary);
    const openAgent = useAgentStore((state) => state.openPanel);
    const [draft, setDraft] = useState(asset);
    const [dirty, setDirty] = useState(false);
    const [agentText, setAgentText] = useState("");
    const [sampleLine, setSampleLine] = useState("");
    const [busy, setBusy] = useState<"save" | "image" | "audio" | "agent" | "upload" | "">("");
    const imageInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const meta = META[asset.kind];
    const Icon = meta.icon;
    const primaryImage = primaryVariant(asset, "image");
    const primaryAudio = primaryVariant(asset, "audio");
    const designVersions = asset.payload.variants.filter((item) => item.kind === "image" && item.usage !== "reference_input");
    const imageReferences = asset.payload.variants.filter((item) => item.kind === "image" && item.usage === "reference_input");
    const audioReferences = asset.payload.variants.filter((item) => item.kind === "audio" && item.usage === "reference_input");

    useEffect(() => { if (!dirty) setDraft(asset); }, [asset, dirty]);

    const change = (patch: Partial<CreativeAsset>) => {
        setDirty(true);
        setDraft((current) => ({ ...current, ...patch }));
    };
    const changePayload = (patch: Partial<CreativeAsset["payload"]>) => change({ payload: { ...draft.payload, ...patch } });
    const save = async (notify = true) => {
        if (!dirty) return true;
        setBusy("save");
        try {
            await update(asset.id, { name: draft.name, status: draft.status, payload: { description: draft.payload.description, voiceDescription: draft.payload.voiceDescription } });
            ctx.updateNode({ title: draft.name });
            setDirty(false);
            if (notify) message.success("设定已保存");
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
            return false;
        } finally { setBusy(""); }
    };
    const runGeneration = async (kind: "image" | "audio") => {
        if (kind === "audio" && !sampleLine.trim()) return message.warning("请先输入一句试听台词");
        if (!await save(false)) return;
        setBusy(kind);
        try {
            await generate(asset.id, {
                kind,
                usage: kind === "image" ? "design_sheet" : "voice_reference",
                label: kind === "image" ? meta.sheet : "角色声音",
                ...(kind === "audio" ? { transcript: sampleLine.trim() } : {}),
            });
            message.success(kind === "image" ? `${meta.sheet}生成已开始` : "角色声音生成已开始");
            if (kind === "audio") setSampleLine("");
        } catch (error) { message.error(error instanceof Error ? error.message : "生成失败"); }
        finally { setBusy(""); }
    };
    const uploadReference = async (kind: "image" | "audio", file: File) => {
        setBusy("upload");
        try {
            const uploaded = await uploadServerFile(file, file.name);
            const variant: CreativeAssetVariant = { id: crypto.randomUUID(), kind, fileId: uploaded.fileId, label: kind === "image" ? "参考图" : "参考声音", prompt: "", usage: "reference_input", createdAt: new Date().toISOString() };
            await update(asset.id, { payload: { variants: [...asset.payload.variants, variant] } });
            message.success(kind === "image" ? "参考图已上传" : "参考声音已上传");
        } catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); }
        finally { setBusy(""); }
    };
    const askAgent = async () => {
        if (!agentText.trim()) return;
        if (!await save(false)) return;
        setBusy("agent");
        try {
            await agentApi.send(asset.projectId, { text: agentText.trim(), sessionId: useAgentStore.getState().currentSessionIds[asset.projectId], assetReferences: [{ projectId: asset.projectId, assetId: asset.id, nodeId: ctx.node.id }] });
            setAgentText("");
            openAgent(asset.projectId);
            message.success("已交给 Agent");
        } catch (error) { message.error(error instanceof Error ? error.message : "提交 Agent 失败"); }
        finally { setBusy(""); }
    };
    const collect = async () => {
        if (!await save(false)) return;
        const library = useAssetStore.getState();
        const existing = library.assets.find((item) => item.kind === asset.kind && item.metadata?.sourceAssetId === asset.id);
        const snapshot = { kind: asset.kind, name: draft.name, status: draft.status, payload: { ...asset.payload, description: draft.payload.description, voiceDescription: draft.payload.voiceDescription } } as const;
        const saved = { kind: asset.kind, title: draft.name, coverUrl: primaryImage ? serverFileUrl(`server:${primaryImage.fileId}`) : "", tags: [], source: "Canvas", note: draft.payload.description, data: { snapshot }, metadata: { source: "canvas-business-node", sourceAssetId: asset.id, projectId: asset.projectId } } as const;
        existing ? library.updateAsset(existing.id, saved) : library.addAsset(saved);
        message.success(existing ? "资产库快照已更新" : "已收藏到资产库");
    };

    return (
        <article className="relative flex size-full flex-col overflow-hidden p-4" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} data-canvas-no-zoom onMouseDownCapture={(event) => { const target = event.target instanceof Element ? event.target : null; if (target?.closest("input,textarea,button,select,audio,.ant-select,.ant-image-mask")) event.stopPropagation(); }}>
            <header className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: `${meta.accent}70`, color: meta.accent }}><Icon className="size-4" /></span>
                <Input variant="borderless" className="min-w-0 flex-1 !px-1 !text-lg !font-semibold" value={draft.name} onChange={(event) => change({ name: event.target.value })} aria-label={`${meta.label}名称`} />
                <Select variant="borderless" size="small" className="w-20" value={draft.status} onChange={(status) => change({ status })} options={[{ value: "draft", label: "草稿" }, { value: "confirmed", label: "确认" }, { value: "locked", label: "锁定" }]} />
                <IconButton title="上传参考图" icon={Upload} onClick={() => imageInputRef.current?.click()} />
                <IconButton title="收藏到资产库" icon={BookmarkPlus} onClick={() => void collect()} />
                {dirty ? <IconButton title="保存设定" icon={Save} loading={busy === "save"} onClick={() => void save()} /> : null}
            </header>

            <p className="mb-2 mt-4 text-[10px] font-medium tracking-wide" style={{ color: ctx.theme.node.muted }}>{meta.sheet}</p>
            <div className="relative aspect-video shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: ctx.theme.node.stroke, background: `${meta.accent}0c` }}>
                {primaryImage ? <AntImage rootClassName="size-full" src={serverFileUrl(`server:${primaryImage.fileId}`)} alt={asset.name} className="!size-full !object-contain" preview={{ mask: "查看设计图" }} /> : <EmptySheet asset={asset} />}
                {generation ? <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10"><span className="block h-full transition-[width]" style={{ width: `${Math.max(4, Math.round(generation.progress * 100))}%`, background: meta.accent }} /></div> : null}
            </div>

            {designVersions.length > 1 || imageReferences.length ? <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {designVersions.map((variant) => <button key={variant.id} type="button" title="设为当前设计图" onClick={() => void setPrimary(asset.id, variant.id)} className="relative aspect-video w-16 shrink-0 overflow-hidden rounded border" style={{ borderColor: variant.id === asset.payload.primaryImageId ? meta.accent : ctx.theme.node.stroke }}><img src={serverFileUrl(`server:${variant.fileId}`)} alt={variant.label} className="size-full object-cover" /></button>)}
                {imageReferences.map((variant) => <span key={variant.id} className="relative aspect-video w-16 shrink-0 overflow-hidden rounded border border-dashed" style={{ borderColor: ctx.theme.node.stroke }}><img src={serverFileUrl(`server:${variant.fileId}`)} alt="参考图" className="size-full object-cover opacity-70" /><span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[8px] text-white">参考</span></span>)}
            </div> : null}

            <label className="mt-3 block"><span className="mb-1.5 block text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}>描述</span><Input.TextArea value={draft.payload.description} onChange={(event) => changePayload({ description: event.target.value })} autoSize={{ minRows: asset.kind === "character" ? 5 : 6, maxRows: asset.kind === "character" ? 5 : 6 }} placeholder={descriptionPlaceholder(asset.kind)} /></label>

            {asset.kind === "character" ? <section className="mt-3 border-t pt-3" style={{ borderColor: ctx.theme.node.stroke }}>
                <div className="flex items-center gap-2"><AudioLines className="size-4" style={{ color: meta.accent }} /><span className="text-[10px] font-medium" style={{ color: ctx.theme.node.muted }}>声音</span>{audioReferences.length ? <span className="text-[9px] opacity-45">已上传参考</span> : null}<button type="button" className="ml-auto flex items-center gap-1 text-[10px] opacity-50 hover:opacity-100" onClick={() => audioInputRef.current?.click()}><Upload className="size-3" />参考声音</button></div>
                <Input.TextArea className="mt-2" value={draft.payload.voiceDescription} onChange={(event) => changePayload({ voiceDescription: event.target.value })} autoSize={{ minRows: 2, maxRows: 2 }} placeholder="音色、语速、口音和情绪质感" />
                {primaryAudio ? <audio src={serverFileUrl(`server:${primaryAudio.fileId}`)} controls className="mt-2 h-8 w-full" /> : null}
                <div className="mt-2 flex items-center gap-2"><Input className="min-w-0 flex-1" size="small" value={sampleLine} onChange={(event) => setSampleLine(event.target.value)} placeholder="输入一句试听台词" /><Button size="small" icon={<Sparkles className="size-3" />} loading={busy === "audio"} onClick={() => void runGeneration("audio")}>{primaryAudio ? "重新生成" : "生成声音"}</Button></div>
            </section> : null}

            <div className="mt-auto pt-3">
                <div className="flex items-center gap-2"><Input size="small" value={agentText} onChange={(event) => setAgentText(event.target.value)} placeholder={`告诉 Agent 怎么修改${meta.label}`} onPressEnter={() => void askAgent()} /><Button size="small" type="text" icon={<Send className="size-3.5" />} loading={busy === "agent"} disabled={!agentText.trim()} onClick={() => void askAgent()} /></div>
                <Button className="mt-2" block type="primary" icon={<Sparkles className="size-3.5" />} loading={busy === "image" || Boolean(generation)} onClick={() => void runGeneration("image")}>{generation ? `生成中 ${Math.round(generation.progress * 100)}%` : primaryImage ? `重新生成${meta.sheet}` : `生成${meta.sheet}`}</Button>
            </div>

            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadReference("image", file); }} />
            <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadReference("audio", file); }} />
        </article>
    );
}

function IconButton({ title, icon: Icon, loading, onClick }: { title: string; icon: typeof Upload; loading?: boolean; onClick: () => void }) { return <Button type="text" size="small" title={title} aria-label={title} loading={loading} icon={loading ? undefined : <Icon className="size-3.5" />} onClick={onClick} />; }
function EmptySheet({ asset }: { asset: CreativeAsset }) { const meta = META[asset.kind]; const Icon = meta.icon; return <span className="grid size-full place-items-center"><span className="text-center"><Icon className="mx-auto size-12 opacity-15" /><span className="mt-2 block text-[10px] opacity-45">{meta.empty}</span></span></span>; }
function LoadingAsset({ kind, ctx }: { kind: CreativeAssetKind; ctx: CanvasNodeContext }) { const meta = META[kind] || META.character; const Icon = meta.icon; return <div className="grid size-full place-items-center" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.muted }}><div className="text-center"><Icon className="mx-auto size-8 opacity-20" /><p className="mt-3 text-[10px] tracking-[0.18em]">正在读取{meta.label}设定</p></div></div>; }
function primaryVariant(asset: CreativeAsset, kind: "image" | "audio") { const id = kind === "image" ? asset.payload.primaryImageId : asset.payload.primaryAudioId; return asset.payload.variants.find((item) => item.kind === kind && item.id === id); }
function descriptionPlaceholder(kind: CreativeAssetKind) { return kind === "character" ? "描述年龄感、体态、面部、发型、服装、配饰和标志性色彩" : kind === "scene" ? "描述空间结构、固定陈设、材质、光线、色调和标志性细节" : "描述形态、材质、尺寸、颜色、纹理、磨损和可识别细节"; }
