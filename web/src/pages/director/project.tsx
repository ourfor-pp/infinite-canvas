import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { App, Button, ConfigProvider, Input, Progress as AntProgress, Select, Spin, Tag, theme as antdTheme, Tooltip } from "antd";
import { AudioLines, Bot, Check, Clapperboard, Copy, FileText, Film, House, Image as ImageIcon, LayoutDashboard, Lock, Package, Pause, Play, Plus, RefreshCw, Save, Scissors, ScrollText, Search, Sparkles, Trash2, Upload, Users, Video } from "lucide-react";
import { nanoid } from "nanoid";
import { useNavigate, useParams } from "react-router-dom";
import { Streamdown } from "streamdown";
import { AgentPanel } from "@/components/agent/agent-panel";
import { directorApi } from "@/services/api/director";
import { serverApi, serverApiUrl } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useDirectorStore } from "@/stores/use-director-store";
import type { CreativeAsset, CreativeAssetKind } from "@/types/creative-asset";
import type { DirectorDocument, DirectorRender, DirectorSection, DirectorSequence, DirectorShot, DirectorState, DirectorStoryboardPanel } from "@/types/director";
import type { VisualStyle } from "@/types/visual-style";
import { DirectorMarkdownEditor } from "./components/director-markdown-editor";
import "./director-light.css";

const sections: Array<{ id: DirectorSection; label: string; icon: typeof Film }> = [
    { id: "overview", label: "概览", icon: LayoutDashboard }, { id: "story", label: "故事", icon: FileText }, { id: "script", label: "剧本", icon: ScrollText },
    { id: "world", label: "角色与场景", icon: Users }, { id: "props", label: "道具", icon: Package },
    { id: "storyboard", label: "分镜", icon: Clapperboard }, { id: "studio", label: "视频创作台", icon: Scissors },
];

function Progress(props: ComponentProps<typeof AntProgress>) {
    return <AntProgress {...props} strokeColor="#2563eb" trailColor="#e2e8f0" />;
}

export default function DirectorProjectPage() {
    const { id = "", section = "overview" } = useParams();
    const active = sections.some((item) => item.id === section) ? section as DirectorSection : "overview";
    const navigate = useNavigate();
    const { message } = App.useApp();
    const state = useDirectorStore((store) => store.states[id]);
    const loadState = useDirectorStore((store) => store.loadState);
    const [assets, setAssets] = useState<CreativeAsset[]>([]);
    const [styles, setStyles] = useState<VisualStyle[]>([]);
    const [loading, setLoading] = useState(true);
    const [agentCollapsed, setAgentCollapsed] = useState(false);
    const openPanel = useAgentStore((store) => store.openPanel);

    const refresh = async () => {
        const [, nextAssets, nextStyles] = await Promise.all([loadState(id), serverApi.creativeAssets(id), serverApi.visualStyles(id)]);
        setAssets(nextAssets); setStyles(nextStyles);
    };
    useEffect(() => {
        let active = true;
        openPanel(id);
        Promise.all([loadState(id), serverApi.creativeAssets(id), serverApi.visualStyles(id)]).then(([, nextAssets, nextStyles]) => {
            if (!active) return; setAssets(nextAssets); setStyles(nextStyles);
        }).catch((error) => message.error(error instanceof Error ? error.message : "导演项目加载失败")).finally(() => active && setLoading(false));
        return () => { active = false; };
    }, [id, loadState, message, openPanel]);
    useEffect(() => {
        const update = (event: Event) => { const detail = (event as CustomEvent<{ projectId: string }>).detail; if (detail.projectId === id) void loadState(id); };
        const refreshAssets = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail.projectId === id) void Promise.all([serverApi.creativeAssets(id), serverApi.visualStyles(id)]).then(([nextAssets, nextStyles]) => { setAssets(nextAssets); setStyles(nextStyles); });
        };
        window.addEventListener("infinite-canvas:director-updated", update);
        window.addEventListener("infinite-canvas:creative-asset-updated", refreshAssets);
        window.addEventListener("infinite-canvas:visual-style-updated", refreshAssets);
        return () => {
            window.removeEventListener("infinite-canvas:director-updated", update);
            window.removeEventListener("infinite-canvas:creative-asset-updated", refreshAssets);
            window.removeEventListener("infinite-canvas:visual-style-updated", refreshAssets);
        };
    }, [id, loadState]);

    if (loading || !state) return <div className="director-light grid h-full place-items-center bg-white"><Spin /></div>;
    return (
        <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
        <main className="director-light flex h-full min-w-0 bg-white text-slate-950">
            {!agentCollapsed ? <AgentPanel projectId={id} themeMode="light" experience="director" /> : null}
            <div className="flex min-w-0 flex-1 flex-col bg-white">
                <header className="flex h-16 shrink-0 items-stretch border-b border-black/10 bg-white px-5">
                    <Tooltip title="返回导演项目库"><button type="button" aria-label="返回导演项目库" className="mr-3 grid w-11 shrink-0 place-items-center text-slate-500 transition hover:bg-blue-50 hover:text-blue-700" onClick={() => navigate("/director")}><House className="size-[18px]" /></button></Tooltip>
                    <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="导演台功能">{sections.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(`/director/${id}/${item.id}`)} className={`relative flex shrink-0 items-center gap-2 px-3 text-sm transition ${active === item.id ? "text-blue-600 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-blue-600" : "text-slate-500 hover:bg-blue-50 hover:text-blue-700"}`}><Icon className="size-4" />{item.label}</button>; })}</nav>
                    <button className="ml-4 flex shrink-0 items-center gap-2 px-3 text-xs text-black/45 hover:bg-black/[.025] hover:text-black/75" onClick={() => { setAgentCollapsed((value) => !value); if (agentCollapsed) openPanel(id); }}><Bot className="size-4" />{agentCollapsed ? "展开 Agent" : "收起 Agent"}</button>
                </header>
                <section className={`min-w-0 flex-1 bg-white ${active === "story" || active === "script" ? "overflow-hidden" : "overflow-auto"}`}>
                {active === "overview" ? <Overview state={state} assets={assets} styles={styles} onNavigate={(target) => navigate(`/director/${id}/${target}`)} /> : null}
                {active === "story" || active === "script" ? <Writing projectId={id} kind={active} state={state} onRefresh={refresh} /> : null}
                {active === "world" ? <AssetGallery projectId={id} title="角色与场景" assets={assets.filter((item) => item.kind !== "prop")} styles={styles} onRefresh={refresh} /> : null}
                {active === "props" ? <AssetGallery projectId={id} title="道具" assets={assets.filter((item) => item.kind === "prop")} styles={styles} onRefresh={refresh} /> : null}
                {active === "storyboard" ? <Storyboard projectId={id} state={state} onRefresh={refresh} /> : null}
                {active === "studio" ? <Studio projectId={id} state={state} onRefresh={refresh} /> : null}
                </section>
            </div>
        </main>
        </ConfigProvider>
    );
}

function Overview({ state, assets, styles, onNavigate }: { state: DirectorState; assets: CreativeAsset[]; styles: VisualStyle[]; onNavigate: (section: DirectorSection) => void }) {
    const documents = Object.fromEntries(state.documents.map((item) => [item.kind, item]));
    const stale = state.sequences.filter((item) => item.payload.needsReview).length + state.shots.filter((item) => item.payload.needsReview || item.payload.videoStale).length;
    const confirmedAssets = assets.filter((item) => item.status !== "draft").length;
    const stages = [Boolean(documents.story?.content.trim()), documents.script?.status !== "draft", Boolean(styles.find((item) => item.status === "confirmed")), assets.length > 0 && confirmedAssets === assets.length, state.sequences.length > 0 && state.sequences.every((item) => item.status !== "draft"), state.shots.length > 0 && state.shots.every((item) => item.payload.videoFileId)];
    const progress = Math.round(stages.filter(Boolean).length / stages.length * 100);
    return <div className="mx-auto max-w-6xl p-6 lg:p-8"><div className="grid gap-px overflow-hidden border border-white/10 bg-white/10 md:grid-cols-4">{[
            ["目标时长", `${Math.round(state.workspace.targetDurationSeconds / 60)} 分钟`], ["画幅", state.workspace.aspectRatio], ["来源", state.sources[0]?.name || "对话创作"], ["当前风格", styles.find((item) => item.status === "confirmed")?.name || "待确认"],
        ].map(([label, value]) => <div key={label} className="bg-[#101012] p-5"><div className="text-xs text-white/35">{label}</div><div className="mt-3 truncate text-lg">{value}</div></div>)}</div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_.8fr]"><section className="border border-white/10 bg-[#101012] p-6"><div className="flex items-center justify-between"><h2 className="font-serif text-xl">生产进度</h2><span className="font-mono text-xs text-blue-600">{progress}%</span></div><Progress percent={progress} showInfo={false} className="mt-5" /><div className="mt-7 grid grid-cols-2 gap-4 text-sm">{[["故事", documents.story?.content.trim() ? "已编写" : "未开始"], ["剧本", documents.script?.status], ["创作资产", `${confirmedAssets}/${assets.length}`], ["故事板", `${state.sequences.filter((item) => item.status !== "draft").length}/${state.sequences.length}`], ["独立镜头", state.shots.length], ["视频就绪", `${state.shots.filter((item) => item.payload.videoFileId).length}/${state.shots.length}`]].map(([label, value]) => <div key={label} className="border-t border-white/8 pt-3"><span className="text-white/35">{label}</span><span className="float-right">{statusLabel(String(value || "未开始"))}</span></div>)}</div></section>
        <section className="border border-white/10 bg-[#101012] p-6"><h2 className="font-serif text-xl">需要注意</h2><div className="mt-5 space-y-3"><Notice count={state.sources.filter((item) => item.status === "failed").length} label="失败的来源任务" /><Notice count={stale} label="上游变化，待检查" /><Notice count={state.sequences.filter((item) => item.status === "draft").length} label="待确认故事板" /><Notice count={state.shots.filter((item) => !item.payload.videoFileId).length} label="缺少视频的镜头" /></div><Button block className="mt-5 !border-blue-600 !bg-blue-600 !text-white" onClick={() => onNavigate(!documents.story?.content.trim() ? "story" : documents.script?.status === "draft" ? "script" : progress < 70 ? "storyboard" : "studio")}>继续创作</Button></section></div>
    </div>;
}

function Notice({ count, label }: { count: number; label: string }) { return <div className="flex items-center justify-between border-b border-white/8 pb-3 text-sm"><span className="text-white/45">{label}</span><span className={count ? "text-rose-600" : "text-white/25"}>{count}</span></div>; }
function statusLabel(status: string) { return status === "confirmed" ? "已确认" : status === "locked" ? "已锁定" : status === "draft" ? "草稿" : status; }

function Writing({ projectId, kind, state, onRefresh }: { projectId: string; kind: "story" | "script"; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp(); const fileRef = useRef<HTMLInputElement>(null); const source = state.sources[0];
    const document = state.documents.find((item) => item.kind === kind)!; const [content, setContent] = useState(document.content); const [busy, setBusy] = useState(false); const [editing, setEditing] = useState(false);
    useEffect(() => { setContent(document.content); setEditing(false); }, [document.content, kind]);
    const giveAgent = useAgentStore((store) => store.prepareComposer);
    const dirty = content !== document.content;
    const save = async (nextStatus?: DirectorDocument["status"]) => { setBusy(true); try { await directorApi.updateDocument(projectId, kind, { revision: document.revision, content, ...(nextStatus ? { status: nextStatus } : {}) }); await onRefresh(); message.success(nextStatus ? `剧本已${statusLabel(nextStatus)}` : "已保存"); } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); } };
    const upload = async (file?: File) => { if (!file) return; setBusy(true); try { await directorApi.addSource(projectId, file); await onRefresh(); message.success("小说已进入解析队列"); } catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; } };
    return <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"><input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.markdown,.pdf,.epub,text/plain,text/markdown,application/pdf,application/epub+zip" onChange={(event) => void upload(event.target.files?.[0])} />
        <div data-testid="director-document-toolbar" className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-8 py-2 lg:px-12"><div className="flex min-w-0 items-center gap-3">{kind === "script" ? <StatusPill status={document.status} /> : null}<span className="font-mono text-[11px] text-slate-400">REV {document.revision}</span>{dirty ? <span className="text-[11px] text-blue-600">未保存</span> : null}{kind === "story" && source ? <span className="hidden min-w-0 items-center gap-2 text-xs text-slate-400 md:flex"><span className="h-3 w-px bg-slate-200" /><FileText className="size-3.5" /><span className="max-w-52 truncate">{source.name}</span><span>{source.status === "processing" ? "正在解析" : source.status === "failed" ? "解析失败" : `${source.chapterCount} 章`}</span>{source.status === "processing" ? <RefreshCw className="size-3 animate-spin" /> : null}</span> : null}</div>
            <div className="flex items-center gap-2">{kind === "story" ? source?.status === "failed" ? <Button type="text" size="small" className="!text-rose-600" onClick={() => void directorApi.retrySource(source.id).then(onRefresh)}>重试解析</Button> : <Button type="text" size="small" className="!text-slate-500" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>上传小说</Button> : null}<Button type="text" size="small" className="!text-slate-500" icon={<Bot className="size-4" />} onClick={() => giveAgent(projectId, { kind: "director", projectId, entityKind: kind, entityId: kind, title: kind === "story" ? "故事" : "剧本", subtitle: "导演文档" })}>交给 Agent</Button><div className="director-doc-mode" role="group" aria-label={`${kind === "story" ? "故事" : "剧本"}文档模式`}><button type="button" data-active={!editing} onClick={() => setEditing(false)}>预览</button><button type="button" data-active={editing} disabled={kind === "script" && document.status === "locked"} onClick={() => setEditing(true)}>编辑</button></div>{editing || dirty ? <Button type="text" size="small" className="!text-slate-500" icon={<Save className="size-4" />} loading={busy} disabled={!dirty} onClick={() => void save()}>保存</Button> : null}{kind === "script" && document.status === "draft" ? <Button size="small" className="!border-blue-200 !bg-blue-50 !text-blue-700" icon={<Check className="size-4" />} onClick={() => void save("confirmed")}>确认</Button> : kind === "script" && document.status === "confirmed" ? <Button type="text" size="small" className="!text-slate-500" icon={<Lock className="size-4" />} onClick={() => void save("locked")}>锁定</Button> : null}</div></div>
        {!editing ? <article data-testid={`director-${kind}-preview`} className="director-document-preview director-markdown thin-scrollbar"><div className="mx-auto max-w-4xl px-8 py-9 lg:px-12"><Streamdown mode="static" controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}>{content}</Streamdown></div></article> : <DirectorMarkdownEditor key={`${projectId}:${kind}:${document.revision}`} content={content} dirty={dirty} saving={busy} label={`${kind === "story" ? "故事" : "剧本"} Markdown 编辑器`} placeholder={kind === "story" ? "在这里创作故事" : "按场次写动作、对白与旁白"} onChange={setContent} />}
    </div>;
}

function StatusPill({ status }: { status: string }) { return <span className={`inline-flex items-center gap-1.5 text-xs ${status === "locked" ? "text-blue-600" : status === "confirmed" ? "text-emerald-600" : "text-slate-500"}`}>{status === "locked" ? <Lock className="size-3" /> : status === "confirmed" ? <Check className="size-3" /> : <Pause className="size-3" />}{statusLabel(status)}</span>; }

function AssetGallery({ projectId, title, assets, styles, onRefresh }: { projectId: string; title: string; assets: CreativeAsset[]; styles: VisualStyle[]; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp(); const prepare = useAgentStore((store) => store.prepareComposer); const [busyId, setBusyId] = useState("");
    const action = async (asset: CreativeAsset, kind: "regenerate" | "copy" | "confirm" | "lock" | "delete", mediaKind: "image" | "audio" = "image") => { setBusyId(asset.id); try {
        if (kind === "regenerate") await serverApi.generateCreativeAsset(asset.id, { kind: mediaKind, revision: asset.revision, allowDraftStyle: true });
        if (kind === "copy") await serverApi.createCreativeAsset(projectId, { kind: asset.kind, name: `${asset.name} 副本`, payload: asset.payload });
        if (kind === "confirm" || kind === "lock") await serverApi.updateCreativeAsset(asset.id, { revision: asset.revision, status: kind === "confirm" ? "confirmed" : "locked" });
        if (kind === "delete") await serverApi.deleteCreativeAsset(asset.id);
        await onRefresh(); message.success(kind === "regenerate" ? "已开始重新生成，将直接替换主结果" : "操作完成");
    } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); } finally { setBusyId(""); } };
    return <div className="mx-auto max-w-7xl p-6 lg:p-8"><div className="flex min-h-9 items-center justify-between gap-4">{styles.length ? <div className="flex items-center gap-3 text-xs text-white/35"><Sparkles className="size-4 text-blue-600" />当前风格：<span className="text-white/65">{styles.find((item) => item.status === "confirmed")?.name || styles[0].name}</span></div> : <span />}<Button className="!border-white/15 !bg-white/5 !text-white/70" icon={<Bot className="size-4" />} onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "script", entityId: "script", title: `拆解${title}`, subtitle: "剧本资产拆解" })}>让 Agent 拆解</Button></div>
        {assets.length ? <div className="mt-5 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} busy={busyId === asset.id} onAgent={() => prepare(projectId, { kind: "asset", projectId, assetId: asset.id, title: asset.name, subtitle: asset.kind })} onAction={(kind, media) => void action(asset, kind, media)} />)}</div> : <EmptyPanel icon={title === "道具" ? Package : Users} title={`还没有${title}`} description="和 Agent 对话，让它从已确认剧本中提出候选清单。" />}
    </div>;
}

function AssetCard({ asset, busy, onAgent, onAction }: { asset: CreativeAsset; busy: boolean; onAgent: () => void; onAction: (kind: "regenerate" | "copy" | "confirm" | "lock" | "delete", media?: "image" | "audio") => void }) {
    const primaryImage = asset.payload.variants.find((item) => item.id === asset.payload.primaryImageId) || asset.payload.variants.find((item) => item.kind === "image");
    const primaryAudio = asset.payload.variants.find((item) => item.id === asset.payload.primaryAudioId) || asset.payload.variants.find((item) => item.kind === "audio");
    return <article className="overflow-hidden border border-white/10 bg-[#101012]"><div className="relative aspect-[16/10] bg-[#080809]">{primaryImage ? <img src={serverApiUrl(`/files/${primaryImage.fileId}/content`)} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-white/15"><ImageIcon className="size-9" /></div>}<div className="absolute left-3 top-3 bg-black/65 px-2 py-1 text-[10px] tracking-widest text-white/55">{asset.kind === "character" ? "CHARACTER" : asset.kind === "scene" ? "SCENE" : "PROP"}</div></div>
        <div className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-serif text-xl">{asset.name}</h2><p className="mt-2 line-clamp-2 text-xs leading-5 text-white/40">{asset.payload.description || "等待设定"}</p></div><StatusPill status={asset.status} /></div>
        {primaryAudio ? <audio className="mt-4 h-8 w-full opacity-75" controls src={serverApiUrl(`/files/${primaryAudio.fileId}/content`)} /> : <div className="mt-4 flex items-center gap-2 text-xs text-white/25"><AudioLines className="size-3.5" />{asset.kind === "character" ? "声线待生成" : asset.kind === "scene" ? "氛围声待生成" : "动作音效待生成"}</div>}
        <div className="mt-5 flex flex-wrap items-center border-t border-white/8 pt-3"><FlatAction icon={Bot} label="Agent" onClick={onAgent} /><FlatAction icon={RefreshCw} label="抽图" loading={busy} onClick={() => onAction("regenerate", "image")} /><FlatAction icon={AudioLines} label="抽声音" loading={busy} onClick={() => onAction("regenerate", "audio")} /><FlatAction icon={Copy} label="复制" onClick={() => onAction("copy")} />{asset.status === "draft" ? <FlatAction icon={Check} label="确认" onClick={() => onAction("confirm")} /> : asset.status === "confirmed" ? <FlatAction icon={Lock} label="锁定" onClick={() => onAction("lock")} /> : null}<FlatAction icon={Trash2} label="删除" danger onClick={() => onAction("delete")} /></div></div></article>;
}

function FlatAction({ icon: Icon, label, loading, danger, onClick }: { icon: typeof Film; label: string; loading?: boolean; danger?: boolean; onClick: () => void }) { return <button disabled={loading} className={`flex items-center gap-1.5 px-2 py-2 text-xs transition hover:bg-white/5 ${danger ? "text-red-300/50 hover:text-red-300" : "text-white/40 hover:text-white/75"}`} onClick={onClick}>{loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}{label}</button>; }

function Storyboard({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp(); const prepare = useAgentStore((store) => store.prepareComposer); const [view, setView] = useState<"boards" | "shots">("boards"); const [busy, setBusy] = useState("");
    const createSequence = async () => { try { await directorApi.createSequence(projectId, { title: `剧情段落 ${state.sequences.length + 1}`, summary: "待 Agent 根据剧本补充分镜节奏", payload: { storyboard: Array.from({ length: 6 }, (_, position) => ({ id: nanoid(), position, title: `镜头 ${position + 1}`, description: "待规划", durationSeconds: 4 })) } }); await onRefresh(); } catch (error) { message.error(error instanceof Error ? error.message : "请先确认剧本"); } };
    const updateSequence = async (sequence: DirectorSequence, patch: Record<string, unknown>) => { setBusy(sequence.id); try { await directorApi.updateSequence(sequence.id, { revision: sequence.revision, ...patch }); await onRefresh(); } catch (error) { message.error(error instanceof Error ? error.message : "更新失败"); } finally { setBusy(""); } };
    const extract = async (sequence: DirectorSequence) => { setBusy(sequence.id); try { for (const panel of sequence.payload.storyboard || []) await directorApi.createShot(projectId, { sequenceId: sequence.id, position: panel.position, title: panel.title || `镜头 ${panel.position + 1}`, payload: { description: panel.description, durationSeconds: panel.durationSeconds, firstFrameFileId: panel.imageFileId, boundary: "cut" } }); await onRefresh(); setView("shots"); } catch (error) { message.error(error instanceof Error ? error.message : "请先确认故事板"); } finally { setBusy(""); } };
    return <div className="mx-auto max-w-7xl p-6 lg:p-8"><div className="flex justify-end gap-1"><Button className={view === "boards" ? "!border-blue-200 !bg-blue-50 !text-blue-700" : "!border-white/10 !bg-transparent !text-white/50"} onClick={() => setView("boards")}>故事板</Button><Button className={view === "shots" ? "!border-blue-200 !bg-blue-50 !text-blue-700" : "!border-white/10 !bg-transparent !text-white/50"} onClick={() => setView("shots")}>镜头列表</Button></div>
        {view === "boards" ? <div className="mt-5 space-y-7">{state.sequences.map((sequence) => <SequenceBoard key={sequence.id} sequence={sequence} busy={busy === sequence.id} onAgent={() => prepare(projectId, { kind: "director", projectId, entityKind: "sequence", entityId: sequence.id, title: sequence.title, subtitle: "剧情段落故事板" })} onConfirm={() => void updateSequence(sequence, { status: "confirmed" })} onExtract={() => void extract(sequence)} onReorder={(storyboard) => void updateSequence(sequence, { payload: { ...sequence.payload, storyboard } })} />)}<Button className="!h-12 w-full !border-dashed !border-white/15 !bg-transparent !text-white/45" icon={<Plus className="size-4" />} onClick={() => void createSequence()}>新建剧情段落</Button></div> : <ShotList projectId={projectId} shots={state.shots} sequences={state.sequences} onRefresh={onRefresh} />}
    </div>;
}

function SequenceBoard({ sequence, busy, onAgent, onConfirm, onExtract, onReorder }: { sequence: DirectorSequence; busy: boolean; onAgent: () => void; onConfirm: () => void; onExtract: () => void; onReorder: (panels: DirectorStoryboardPanel[]) => void }) {
    const panels = sequence.payload.storyboard || [];
    const move = (index: number, direction: number) => { const next = [...panels]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; onReorder(next.map((item, position) => ({ ...item, position }))); };
    return <article className="border border-white/10 bg-[#101012] [contain-intrinsic-size:auto_640px] [content-visibility:auto]"><header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5"><div><div className="flex items-center gap-3"><span className="font-mono text-xs text-blue-600">SEQ {String(sequence.position + 1).padStart(2, "0")}</span><StatusPill status={sequence.status} />{sequence.payload.needsReview ? <Tag color="orange">需要检查</Tag> : null}</div><h2 className="mt-2 font-serif text-2xl">{sequence.title}</h2><p className="mt-1 text-xs text-white/35">{sequence.summary}</p></div><div className="flex"><FlatAction icon={Bot} label="交给 Agent" onClick={onAgent} />{sequence.status === "draft" ? <FlatAction icon={Check} label="确认故事板" loading={busy} onClick={onConfirm} /> : <FlatAction icon={Scissors} label="拆为镜头" loading={busy} onClick={onExtract} />}</div></header>
        <div className="grid gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-3">{panels.map((panel, index) => <div key={panel.id} className="group bg-[#0c0c0e]"><div className="relative aspect-video bg-black">{panel.imageFileId ? <img src={serverApiUrl(`/files/${panel.imageFileId}/content`)} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-white/12"><ImageIcon className="size-8" /></div>}<span className="absolute left-2 top-2 bg-black/70 px-1.5 py-0.5 font-mono text-[10px]">{index + 1}</span><button className="absolute right-2 top-2 bg-black/70 p-1.5 text-white/50 opacity-0 transition group-hover:opacity-100" onClick={onAgent}><RefreshCw className="size-3.5" /></button></div><div className="p-4"><div className="flex justify-between gap-3"><strong className="text-sm">{panel.title || `镜头 ${index + 1}`}</strong><span className="font-mono text-xs text-white/30">{panel.durationSeconds || 4}s</span></div><p className="mt-2 min-h-10 text-xs leading-5 text-white/35">{panel.description || "待规划画面与动作"}</p><div className="mt-3 flex gap-1"><button className="px-2 text-white/25 hover:text-white/60" onClick={() => move(index, -1)}>←</button><button className="px-2 text-white/25 hover:text-white/60" onClick={() => move(index, 1)}>→</button></div></div></div>)}</div>
    </article>;
}

function ShotList({ projectId, shots, sequences, onRefresh }: { projectId: string; shots: DirectorShot[]; sequences: DirectorSequence[]; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp(); const prepare = useAgentStore((store) => store.prepareComposer);
    const update = async (shot: DirectorShot, patch: Record<string, unknown>) => { try { await directorApi.updateShot(shot.id, { revision: shot.revision, ...patch }); await onRefresh(); } catch (error) { message.error(error instanceof Error ? error.message : "镜头更新失败"); } };
    const regenerate = async (shot: DirectorShot) => { try { await directorApi.generateShot(shot.id, shot.revision); message.success("镜头视频已进入生成队列，将直接替换当前结果"); } catch (error) { message.error(error instanceof Error ? error.message : "镜头生成失败"); } };
        return shots.length ? <div className="mt-7 space-y-4">{shots.map((shot) => <article key={shot.id} className="grid overflow-hidden border border-white/10 bg-[#101012] md:grid-cols-[280px_1fr]"><div className="aspect-video bg-black md:aspect-auto">{shot.payload.firstFrameFileId ? <img className="size-full object-cover" src={serverApiUrl(`/files/${shot.payload.firstFrameFileId}/content`)} /> : <div className="grid size-full place-items-center text-white/15"><Video className="size-8" /></div>}</div><div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] tracking-wider text-blue-600">{sequences.find((item) => item.id === shot.sequenceId)?.title} · SHOT {shot.position + 1}</div><h2 className="mt-2 font-serif text-xl">{shot.title}</h2></div><div className="flex"><FlatAction icon={Bot} label="Agent" onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "shot", entityId: shot.id, title: shot.title, subtitle: "独立镜头" })} /><FlatAction icon={RefreshCw} label="重新生成" onClick={() => void regenerate(shot)} />{shot.status === "draft" ? <FlatAction icon={Check} label="确认" onClick={() => void update(shot, { status: "confirmed" })} /> : null}</div></div><p className="mt-3 text-sm leading-6 text-white/45">{shot.payload.description || "等待补充画面描述"}</p><div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/40">{[shot.payload.shotSize, shot.payload.cameraAngle, shot.payload.cameraMove, `${shot.payload.durationSeconds || 4}s`].filter(Boolean).map((item) => <span key={String(item)} className="border border-white/10 px-2 py-1">{String(item)}</span>)}<Select size="small" variant="borderless" value={shot.payload.boundary || "cut"} popupClassName="director-select" className="!text-xs" options={[{ value: "cut", label: "CUT 普通切镜" }, { value: "continue", label: "CONTINUE 连续续写" }]} onChange={(boundary) => void update(shot, { payload: { ...shot.payload, boundary } })} /></div></div></article>)}</div> : <EmptyPanel icon={Clapperboard} title="还没有独立镜头" description="先确认故事板，再拆分成镜头。" />;
}

function Studio({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp(); const prepare = useAgentStore((store) => store.prepareComposer); const order = state.timeline.payload.shotOrder?.length ? state.timeline.payload.shotOrder : state.shots.map((item) => item.id); const shots = order.map((id) => state.shots.find((item) => item.id === id)).filter(Boolean) as DirectorShot[]; const [playing, setPlaying] = useState(false); const [dragged, setDragged] = useState(""); const [rendering, setRendering] = useState(false); const [renders, setRenders] = useState<DirectorRender[]>([]);
    useEffect(() => { let active = true; const load = () => void directorApi.renders(projectId).then((items) => active && setRenders(items)); load(); const timer = window.setInterval(load, 2000); return () => { active = false; window.clearInterval(timer); }; }, [projectId]);
    const saveOrder = async (next: string[]) => { try { await directorApi.updateTimeline(projectId, { revision: state.timeline.revision, payload: { ...state.timeline.payload, shotOrder: next } }); await onRefresh(); } catch (error) { message.error(error instanceof Error ? error.message : "时间线保存失败"); } };
    const drop = (target: string) => { if (!dragged || dragged === target) return; const next = order.filter((id) => id !== dragged); next.splice(next.indexOf(target), 0, dragged); setDragged(""); void saveOrder(next); };
    const missingVideos = shots.filter((shot) => !shot.payload.videoFileId).length;
    const render = async () => { setRendering(true); try { const created = await directorApi.createRender(projectId, state.timeline.revision); setRenders((items) => [created, ...items]); message.success("成片已进入持久化合成队列，可刷新页面继续查看"); } catch (error) { message.error(error instanceof Error ? error.message : "创建合成任务失败"); } finally { setRendering(false); } };
    return <div className="flex min-h-full flex-col"><div className="flex justify-end gap-2 px-6 pt-6 lg:px-8 lg:pt-8"><Button className="!border-white/15 !bg-white/5 !text-white/65" icon={<Bot className="size-4" />} onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "timeline", entityId: "timeline", title: "时间线", subtitle: "镜头与声音编排" })}>交给 Agent 铺轨</Button><Tooltip title={missingVideos ? `仍有 ${missingVideos} 个镜头缺少视频` : "导出 H.264/AAC MP4"}><Button disabled={Boolean(missingVideos)} loading={rendering} className="!border-blue-600 !bg-blue-600 !text-white" icon={<Film className="size-4" />} onClick={() => void render()}>导出 MP4</Button></Tooltip></div>
        {renders[0] ? <div className="mx-8 mt-6 flex items-center gap-4 border border-white/10 bg-[#101012] px-4 py-3 text-xs lg:mx-10"><Film className="size-4 text-blue-600" /><div className="min-w-0 flex-1"><div className="flex justify-between"><span>{renders[0].status === "succeeded" ? "最近成片" : "成片合成"}</span><span className="text-white/35">{Math.round(renders[0].progress * 100)}%</span></div><Progress percent={Math.round(renders[0].progress * 100)} showInfo={false} size="small" /></div>{renders[0].status === "succeeded" && renders[0].outputFileId ? <a className="text-blue-600" href={serverApiUrl(`/files/${renders[0].outputFileId}/content`)} download>下载 MP4</a> : renders[0].status === "failed" || renders[0].status === "canceled" ? <Button size="small" onClick={() => void directorApi.retryRender(renders[0].id)}>重试</Button> : <Button size="small" danger type="text" onClick={() => void directorApi.cancelRender(renders[0].id)}>取消</Button>}</div> : null}
        <div className="mt-7 flex min-h-0 flex-1 flex-col border-y border-white/10 bg-[#0c0c0e]"><div className="flex h-14 items-center gap-3 border-b border-white/10 px-5"><button className="grid size-8 place-items-center border border-white/15 text-white/70" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button><span className="font-mono text-xs text-white/35">00:00:00:00</span><div className="ml-auto text-xs text-white/30">1080p · 24 fps · {state.workspace.aspectRatio}</div></div>
            <div className="min-h-64 overflow-x-auto p-5"><div className="flex min-w-max gap-1">{shots.map((shot) => <div key={shot.id} draggable onDragStart={() => setDragged(shot.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(shot.id)} className={`w-52 shrink-0 cursor-grab border ${shot.payload.videoStale ? "border-orange-400/50" : "border-white/10"} bg-[#141417]`}><div className="relative aspect-video bg-black">{shot.payload.videoFileId ? <video muted src={serverApiUrl(`/files/${shot.payload.videoFileId}/content`)} className="size-full object-cover" /> : shot.payload.firstFrameFileId ? <img src={serverApiUrl(`/files/${shot.payload.firstFrameFileId}/content`)} className="size-full object-cover opacity-60" /> : <div className="grid size-full place-items-center"><Video className="size-6 text-white/15" /></div>}<span className="absolute bottom-1 right-1 bg-black/70 px-1 font-mono text-[10px]">{shot.payload.durationSeconds || 4}s</span></div><div className="truncate px-3 py-2 text-xs text-white/55">{shot.title}</div></div>)}</div>
                <div className="mt-5 space-y-1">{(["dialogue", "narration", "ambient", "sfx", "music"] as const).map((kind) => { const track = state.timeline.payload.tracks?.find((item) => item.kind === kind); return <div key={kind} className="flex h-11 min-w-[900px] items-center border-t border-white/8"><div className="w-28 shrink-0 text-[11px] uppercase tracking-wider text-white/30">{({ dialogue: "对白", narration: "旁白", ambient: "环境声", sfx: "道具音效", music: "音乐" })[kind]}</div><div className="relative h-7 flex-1 bg-white/[.025]">{track?.clips.map((clip) => <div key={clip.id} className="absolute inset-y-1 border border-blue-200 bg-blue-50 px-2 text-[10px] leading-5 text-blue-700" style={{ left: clip.start * 16, width: Math.max(24, clip.duration * 16) }}>{clip.duration}s</div>)}</div></div>; })}</div>
            </div></div>
    </div>;
}

function EmptyPanel({ icon: Icon, title, description }: { icon: typeof Film; title: string; description: string }) { return <div className="mt-8 grid min-h-80 place-items-center border border-dashed border-white/12 text-center"><div><Icon className="mx-auto size-8 text-white/15" /><h2 className="mt-4 font-serif text-xl">{title}</h2><p className="mt-2 text-sm text-white/35">{description}</p></div></div>; }
