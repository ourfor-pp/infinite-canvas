import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { App, Button, ConfigProvider, Drawer, Dropdown, Image as AntImage, Input, Progress as AntProgress, Select, Spin, Tag, theme as antdTheme, Tooltip } from "antd";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Activity,
    AudioLines,
    Bell,
    Bot,
    Braces,
    Check,
    ChevronRight,
    Clock3,
    Clapperboard,
    Copy,
    FileText,
    Film,
    House,
    Eye,
    Image as ImageIcon,
    LayoutDashboard,
    ListVideo,
    Lock,
    Loader2,
    Maximize2,
    MoreHorizontal,
    Package,
    Palette,
    Pause,
    PanelLeftClose,
    PanelLeftOpen,
    Play,
    Plus,
    RefreshCw,
    Save,
    Scissors,
    ScrollText,
    Sparkles,
    SkipBack,
    SkipForward,
    Trash2,
    Upload,
    Download,
    ShieldCheck,
    Users,
    Video,
    Volume2,
    VolumeX,
    X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useNavigate, useParams } from "react-router-dom";
import { Streamdown } from "streamdown";
import { AgentPanel } from "@/components/agent/agent-panel";
import { VisualStyleTemplatePicker } from "@/components/visual-style-template-picker";
import { directorApi } from "@/services/api/director";
import { serverApi, serverApiUrl, uploadServerFile, type CreativeAssetGenerationPreview, type ServerGeneration } from "@/services/api/server";
import { useAgentStore } from "@/stores/use-agent-store";
import { useDirectorStore } from "@/stores/use-director-store";
import type { CreativeAsset, CreativeAssetKind } from "@/types/creative-asset";
import type { DirectorAssetDetail, DirectorAssetMedia, DirectorAssetVisualWorkspace, DirectorDocument, DirectorLogicalDocument, DirectorRender, DirectorSection, DirectorSequence, DirectorState, DirectorValidation, DirectorVideoSegment, DirectorVideoSegmentPreflight, DirectorWorkspace, H3QualityPreset } from "@/types/director";
import type { VisualStyle, VisualStyleTemplate } from "@/types/visual-style";
import { DirectorMarkdownEditor } from "./components/director-markdown-editor";
import { WorkspaceImagePreviewLightbox, type WorkspaceImagePreviewItem } from "@/components/workspace-image-preview-lightbox";
import { useCopyText } from "@/hooks/use-copy-text";
import "./director-light.css";

const sections: Array<{ id: DirectorSection; label: string; icon: typeof Film }> = [
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "story", label: "故事", icon: FileText },
    { id: "script", label: "剧本", icon: ScrollText },
    { id: "style", label: "导演方案", icon: Palette },
    { id: "assets", label: "素材", icon: Package },
    { id: "storyboard", label: "分镜", icon: Clapperboard },
    { id: "studio", label: "视频创作台", icon: Scissors },
];

function Progress(props: ComponentProps<typeof AntProgress>) {
    return <AntProgress {...props} strokeColor="#2563eb" trailColor="#e2e8f0" />;
}

function formatDirectorDuration(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return minutes ? `${minutes} 分${remaining ? ` ${remaining} 秒` : ""}` : `${remaining} 秒`;
}

const assetFileUrl = (fileId: string, revision: number) => serverApiUrl(`/files/${fileId}/content?revision=${revision}`);

export default function DirectorProjectPage() {
    const { id = "", section = "overview" } = useParams();
    const active = sections.some((item) => item.id === section) ? (section as DirectorSection) : "overview";
    const navigate = useNavigate();
    const { message } = App.useApp();
    const state = useDirectorStore((store) => store.states[id]);
    const loadState = useDirectorStore((store) => store.loadState);
    const [assets, setAssets] = useState<CreativeAsset[]>([]);
    const [styles, setStyles] = useState<VisualStyle[]>([]);
    const [generations, setGenerations] = useState<ServerGeneration[]>([]);
    const [loading, setLoading] = useState(true);
    const [agentCollapsed, setAgentCollapsed] = useState(false);
    const openPanel = useAgentStore((store) => store.openPanel);

    const refresh = async () => {
        const [, nextAssets, nextStyles, nextGenerations] = await Promise.all([loadState(id), serverApi.creativeAssets(id), serverApi.visualStyles(id), serverApi.generations()]);
        setAssets(nextAssets);
        setStyles(nextStyles);
        setGenerations(nextGenerations);
    };
    useEffect(() => {
        let active = true;
        openPanel(id);
        Promise.all([loadState(id), serverApi.creativeAssets(id), serverApi.visualStyles(id), serverApi.generations()])
            .then(([, nextAssets, nextStyles, nextGenerations]) => {
                if (!active) return;
                setAssets(nextAssets);
                setStyles(nextStyles);
                setGenerations(nextGenerations);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "导演项目加载失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [id, loadState, message, openPanel]);
    const applyGeneration = (generation: ServerGeneration) => setGenerations((current) => [generation, ...current.filter((item) => item.id !== generation.id)].slice(0, 100));
    useEffect(() => {
        const update = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail.projectId === id) void loadState(id);
        };
        const refreshAssets = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail.projectId === id)
                void Promise.all([serverApi.creativeAssets(id), serverApi.visualStyles(id)]).then(([nextAssets, nextStyles]) => {
                    setAssets(nextAssets);
                    setStyles(nextStyles);
                });
        };
        const updateGeneration = (event: Event) => applyGeneration((event as CustomEvent<ServerGeneration>).detail);
        window.addEventListener("infinite-canvas:director-updated", update);
        window.addEventListener("infinite-canvas:creative-asset-updated", refreshAssets);
        window.addEventListener("infinite-canvas:visual-style-updated", refreshAssets);
        window.addEventListener("infinite-canvas:generation-updated", updateGeneration);
        return () => {
            window.removeEventListener("infinite-canvas:director-updated", update);
            window.removeEventListener("infinite-canvas:creative-asset-updated", refreshAssets);
            window.removeEventListener("infinite-canvas:visual-style-updated", refreshAssets);
            window.removeEventListener("infinite-canvas:generation-updated", updateGeneration);
        };
    }, [id, loadState]);

    if (loading || !state)
        return (
            <div className="director-light grid h-full place-items-center bg-white">
                <Spin />
            </div>
        );
    return (
        <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
            <main className="director-light flex h-dvh min-w-0 bg-white text-slate-950">
                {!agentCollapsed ? <AgentPanel projectId={id} themeMode="light" /> : null}
                <div className="flex min-w-0 flex-1 flex-col bg-white">
                    <header className="flex h-11 shrink-0 items-stretch border-b border-black/10 bg-white px-5">
                        <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="导演台功能">
                            {sections.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => navigate(`/director/${id}/${item.id}`)}
                                        aria-current={active === item.id ? "page" : undefined}
                                        className={`relative flex shrink-0 items-center gap-2 px-3 text-sm transition ${active === item.id ? "text-blue-600 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-blue-600" : "text-slate-500 hover:bg-blue-50 hover:text-blue-700"}`}
                                    >
                                        <Icon className="size-4" />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </nav>
                        <DirectorTaskControls projectId={id} generations={generations} assets={assets} styles={styles} onGeneration={applyGeneration} onNavigate={(target) => navigate(`/director/${id}/${target}`)} />
                        <div className="ml-1 flex shrink-0 items-stretch border-l border-slate-200 pl-1">
                            <Tooltip title={agentCollapsed ? "展开 Agent" : "收起 Agent"}>
                                <button
                                    type="button"
                                    aria-label={agentCollapsed ? "展开 Agent" : "收起 Agent"}
                                    className="grid w-10 place-items-center text-slate-400 transition hover:bg-blue-50 hover:text-blue-700"
                                    onClick={() => {
                                        setAgentCollapsed((value) => !value);
                                        if (agentCollapsed) openPanel(id);
                                    }}
                                >
                                    {agentCollapsed ? <PanelLeftOpen className="size-[17px]" /> : <PanelLeftClose className="size-[17px]" />}
                                </button>
                            </Tooltip>
                            <Tooltip title="返回导演项目库">
                                <button type="button" aria-label="返回导演项目库" className="grid w-10 place-items-center text-slate-500 transition hover:bg-blue-50 hover:text-blue-700" onClick={() => navigate("/director")}>
                                    <House className="size-[18px]" />
                                </button>
                            </Tooltip>
                        </div>
                    </header>
                    <section className={`relative min-w-0 flex-1 bg-white ${active === "story" || active === "script" || active === "style" || active === "assets" || active === "storyboard" ? "overflow-hidden" : "overflow-auto"}`}>
                        {active === "overview" ? <Overview state={state} assets={assets} styles={styles} onNavigate={(target) => navigate(`/director/${id}/${target}`)} /> : null}
                        {active === "story" || active === "script" ? <Writing key={active} projectId={id} kind={active} state={state} onRefresh={refresh} /> : null}
                        {active === "style" ? <DirectorTreatmentPage projectId={id} workspace={state.workspace} activeStyleId={state.activeStyleId} styles={styles} onRefresh={refresh} /> : null}
                        {active === "assets" ? <AssetGallery projectId={id} state={state} assets={assets} generations={generations} agentCollapsed={agentCollapsed} onGeneration={applyGeneration} onRefresh={refresh} /> : null}
                        {active === "storyboard" ? <Storyboard projectId={id} state={state} onRefresh={refresh} /> : null}
                        {active === "studio" ? <Studio projectId={id} state={state} onRefresh={refresh} /> : null}
                    </section>
                </div>
            </main>
        </ConfigProvider>
    );
}

type DirectorTaskPanel = "tasks" | "notifications" | null;

function DirectorTaskControls({ projectId, generations, assets, styles, onGeneration, onNavigate }: { projectId: string; generations: ServerGeneration[]; assets: CreativeAsset[]; styles: VisualStyle[]; onGeneration: (generation: ServerGeneration) => void; onNavigate: (section: DirectorSection) => void }) {
    const { message } = App.useApp();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<DirectorTaskPanel>(null);
    const [cancelling, setCancelling] = useState("");
    const seenKey = `director-notifications-seen:${projectId}`;
    const [seen, setSeen] = useState<Set<string>>(() => new Set(readLocalIds(seenKey)));
    const projectGenerations = generations.filter((generation) => generationBelongsToDirector(generation, projectId, assets, styles));
    const activeCount = projectGenerations.filter((item) => item.status === "queued" || item.status === "running").length;
    const notifications = projectGenerations.filter((item) => item.status === "succeeded" || item.status === "failed" || item.status === "canceled");
    const unreadCount = notifications.filter((item) => !seen.has(item.id)).length;
    useEffect(() => {
        const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(null); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, []);
    const toggle = (panel: Exclude<DirectorTaskPanel, null>) => {
        const next = open === panel ? null : panel;
        setOpen(next);
        if (next === "notifications") {
            const nextSeen = new Set([...seen, ...notifications.map((item) => item.id)]);
            setSeen(nextSeen);
            localStorage.setItem(seenKey, JSON.stringify([...nextSeen].slice(-200)));
        }
    };
    const cancel = async (generation: ServerGeneration) => {
        setCancelling(generation.id);
        try { onGeneration(await serverApi.cancelGeneration(generation.id)); }
        catch (error) { message.error(error instanceof Error ? error.message : "取消任务失败"); }
        finally { setCancelling(""); }
    };
    return (
        <div ref={rootRef} className="relative ml-3 flex shrink-0 items-center gap-1 border-l border-slate-200 pl-3">
            <TaskHeaderButton label="通知" icon={Bell} count={unreadCount} active={open === "notifications"} onClick={() => toggle("notifications")} />
            <TaskHeaderButton label="任务" icon={Activity} count={activeCount} active={open === "tasks"} pulse={activeCount > 0} onClick={() => toggle("tasks")} />
            {open ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-[1200] w-[360px] overflow-hidden border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,.16)]">
                    <div className="flex items-center border-b border-slate-200 px-4 py-3">
                        <div className="grid size-8 place-items-center bg-blue-50 text-blue-600">{open === "tasks" ? <Activity className="size-4" /> : <Bell className="size-4" />}</div>
                        <div className="ml-3"><h3 className="text-sm font-medium text-slate-950">{open === "tasks" ? "生成任务" : "通知"}</h3><p className="mt-0.5 font-mono text-[10px] tracking-wider text-slate-400">{open === "tasks" ? `${activeCount} ACTIVE · ${projectGenerations.length} TOTAL` : `${notifications.length} EVENTS`}</p></div>
                        <button className="ml-auto grid size-8 place-items-center text-slate-400 hover:bg-slate-50 hover:text-slate-700" onClick={() => setOpen(null)} aria-label="关闭"><X className="size-4" /></button>
                    </div>
                    {open === "tasks" ? (
                        <div className="max-h-[420px] overflow-y-auto p-2">
                            {projectGenerations.length ? projectGenerations.slice(0, 30).map((generation) => <DirectorTaskRow key={generation.id} generation={generation} assets={assets} cancelling={cancelling === generation.id} onCancel={() => void cancel(generation)} />) : <TaskEmpty icon={Activity} title="还没有生成任务" description="角色、场景、道具和镜头任务会显示在这里。" />}
                        </div>
                    ) : (
                        <div className="max-h-[420px] overflow-y-auto p-2">
                            {notifications.length ? notifications.slice(0, 30).map((generation) => <DirectorNotificationRow key={generation.id} generation={generation} assets={assets} onNavigate={() => { setOpen(null); onNavigate(generationAssetId(generation) ? "assets" : generationStyleId(generation) ? "style" : "storyboard"); }} />) : <TaskEmpty icon={Bell} title="暂无通知" description="任务完成、失败或取消后会留在这里。" />}
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function TaskHeaderButton({ label, icon: Icon, count, active, pulse, onClick }: { label: string; icon: typeof Bell; count: number; active: boolean; pulse?: boolean; onClick: () => void }) {
    return <Tooltip title={label}><button type="button" aria-label={label} className={`relative grid size-9 place-items-center transition ${active ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50 hover:text-blue-700"}`} onClick={onClick}><Icon className={`size-[17px] ${pulse ? "director-task-pulse" : ""}`} />{count > 0 ? <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-semibold text-white">{count > 9 ? "9+" : count}</span> : null}</button></Tooltip>;
}

function DirectorTaskRow({ generation, assets, cancelling, onCancel }: { generation: ServerGeneration; assets: CreativeAsset[]; cancelling: boolean; onCancel: () => void }) {
    const meta = generationTaskMeta(generation, assets);
    const active = generation.status === "queued" || generation.status === "running";
    return <article className="border-b border-slate-100 px-3 py-3 last:border-0">
        <div className="flex items-center gap-2">{generation.status === "running" ? <Loader2 className="size-3.5 animate-spin text-blue-600" /> : generation.status === "queued" ? <Clock3 className="size-3.5 text-slate-400" /> : generation.status === "succeeded" ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-rose-500" />}<span className="min-w-0 flex-1 truncate text-xs text-slate-700">{meta.title}</span><span className={`text-[10px] ${active ? "text-blue-600" : generation.status === "succeeded" ? "text-emerald-600" : "text-rose-500"}`}>{generationStatusLabel(generation.status)}</span>{active ? <button disabled={cancelling} className="ml-1 text-[10px] text-slate-400 hover:text-rose-500" onClick={onCancel}>{cancelling ? "取消中" : "取消"}</button> : null}</div>
        {active ? <div className="mt-2 h-0.5 overflow-hidden bg-slate-100"><div className={`h-full bg-blue-600 transition-all ${generation.progress > 0 ? "" : "director-task-progress"}`} style={generation.progress > 0 ? { width: `${Math.max(4, Math.round(generation.progress * 100))}%` } : undefined} /></div> : null}
        {generation.error ? <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-rose-500">{generation.error}</p> : <p className="mt-1.5 font-mono text-[9px] text-slate-400">{meta.subtitle} · {formatTaskTime(generation.updatedAt)}</p>}
    </article>;
}

function DirectorNotificationRow({ generation, assets, onNavigate }: { generation: ServerGeneration; assets: CreativeAsset[]; onNavigate: () => void }) {
    const meta = generationTaskMeta(generation, assets);
    const success = generation.status === "succeeded";
    return <button className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left transition last:border-0 hover:bg-blue-50/50" onClick={onNavigate}><span className={`mt-0.5 grid size-7 shrink-0 place-items-center ${success ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{success ? <Check className="size-3.5" /> : <X className="size-3.5" />}</span><span className="min-w-0 flex-1"><span className="block text-xs text-slate-800">{meta.title}{success ? "已完成" : generation.status === "canceled" ? "已取消" : "失败"}</span><span className="mt-1 block font-mono text-[9px] text-slate-400">{formatTaskTime(generation.updatedAt)}</span>{generation.error ? <span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-rose-500">{generation.error}</span> : null}</span><ChevronRight className="mt-1 size-3.5 text-slate-300" /></button>;
}

function TaskEmpty({ icon: Icon, title, description }: { icon: typeof Bell; title: string; description: string }) {
    return <div className="m-2 border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center"><Icon className="mx-auto size-5 text-slate-300" /><p className="mt-3 text-xs font-medium text-slate-700">{title}</p><p className="mt-1 text-[10px] leading-4 text-slate-400">{description}</p></div>;
}

function generationBelongsToDirector(generation: ServerGeneration, projectId: string, assets: CreativeAsset[], styles: VisualStyle[]) {
    const params = recordValue(recordValue(generation.request).params);
    const contexts = [params.__creativeAsset, params.__directorVideoSegment, params.__directorSegment, params.__directorRender, params.__directorStoryboardSheet, params.__directorStoryboardReview].map(recordValue);
    if (contexts.some((context) => String(context.projectId || "") === projectId)) return true;
    const assetId = String(recordValue(params.__creativeAsset).assetId || "");
    if (assetId && assets.some((asset) => asset.id === assetId)) return true;
    const styleId = String(recordValue(params.__visualStyleBoard).styleId || recordValue(params.__visualStyleAnalysis).styleId || "");
    return Boolean(styleId && styles.some((style) => style.id === styleId));
}

function generationAssetId(generation: ServerGeneration) { return String(recordValue(recordValue(recordValue(generation.request).params).__creativeAsset).assetId || ""); }
function generationStyleId(generation: ServerGeneration) { const params = recordValue(recordValue(generation.request).params); return String(recordValue(params.__visualStyleBoard).styleId || recordValue(params.__visualStyleAnalysis).styleId || ""); }
function generationTaskMeta(generation: ServerGeneration, assets: CreativeAsset[]) { const params = recordValue(recordValue(generation.request).params); const asset = assets.find((item) => item.id === generationAssetId(generation)); const storyboard = recordValue(params.__directorStoryboardSheet); const segment = recordValue(params.__directorSegment); const storyboardReview = recordValue(params.__directorStoryboardReview); const media = generation.kind === "image" ? "图片" : generation.kind === "video" ? "视频" : generation.kind === "audio" ? "声音" : "分析"; return { title: asset ? `${asset.name} · ${media}` : storyboard.segmentId ? "整张故事板 · 图片" : segment.segmentId ? "视频段 · 视频" : storyboardReview.segmentId ? "整张故事板 · 视觉检查" : `${media}生成`, subtitle: generation.modelId || "生成服务" }; }
function generationStatusLabel(status: ServerGeneration["status"]) { return status === "queued" ? "排队" : status === "running" ? "生成中" : status === "succeeded" ? "完成" : status === "canceled" ? "取消" : "失败"; }
function formatTaskTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
function recordValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readLocalIds(key: string): string[] { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } }

function Overview({ state, assets, styles, onNavigate }: { state: DirectorState; assets: CreativeAsset[]; styles: VisualStyle[]; onNavigate: (section: DirectorSection) => void }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const importRef = useRef<HTMLInputElement>(null);
    const [validation, setValidation] = useState<DirectorValidation | null>(null);
    const [projectBusy, setProjectBusy] = useState<"validate" | "export" | "import" | "">("");
    useEffect(() => { void directorApi.validation(state.workspace.projectId).then(setValidation).catch(() => undefined); }, [state.workspace.projectId, state.workspace.updatedAt]);
    const runValidation = async () => {
        setProjectBusy("validate");
        try { const result = await directorApi.validate(state.workspace.projectId); setValidation(result); message.success(result.valid ? "工程规范检查通过" : `发现 ${result.diagnostics.length} 项问题`); }
        catch (error) { message.error(error instanceof Error ? error.message : "工程检查失败"); }
        finally { setProjectBusy(""); }
    };
    const exportProject = async () => {
        setProjectBusy("export");
        try { const blob = await directorApi.exportProject(state.workspace.projectId); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `director-${state.workspace.projectId}.zip`; anchor.click(); URL.revokeObjectURL(url); }
        catch (error) { message.error(error instanceof Error ? error.message : "工程导出失败"); }
        finally { setProjectBusy(""); }
    };
    const importProject = async (file?: File) => {
        if (!file) return;
        setProjectBusy("import");
        try { const result = await directorApi.importProject(file); message.success("导演工程已导入"); navigate(`/director/${result.projectId}/overview`); }
        catch (error) { message.error(error instanceof Error ? error.message : "工程导入失败"); }
        finally { setProjectBusy(""); if (importRef.current) importRef.current.value = ""; }
    };
    const documents = Object.fromEntries(state.documents.map((item) => [item.kind, item]));
    const stale = state.sequences.filter((item) => item.payload.needsReview).length + state.videoSegments.filter((item) => item.payload.needsReview || item.payload.videoStale).length;
    const readyAssets = assets.filter((item) => item.payload.variants.some((variant) => variant.kind === "image")).length;
    const stages = [
        Boolean(documents.story?.content.trim()),
        Boolean(documents.script?.content.trim()),
        Boolean(styles.find((item) => item.id === state.activeStyleId)),
        assets.length > 0 && readyAssets === assets.length,
        state.sequences.length > 0 && state.sequences.every((item) => item.status !== "draft"),
        state.videoSegments.length > 0 && state.videoSegments.every((item) => item.payload.videoFileId),
    ];
    const progress = Math.round((stages.filter(Boolean).length / stages.length) * 100);
    const stageItems = [
        { label: "故事", detail: documents.story?.content.trim() ? "已编写" : "待创作", done: stages[0], target: "story" as const },
        { label: "剧本", detail: stages[1] ? "已编写" : "待创作", done: stages[1], target: "script" as const },
        { label: "导演方案", detail: styles.find((item) => item.id === state.activeStyleId)?.name || "待设置", done: stages[2], target: "style" as const },
        { label: "素材", detail: `${readyAssets}/${assets.length}`, done: stages[3], target: "assets" as const },
        { label: "故事板", detail: `${state.sequences.filter((item) => item.status !== "draft").length}/${state.sequences.length}`, done: stages[4], target: "storyboard" as const },
        { label: "视频段", detail: `${state.videoSegments.filter((item) => item.payload.videoFileId).length}/${state.videoSegments.length}`, done: stages[5], target: "storyboard" as const },
        { label: "成片", detail: stages[5] ? "可合成" : "待就绪", done: false, target: "studio" as const },
    ];
    const nextStage = stageItems.find((item) => !item.done) || stageItems.at(-1)!;
    return (
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
            <section className="mb-6 flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid size-9 shrink-0 place-items-center ${validation?.valid ? "bg-emerald-50 text-emerald-600" : "bg-white text-slate-500"}`}><ShieldCheck className="size-4" /></span>
                    <div className="min-w-0"><div className="text-sm font-medium text-slate-900">工程健康</div><div className="mt-0.5 truncate text-xs text-slate-500">{validation ? validation.valid ? "目录、引用和创作文件通过检查" : `${validation.diagnostics.filter((item) => item.severity === "error").length} 个错误，${validation.diagnostics.filter((item) => item.severity === "warning").length} 个提醒` : "正在读取工程诊断"}</div></div>
                </div>
                <div className="flex items-center gap-1">
                    <Button type="text" icon={<ShieldCheck className="size-4" />} loading={projectBusy === "validate"} onClick={() => void runValidation()}>检查工程</Button>
                    <Button type="text" icon={<Download className="size-4" />} loading={projectBusy === "export"} onClick={() => void exportProject()}>导出 ZIP</Button>
                    <Button type="text" icon={<Upload className="size-4" />} loading={projectBusy === "import"} onClick={() => importRef.current?.click()}>导入工程</Button>
                    <input ref={importRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => void importProject(event.target.files?.[0])} />
                </div>
            </section>
            <div className="grid gap-px overflow-hidden border border-slate-200 bg-slate-200 md:grid-cols-4">
                {[
                    ["目标时长", `${Math.round(state.workspace.targetDurationSeconds / 60)} 分钟`],
                    ["画幅", state.workspace.aspectRatio],
                    ["来源", state.sources[0]?.name || "对话创作"],
                    ["当前风格", styles.find((item) => item.id === state.activeStyleId)?.name || "未设置"],
                ].map(([label, value]) => (
                    <div key={label} className="bg-white p-5">
                        <div className="text-xs text-slate-500">{label}</div>
                        <div className="mt-3 truncate text-lg text-slate-950">{value}</div>
                    </div>
                ))}
            </div>
            <section className="mt-8 border border-slate-200 bg-white p-6">
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <h2 className="font-serif text-2xl">制作进度</h2>
                    </div>
                    <span className="font-mono text-sm text-blue-600">{progress}%</span>
                </div>
                <Progress percent={progress} showInfo={false} className="mt-5" />
                <div className="mt-6 grid gap-px overflow-hidden border border-slate-200 bg-slate-200 md:grid-cols-3 xl:grid-cols-7">
                    {stageItems.map((item, index) => (
                        <button key={item.label} className="group bg-white px-4 py-4 text-left transition hover:bg-blue-50" onClick={() => onNavigate(item.target)}>
                            <div className="flex items-center justify-between">
                                <span className={`font-mono text-[10px] ${item.done ? "text-emerald-600" : "text-slate-400"}`}>{String(index + 1).padStart(2, "0")}</span>
                                {item.done ? <Check className="size-3.5 text-emerald-600" /> : <ChevronRight className="size-3.5 text-slate-300 group-hover:text-blue-600" />}
                            </div>
                            <div className="mt-4 text-sm font-medium text-slate-900">{item.label}</div>
                            <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                        </button>
                    ))}
                </div>
            </section>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
                <section className="border border-slate-200 bg-slate-50 p-6">
                    <div className="text-xs text-slate-500">下一步</div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
                        <div>
                            <h2 className="font-serif text-2xl text-slate-950">继续处理「{nextStage.label}」</h2>
                            <p className="mt-2 text-sm text-slate-500">系统只推进当前阶段，已有内容和生成结果不会被自动覆盖。</p>
                        </div>
                        <Button className="!h-10 !border-blue-600 !bg-blue-600 !px-5 !text-white" onClick={() => onNavigate(nextStage.target)}>
                            继续创作 <ChevronRight className="ml-1 size-4" />
                        </Button>
                    </div>
                </section>
                <section className="border border-slate-200 bg-white p-6">
                    <h2 className="font-serif text-xl">需要注意</h2>
                    <div className="mt-5 space-y-3">
                        <Notice count={state.sources.filter((item) => item.status === "failed").length} label="失败的来源任务" />
                        <Notice count={stale} label="上游变化，待检查" />
                        <Notice count={state.videoSegments.filter((item) => !item.payload.storyboardSheet?.imageFileId).length} label="缺少故事板的视频段" />
                        <Notice count={state.videoSegments.filter((item) => !item.payload.videoFileId).length} label="缺少视频的视频段" />
                    </div>
                </section>
            </div>
        </div>
    );
}

function Notice({ count, label }: { count: number; label: string }) {
    return (
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className={count ? "text-rose-600" : "text-slate-300"}>{count}</span>
        </div>
    );
}
function statusLabel(status: string) {
    return status === "confirmed" ? "已确认" : status === "locked" ? "已锁定" : status === "draft" ? "草稿" : status;
}

const screenplaySpeakerCue = /^[\p{L}\p{N}·・]{1,16}(?:（[^）\n]{1,12}）)?$/u;

function formatScreenplayPreview(source: string) {
    const lines = source.split("\n");
    return lines.map((line, index) => {
        const cue = line.trim();
        if (!cue || cue.startsWith("**") || !screenplaySpeakerCue.test(cue)) return line;
        const previous = index ? lines[index - 1]!.trim() : "";
        const next = lines[index + 1]?.trim() || "";
        return !previous && next ? `**${cue}**` : line;
    }).join("\n");
}

function composeDirectorDocumentParts(document: DirectorLogicalDocument, selectedPath: string | undefined, selectedContent: string) {
    return document.parts.map((part) => {
        const content = (part.path === selectedPath ? selectedContent : part.content).trim();
        return part.index ? content : content.replace(/^#\s+/, "## ");
    }).filter(Boolean).join("\n\n");
}

function Writing({ projectId, kind, state, onRefresh }: { projectId: string; kind: "story" | "script"; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const fileRef = useRef<HTMLInputElement>(null);
    const source = state.sources[0];
    const document = state.documents.find((item) => item.kind === kind)!;
    const [logicalDocument, setLogicalDocument] = useState<DirectorLogicalDocument>();
    const [selectedPartPath, setSelectedPartPath] = useState("");
    const selectedPartPathRef = useRef(selectedPartPath);
    selectedPartPathRef.current = selectedPartPath;
    const [partContent, setPartContent] = useState("");
    const [documentLoading, setDocumentLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [activeOutline, setActiveOutline] = useState(0);
    const previewRef = useRef<HTMLElement>(null);
    const outlineRef = useRef<HTMLElement>(null);
    const selectedPart = logicalDocument?.parts.find((part) => part.path === selectedPartPath) || logicalDocument?.parts[0];
    const dirty = Boolean(selectedPart && partContent !== selectedPart.content);
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    useEffect(() => {
        let active = true;
        setDocumentLoading(true);
        void directorApi.logicalDocument(projectId, kind).then((next) => {
            if (!active || dirtyRef.current) return;
            const nextPath = next.parts.some((part) => part.path === selectedPartPathRef.current) ? selectedPartPathRef.current : (next.parts.find((part) => !part.index) || next.parts[0])?.path || "";
            setLogicalDocument(next);
            setSelectedPartPath(nextPath);
            setPartContent(next.parts.find((part) => part.path === nextPath)?.content || "");
            setActiveOutline(0);
        }).catch((error) => active && message.error(error instanceof Error ? error.message : "文档读取失败")).finally(() => active && setDocumentLoading(false));
        return () => { active = false; };
    }, [document.revision, kind, projectId]);
    useEffect(() => {
        if (selectedPart) setPartContent(selectedPart.content);
    }, [selectedPart?.hash, selectedPart?.path]);
    const giveAgent = useAgentStore((store) => store.prepareComposer);
    const content = useMemo(() => logicalDocument ? composeDirectorDocumentParts(logicalDocument, selectedPart?.path, partContent) : document.content, [document.content, logicalDocument, partContent, selectedPart?.path]);
    const contentLength = content.replace(/\s/g, "").length;
    const physicalParts = logicalDocument?.parts.filter((part) => !part.index) || [];
    const sectionCount = physicalParts.length || (content.match(/^##\s/gm) || []).length;
    const previewContent = useMemo(() => kind === "script" ? formatScreenplayPreview(content) : content, [content, kind]);
    const screenplayDuration = kind === "script" && !state.screenplayBreakdown.stale && state.screenplayBreakdown.scriptRevision === document.revision
        ? state.screenplayBreakdown.payload.estimatedDurationSeconds : 0;
    const outline = content
        .split("\n")
        .map((line) => line.match(/^(#{1,3})\s+(.+)/))
        .filter((match) => Boolean(match) && (kind !== "script" || match![1].length === 2))
        .map((match, index) => ({ id: index + 1, depth: match![1].length, title: match![2] }));
    const previewHeadings = () => Array.from(previewRef.current?.querySelectorAll<HTMLElement>(kind === "script" ? "h2" : "h1, h2, h3") || []);
    const navigateOutline = (index: number) => {
        const preview = previewRef.current;
        const heading = previewHeadings()[index];
        if (!preview || !heading) return;
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveOutline(index);
    };
    const syncOutline = () => {
        const preview = previewRef.current;
        if (!preview) return;
        const threshold = preview.getBoundingClientRect().top + 72;
        let current = 0;
        previewHeadings().forEach((heading, index) => {
            if (heading.getBoundingClientRect().top <= threshold) current = index;
        });
        setActiveOutline(current);
    };
    useEffect(() => {
        const container = outlineRef.current;
        const item = container?.querySelector<HTMLElement>('[aria-current="location"]');
        if (!container || !item) return;
        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.offsetHeight;
        if (itemTop < container.scrollTop) container.scrollTo({ top: itemTop - 8, behavior: "smooth" });
        else if (itemBottom > container.scrollTop + container.clientHeight) container.scrollTo({ top: itemBottom - container.clientHeight + 8, behavior: "smooth" });
    }, [activeOutline]);
    const save = async () => {
        if (!selectedPart) return;
        setBusy(true);
        try {
            const next = await directorApi.updateDocumentPart(projectId, kind, selectedPart.path, partContent, selectedPart.hash);
            setLogicalDocument(next);
            const savedPart = next.parts.find((part) => part.path === selectedPart.path);
            if (savedPart) setPartContent(savedPart.content);
            await onRefresh();
            message.success(`${selectedPart.name}已保存`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setBusy(false);
        }
    };
    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try {
            await directorApi.addSource(projectId, file);
            await onRefresh();
            message.success("小说已进入解析队列");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setBusy(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };
    return (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.markdown,.pdf,.epub,text/plain,text/markdown,application/pdf,application/epub+zip" onChange={(event) => void upload(event.target.files?.[0])} />
            <div data-testid="director-document-toolbar" className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-8 py-2 lg:px-12">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-[11px] text-slate-400">REV {document.revision}</span>
                    <span className="hidden text-[11px] text-slate-400 sm:inline">
                        {contentLength.toLocaleString()} 字 · {sectionCount} {kind === "script" ? "场" : "章"}{screenplayDuration ? ` · 预计 ${formatDirectorDuration(screenplayDuration)}` : ""}
                    </span>
                    {dirty ? <span className="text-[11px] text-blue-600">未保存</span> : null}
                    {kind === "story" && source ? (
                        <span className="hidden min-w-0 items-center gap-2 text-xs text-slate-400 md:flex">
                            <span className="h-3 w-px bg-slate-200" />
                            <FileText className="size-3.5" />
                            <span className="max-w-52 truncate">{source.name}</span>
                            <span>{source.status === "processing" ? "正在解析" : source.status === "failed" ? "解析失败" : `${source.chapterCount} 章`}</span>
                            {source.status === "processing" ? <RefreshCw className="size-3 animate-spin" /> : null}
                        </span>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    {editing && (logicalDocument?.parts.length || 0) > 1 ? <Select className="director-document-part-select" size="small" variant="borderless" aria-label={`选择要编辑的${kind === "story" ? "章节" : "场次"}`} value={selectedPart?.path} disabled={dirty || busy} options={logicalDocument!.parts.map((part) => ({ value: part.path, label: part.index ? `${kind === "story" ? "故事" : "剧本"}总览` : part.name }))} onChange={(path) => { setSelectedPartPath(path); setPartContent(logicalDocument!.parts.find((part) => part.path === path)?.content || ""); }} /> : null}
                    {kind === "story" ? (
                        source?.status === "failed" ? (
                            <Button type="text" size="small" className="!text-rose-600" onClick={() => void directorApi.retrySource(source.id).then(onRefresh)}>
                                重试解析
                            </Button>
                        ) : (
                            <Button type="text" size="small" className="!text-slate-500" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
                                上传小说
                            </Button>
                        )
                    ) : null}
                    <Button
                        type="text"
                        size="small"
                        className="!text-slate-500"
                        icon={<Bot className="size-4" />}
                        onClick={() => giveAgent(projectId, { kind: "director", projectId, entityKind: kind, entityId: kind, title: kind === "story" ? "故事" : "剧本", subtitle: "导演文档" })}
                    >
                        交给 Agent
                    </Button>
                    <div className="director-doc-mode" role="group" aria-label={`${kind === "story" ? "故事" : "剧本"}文档模式`}>
                        <button type="button" data-active={!editing} onClick={() => setEditing(false)}>
                            预览
                        </button>
                        <button type="button" data-active={editing} onClick={() => setEditing(true)}>
                            编辑
                        </button>
                    </div>
                    {editing || dirty ? (
                        <Button type="text" size="small" className="!text-slate-500" icon={<Save className="size-4" />} loading={busy} disabled={!dirty} onClick={() => void save()}>
                            保存
                        </Button>
                    ) : null}
                </div>
            </div>
            {!editing ? (
                documentLoading && !logicalDocument ? <div className="grid h-full place-items-center"><Spin size="small" /></div> : <div data-testid={`director-${kind}-preview`} className={`director-document-preview thin-scrollbar ${kind === "script" ? "director-script-preview" : "director-story-preview"}`}>
                    {kind === "script" ? (
                        <aside ref={outlineRef} className="director-script-outline thin-scrollbar" aria-label="剧本场次目录">
                            <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-5 pb-3 pt-5 text-xs font-semibold text-slate-900">场次目录</div>
                            <div className="director-script-outline-list space-y-0.5 px-2 pb-6 pt-2">
                                {outline.length ? (
                                    outline.map((item, index) => (
                                        <button
                                            type="button"
                                            key={`${item.id}:${item.title}`}
                                            aria-current={activeOutline === index ? "location" : undefined}
                                            className={`director-script-outline-item block w-full border-l-2 px-3 py-2 text-left text-xs transition ${activeOutline === index ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
                                            style={{ paddingLeft: 12 + Math.max(0, item.depth - 1) * 12 }}
                                            onClick={() => navigateOutline(index)}
                                        >
                                            {item.title}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-3 py-2 text-xs text-slate-400">等待剧本场次</div>
                                )}
                            </div>
                        </aside>
                    ) : null}
                    <article ref={previewRef} className="director-markdown min-w-0 overflow-auto" onScroll={kind === "script" ? syncOutline : undefined}>
                        <div className={`mx-auto px-8 py-10 lg:px-12 ${kind === "story" ? "max-w-4xl" : "max-w-5xl"}`}>
                            <Streamdown mode="static" controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}>
                                {previewContent}
                            </Streamdown>
                        </div>
                    </article>
                </div>
            ) : (
                <DirectorMarkdownEditor
                    key={`${projectId}:${kind}:${selectedPart?.path}:${selectedPart?.hash}`}
                    content={partContent}
                    dirty={dirty}
                    saving={busy}
                    label={`${selectedPart?.name || (kind === "story" ? "故事" : "剧本")} Markdown 编辑器`}
                    placeholder={kind === "story" ? "在这里创作当前章节" : "按场次写动作、对白与旁白"}
                    onChange={setPartContent}
                />
            )}
        </div>
    );
}

function StatusPill({ status }: { status: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs ${status === "locked" ? "text-blue-600" : status === "confirmed" ? "text-emerald-600" : "text-slate-500"}`}>
            {status === "locked" ? <Lock className="size-3" /> : status === "confirmed" ? <Check className="size-3" /> : <Pause className="size-3" />}
            {statusLabel(status)}
        </span>
    );
}

function AssetGallery({ projectId, state, assets, generations, agentCollapsed, onGeneration, onRefresh }: { projectId: string; state: DirectorState; assets: CreativeAsset[]; generations: ServerGeneration[]; agentCollapsed: boolean; onGeneration: (generation: ServerGeneration) => void; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const setAgentDraft = useAgentStore((store) => store.setDraft);
    const agentWidth = useAgentStore((store) => store.width);
    const [busyId, setBusyId] = useState("");
    const [detailAssetId, setDetailAssetId] = useState("");
    const [previewMediaId, setPreviewMediaId] = useState("");
    const navigate = useNavigate();
    const previewItems = useMemo(() => assets.flatMap((asset) => asset.payload.variants
        .filter((item) => item.kind === "image")
        .map((item) => ({ id: `${asset.id}:${item.id}`, url: assetFileUrl(item.fileId, asset.revision), alt: `${asset.name} · ${item.label || "素材图片"}` } satisfies WorkspaceImagePreviewItem))), [assets]);
    const previewIndex = previewMediaId ? previewItems.findIndex((item) => item.id === previewMediaId) : -1;
    const counts = { character: assets.filter((item) => item.kind === "character").length, scene: assets.filter((item) => item.kind === "scene").length, prop: assets.filter((item) => item.kind === "prop").length };
    const action = async (asset: CreativeAsset, kind: "regenerate" | "copy" | "delete", mediaKind: "image" | "audio" = "image") => {
        setBusyId(asset.id);
        try {
            if (kind === "regenerate") {
                const detail = await directorApi.assetDetail(asset.id);
                onGeneration(await directorApi.generateAsset(asset.id, { target: mediaKind === "audio" ? "sound" : "primary-visual", expectedHash: mediaKind === "audio" ? detail.sound.hash : detail.primaryVisual.hash }));
            }
            if (kind === "copy") await serverApi.createCreativeAsset(projectId, { kind: asset.kind, name: `${asset.name} 副本`, payload: asset.payload });
            if (kind === "delete") await serverApi.deleteCreativeAsset(asset.id);
            if (kind === "delete") setDetailAssetId("");
            await onRefresh();
            message.success(kind === "regenerate" ? "已开始重新生成，将直接替换主结果" : "操作完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setBusyId("");
        }
    };
    const openAgent = (asset: CreativeAsset, path?: string) => prepare(projectId, { kind: "asset", projectId, assetId: asset.id, path, title: asset.name, subtitle: path ? `${asset.kind} · ${path}` : asset.kind });
    const planVariant = (asset: CreativeAsset, folderPath?: string) => {
        openAgent(asset, folderPath);
        const current = useAgentStore.getState().drafts[projectId]?.trimEnd() || "";
        const label = asset.kind === "character" ? "形象" : "状态";
        const instruction = `请先检查剧本和该素材的全部使用位置；只有跨多个视频段持续存在、且缺少独立参考会破坏连续性时，才在当前素材文件夹中规划并创建一个新的生产${label}档案。先完成文字档案和提示词，不要自动生成媒体。`;
        setAgentDraft(projectId, [current, instruction].filter(Boolean).join("\n\n"));
    };
    const columns = (["character", "scene", "prop"] as const).map((kind) => ({
        kind,
        label: kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具",
        agentTitle: kind === "character" ? "批量拆解角色" : kind === "scene" ? "批量拆解场景" : "批量拆解道具",
        agentSubtitle: kind === "character" ? "从剧本整理角色档案与必要变体" : kind === "scene" ? "从剧本整理场景母版与必要状态" : "从剧本整理道具结构与必要状态",
        items: assets.filter((item) => item.kind === kind),
        needsReview: assets.filter((item) => item.kind === kind && item.payload.needsReview).length,
    }));
    const detailAsset = assets.find((item) => item.id === detailAssetId);
    return (
        <div className="relative flex h-full min-w-0 flex-col bg-white">
            <ScrollArea orientation="horizontal" className="min-h-0 flex-1" viewportClassName="director-asset-horizontal-viewport">
                <div className="grid h-full min-w-[900px] grid-cols-3 bg-slate-50 px-1">
                    {columns.map((column) => (
                        <section key={column.kind} className="relative flex min-h-0 min-w-0 flex-col pl-3 before:absolute before:bottom-8 before:left-0 before:top-8 before:border-l before:border-solid before:border-slate-200/70 first:before:hidden" aria-labelledby={`asset-column-${column.kind}`}>
                            <div className="flex h-14 shrink-0 items-center justify-between gap-3 bg-slate-50 pr-3">
                                <div className="flex min-w-0 items-center gap-2 whitespace-nowrap"><h2 id={`asset-column-${column.kind}`} className="text-[15px] font-semibold leading-none text-slate-950">{column.label}</h2><span className="font-mono text-[10px] leading-none text-slate-400">{counts[column.kind]}</span>{column.needsReview ? <span className="ml-1 text-[10px] leading-none text-slate-400">待检查 {column.needsReview}</span> : null}</div>
                                <button type="button" className="inline-flex h-8 -translate-y-0.5 shrink-0 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium leading-none text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,.04)] transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "script", entityId: "script", title: column.agentTitle, subtitle: column.agentSubtitle })}>批量拆解</button>
                            </div>
                            <ScrollArea className="min-h-0 flex-1">
                                <div className="space-y-3 pb-4 pr-3">
                                {column.items.length ? column.items.map((asset) => (
                                    <AssetCard
                                        key={asset.id}
                                        asset={asset}
                                        busy={busyId === asset.id}
                                        activeGenerations={generations.filter((generation) => generationAssetId(generation) === asset.id && (generation.status === "queued" || generation.status === "running"))}
                                        onAgent={() => openAgent(asset)}
                                        onPreview={() => { const media = primaryAssetImage(asset); if (media) setPreviewMediaId(`${asset.id}:${media.id}`); }}
                                        onDetail={() => setDetailAssetId(asset.id)}
                                        onAction={(kind, media) => void action(asset, kind, media)}
                                    />
                                )) : <AssetColumnEmpty kind={column.kind} />}
                                </div>
                            </ScrollArea>
                        </section>
                    ))}
                </div>
            </ScrollArea>
            <AssetDetailDialog asset={detailAsset} generations={generations} leftInset={agentCollapsed ? 0 : agentWidth + 1} onRefresh={onRefresh} onClose={() => setDetailAssetId("")} onAgent={(path) => { if (detailAsset) openAgent(detailAsset, path); }} onNewVariant={(path) => { if (detailAsset) planVariant(detailAsset, path); }} onLocate={(segmentId) => { window.localStorage.setItem(storyboardUiKey(projectId), JSON.stringify({ selectedId: segmentId, modes: { [segmentId]: "storyboard" } })); navigate(`/director/${projectId}/storyboard?segment=${encodeURIComponent(segmentId)}`); }} />
            <WorkspaceImagePreviewLightbox items={previewItems} activeIndex={previewIndex >= 0 ? previewIndex : null} onClose={() => setPreviewMediaId("")} onChangeIndex={(index) => setPreviewMediaId(previewItems[index]?.id || "")} />
        </div>
    );
}

function AssetColumnEmpty({ kind }: { kind: CreativeAssetKind }) {
    const label = kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
    return <div className="grid min-h-40 place-items-center border border-dashed border-slate-200 bg-white text-center"><div><Package className="mx-auto size-5 text-slate-300" /><p className="mt-2 text-xs text-slate-400">还没有{label}</p></div></div>;
}

const directingRulesPath = "direction/directing-rules.md";
const visualStylePath = "direction/visual-style.md";

function splitMarkdownFrontmatter(source: string) {
    const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return { frontmatter: match?.[0] || "", body: source.slice(match?.[0].length || 0).trim() };
}

function normalizeDirectingRulesMarkdown(source: string) {
    const legacyHeadings: Record<string, string> = { positioning: "创作定位", intent: "核心导演意图", photography: "摄影与空间", performance: "表演", pacing: "叙事与剪辑节奏", sound: "声音", prohibitions: "全片禁区" };
    let value = source.replace(/^##\s+(positioning|intent|photography|performance|pacing|sound|prohibitions)\s*$/gm, (_, key: string) => `## ${legacyHeadings[key]}`);
    if (!/^#\s+导演规则\s*$/m.test(value)) value = `# 导演规则\n\n${value}`;
    if (!/^##\s+核心导演意图\s*$/m.test(value)) value = value.replace(/^#\s+导演规则\s*$/m, "# 导演规则\n\n## 核心导演意图\n\n在这里概括整部影片希望观众获得的核心感受，以及所有部门共同遵循的表达方向。");
    if (!/^##\s+创作定位\s*$/m.test(value)) value = value.replace(/^#\s+导演规则\s*$/m, "# 导演规则\n\n## 创作定位\n\n概括题材、类型、基调、时代地域、目标观众与核心命题。");
    return value.trim();
}

function normalizeVisualStyleMarkdown(source: string) {
    const value = source.trim();
    return value || "# 视觉风格\n\n## 总体风格\n\n在这里描述全片统一的画面表达。";
}

function DirectorTreatmentPage({ projectId, workspace, activeStyleId, styles, onRefresh }: { projectId: string; workspace: DirectorWorkspace; activeStyleId: string | null; styles: VisualStyle[]; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const [templates, setTemplates] = useState<VisualStyleTemplate[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [busy, setBusy] = useState("");
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [styleDocument, setStyleDocument] = useState("");
    const [savedStyleDocument, setSavedStyleDocument] = useState("");
    const [styleFrontmatter, setStyleFrontmatter] = useState("");
    const [styleHash, setStyleHash] = useState("");
    const [styleEditorVersion, setStyleEditorVersion] = useState(0);
    const [styleSaveBlocked, setStyleSaveBlocked] = useState("");
    const [styleLoading, setStyleLoading] = useState(true);
    const [editingStyle, setEditingStyle] = useState(false);
    const [rules, setRules] = useState("");
    const [savedRules, setSavedRules] = useState("");
    const [rulesFrontmatter, setRulesFrontmatter] = useState("");
    const [rulesHash, setRulesHash] = useState("");
    const [rulesEditorVersion, setRulesEditorVersion] = useState(0);
    const [rulesSaveBlocked, setRulesSaveBlocked] = useState("");
    const [rulesLoading, setRulesLoading] = useState(true);
    const [editingRules, setEditingRules] = useState(false);
    const styleDirtyRef = useRef(false);
    const rulesDirtyRef = useRef(false);
    const uploadRef = useRef<HTMLInputElement>(null);
    const style = styles.find((item) => item.id === selectedId);
    const previewUrl = style?.references.board && !style.boardStale ? serverApiUrl(`/director/projects/${projectId}/direction/style-board?v=${style.revision}`) : "";
    const styleDirty = styleDocument !== savedStyleDocument;
    const rulesDirty = rules !== savedRules;
    useEffect(() => { styleDirtyRef.current = styleDirty; }, [styleDirty]);
    useEffect(() => { rulesDirtyRef.current = rulesDirty; }, [rulesDirty]);
    useEffect(() => { void serverApi.visualStyleTemplates().then(setTemplates); }, []);
    useEffect(() => { setSelectedId(activeStyleId || styles[0]?.id || ""); }, [activeStyleId, styles[0]?.id]);
    useEffect(() => {
        let canceled = false;
        setStyleLoading(true);
        void directorApi.file(projectId, visualStylePath).then((file) => {
            if (canceled || styleDirtyRef.current || file.hash === styleHash) return;
            const document = splitMarkdownFrontmatter(file.content);
            const normalized = normalizeVisualStyleMarkdown(document.body);
            setStyleFrontmatter(document.frontmatter);
            setStyleDocument(normalized);
            setSavedStyleDocument(document.body.trim());
            setStyleHash(file.hash);
            setStyleSaveBlocked("");
            setStyleEditorVersion((value) => value + 1);
        }).catch((error) => {
            if (!canceled) message.error(error instanceof Error ? error.message : "视觉风格读取失败");
        }).finally(() => { if (!canceled) setStyleLoading(false); });
        return () => { canceled = true; };
    }, [projectId, workspace.revision, style?.revision, message]);
    useEffect(() => {
        let canceled = false;
        setRulesLoading(true);
        void directorApi.file(projectId, directingRulesPath).then((file) => {
            if (canceled || rulesDirtyRef.current) return;
            if (file.hash === rulesHash) return;
            const document = splitMarkdownFrontmatter(file.content);
            const normalized = normalizeDirectingRulesMarkdown(document.body);
            setRulesFrontmatter(document.frontmatter);
            setRules(normalized);
            setSavedRules(normalized);
            setRulesHash(file.hash);
            setRulesSaveBlocked("");
            setRulesEditorVersion((value) => value + 1);
        }).catch((error) => {
            if (!canceled) message.error(error instanceof Error ? error.message : "导演规则读取失败");
        }).finally(() => { if (!canceled) setRulesLoading(false); });
        return () => { canceled = true; };
    }, [projectId, workspace.revision, message]);
    const run = async (label: string, action: () => Promise<unknown>) => {
        setBusy(label);
        try { await action(); await onRefresh(); message.success("导演方案已更新"); }
        catch (error) { message.error(error instanceof Error ? error.message : "导演方案操作失败"); }
        finally { setBusy(""); }
    };
    const applyTemplate = (template: VisualStyleTemplate) => void run("template", async () => {
        const current = style
            ? await serverApi.updateVisualStyle(style.id, { revision: style.revision, name: template.name, mode: "template", templateId: template.id, description: template.description, dna: template.dna })
            : await serverApi.createVisualStyle(projectId, { name: template.name, mode: "template", templateId: template.id, description: template.description, dna: template.dna, references: {} });
        setSelectedId(current.id);
        await serverApi.setDefaultVisualStyle(current.id);
        setTemplatePickerOpen(false);
    });
    const generateBoard = () => void run("board", async () => { if (!style) throw new Error("请先选择视觉风格"); await serverApi.generateVisualStyleReferences(style.id, style.revision); });
    const upload = async (file: File) => { await run("upload", async () => { if (!style) throw new Error("请先选择视觉风格"); const uploaded = await uploadServerFile(file, file.name); const updated = await serverApi.updateVisualStyle(style.id, { revision: style.revision, mode: "custom", templateId: null, references: { source: uploaded.fileId } }); await serverApi.analyzeVisualStyle(updated.id, updated.revision); }); };
    const saveStyleDocument = async () => {
        setBusy("style-save");
        try {
            const source = `${styleFrontmatter}${styleDocument.trim()}\n`;
            const result = await directorApi.updateMarkdownFile(projectId, visualStylePath, source, styleHash);
            setStyleHash(result.hash);
            setSavedStyleDocument(styleDocument);
            setStyleSaveBlocked("");
        } catch (error) {
            setStyleSaveBlocked(styleDocument);
            message.error(error instanceof Error ? error.message : "视觉风格保存失败");
        } finally {
            setBusy("");
        }
    };
    useEffect(() => {
        if (!styleDirty || styleLoading || busy || styleSaveBlocked === styleDocument) return;
        const timer = window.setTimeout(() => void saveStyleDocument(), 600);
        return () => window.clearTimeout(timer);
    }, [projectId, styleDocument, styleDirty, styleLoading, styleHash, styleFrontmatter, styleSaveBlocked, busy]);
    const saveRules = async () => {
        setBusy("save");
        try {
            const source = `${rulesFrontmatter}${rules.trim()}\n`;
            const result = await directorApi.updateMarkdownFile(projectId, directingRulesPath, source, rulesHash);
            setRulesHash(result.hash);
            setSavedRules(rules);
            setRulesSaveBlocked("");
        } catch (error) {
            setRulesSaveBlocked(rules);
            message.error(error instanceof Error ? error.message : "导演规则保存失败");
        } finally {
            setBusy("");
        }
    };
    useEffect(() => {
        if (!rulesDirty || rulesLoading || busy || rulesSaveBlocked === rules) return;
        const timer = window.setTimeout(() => void saveRules(), 600);
        return () => window.clearTimeout(timer);
    }, [projectId, rules, rulesDirty, rulesLoading, rulesHash, rulesFrontmatter, rulesSaveBlocked, busy]);
    return (
        <div className="director-treatment-page">
            <div className="director-treatment-workspace">
                <section className="director-treatment-style">
                    <div className="director-treatment-section-title">
                        <div><h2>视觉风格</h2><p>项目文档 · 参考板与文字共同约束画面</p></div>
                        <div className="flex items-center gap-2"><div className="director-doc-mode" role="group" aria-label="视觉风格文档模式"><button type="button" data-active={!editingStyle} onClick={() => setEditingStyle(false)}>阅读</button><button type="button" data-active={editingStyle} onClick={() => setEditingStyle(true)}>编辑</button></div><Button type="text" size="small" className="!text-slate-500" icon={<Bot className="size-4" />} onClick={() => style ? prepare(projectId, { kind: "style", projectId, styleId: style.id, title: style.name, subtitle: visualStylePath }) : prepare(projectId, { kind: "director", projectId, entityKind: "directing-plan", entityId: "visual-style", title: "视觉风格", subtitle: visualStylePath })}>交给 Agent</Button></div>
                    </div>
                    <div className="director-treatment-style-body thin-scrollbar">
                        <div className="director-treatment-style-board">
                            {previewUrl ? <AntImage rootClassName="size-full" src={previewUrl} alt={`${style?.name || "当前视觉风格"}三元素风格板`} className="!size-full !object-contain" preview={{ mask: <span className="flex items-center gap-1.5 text-xs"><Maximize2 className="size-3.5" />查看大图</span> }} /> : <div className="grid size-full place-items-center text-center text-slate-500"><div><ImageIcon className="mx-auto size-8 text-slate-300" /><p className="mt-2 text-xs">当前风格还没有统一参考板</p><Button type="link" size="small" loading={busy === "board"} disabled={!style} onClick={generateBoard}>生成参考板</Button></div></div>}
                        </div>
                        <div className="director-treatment-style-actions">
                            <Button icon={<Palette className="size-3.5" />} disabled={styleDirty || Boolean(busy)} onClick={() => setTemplatePickerOpen(true)}>更换风格</Button>
                            <Button icon={<RefreshCw className="size-3.5" />} loading={busy === "board"} disabled={styleDirty || Boolean(busy) || !style} onClick={generateBoard}>{previewUrl ? "重新生成参考板" : "生成参考板"}</Button>
                            <Button type="text" icon={<Upload className="size-3.5" />} loading={busy === "upload"} disabled={styleDirty || Boolean(busy) || !style} onClick={() => uploadRef.current?.click()}>上传参考图</Button>
                            {style?.boardStale ? <span className="ml-auto self-center text-[10px] text-rose-500">文字已变化，参考板需更新</span> : null}
                            <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
                        </div>
                        <div className={`director-treatment-style-document ${editingStyle ? "is-editing" : ""}`}>
                            {styleLoading ? <div className="grid min-h-52 place-items-center"><Spin size="small" /></div> : editingStyle ? <DirectorMarkdownEditor key={`${projectId}:style:${styleEditorVersion}`} content={styleDocument} dirty={styleDirty} saving={busy === "style-save"} label="视觉风格 Markdown 编辑器" placeholder="描述总体风格、媒介、角色、场景、道具、色彩、光线、材质、构图与避免元素" onChange={setStyleDocument} /> : <article className="director-markdown director-treatment-style-markdown"><Streamdown mode="static">{styleDocument}</Streamdown></article>}
                        </div>
                    </div>
                </section>
                <section className="director-treatment-rules">
                    <div className="director-treatment-rules-toolbar">
                        <div><h2>导演规则</h2><p>项目文档 · 更换视觉风格不会覆盖</p></div>
                        <div className="flex items-center gap-2"><div className="director-doc-mode" role="group" aria-label="导演规则文档模式"><button type="button" data-active={!editingRules} onClick={() => setEditingRules(false)}>阅读</button><button type="button" data-active={editingRules} onClick={() => setEditingRules(true)}>编辑</button></div><Button type="text" size="small" className="!text-slate-500" icon={<Bot className="size-4" />} onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "directing-plan", entityId: "directing-plan", title: "导演规则", subtitle: directingRulesPath })}>交给 Agent</Button></div>
                    </div>
                    <div className="director-treatment-document">
                        <div className={`director-treatment-document-body thin-scrollbar ${editingRules ? "is-editing" : ""}`}>
                            {rulesLoading ? <div className="grid h-full place-items-center"><Spin size="small" /></div> : editingRules ? <DirectorMarkdownEditor key={`${projectId}:${rulesEditorVersion}`} content={rules} dirty={rulesDirty} saving={busy === "save"} label="导演规则 Markdown 编辑器" placeholder="写下创作定位，以及整部影片共同遵循的导演意图、摄影、表演、节奏、声音与禁区" onChange={setRules} /> : <article className="director-markdown director-treatment-markdown"><Streamdown mode="static">{rules}</Streamdown></article>}
                        </div>
                    </div>
                </section>
            </div>
            <VisualStyleTemplatePicker open={templatePickerOpen} templates={templates} selectedId={style?.templateId || null} onClose={() => setTemplatePickerOpen(false)} onSelect={(id) => { const template = templates.find((item) => item.id === id); if (template) applyTemplate(template); }} />
        </div>
    );
}

function primaryAssetImage(asset: CreativeAsset) {
    return asset.payload.variants.find((item) => item.id === asset.payload.primaryImageId) || asset.payload.variants.find((item) => item.kind === "image" && !isAssetReference(item.usage));
}

const isAssetReference = (usage?: string) => ["reference_input", "identity_reference", "wardrobe_reference", "composition_reference"].includes(usage || "");

function assetInventory(asset: CreativeAsset) {
    const images = asset.payload.variants.filter((item) => item.kind === "image").length;
    const audio = asset.payload.variants.filter((item) => item.kind === "audio").length;
    const variants = asset.payload.variants.filter((item) => item.usage === "variant_reference").length;
    const imageLabel = asset.kind === "character" ? "身份板" : asset.kind === "scene" ? "空间母板" : "结构参考";
    return [`${imageLabel} ${images}`, `声音 ${audio}`, `变体 ${variants}`].join(" · ");
}

function AssetCard({ asset, busy, activeGenerations, onAgent, onPreview, onDetail, onAction }: { asset: CreativeAsset; busy: boolean; activeGenerations: ServerGeneration[]; onAgent: () => void; onPreview: () => void; onDetail: () => void; onAction: (kind: "regenerate" | "copy" | "delete", media?: "image" | "audio") => void }) {
    const primaryImage = primaryAssetImage(asset);
    const generatingImage = activeGenerations.find((generation) => generation.kind === "image");
    return (
        <article className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.035)] transition hover:border-blue-300 hover:shadow-[0_6px_20px_rgba(37,99,235,.07)]" style={{ contentVisibility: "auto", containIntrinsicSize: "132px" }}>
            <div className="grid h-[156px] grid-cols-[42%_minmax(0,1fr)]">
                <div className="relative m-2 mr-0 aspect-video self-start overflow-hidden rounded-lg bg-slate-50">
                    {primaryImage ? <button type="button" aria-label={`查看${asset.name}大图`} className="group/preview block size-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500" onClick={onPreview}><img src={assetFileUrl(primaryImage.fileId, asset.revision)} alt={asset.name} className="size-full object-contain transition duration-200 group-hover/preview:scale-[1.015]" /></button> : <MediaPlaceholder label="等待设计" />}
                    {generatingImage ? <div className="director-asset-loading pointer-events-none absolute inset-0"><div className="relative z-10 flex h-full flex-col items-center justify-center text-center"><Loader2 className="size-4 animate-spin text-blue-600" /><p className="mt-2 text-[10px] font-medium text-slate-700">{generatingImage.status === "queued" ? "等待生成" : "正在设计"}</p></div></div> : null}
                </div>
                <div className="flex min-w-0 flex-col px-3 pb-2 pt-2.5">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={onDetail}>
                        <h2 className="truncate text-sm font-semibold text-slate-950">{asset.name}</h2>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{asset.payload.description || asset.payload.narrativeDescription || "等待补充素材档案"}</p>
                        <p className="mt-1.5 truncate text-[10px] text-slate-400">{assetInventory(asset)}</p>
                    </button>
                    {primaryImage?.review?.status === "rejected" ? <p className="mt-1 truncate text-[9px] text-rose-500">{primaryImage.review.summary || "视觉结果需要检查"}</p> : null}
                    <div className="director-asset-actions mt-1.5 min-w-0 border-t border-slate-100 pt-1">
                        <div className="director-asset-actions-wide flex min-w-0 items-center">
                            <AssetAction icon={Bot} label="Agent" onClick={onAgent} />
                            <AssetAction icon={Braces} label="详情" onClick={onDetail} />
                            <AssetAction icon={RefreshCw} label={generatingImage ? "生成中" : "重新生成"} loading={busy || Boolean(generatingImage)} onClick={() => onAction("regenerate", "image")} />
                            <AssetMoreMenu busy={busy || Boolean(generatingImage)} generating={Boolean(generatingImage)} onDetail={onDetail} onAction={onAction} />
                        </div>
                        <div className="director-asset-actions-medium min-w-0 items-center">
                            <AssetAction icon={Bot} label="Agent" onClick={onAgent} />
                            <AssetAction icon={Braces} label="详情" onClick={onDetail} />
                            <AssetMoreMenu includeRegenerate busy={busy || Boolean(generatingImage)} generating={Boolean(generatingImage)} onDetail={onDetail} onAction={onAction} />
                        </div>
                        <div className="director-asset-actions-compact justify-end">
                            <AssetAction icon={Bot} label="Agent" onClick={onAgent} />
                            <AssetMoreMenu includeDetail includeRegenerate busy={busy || Boolean(generatingImage)} generating={Boolean(generatingImage)} onDetail={onDetail} onAction={onAction} />
                        </div>
                    </div>
                </div>
            </div>
            {activeGenerations.map((generation) => <div key={generation.id} className="border-t border-slate-100 px-3 py-1.5"><div className="flex items-center justify-between text-[9px] text-slate-400"><span>{generation.status === "queued" ? `${generation.kind === "audio" ? "声音" : "设计图"}任务已排队` : `${generation.kind === "audio" ? "声音" : "设计图"}生成中`}</span><span>{Math.round(generation.progress * 100)}%</span></div><div className="mt-1 h-0.5 overflow-hidden bg-slate-100"><div className={`h-full bg-blue-600 ${generation.progress > 0 ? "transition-all" : "director-task-progress"}`} style={generation.progress > 0 ? { width: `${Math.max(4, Math.round(generation.progress * 100))}%` } : undefined} /></div></div>)}
        </article>
    );
}

function AssetAction({ icon: Icon, label, loading, onClick }: { icon: typeof Film; label: string; loading?: boolean; onClick: () => void }) {
    return <button type="button" aria-label={label} disabled={loading} className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={onClick}>{loading ? <RefreshCw className="size-3 animate-spin" /> : <Icon className="size-3" />}<span className="whitespace-nowrap">{label}</span></button>;
}

function AssetMoreMenu({ includeDetail = false, includeRegenerate = false, busy, generating, onDetail, onAction }: { includeDetail?: boolean; includeRegenerate?: boolean; busy: boolean; generating: boolean; onDetail: () => void; onAction: (kind: "regenerate" | "copy" | "delete", media?: "image" | "audio") => void }) {
    const items: NonNullable<ComponentProps<typeof Dropdown>["menu"]>["items"] = [];
    if (includeDetail) items.push({ key: "detail", label: "查看详情", icon: <Braces className="size-3.5" /> });
    if (includeRegenerate) items.push({ key: "regenerate", label: generating ? "生成中" : "重新生成", icon: <RefreshCw className="size-3.5" />, disabled: busy });
    if (includeDetail || includeRegenerate) items.push({ type: "divider" });
    items.push({ key: "copy", label: "复制素材", icon: <Copy className="size-3.5" /> }, { type: "divider" }, { key: "delete", label: <span className="text-rose-600">删除素材</span>, icon: <Trash2 className="size-3.5 text-rose-500" /> });
    return <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => { if (key === "detail") onDetail(); else if (key === "regenerate") onAction("regenerate", "image"); else onAction(key === "copy" ? "copy" : "delete"); } }}><button type="button" aria-label="更多素材操作" className="ml-auto grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal className="size-4" /></button></Dropdown>;
}

type AssetDetailTab = "dossier" | "primary" | "sound" | "usages" | `variant:${string}`;

function AssetDetailDialog({ asset, generations, leftInset, onRefresh, onClose, onAgent, onNewVariant, onLocate }: { asset?: CreativeAsset; generations: ServerGeneration[]; leftInset: number; onRefresh: () => Promise<void>; onClose: () => void; onAgent: (path?: string) => void; onNewVariant: (path?: string) => void; onLocate: (segmentId: string) => void }) {
    const { message, modal } = App.useApp();
    const [detail, setDetail] = useState<DirectorAssetDetail>();
    const [tab, setTab] = useState<AssetDetailTab>("dossier");
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<{ items: WorkspaceImagePreviewItem[]; activeIndex: number } | null>(null);
    const assetGenerationVersion = useMemo(() => generations.filter((generation) => {
        return generationAssetId(generation) === asset?.id;
    }).map((generation) => `${generation.id}:${generation.status}:${generation.progress}:${generation.updatedAt}`).join("|"), [asset?.id, generations]);
    const reload = async () => {
        if (!asset) return;
        const value = await directorApi.assetDetail(asset.id);
        setDetail(value);
        if (tab.startsWith("variant:") && !value.variants.some((item) => `variant:${item.variantId}` === tab)) setTab("primary");
    };
    useEffect(() => { if (!asset) { setDetail(undefined); return; } setTab("dossier"); void reload().catch((error) => message.error(error instanceof Error ? error.message : "素材详情加载失败")); }, [asset?.id]);
    useEffect(() => { if (asset && detail && (assetGenerationVersion || asset.revision !== detail.revision)) void reload(); }, [asset?.revision, assetGenerationVersion]);
    useEffect(() => {
        if (!asset) return;
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [asset, onClose]);
    if (!asset) return null;
    const visual = tab === "primary" ? detail?.primaryVisual : tab.startsWith("variant:") ? detail?.variants.find((item) => item.variantId === tab.slice(8)) : undefined;
    const activePath = tab === "dossier" ? detail?.dossier.path : tab === "sound" ? detail?.sound.promptPath : tab === "usages" ? detail?.folderPath : visual?.promptPath;
    const generate = async (target: "primary-visual" | "variant-visual" | "sound") => {
        if (!detail) return;
        const expectedHash = target === "sound" ? detail.sound.hash : visual?.hash || detail.primaryVisual.hash;
        setBusy(true);
        try {
            await directorApi.generateAsset(asset.id, { target, variantId: visual?.variantId, expectedHash });
            await onRefresh(); await reload(); message.success("生成任务已提交");
        } catch (error) { message.error(error instanceof Error ? error.message : "生成失败"); }
        finally { setBusy(false); }
    };
    const addInput = async (file: File, target: "primary-visual" | "variant-visual" | "sound") => {
        setBusy(true);
        try { const uploaded = await uploadServerFile(file, file.name); setDetail(await directorApi.addAssetMediaInput(asset.id, { fileId: uploaded.fileId, target, variantId: visual?.variantId })); }
        catch (error) { message.error(error instanceof Error ? error.message : "上传输入失败"); }
        finally { setBusy(false); }
    };
    const openMedia = (items: DirectorAssetMedia[], media: DirectorAssetMedia) => setPreview({ items: items.map((item) => ({ id: item.id, url: assetFileUrl(item.fileId, asset.revision), alt: `${asset.name} · ${item.name}` })), activeIndex: Math.max(0, items.findIndex((item) => item.id === media.id)) });
    const tabs: Array<{ id: AssetDetailTab; label: string }> = [
        { id: "dossier", label: "主档案" },
        { id: "primary", label: asset.kind === "character" ? "主形象" : asset.kind === "scene" ? "空间母板" : "结构母板" },
        ...(detail?.variants.map((item) => ({ id: `variant:${item.variantId}` as AssetDetailTab, label: item.label })) || []),
        { id: "sound", label: "声音" }, { id: "usages", label: "使用位置" },
    ];
    return createPortal(<div className="fixed inset-y-0 right-0 z-[100] flex items-center justify-center bg-slate-950/30 p-3 backdrop-blur-[1px]" style={{ left: leftInset }} onMouseDown={onClose}>
        <section role="dialog" aria-modal="true" aria-label={`${asset.name}素材工作台`} className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,.24)]" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
                <div className="min-w-0"><div className="flex items-baseline gap-2"><h1 className="truncate text-xl font-semibold text-slate-950">{asset.name}</h1><span className="font-mono text-[10px] text-slate-400">REV {detail?.revision || asset.revision}</span></div></div>
                <div className="flex items-center gap-1"><Button type="text" size="small" icon={<Bot className="size-4" />} onClick={() => onAgent(activePath)}>交给 Agent</Button><button type="button" aria-label="关闭素材详情" className="cursor-pointer p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950" onClick={onClose}><X className="size-4" /></button></div>
            </header>
            <nav className="hide-scrollbar flex h-12 shrink-0 items-end gap-1 overflow-x-auto border-b border-slate-200 px-5" aria-label="素材详情页面">
                {tabs.map((item) => <button key={item.id} type="button" className={`h-12 shrink-0 cursor-pointer border-b-2 px-3 text-sm transition ${tab === item.id ? "border-blue-600 font-medium text-slate-950" : "border-transparent text-slate-500 hover:text-slate-900"}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
                <button type="button" className="h-12 shrink-0 cursor-pointer px-3 text-sm text-blue-600 hover:bg-blue-50" onClick={() => onNewVariant(detail?.folderPath)}>＋ {asset.kind === "character" ? "新增形象" : "新增状态"}</button>
                {tab.startsWith("variant:") ? <Dropdown trigger={["click"]} menu={{ items: [{ key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "移到回收站" }], onClick: () => modal.confirm({ title: "移除这个生产变体？", content: "文件会移入项目 .trash，可恢复。", okText: "移除", okButtonProps: { danger: true }, cancelText: "取消", onOk: async () => { if (!detail) return; setDetail(await directorApi.deleteAssetVariant(asset.id, tab.slice(8))); setTab("primary"); } }) }}><button type="button" aria-label="变体操作" className="mb-2 ml-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal className="size-4" /></button></Dropdown> : null}
            </nav>
            <div className="min-h-0 flex-1 bg-white">
                {!detail ? <div className="grid size-full place-items-center"><Spin /></div> : tab === "dossier" ? <ScrollArea className="h-full"><article className="director-markdown mx-auto max-w-4xl px-10 py-8"><Streamdown mode="static">{detail.dossier.content || `# ${asset.name}\n\n等待 Agent 补充素材档案。`}</Streamdown></article></ScrollArea>
                    : visual ? <AssetVisualTab asset={asset} workspace={visual} busy={busy} onGenerate={() => void generate(visual.kind === "variant" ? "variant-visual" : "primary-visual")} onAddInput={(file) => void addInput(file, visual.kind === "variant" ? "variant-visual" : "primary-visual")} onRemoveInput={async (inputId) => setDetail(await directorApi.removeAssetMediaInput(asset.id, inputId))} onPreview={openMedia} />
                    : tab === "sound" ? <AssetSoundTab asset={asset} detail={detail} busy={busy} onGenerate={() => void generate("sound")} onAddInput={(file) => void addInput(file, "sound")} onRemoveInput={async (inputId) => setDetail(await directorApi.removeAssetMediaInput(asset.id, inputId))} />
                    : <AssetUsagesTab detail={detail} onLocate={onLocate} />}
            </div>
        </section>
        <WorkspaceImagePreviewLightbox items={preview?.items || []} activeIndex={preview?.activeIndex ?? null} onClose={() => setPreview(null)} onChangeIndex={(activeIndex) => setPreview((current) => current ? { ...current, activeIndex } : null)} />
    </div>, document.body);
}

function AssetVisualTab({ asset, workspace, busy, onGenerate, onAddInput, onRemoveInput, onPreview }: { asset: CreativeAsset; workspace: DirectorAssetVisualWorkspace; busy: boolean; onGenerate: () => void; onAddInput: (file: File) => void; onRemoveInput: (id: string) => void; onPreview: (items: DirectorAssetMedia[], media: DirectorAssetMedia) => void }) {
    const output = workspace.outputs[0];
    const [generationPreview, setGenerationPreview] = useState<CreativeAssetGenerationPreview>();
    const [previewError, setPreviewError] = useState("");
    useEffect(() => {
        let canceled = false;
        setGenerationPreview(undefined);
        setPreviewError("");
        void directorApi.previewAssetGeneration(asset.id, { target: workspace.kind === "variant" ? "variant-visual" : "primary-visual", variantId: workspace.variantId, expectedHash: workspace.hash }).then((value) => {
            if (!canceled) setGenerationPreview(value);
        }).catch((error) => {
            if (!canceled) setPreviewError(error instanceof Error ? error.message : "生成预检失败");
        });
        return () => { canceled = true; };
    }, [asset.id, asset.revision, workspace.hash, workspace.kind, workspace.variantId]);
    const imageReferences = generationPreview?.references.filter((item) => item.kind === "image") || [];
    const referenceMedia = imageReferences.map((item, index) => ({ id: `generation-input-${index}-${item.fileId}`, fileId: item.fileId, path: "", name: item.label, mediaRole: item.purpose || item.source, kind: "image" as const }));
    const inputIds = new Map(workspace.inputs.map((item) => [item.fileId, item.id]));
    const actualPrompt = generationPreview?.prompt || "";
    return <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[58fr_42fr]">
        <section className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
            <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3">
                <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-xs font-semibold text-slate-900">生成输入（{imageReferences.length}）</h2><div className="flex items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-1 text-xs text-blue-600 hover:text-blue-700"><Upload className="size-3.5" />添加<input type="file" accept="image/*" disabled={busy} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onAddInput(file); }} /></label><Button type="primary" loading={busy} icon={<RefreshCw className="size-3.5" />} onClick={onGenerate}>{output ? "重新生成" : "生成"}</Button></div></div>
                <div className="hide-scrollbar flex min-h-14 gap-2 overflow-x-auto overflow-y-hidden">
                    {generationPreview ? imageReferences.length ? imageReferences.map((item, index) => <div key={`${item.fileId}:${index}`} className="group relative w-20 shrink-0"><button type="button" className="block w-full cursor-zoom-in text-left" onClick={() => onPreview(referenceMedia, referenceMedia[index])}><img className="h-11 w-full rounded border border-slate-200 object-cover" src={assetFileUrl(item.fileId, asset.revision)} alt={item.label} /><span className="mt-1 block truncate text-[10px] text-slate-500">{item.label}</span></button>{inputIds.has(item.fileId) ? <button type="button" aria-label="移除输入" className="absolute -right-1 -top-1 hidden size-4 cursor-pointer place-items-center rounded-full bg-slate-900 text-white group-hover:grid" onClick={() => onRemoveInput(inputIds.get(item.fileId)!)}><X className="size-2.5" /></button> : null}</div>) : <span className="self-center text-[11px] text-slate-400">prompt.md 没有声明项目参考图，inputs/ 也没有用户输入</span> : previewError ? <span className="self-center text-[11px] text-rose-600">{previewError}</span> : <span className="self-center text-[11px] text-slate-400">正在读取 prompt.md 与显式输入…</span>}
                </div>
            </div>
            <div className="relative min-h-0 flex-1 p-5">{output ? <><button type="button" className="size-full cursor-zoom-in" onClick={() => onPreview(workspace.outputs, output)}><img className="size-full object-contain" src={assetFileUrl(output.fileId, asset.revision)} alt={`${asset.name} · ${workspace.label}`} /></button>{asset.payload.needsReview ? <span className="absolute left-7 top-7 rounded bg-rose-600 px-2 py-1 text-[10px] text-white shadow-sm">当前图已过期 · {asset.payload.staleReason || "提示词或风格已变化"}</span> : null}</> : <MediaPlaceholder label="还没有基础设计媒体" />}</div>
        </section>
        <section className="flex min-h-0 flex-col"><div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-5"><div><h2 className="text-sm font-semibold text-slate-950">最终提示词 · prompt.md</h2>{generationPreview ? <p className="mt-0.5 text-[10px] text-slate-400">原样发送 · {generationPreview.model.name} · {String(generationPreview.params.size || "默认尺寸")}</p> : null}</div><CopyPromptButton value={actualPrompt} /></div><ScrollArea className="min-h-0 flex-1"><pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12px] leading-6 text-slate-700">{actualPrompt || (previewError ? previewError : "正在读取最终提示词…")}</pre></ScrollArea></section>
    </div>;
}

function CopyPromptButton({ value }: { value: string }) { const copy = useCopyText(); return <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate-500 hover:text-blue-700" onClick={() => void copy(value, "已复制提示词")}><Copy className="size-3.5" />复制</button>; }

function AssetSoundTab({ asset, detail, busy, onGenerate, onAddInput, onRemoveInput }: { asset: CreativeAsset; detail: DirectorAssetDetail; busy: boolean; onGenerate: () => void; onAddInput: (file: File) => void; onRemoveInput: (id: string) => void }) {
    const sound = detail.sound;
    return <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[58fr_42fr]"><section className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50 p-6 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-slate-950">{asset.kind === "character" ? "角色声音" : asset.kind === "scene" ? "环境声" : "道具音效"}</h2><p className="mt-1 text-xs text-slate-500">最多使用一个参考声音</p></div><Button type="primary" loading={busy} icon={<AudioLines className="size-3.5" />} onClick={onGenerate}>{sound.output ? "重新生成" : "生成声音"}</Button></div><div className="mt-10 rounded-lg border border-slate-200 bg-white p-5">{sound.output ? <audio className="w-full" controls src={serverApiUrl(`/files/${sound.output.fileId}/content`)} /> : <MediaPlaceholder icon={AudioLines} label="还没有声音结果" />}</div><div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-5"><div><p className="text-xs font-medium text-slate-700">参考声音</p><p className="mt-1 text-[11px] text-slate-400">{sound.input?.name || "未添加"}</p></div>{sound.input ? <div className="flex items-center gap-2"><audio className="h-8 w-56" controls src={serverApiUrl(`/files/${sound.input.fileId}/content`)} /><button type="button" className="cursor-pointer p-2 text-slate-400 hover:text-rose-600" onClick={() => onRemoveInput(sound.input!.id)}><Trash2 className="size-4" /></button></div> : <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-blue-600"><Upload className="size-3.5" />添加参考<input type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onAddInput(file); }} /></label>}</div>{asset.kind === "character" && sound.sampleText ? <div className="mt-5 border-t border-slate-200 pt-5"><p className="text-xs font-medium text-slate-700">试听文本</p><p className="mt-2 text-sm leading-6 text-slate-600">{sound.sampleText}</p></div> : null}</section><section className="flex min-h-0 flex-col"><div className="flex h-12 items-center justify-between border-b border-slate-200 px-5"><h2 className="text-sm font-semibold text-slate-950">声音提示词</h2><CopyPromptButton value={sound.prompt} /></div><ScrollArea className="min-h-0 flex-1"><pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12px] leading-6 text-slate-700">{sound.prompt || "等待 Agent 完成声音提示词。"}</pre></ScrollArea></section></div>;
}

function AssetUsagesTab({ detail, onLocate }: { detail: DirectorAssetDetail; onLocate: (id: string) => void }) {
    const ordered = useMemo(() => [...detail.usages].sort((a, b) => a.sequencePosition - b.sequencePosition || a.segmentPosition - b.segmentPosition || a.id.localeCompare(b.id)), [detail.usages]);
    const groups = useMemo(() => {
        const value = new Map<string, { id: string; title: string; position: number; items: typeof ordered }>();
        for (const item of ordered) {
            const group = value.get(item.sequenceId) || { id: item.sequenceId, title: item.sequenceTitle, position: item.sequencePosition, items: [] };
            group.items.push(item);
            value.set(item.sequenceId, group);
        }
        return [...value.values()];
    }, [ordered]);
    return <ScrollArea className="h-full bg-slate-50/50"><div className="mx-auto w-full max-w-7xl px-8 py-7">
        <div className="flex items-end justify-between border-b border-slate-200 pb-5"><div><h2 className="text-lg font-semibold text-slate-950">使用位置</h2><p className="mt-1 text-xs text-slate-500">按剧情段落与视频段的制作顺序排列</p></div><div className="text-right"><strong className="font-mono text-2xl font-medium text-slate-900">{detail.usages.length}</strong><span className="ml-2 text-xs text-slate-500">个视频段</span></div></div>
        {groups.length ? <div className="mt-6 space-y-5">{groups.map((group) => <section key={group.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <header className="flex h-11 items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4"><div className="flex min-w-0 items-center gap-3"><span className="font-mono text-[10px] tracking-wider text-blue-600">SEQ {String(group.position + 1).padStart(2, "0")}</span><h3 className="truncate text-sm font-semibold text-slate-900">{group.title}</h3></div><span className="text-[11px] text-slate-400">{group.items.length} 个视频段</span></header>
            <div className="divide-y divide-slate-100">{group.items.map((item) => <button key={item.id} type="button" className="group grid w-full cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-blue-50/50" onClick={() => onLocate(item.id)}>
                <span className="font-mono text-[10px] text-slate-400">SEG {String(item.segmentPosition + 1).padStart(2, "0")}</span>
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800 group-hover:text-blue-700">{item.title}</span><span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400"><span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{item.durationSeconds} 秒</span><span>·</span><span>{item.variantId ? `变体 ${item.variantId}` : "基础设计"}</span></span></span>
                <span className="flex shrink-0 items-center gap-2"><span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] ${item.storyboardReady ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-400"}`}><ImageIcon className="size-3" />故事板{item.storyboardReady ? "已就绪" : "待生成"}</span><span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] ${item.videoReady ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-400"}`}><Video className="size-3" />视频{item.videoReady ? "已就绪" : "待生成"}</span><ChevronRight className="ml-1 size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /></span>
            </button>)}</div>
        </section>)}</div> : <div className="grid min-h-72 place-items-center text-center"><div><ListVideo className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm text-slate-500">还没有被视频段引用</p><p className="mt-1 text-xs text-slate-400">分镜绑定这个素材后会自动出现在这里。</p></div></div>}
    </div></ScrollArea>;
}

function MediaPlaceholder({ label = "等待生成设计图", icon: Icon = ImageIcon }: { label?: string; icon?: typeof ImageIcon }) {
    return <div className="grid size-full place-items-center text-center text-slate-300"><div><Icon className="mx-auto size-8" /><p className="mt-2 text-[11px] text-slate-400">{label}</p></div></div>;
}

function FlatAction({ icon: Icon, label, loading, disabled, danger, onClick }: { icon: typeof Film; label: string; loading?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void }) {
    return (
        <button disabled={loading || disabled} className={`flex items-center gap-1.5 px-2 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-rose-400 hover:bg-rose-50 hover:text-rose-600" : "text-slate-500 hover:bg-blue-50 hover:text-blue-700"}`} onClick={onClick}>
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
            {label}
        </button>
    );
}

function Storyboard({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const orderedSegments = useMemo(() => orderDirectorSegments(state.videoSegments, state.sequences), [state.sequences, state.videoSegments]);
    const initialUi = useMemo(() => readStoryboardUi(projectId), [projectId]);
    const [selectedId, setSelectedId] = useState(initialUi.selectedId);
    const [modes, setModes] = useState<Record<string, StoryboardWorkspaceMode>>(initialUi.modes);
    const [busy, setBusy] = useState("");
    const [preview, setPreview] = useState<{ items: WorkspaceImagePreviewItem[]; activeIndex: number } | null>(null);
    const selected = orderedSegments.find((segment) => segment.id === selectedId) || orderedSegments[0];
    const mode = selected ? modes[selected.id] || "storyboard" : "storyboard";
    const [preflight, setPreflight] = useState<DirectorVideoSegmentPreflight>();
    useEffect(() => {
        if (!selected) return setPreflight(undefined);
        let active = true;
        void directorApi.videoSegmentPreflight(selected.id).then((value) => active && setPreflight(value)).catch(() => active && setPreflight(undefined));
        return () => { active = false; };
    }, [selected?.id, selected?.revision]);
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(storyboardUiKey(projectId), JSON.stringify({ selectedId: selected?.id || "", modes }));
    }, [modes, projectId, selected?.id]);
    const generateBoard = async (segment: DirectorVideoSegment) => {
        setBusy(segment.id);
        try {
            await directorApi.generateStoryboard(segment.id, segment.revision);
            await onRefresh();
            message.success("整张多宫格故事板已进入生图队列");
        } catch (error) { message.error(error instanceof Error ? error.message : "故事板生成失败"); }
        finally { setBusy(""); }
    };
    const generateVideo = async (segment: DirectorVideoSegment, qualityPreset: H3QualityPreset) => {
        setBusy(segment.id);
        try {
            await directorApi.generateVideoSegment(segment.id, segment.revision, qualityPreset);
            await onRefresh();
            message.success(qualityPreset === "final" ? "最终成片已进入本地 GPU 队列" : "快速预览已进入本地 GPU 队列");
        } catch (error) { message.error(error instanceof Error ? error.message : "视频生成失败"); }
        finally { setBusy(""); }
    };
    const batchGenerate = async () => {
        const targets = state.videoSegments.filter((segment) => !segment.payload.storyboardSheet?.imageFileId);
        if (!targets.length) return message.info("没有缺失的故事板");
        setBusy("batch");
        const results = await Promise.allSettled(targets.map((segment) => directorApi.generateStoryboard(segment.id, segment.revision)));
        await onRefresh(); setBusy("");
        const failed = results.filter((item) => item.status === "rejected").length;
        failed ? message.warning(`${targets.length - failed} 个已提交，${failed} 个因素材预检未通过`) : message.success(`${targets.length} 个故事板已提交，生图队列并发上限 10`);
    };
    return (
        <div className="grid h-full min-h-0 w-full min-w-0 grid-rows-[minmax(0,1fr)_180px] overflow-hidden bg-slate-50">
            {selected ? <StoryboardWorkspace segment={selected} sequence={state.sequences.find((item) => item.id === selected.sequenceId)} mode={mode} preflight={preflight} busy={busy === selected.id} onMode={(value) => setModes((current) => ({ ...current, [selected.id]: value }))} onAgent={() => prepare(projectId, { kind: "director", projectId, entityKind: "video-segment", entityId: selected.id, title: selected.title, subtitle: "视频段与故事板" })} onPreview={(items, activeIndex) => setPreview({ items, activeIndex })} onGenerateBoard={() => void generateBoard(selected)} onGenerateVideo={(preset) => void generateVideo(selected, preset)} /> : <EmptyPanel icon={Clapperboard} title="还没有视频段" description="让 Agent 根据剧本规划 4–15 秒视频段。" />}
            <SegmentFilmstrip segments={orderedSegments} selectedId={selected?.id || ""} busy={busy === "batch"} onSelect={setSelectedId} onBatch={() => void batchGenerate()} />
            <WorkspaceImagePreviewLightbox items={preview?.items || []} activeIndex={preview?.activeIndex ?? null} onClose={() => setPreview(null)} onChangeIndex={(activeIndex) => setPreview((current) => current ? { ...current, activeIndex } : null)} />
        </div>
    );
}

type StoryboardWorkspaceMode = "storyboard" | "video";

function storyboardUiKey(projectId: string) { return `director-storyboard-workspace:${projectId}`; }
function readStoryboardUi(projectId: string): { selectedId: string; modes: Record<string, StoryboardWorkspaceMode> } {
    if (typeof window === "undefined") return { selectedId: "", modes: {} };
    try {
        const value = JSON.parse(window.localStorage.getItem(storyboardUiKey(projectId)) || "{}") as { selectedId?: unknown; modes?: unknown };
        const modes = value.modes && typeof value.modes === "object" ? Object.fromEntries(Object.entries(value.modes).filter(([, mode]) => mode === "storyboard" || mode === "video")) as Record<string, StoryboardWorkspaceMode> : {};
        return { selectedId: typeof value.selectedId === "string" ? value.selectedId : "", modes };
    } catch { return { selectedId: "", modes: {} }; }
}

function orderDirectorSegments(segments: DirectorVideoSegment[], sequences: DirectorSequence[]) {
    const positions = new Map(sequences.map((sequence) => [sequence.id, sequence.position]));
    return [...segments].sort((a, b) => (positions.get(a.sequenceId) ?? 0) - (positions.get(b.sequenceId) ?? 0) || a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

function StoryboardWorkspace({ segment, sequence, mode, preflight, busy, onMode, onAgent, onPreview, onGenerateBoard, onGenerateVideo }: { segment: DirectorVideoSegment; sequence?: DirectorSequence; mode: StoryboardWorkspaceMode; preflight?: DirectorVideoSegmentPreflight; busy: boolean; onMode: (value: StoryboardWorkspaceMode) => void; onAgent: () => void; onPreview: (items: WorkspaceImagePreviewItem[], activeIndex: number) => void; onGenerateBoard: () => void; onGenerateVideo: (preset: H3QualityPreset) => void }) {
    const sheet = segment.payload.storyboardSheet;
    const isTransition = segment.payload.generationIntent === "transition";
    const recommendedFrames = (segment.payload.durationSeconds || 4) <= 6 ? 4 : (segment.payload.durationSeconds || 4) <= 10 ? 6 : 9;
    return (
        <section data-testid="director-storyboard-card" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
            <header className="flex min-h-16 min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 overflow-hidden border-b border-slate-200 px-6 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-3"><span className="font-mono text-[11px] text-blue-600">SEG {String(segment.position + 1).padStart(2, "0")}</span><h1 className="truncate font-serif text-xl text-slate-950">{segment.title}</h1>{segment.payload.videoStale ? <Tag color="error">视频已过期</Tag> : null}</div>
                    <p className="mt-1 truncate text-xs text-slate-500">{sequence?.title || "未分组"} · {segment.payload.durationSeconds || 4} 秒 · {sheet?.frames.length || recommendedFrames} 格 · {segment.payload.description || "等待补充分镜描述"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <div role="tablist" aria-label="分镜创作模式" className="flex bg-slate-100 p-1">
                        {(["storyboard", "video"] as const).map((item) => <button key={item} role="tab" aria-selected={mode === item} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition ${mode === item ? "bg-white font-medium text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`} onClick={() => onMode(item)}>{item === "storyboard" ? <ImageIcon className="size-3.5" /> : <Video className="size-3.5" />}{item === "storyboard" ? "故事板" : "视频"}</button>)}
                    </div>
                    <Button type="text" size="small" icon={<Bot className="size-3.5" />} onClick={onAgent}>交给 Agent</Button>
                </div>
            </header>
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] overflow-hidden max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(280px,45vh)_minmax(360px,1fr)]">
                <StoryboardMediaStage segment={segment} mode={mode} preflight={preflight} busy={busy} onPreview={onPreview} onGenerateBoard={onGenerateBoard} onGenerateVideo={onGenerateVideo} />
                <StoryboardInspector segment={segment} mode={mode} preflight={preflight} />
            </div>
        </section>
    );
}

function StoryboardMediaStage({ segment, mode, preflight, busy, onPreview, onGenerateBoard, onGenerateVideo }: { segment: DirectorVideoSegment; mode: StoryboardWorkspaceMode; preflight?: DirectorVideoSegmentPreflight; busy: boolean; onPreview: (items: WorkspaceImagePreviewItem[], activeIndex: number) => void; onGenerateBoard: () => void; onGenerateVideo: (preset: H3QualityPreset) => void }) {
    const sheet = segment.payload.storyboardSheet;
    const isTransition = segment.payload.generationIntent === "transition";
    const selected = mode === "storyboard" ? sheet?.referenceSnapshot?.selected || preflight?.selected || [] : preflight?.videoSelected || [];
    const blocked = preflight?.blockedReasons || [];
    const inputCount = selected.length + (mode === "video" && sheet?.imageFileId ? 1 : 0);
    const inputPreviewItems = [
        ...(mode === "video" && sheet?.imageFileId ? [{ id: `storyboard-${sheet.imageFileId}`, url: serverApiUrl(`/files/${sheet.imageFileId}/content`), alt: `${segment.title} · 完整故事板` }] : []),
        ...selected.map((item, index) => ({ id: `input-${index}-${item.fileId}`, url: serverApiUrl(`/files/${item.fileId}/content`), alt: item.name || item.purpose })),
    ];
    const inputOffset = mode === "video" && sheet?.imageFileId ? 1 : 0;
    return (
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
            <div className="flex min-h-[80px] min-w-0 shrink-0 items-start gap-3 border-b border-slate-200 bg-white px-4 py-2">
                <div className="min-w-0 flex-1">
                    <h2 className="text-xs font-medium text-slate-900">{mode === "storyboard" ? "故事板输入" : "视频输入"}<span className="ml-1 font-normal text-slate-400">（{inputCount}）</span></h2>
                    <div className="thin-scrollbar mt-1.5 flex gap-2 overflow-x-auto overflow-y-hidden">
                        {mode === "video" && sheet?.imageFileId ? <ReferenceThumb fileId={sheet.imageFileId} label="完整故事板" onPreview={() => onPreview(inputPreviewItems, 0)} /> : null}
                        {selected.map((item, index) => <ReferenceThumb key={`${item.fileId}-${item.purpose}`} fileId={item.fileId} label={item.purpose} title={item.name} onPreview={() => onPreview(inputPreviewItems, inputOffset + index)} />)}
                        {!selected.length && !(mode === "video" && sheet?.imageFileId) ? <p className="py-4 text-[11px] text-slate-400">还没有可用输入素材</p> : null}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">{mode === "storyboard" ? <Button type="primary" size="small" loading={busy} disabled={isTransition} icon={<RefreshCw className="size-3.5" />} onClick={onGenerateBoard}>{sheet?.imageFileId ? "重抽整板" : "生成故事板"}</Button> : <><Button size="small" loading={busy} disabled={!preflight || blocked.length > 0} icon={<Play className="size-3.5" />} onClick={() => onGenerateVideo("preview")}>快速预览</Button><Button type="primary" size="small" loading={busy} disabled={!preflight || blocked.length > 0} icon={<Film className="size-3.5" />} onClick={() => onGenerateVideo("final")}>生成成片</Button></>}</div>
            </div>
            <div data-testid="director-storyboard-sheet" className={`relative min-h-0 flex-1 ${mode === "storyboard" ? "thin-scrollbar overflow-auto bg-white" : "overflow-hidden bg-slate-950"}`}>
                {mode === "video" ? segment.payload.videoFileId ? <video key={segment.payload.videoFileId} controls className="absolute inset-0 size-full bg-slate-950 object-contain" src={serverApiUrl(`/files/${segment.payload.videoFileId}/content`)} /> : <MediaPlaceholder icon={Video} label="当前视频段还没有视频，先生成快速预览" /> : isTransition ? <div className="grid w-full grid-cols-2 gap-px bg-slate-300">{([preflight?.transitionInputs?.firstFrameFileId, preflight?.transitionInputs?.lastFrameFileId] as const).map((fileId, index) => fileId ? <img key={fileId} draggable={false} className="w-full bg-slate-100 object-contain" src={serverApiUrl(`/files/${fileId}/content`)} /> : <div key={index} className="aspect-video"><MediaPlaceholder label={index ? "等待后段实际首帧" : "等待前段实际尾帧"} /></div>)}</div> : sheet?.imageFileId ? <img draggable={false} aria-label="放大查看完整故事板" className="block h-auto w-full cursor-zoom-in" src={serverApiUrl(`/files/${sheet.imageFileId}/content`)} onClick={() => onPreview([{ id: `storyboard-${sheet.imageFileId}`, url: serverApiUrl(`/files/${sheet.imageFileId}/content`), alt: `${segment.title} · 故事板` }], 0)} /> : <MediaPlaceholder label="当前视频段还没有故事板" />}
                {busy ? <div className="director-asset-loading absolute inset-0 grid place-items-center bg-white/55"><Loader2 className="size-7 animate-spin text-blue-600" /></div> : null}
            </div>
        </div>
    );
}

function StoryboardInspector({ segment, mode, preflight }: { segment: DirectorVideoSegment; mode: StoryboardWorkspaceMode; preflight?: DirectorVideoSegmentPreflight }) {
    const copyText = useCopyText();
    const sheet = segment.payload.storyboardSheet;
    const prompt = mode === "storyboard" ? sheet?.promptSnapshot || "" : segment.payload.h3PromptSnapshot?.prompt || "";
    const blocked = preflight?.blockedReasons || [];
    return (
        <aside data-testid="director-storyboard-inspector" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
            <section className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4"><h2 className="text-sm font-medium text-slate-900">{mode === "storyboard" ? "故事板提示词" : "视频生成提示词"}</h2><Button type="text" size="small" disabled={!prompt} icon={<Copy className="size-3.5" />} onClick={() => copyText(prompt, "已复制提示词")}>复制</Button></div>
                {prompt ? <pre className="thin-scrollbar min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-slate-50 px-5 py-4 font-mono text-[11px] leading-5 text-slate-700">{prompt}</pre> : <div className="grid min-h-0 flex-1 place-items-center bg-slate-50 px-6 text-center text-xs leading-5 text-slate-400">{mode === "storyboard" ? "生成故事板后，这里会显示实际使用的提示词。" : "生成快速预览或成片后，这里会显示实际使用的 H3 提示词。"}</div>}
                {blocked.length ? <p className="shrink-0 border-t border-rose-100 bg-rose-50 px-4 py-2 text-[11px] text-rose-600">{blocked.join("；")}</p> : null}
            </section>
        </aside>
    );
}

function ReferenceThumb({ fileId, label, title, onPreview }: { fileId: string; label: string; title?: string; onPreview: () => void }) {
    return <Tooltip title={`查看${title || label}大图`}><button type="button" aria-label={`查看${title || label}大图`} className="w-16 shrink-0 text-left" onClick={onPreview}><img className="h-10 w-full border border-slate-200 bg-slate-50 object-cover transition hover:border-blue-400" src={serverApiUrl(`/files/${fileId}/content`)} /><p className="mt-1 truncate text-[10px] text-slate-500">{label}</p></button></Tooltip>;
}

function SegmentFilmstrip({ segments, selectedId, busy, onSelect, onBatch }: { segments: DirectorVideoSegment[]; selectedId: string; busy: boolean; onSelect: (id: string) => void; onBatch: () => void }) {
    return (
        <section data-testid="director-segment-filmstrip" className="flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden border-t border-slate-200 bg-white">
            <header className="flex h-10 shrink-0 items-center justify-between px-5"><div className="flex items-center gap-3"><h2 className="text-xs font-medium text-slate-900">视频段</h2><span className="font-mono text-[10px] text-slate-400">{segments.length}</span></div><Button type="text" size="small" loading={busy} icon={<ImageIcon className="size-3.5" />} onClick={onBatch}>批量生成缺失故事板</Button></header>
            <div data-testid="director-segment-filmstrip-scroll" className="thin-scrollbar flex min-h-0 min-w-0 max-w-full flex-1 gap-2 overflow-x-auto overflow-y-hidden border-t border-slate-200 px-4 pb-4 pt-3">
                {segments.map((segment, index) => {
                    const sheet = segment.payload.storyboardSheet;
                    const imageFileId = sheet?.imageFileId || segment.payload.actualFirstFrameFileId || segment.payload.actualLastFrameFileId;
                    return <button key={segment.id} type="button" data-testid="director-segment-filmstrip-item" aria-current={selectedId === segment.id ? "true" : undefined} className={`group w-44 shrink-0 overflow-hidden border text-left transition ${selectedId === segment.id ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200 hover:border-blue-300"}`} onClick={() => onSelect(segment.id)}><div className="relative h-[72px] bg-slate-100">{imageFileId ? <img className="size-full object-cover" src={serverApiUrl(`/files/${imageFileId}/content`)} /> : segment.payload.videoFileId ? <video muted preload="metadata" className="size-full object-cover" src={serverApiUrl(`/files/${segment.payload.videoFileId}/content`)} /> : <div className="grid size-full place-items-center"><Clapperboard className="size-5 text-slate-300" /></div>}<span className="absolute left-1.5 top-1.5 bg-slate-950/75 px-1.5 py-0.5 font-mono text-[9px] text-white">{String(index + 1).padStart(2, "0")}</span><span className="absolute bottom-1.5 right-1.5 bg-slate-950/75 px-1.5 py-0.5 text-[9px] text-white">{segment.payload.durationSeconds || 4}s</span></div><div className="px-2 py-2"><p className="truncate text-[11px] font-medium text-slate-800">{segment.title}</p></div></button>;
                })}
            </div>
        </section>
    );
}

function VideoSegmentCard({ segment, busy, onAgent, onPrompt, onGenerateBoard, onGenerateVideo, onRefresh }: { segment: DirectorVideoSegment; busy: boolean; onAgent: () => void; onPrompt: () => void; onGenerateBoard: () => void; onGenerateVideo: (preset: H3QualityPreset) => void; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const [preflight, setPreflight] = useState<DirectorVideoSegmentPreflight>();
    const [layoutBusy, setLayoutBusy] = useState(false);
    useEffect(() => { void directorApi.videoSegmentPreflight(segment.id).then(setPreflight).catch(() => setPreflight(undefined)); }, [segment.id, segment.revision]);
    const sheet = segment.payload.storyboardSheet;
    const isTransition = segment.payload.generationIntent === "transition";
    const recommendedFrames = (segment.payload.durationSeconds || 4) <= 6 ? 4 : (segment.payload.durationSeconds || 4) <= 10 ? 6 : 9;
    const updateFrameCount = async (frameCount: 4 | 6 | 9) => {
        setLayoutBusy(true);
        try {
            await directorApi.updateVideoSegment(segment.id, { revision: segment.revision, payload: { ...segment.payload, storyboardFrameCount: frameCount } });
            await onRefresh();
            message.success(`已改为 ${frameCount} 格，请重新生成整张故事板`);
        } catch (error) { message.error(error instanceof Error ? error.message : "故事板格数修改失败"); }
        finally { setLayoutBusy(false); }
    };
    const sheetAspect = sheet?.layout === "3x2" ? "8 / 3" : "16 / 9";
    const shotCount = new Set(sheet?.frames.map((frame) => frame.shotNumber)).size || 1;
    return (
        <article data-testid="director-storyboard-card" className="overflow-hidden border border-slate-300 bg-white [content-visibility:auto]">
            <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div><div className="flex items-center gap-3"><span className="font-mono text-xs text-blue-600">SEG {String(segment.position + 1).padStart(2, "0")}</span><h3 className="font-serif text-xl text-slate-950">{segment.title}</h3>{isTransition ? <Tag color="blue">独立视觉过渡</Tag> : null}{segment.payload.videoStale ? <Tag color="error">视频已过期</Tag> : null}</div><p className="mt-1 text-xs text-slate-500">{isTransition ? `${segment.payload.durationSeconds || 4} 秒 · 前段尾帧 → 后段首帧 · 专用 FL2VA` : `${segment.payload.durationSeconds || 4} 秒 · ${sheet?.frames.length || 4} 格 · 内部 ${shotCount} 个 Shot · 一次整板生成`}</p></div>
                <div className="flex flex-wrap items-center gap-2">{!isTransition ? <Select aria-label="故事板格数" size="small" variant="borderless" loading={layoutBusy} disabled={busy} value={(sheet?.frames.length || recommendedFrames) as 4 | 6 | 9} options={([4, 6, 9] as const).map((count) => ({ value: count, label: `${count} 格${count === recommendedFrames ? " · 建议" : ""}` }))} onChange={(value) => void updateFrameCount(value)} /> : null}<FlatAction icon={Braces} label="提示词" onClick={onPrompt} /><FlatAction icon={Bot} label="交给 Agent" onClick={onAgent} />{!isTransition ? <FlatAction icon={RefreshCw} label={sheet?.imageFileId ? "重抽整板" : "生成故事板"} loading={busy || layoutBusy} onClick={onGenerateBoard} /> : null}<Button type="primary" size="small" loading={busy || layoutBusy} disabled={!preflight || (preflight.blockedReasons?.length || 0) > 0} icon={<Play className="size-3.5" />} onClick={() => onGenerateVideo("preview")}>快速预览</Button><FlatAction icon={Film} label="生成成片" loading={busy || layoutBusy} disabled={!preflight || (preflight.blockedReasons?.length || 0) > 0} onClick={() => onGenerateVideo("final")} /></div>
            </header>
            {segment.payload.videoFileId ? <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2 text-[11px] text-slate-500"><span className={segment.payload.videoQualityPreset === "final" ? "text-blue-700" : "text-slate-700"}>{segment.payload.videoQualityPreset === "final" ? "最终成片" : "快速预览"}</span><span>{segment.payload.videoNativeResolution || "768p"}</span><span>{(segment.payload.h3Mode || preflight?.route.mode || "ref2va").toUpperCase()}</span>{segment.payload.videoGenerationDurationMs ? <span>生成耗时 {Math.max(1, Math.round(segment.payload.videoGenerationDurationMs / 1000))} 秒</span> : null}</div> : null}
            <div className="grid border-t border-slate-200 lg:grid-cols-[1fr_280px]">
                <div data-testid="director-storyboard-sheet" className="relative overflow-hidden bg-slate-100" style={{ aspectRatio: sheetAspect }}>{isTransition ? <div className="grid size-full grid-cols-2 gap-px bg-slate-300">{([preflight?.transitionInputs?.firstFrameFileId, preflight?.transitionInputs?.lastFrameFileId] as const).map((fileId, index) => fileId ? <div key={fileId} className="relative bg-slate-100"><img draggable={false} src={serverApiUrl(`/files/${fileId}/content`)} className="pointer-events-none size-full select-none object-contain" /><span className="absolute bottom-3 left-3 bg-slate-950/75 px-2 py-1 text-[10px] text-white">{index ? "后段实际首帧" : "前段实际尾帧"}</span></div> : <div key={index} className="grid place-items-center text-xs text-slate-400">{index ? "等待后段首帧" : "等待前段尾帧"}</div>)}</div> : sheet?.imageFileId ? <img draggable={false} src={serverApiUrl(`/files/${sheet.imageFileId}/content`)} className="pointer-events-none size-full select-none object-contain" /> : <div className="grid size-full place-items-center text-slate-400"><ImageIcon className="size-10" /></div>}{!isTransition && sheet?.review?.status === "pending" ? <div className="director-asset-loading pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="size-6 animate-spin text-blue-600" /></div> : null}{!isTransition ? <span className="pointer-events-none absolute bottom-3 left-3 bg-slate-950/75 px-2 py-1 text-[10px] text-white">完整故事板 · {sheet?.frames.length || recommendedFrames} 格 · {shotCount} 个 Shot</span> : null}</div>
                <aside className="border-l border-slate-200 p-4"><p className="text-xs font-medium text-slate-900">本次视频输入</p><div className="mt-3 grid grid-cols-3 gap-2">{!isTransition && sheet?.imageFileId ? <Tooltip title="完整故事板 · Shot 顺序与构图参考"><div><img className="aspect-square w-full object-cover" src={serverApiUrl(`/files/${sheet.imageFileId}/content`)} /><p className="mt-1 truncate text-[10px] font-medium text-blue-700">完整故事板</p></div></Tooltip> : null}{preflight?.videoSelected?.map((item) => <Tooltip key={item.fileId} title={`${item.purpose} · ${item.name}`}><div><img className="aspect-square w-full object-cover" src={serverApiUrl(`/files/${item.fileId}/content`)} /><p className="mt-1 truncate text-[10px] text-slate-500">{item.purpose}</p></div></Tooltip>)}</div>{preflight?.videoOmitted?.length ? <p className="mt-3 text-[11px] text-rose-600">未采用 {preflight.videoOmitted.length} 项：{preflight.videoOmitted.map((item) => item.name).join("、")}</p> : null}{preflight?.blockedReasons?.map((reason) => <p key={reason} className="mt-2 text-[11px] text-rose-600">{reason} · {isTransition ? "请先准备相邻视频段" : "交给 Agent 修订"}</p>)}{preflight?.warnings?.map((warning) => <p key={warning} className="mt-2 text-[11px] text-amber-600">{warning}</p>)}<div className="mt-4 border-t border-slate-200 pt-3 text-[11px] leading-5 text-slate-500"><strong className="text-slate-700">{isTransition ? "专用首尾帧过渡" : "整板参考生成"}</strong><br />{preflight?.route.reason}<br /><span className="text-slate-400">{isTransition ? "只用于有意设计的视觉过渡，不替代普通切镜" : "完整故事板作为一个参考文件，不裁格、不设置画格锚点"}</span><span className="mt-1 block">快速预览：480p · {isTransition ? "Turbo 可用时启用" : "基础配方"}</span><span className="block">最终成片：768p · 基础模型</span>{segment.payload.boundary === "continue" ? <span className="mt-1 block text-blue-700">连续段将继承上一段最后 22 帧及原声</span> : null}</div></aside>
            </div>
        </article>
    );
}

function StoryboardPromptDrawer({ segment, onClose, onAgent }: { segment?: DirectorVideoSegment; onClose: () => void; onAgent: () => void }) {
    const copyText = useCopyText();
    const [kind, setKind] = useState<"storyboard" | "video">("storyboard");
    useEffect(() => { if (segment) setKind(segment.payload.h3PromptSnapshot?.prompt ? "video" : "storyboard"); }, [segment?.id]);
    const sheet = segment?.payload.storyboardSheet;
    const videoSnapshot = segment?.payload.h3PromptSnapshot;
    const prompt = kind === "storyboard" ? sheet?.promptSnapshot || "" : videoSnapshot?.prompt || "";
    const storyboardReferences = (sheet?.referenceSnapshot?.selected || []).map((item) => ({ fileId: item.fileId, label: item.purpose }));
    const videoReferences = (videoSnapshot?.references || []).filter((item) => (item.kind || "image") === "image").map((item, index) => ({ fileId: item.fileId, label: promptReferenceLabel(item.role, index) }));
    const supportingReferences = (videoSnapshot?.references || []).filter((item) => item.kind === "video" || item.kind === "audio");
    return (
        <Drawer open={Boolean(segment)} onClose={onClose} size={560} title="分镜提示词" styles={{ body: { padding: 0, background: "#fff" } }} footer={<div className="flex items-center justify-between"><Button type="text" icon={<Copy className="size-4" />} disabled={!prompt} onClick={() => copyText(prompt, "已复制分镜提示词")}>复制</Button><Button type="text" icon={<Bot className="size-4" />} onClick={onAgent}>交给 Agent</Button></div>}>
            {segment ? <div>
                <div className="grid grid-cols-2 border-b border-slate-200 px-5 pt-3">{(["storyboard", "video"] as const).map((item) => <button key={item} className={`border-b-2 px-3 py-3 text-sm transition ${kind === item ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-900"}`} onClick={() => setKind(item)}>{item === "storyboard" ? "故事板提示词" : "视频提示词"}</button>)}</div>
                <div className="space-y-5 p-5">
                    <p className="text-xs text-slate-500">{kind === "storyboard" ? `本次故事板 · GPT-Image-2 · Prompt REV ${sheet?.revision || "—"}` : `本次视频 · H3 ${(videoSnapshot?.mode || segment.payload.h3Mode || "待路由").toUpperCase()} · Prompt REV ${videoSnapshot?.storyboardRevision || sheet?.revision || "—"}`}</p>
                    {(kind === "storyboard" ? storyboardReferences : videoReferences).length ? <PromptReferences title={`参考输入 ${(kind === "storyboard" ? storyboardReferences : videoReferences).length}`} items={kind === "storyboard" ? storyboardReferences : videoReferences} /> : null}
                    {kind === "video" && supportingReferences.length ? <div><p className="text-xs font-medium text-slate-900">连续与声音参考</p><div className="mt-2 flex flex-wrap gap-2">{supportingReferences.map((item, index) => <span key={`${item.fileId}-${index}`} className="border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{item.kind === "video" ? "上一段尾部音视频" : "声音参考"}</span>)}</div></div> : null}
                    <div><p className="mb-2 text-xs font-medium text-slate-900">提示词</p><PromptText value={prompt} empty={kind === "storyboard" ? "当前视频段还没有已保存的故事板提示词，生成故事板后会记录实际请求。" : "当前视频段还没有已保存的视频提示词，生成快速预览或成片后会记录实际请求。"} /></div>
                </div>
            </div> : null}
        </Drawer>
    );
}

function PromptText({ value, empty }: { value: string; empty: string }) {
    return value ? <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap break-words border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-700">{value}</pre> : <div className="border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-xs leading-5 text-slate-400">{empty}</div>;
}

function PromptReferences({ title, items }: { title: string; items: Array<{ fileId: string; label: string }> }) {
    return <div><p className="text-xs font-medium text-slate-900">{title}</p><div className="mt-3 flex gap-2 overflow-x-auto">{items.map((item, index) => <div key={`${item.fileId}-${index}`} className="w-20 shrink-0"><img className="aspect-square w-full border border-slate-200 bg-slate-50 object-cover" src={serverApiUrl(`/files/${item.fileId}/content`)} /><p className="mt-1 truncate text-[10px] text-slate-500">{item.label}</p></div>)}</div></div>;
}

function generationReferences(generation?: ServerGeneration) {
    const params = generation?.request.params && typeof generation.request.params === "object" ? generation.request.params as Record<string, unknown> : {};
    const packaged = params.__promptPackage && typeof params.__promptPackage === "object" ? (params.__promptPackage as Record<string, unknown>).references : undefined;
    const value = Array.isArray(packaged) ? packaged : generation?.request.references;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
        if (!record || typeof record.fileId !== "string" || (record.kind && record.kind !== "image")) return [];
        const purpose = String(record.purpose || "");
        const purposeLabel = purpose === "identity_reference" || purpose === "reference_input" ? "身份参考" : purpose === "wardrobe_reference" ? "服装参考" : purpose === "composition_reference" ? "构图参考" : "";
        return [{ fileId: record.fileId, label: String(record.label || purposeLabel || `参考 ${index + 1}`) }];
    });
}

function promptReferenceLabel(role: string | undefined, index: number) {
    return role === "first-frame" ? "首帧" : role === "last-frame" ? "尾帧" : role === "continuation" ? "连续参考" : index === 0 ? "完整故事板" : `素材参考 ${index}`;
}

function VideoSegmentList({ projectId, segments, sequences, onRefresh }: { projectId: string; segments: DirectorVideoSegment[]; sequences: DirectorSequence[]; onRefresh: () => Promise<void> }) {
    const prepare = useAgentStore((store) => store.prepareComposer);
    const sequencePositions = new Map(sequences.map((sequence) => [sequence.id, sequence.position]));
    const orderedSegments = [...segments].sort((a, b) => (sequencePositions.get(a.sequenceId) ?? 0) - (sequencePositions.get(b.sequenceId) ?? 0) || a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    return orderedSegments.length ? (
        <div className="mt-7 space-y-4">
            {orderedSegments.map((segment) => (
                <article key={segment.id} className="grid overflow-hidden border border-slate-200 bg-white md:grid-cols-[280px_1fr]"><div className="aspect-video bg-slate-50">{segment.payload.videoFileId ? <video controls className="size-full object-cover" src={serverApiUrl(`/files/${segment.payload.videoFileId}/content`)} /> : segment.payload.storyboardSheet?.imageFileId ? <img className="size-full object-cover" src={serverApiUrl(`/files/${segment.payload.storyboardSheet.imageFileId}/content`)} /> : <div className="grid size-full place-items-center text-slate-300"><Video className="size-8" /></div>}</div><div className="p-5"><div className="flex justify-between gap-3"><div><div className="text-[10px] tracking-wider text-blue-600">{sequences.find((item) => item.id === segment.sequenceId)?.title} · SEG {segment.position + 1}</div><h2 className="mt-2 font-serif text-xl text-slate-950">{segment.title}</h2></div><FlatAction icon={Bot} label="Agent" onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "video-segment", entityId: segment.id, title: segment.title, subtitle: "视频段" })} /></div><p className="mt-3 text-sm text-slate-500">{segment.payload.description || "等待补充视频段描述"}</p><div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500"><span className="border border-slate-200 px-2 py-1">{segment.payload.durationSeconds}s</span><span className="border border-slate-200 px-2 py-1">{(segment.payload.h3Mode || "待路由").toUpperCase()}</span>{segment.payload.videoFileId ? <span className={segment.payload.videoQualityPreset === "final" ? "border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700" : "border border-slate-200 px-2 py-1"}>{segment.payload.videoQualityPreset === "final" ? "成片" : "预览"} · {segment.payload.videoNativeResolution || "768p"}</span> : null}<span className="border border-slate-200 px-2 py-1">{segment.payload.nativeAudioStatus === "ready" ? "含模型原声" : "无模型原声"}</span>{segment.payload.videoStale ? <span className="border border-rose-200 px-2 py-1 text-rose-600">已过期</span> : null}</div></div></article>
            ))}
        </div>
    ) : (
        <EmptyPanel icon={Clapperboard} title="还没有视频段" description="让 Agent 根据剧本规划 4–15 秒视频段。" />
    );
}

function Studio({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const order = useMemo(() => state.timeline.payload.segmentOrder?.length ? state.timeline.payload.segmentOrder : state.videoSegments.map((item) => item.id), [state.timeline.payload.segmentOrder, state.videoSegments]);
    const shots = useMemo(() => order.map((id) => state.videoSegments.find((item) => item.id === id)).filter(Boolean) as DirectorVideoSegment[], [order, state.videoSegments]);
    const videoRef = useRef<HTMLVideoElement>(null);
    const monitorRef = useRef<HTMLDivElement>(null);
    const pendingSeekRef = useRef(0);
    const [playing, setPlaying] = useState(false);
    const [currentShotIndex, setCurrentShotIndex] = useState(() => shots.findIndex((shot) => Boolean(shot.payload.videoFileId)));
    const [currentShotTime, setCurrentShotTime] = useState(0);
    const [muted, setMuted] = useState(false);
    const [dragged, setDragged] = useState("");
    const [rendering, setRendering] = useState(false);
    const [renders, setRenders] = useState<DirectorRender[]>([]);
    useEffect(() => {
        let active = true;
        const load = () => void directorApi.renders(projectId).then((items) => active && setRenders(items));
        load();
        const timer = window.setInterval(load, 2000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [projectId]);
    const saveOrder = async (next: string[]) => {
        try {
            await directorApi.updateTimeline(projectId, { revision: state.timeline.revision, payload: { ...state.timeline.payload, segmentOrder: next } });
            await onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "时间线保存失败");
        }
    };
    const drop = (target: string) => {
        if (!dragged || dragged === target) return;
        const next = order.filter((id) => id !== dragged);
        next.splice(next.indexOf(target), 0, dragged);
        setDragged("");
        void saveOrder(next);
    };
    const missingVideos = shots.filter((shot) => !shot.payload.videoFileId).length;
    const currentShot = currentShotIndex >= 0 ? shots[currentShotIndex] : undefined;
    const nextShot = currentShotIndex >= 0 ? shots[currentShotIndex + 1] : undefined;
    const playableCount = shots.length - missingVideos;
    useEffect(() => {
        if (currentShot?.payload.videoFileId) return;
        setCurrentShotIndex(shots.findIndex((shot) => Boolean(shot.payload.videoFileId)));
        setCurrentShotTime(0);
        setPlaying(false);
    }, [currentShot?.id, currentShot?.payload.videoFileId, shots]);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (playing) void video.play().catch(() => setPlaying(false));
        else video.pause();
    }, [playing, currentShotIndex]);
    const moveToPlayable = (direction: 1 | -1) => {
        let index = currentShotIndex + direction;
        while (index >= 0 && index < shots.length && !shots[index].payload.videoFileId) index += direction;
        if (index < 0 || index >= shots.length) return false;
        pendingSeekRef.current = 0;
        setCurrentShotIndex(index);
        setCurrentShotTime(0);
        return true;
    };
    const selectShot = (index: number) => {
        if (!shots[index].payload.videoFileId) return message.warning("这个视频段还没有可播放视频");
        pendingSeekRef.current = 0;
        setCurrentShotIndex(index);
        setCurrentShotTime(0);
    };
    const advanceAfterEnd = () => {
        const index = currentShotIndex + 1;
        if (index >= shots.length || !shots[index].payload.videoFileId) return setPlaying(false);
        pendingSeekRef.current = 0;
        setCurrentShotIndex(index);
        setCurrentShotTime(0);
    };
    const submitRender = async () => {
        setRendering(true);
        try {
            const created = await directorApi.createRender(projectId, state.timeline.revision);
            setRenders((items) => [created, ...items]);
            message.success("成片已进入持久化合成队列，可刷新页面继续查看");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建合成任务失败");
        } finally {
            setRendering(false);
        }
    };
    const render = () => {
        const previews = shots.filter((shot) => shot.payload.videoFileId && shot.payload.videoQualityPreset !== "final").length;
        if (!previews) return void submitRender();
        modal.confirm({ title: "时间线仍包含快速预览", content: `当前有 ${previews} 个预览片段（480p 或兼容预览配方）。可以导出，但不建议作为最终成片。`, okText: "仍然导出", cancelText: "返回替换成片", onOk: submitRender });
    };
    const totalDuration = shots.reduce((sum, shot) => sum + (shot.payload.durationSeconds || 4), 0);
    const elapsedBeforeCurrent = shots.slice(0, Math.max(0, currentShotIndex)).reduce((sum, shot) => sum + (shot.payload.durationSeconds || 4), 0);
    const currentTimelineTime = Math.min(totalDuration, elapsedBeforeCurrent + currentShotTime);
    const timelineWidth = Math.max(1000, 160 + totalDuration * 16);
    const seekTimeline = (seconds: number) => {
        let elapsed = 0;
        for (let index = 0; index < shots.length; index += 1) {
            const duration = shots[index].payload.durationSeconds || 4;
            if (seconds <= elapsed + duration || index === shots.length - 1) {
                if (!shots[index].payload.videoFileId) {
                    setPlaying(false);
                    message.warning("这个位置的视频段还未生成");
                    return;
                }
                const offset = Math.max(0, Math.min(duration, seconds - elapsed));
                pendingSeekRef.current = offset;
                setCurrentShotIndex(index);
                setCurrentShotTime(offset);
                if (index === currentShotIndex && videoRef.current) videoRef.current.currentTime = offset;
                return;
            }
            elapsed += duration;
        }
    };
    return (
        <div className="flex min-h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 lg:px-8">
                <div className="flex flex-wrap items-center gap-5 text-sm text-slate-600">
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                        <ListVideo className="size-4" />
                        时间线
                    </span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span>{shots.length} 个视频段</span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span className="flex items-center gap-1.5">
                        <Clock3 className="size-4" />
                        总时长 {formatTime(totalDuration)}
                    </span>
                    {missingVideos ? <span className="text-orange-600">缺少视频 {missingVideos} 个视频段</span> : <span className="text-emerald-600">视频已就绪</span>}
                </div>
                <div className="flex gap-2">
                    <Button
                        type="text"
                        className="!text-slate-600"
                        icon={<Bot className="size-4" />}
                        onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "timeline", entityId: "timeline", title: "时间线", subtitle: "视频段与声音编排" })}
                    >
                        交给 Agent 铺轨
                    </Button>
                    <Tooltip title={missingVideos ? `仍有 ${missingVideos} 个视频段缺少视频` : "导出 H.264/AAC MP4"}>
                        <Button disabled={Boolean(missingVideos)} loading={rendering} className="!border-blue-600 !bg-blue-600 !text-white" icon={<Film className="size-4" />} onClick={render}>
                            导出 MP4
                        </Button>
                    </Tooltip>
                </div>
            </div>
            {renders[0] ? (
                <div className="mx-8 mt-5 flex items-center gap-4 border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                    <Film className="size-4 text-blue-600" />
                    <div className="min-w-0 flex-1">
                        <div className="flex justify-between">
                            <span>{renders[0].status === "succeeded" ? "最近成片" : "成片合成"}</span>
                            <span className="text-slate-400">{Math.round(renders[0].progress * 100)}%</span>
                        </div>
                        <Progress percent={Math.round(renders[0].progress * 100)} showInfo={false} size="small" />
                    </div>
                    {renders[0].status === "succeeded" && renders[0].outputFileId ? (
                        <a className="text-blue-600" href={serverApiUrl(`/files/${renders[0].outputFileId}/content`)} download>
                            下载 MP4
                        </a>
                    ) : renders[0].status === "failed" || renders[0].status === "canceled" ? (
                        <Button size="small" onClick={() => void directorApi.retryRender(renders[0].id)}>
                            重试
                        </Button>
                    ) : (
                        <Button size="small" danger type="text" onClick={() => void directorApi.cancelRender(renders[0].id)}>
                            取消
                        </Button>
                    )}
                </div>
            ) : null}
            <section data-testid="director-program-monitor" className="border-b border-slate-200 bg-white px-5 py-6 lg:px-8">
                <div ref={monitorRef} data-testid="director-program-frame" className="director-program-surface relative mx-auto aspect-video w-full max-w-[800px] overflow-hidden">
                    {currentShot?.payload.videoFileId ? <video ref={videoRef} muted={muted} preload="auto" className="size-full object-contain" src={serverApiUrl(`/files/${currentShot.payload.videoFileId}/content`)} playsInline onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(pendingSeekRef.current, event.currentTarget.duration || pendingSeekRef.current); if (playing) void event.currentTarget.play().catch(() => setPlaying(false)); }} onTimeUpdate={(event) => setCurrentShotTime(event.currentTarget.currentTime)} onEnded={advanceAfterEnd} /> : <div className="grid size-full place-items-center text-center text-slate-400"><div><Video className="mx-auto size-10" /><p className="mt-3 text-sm">暂无可连续播放的视频段</p><p className="mt-1 text-xs text-slate-500">生成视频后会自动按时间线顺序播放</p></div></div>}
                    {currentShot ? <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3 text-xs text-white"><span>{String(currentShotIndex + 1).padStart(2, "0")} · {currentShot.title}</span><span>{currentShot.payload.videoQualityPreset === "final" ? "最终成片" : "快速预览"} · {currentShot.payload.videoNativeResolution || "768p"}</span></div> : null}
                    <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-3 pt-10 text-white">
                        <button aria-label="上一个可播放片段" className="director-program-control grid size-8 shrink-0 place-items-center" disabled={!playableCount} onClick={() => { setPlaying(false); void moveToPlayable(-1); }}><SkipBack className="size-4" /></button>
                        <button aria-label={playing ? "暂停连续预览" : "播放连续预览"} className="director-program-control-primary grid size-10 shrink-0 place-items-center rounded-full" disabled={!playableCount} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}</button>
                        <button aria-label="下一个可播放片段" className="director-program-control grid size-8 shrink-0 place-items-center" disabled={!playableCount} onClick={() => { setPlaying(false); void moveToPlayable(1); }}><SkipForward className="size-4" /></button>
                        <span className="ml-1 shrink-0 font-mono text-xs text-slate-100">{formatTimecode(currentTimelineTime)} / {formatTime(totalDuration)}</span>
                        <input aria-label="全片播放进度" className="mx-2 h-1 min-w-20 flex-1 cursor-pointer accent-blue-600" type="range" min={0} max={Math.max(1, totalDuration)} step={1 / 24} value={currentTimelineTime} onChange={(event) => seekTimeline(Number(event.target.value))} />
                        <button aria-label={muted ? "开启声音" : "静音"} className="director-program-control grid size-8 shrink-0 place-items-center" onClick={() => setMuted((value) => !value)}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
                        <button aria-label="全屏播放" className="director-program-control grid size-8 shrink-0 place-items-center" onClick={() => void monitorRef.current?.requestFullscreen()}><Maximize2 className="size-4" /></button>
                    </div>
                </div>
                <div className="mx-auto mt-3 flex max-w-[800px] flex-wrap items-center gap-x-5 gap-y-2 border-y border-slate-200 py-2 text-[11px] text-slate-500">
                    <span>当前监听：模型原声</span><span className="text-slate-700">当前片段 {currentShot ? `${String(currentShotIndex + 1).padStart(2, "0")}/${shots.length} · ${currentShot.title}` : "—"}</span><span className="ml-auto">已有 {playableCount} 段可播放{missingVideos ? "，遇到缺失片段自动暂停" : ""}</span>{nextShot ? <span className={nextShot.payload.videoFileId ? "" : "text-rose-500"}>下一段：{nextShot.title}{nextShot.payload.videoFileId ? "" : " · 缺少视频"}</span> : null}
                </div>
            </section>
            <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
                <div className="flex h-12 items-center justify-end gap-2 border-b border-slate-200 bg-white px-5 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                        <span className="border border-slate-200 px-3 py-1.5">1080p</span>
                        <span className="border border-slate-200 px-3 py-1.5">24 fps</span>
                        <span className="border border-slate-200 px-3 py-1.5">{state.workspace.aspectRatio}</span>
                    </div>
                </div>
                <div className="min-h-64 overflow-x-auto bg-white pb-5">
                    <div className="relative min-w-[1000px]" style={{ width: timelineWidth }}>
                        <div className="flex h-10 border-b border-slate-200 pl-40">
                            {Array.from({ length: Math.max(7, Math.ceil(totalDuration / 10) + 1) }, (_, index) => (
                                <div key={index} className="w-40 shrink-0 border-l border-slate-200 pl-1 pt-3 font-mono text-[9px] text-slate-400">
                                    {formatTime(index * 10)}
                                </div>
                            ))}
                        </div>
                        <div data-testid="director-playhead" className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-blue-600 transition-[left] duration-75" style={{ left: 160 + currentTimelineTime * 16 }}>
                            <span className="absolute -left-1.5 top-0 h-0 w-0 border-x-[6px] border-t-[9px] border-x-transparent border-t-blue-600" />
                        </div>
                        <div className="flex h-28 border-b border-slate-200">
                            <TrackLabel icon={Video} label="视频" />
                            <div className="flex min-w-max flex-1 items-start bg-slate-50 p-3">
                                {shots.map((shot, index) => (
                                    <div
                                        key={shot.id}
                                        draggable
                                        onDragStart={() => setDragged(shot.id)}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={() => drop(shot.id)}
                                        onClick={() => selectShot(index)}
                                        style={{ width: Math.max(96, (shot.payload.durationSeconds || 4) * 16) }}
                                        className={`relative shrink-0 cursor-grab border ${currentShotIndex === index ? "z-10 border-blue-600 ring-1 ring-blue-600" : shot.payload.videoStale ? "border-orange-400" : "border-slate-300"} ${shot.payload.videoFileId ? "bg-white" : "border-dashed bg-slate-50"}`}
                                    >
                                        <div className="relative h-16 bg-slate-100">
                                            {shot.payload.videoFileId ? (
                                                <video muted src={serverApiUrl(`/files/${shot.payload.videoFileId}/content`)} className="size-full object-cover" />
                                            ) : (
                                                <div className="grid size-full place-items-center text-[10px] text-slate-400">
                                                    缺少视频
                                                </div>
                                            )}
                                            <span className="absolute bottom-1 right-1 bg-slate-950/75 px-1 font-mono text-[10px] text-white">{shot.payload.durationSeconds || 4}s</span>
                                            <span className="absolute left-1 top-1 bg-slate-950/75 px-1.5 py-0.5 font-mono text-[10px] text-white">{String(index + 1).padStart(2, "0")}</span>
                                        </div>
                                        <div className="truncate px-3 py-2 text-xs text-slate-600">{shot.title}</div>
                                        <div
                                            className={`absolute -right-1.5 top-[calc(100%+5px)] z-10 border px-1 py-0.5 font-mono text-[9px] ${shot.payload.boundary === "continue" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-500"}`}
                                        >
                                            {shot.payload.boundary === "continue" ? "CONTINUE" : "CUT"}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            {(["model-original", "dialogue", "narration", "ambient", "sfx", "music"] as const).map((kind) => {
                                const track = state.timeline.payload.tracks?.find((item) => item.kind === kind);
                                return (
                                    <div key={kind} className="flex h-16 border-b border-slate-200">
                                        <TrackLabel icon={AudioLines} label={{ "model-original": "模型原声", dialogue: "对白", narration: "旁白", ambient: "环境声", sfx: "道具音效", music: "音乐" }[kind]} />
                                        <div className="relative flex-1 bg-white">
                                            {track?.clips.map((clip) => (
                                                <div
                                                    key={clip.id}
                                                    className="director-waveform absolute inset-y-2 overflow-hidden border border-blue-200 bg-blue-50 px-2 text-[10px] leading-[46px] text-blue-700"
                                                    style={{ left: clip.start * 16, width: Math.max(24, clip.duration * 16) }}
                                                >
                                                    <span>{clip.duration}s</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function EmptyPanel({ icon: Icon, title, description }: { icon: typeof Film; title: string; description: string }) {
    return (
        <div className="mt-8 grid min-h-80 place-items-center border border-dashed border-slate-300 bg-slate-50 text-center">
            <div>
                <Icon className="mx-auto size-8 text-slate-300" />
                <h2 className="mt-4 font-serif text-xl text-slate-900">{title}</h2>
                <p className="mt-2 text-sm text-slate-500">{description}</p>
            </div>
        </div>
    );
}

function TrackLabel({ icon: Icon, label }: { icon: typeof Film; label: string }) {
    return (
        <div className="flex w-40 shrink-0 items-center justify-between border-r border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
            <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{label}</span>
            </span>
            <span className="ml-2 flex items-center gap-1.5 text-slate-300">
                <Eye className="size-3" />
                <Lock className="size-3" />
            </span>
        </div>
    );
}

function formatTime(seconds: number) {
    const value = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remaining = value % 60;
    return [hours, minutes, remaining].map((item) => String(item).padStart(2, "0")).join(":");
}

function formatTimecode(seconds: number) {
    const value = Math.max(0, seconds);
    const whole = Math.floor(value);
    return `${formatTime(whole)}:${String(Math.floor((value - whole) * 24)).padStart(2, "0")}`;
}
