import { generationPhaseLabel } from "@/lib/generation-status";
import { ShotWorkspace } from "./shot-workspace";
import { EditWorkspace } from "./edit-workspace";
import { readDirectorQuery } from "@/services/director-queries";
import { DirectorMedia } from "./components/director-media";
import { currentDirectorPreviewItems, directorMediaUrl, useDeferredDirectorValue, useDirectorResourceVersion } from "./use-director-sync";
import { directorSync } from "@/stores/use-director-store";
import type { DirectorResource } from "@/types/director-sync";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App, Button, ConfigProvider, Drawer, Dropdown, Image as AntImage, Input, Modal, Progress as AntProgress, Select, Spin, Tag, Tooltip } from "antd";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Activity,
    ArrowLeft,
    Search,
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
import { directorAntTheme } from "@/lib/app-theme";
import { useCopyText } from "@/hooks/use-copy-text";
import { assetKinds, assetKindLabels, segmentAssetRefs } from "./segment-workflow";
import "./director-light.css";

const sections: Array<{ id: DirectorSection; label: string; icon: typeof Film }> = [
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "story", label: "故事", icon: FileText },
    { id: "style", label: "导演方案", icon: Palette },
    { id: "script", label: "剧本", icon: ScrollText },
    { id: "storyboard", label: "分镜", icon: Clapperboard },
    { id: "studio", label: "视频创作台", icon: Scissors },
    { id: "assets", label: "素材库", icon: Package },
];

function Progress(props: ComponentProps<typeof AntProgress>) {
    return <AntProgress {...props} strokeColor="#2563eb" trailColor="#e2e8f0" />;
}

function formatDirectorDuration(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return minutes ? `${minutes} 分${remaining ? ` ${remaining} 秒` : ""}` : `${remaining} 秒`;
}

const EMPTY_ASSETS: CreativeAsset[] = [];
const EMPTY_STYLES: VisualStyle[] = [];
const EMPTY_GENERATIONS: ServerGeneration[] = [];
const EMPTY_RENDERS: DirectorRender[] = [];
const PAGE_RESOURCES: Record<DirectorSection, DirectorResource[]> = {
    overview: ["sources", "validation", "story", "script", "segments", "timeline"], story: ["story", "sources"], script: ["script", "sources"], style: ["direction"],
    assets: ["assets", "segments"], storyboard: ["segments", "timeline", "validation"], studio: ["segments", "timeline", "renders"],
};
const assetFileUrl = (fileId: string, revision: number) => directorMediaUrl(fileId, revision);

export default function DirectorProjectPage() {
    const { id = "", section = "overview" } = useParams();
    const active = sections.some((item) => item.id === section) ? (section as DirectorSection) : "overview";
    const navigate = useNavigate();
    const { message } = App.useApp();
    const state = useDirectorStore((store) => store.states[id]);
    const loadState = useDirectorStore((store) => store.loadState);
    const projectData = useDirectorStore((store) => store.data[id]);
    const assets = projectData?.assets || EMPTY_ASSETS;
    const styles = projectData?.styles || EMPTY_STYLES;
    const generations = projectData?.generations || EMPTY_GENERATIONS;
    const loading = !projectData?.ready;
    const [agentCollapsed, setAgentCollapsed] = useState(false);
    const openPanel = useAgentStore((store) => store.openPanel);
    const agentFocusRequest = useAgentStore((store) => store.focusRequests[id]);
    useEffect(() => { if (agentFocusRequest) setAgentCollapsed(false); }, [agentFocusRequest]);

    const refresh = async () => { await loadState(id); };
    useEffect(() => {
        openPanel(id);
        return useDirectorStore.getState().retainProject(id, ["project", "assets", "direction", "generations", "media", ...PAGE_RESOURCES[active]]);
    }, [id, active, openPanel]);
    useEffect(() => {
        if (projectData?.deleted) { message.info("当前导演项目已删除"); navigate("/director", { replace: true }); }
    }, [id, projectData?.deleted, message, navigate]);
    const applyGeneration = () => { void directorSync.refresh(id, ["generations"]).catch(() => undefined); };
    if (loading && projectData?.error) return <div className="director-light grid h-full place-items-center"><div role="alert" className="text-center text-sm text-slate-500">{projectData.error}<button type="button" className="ml-3 text-blue-600" onClick={() => void refresh().catch(() => undefined)}>重试</button></div></div>;

    if (loading || !state)
        return (
            <div className="director-light grid h-full place-items-center bg-white">
                <Spin />
            </div>
        );
    return (
        <ConfigProvider theme={directorAntTheme}>
            <main key={id} className="director-light flex h-dvh min-w-0 bg-white text-slate-950">
                {!agentCollapsed ? <AgentPanel projectId={id} themeMode="light" /> : null}
                <div className="flex min-w-0 flex-1 flex-col bg-white">
                    {projectData?.error ? <div role="alert" className="flex shrink-0 items-center justify-center gap-3 px-3 py-1 text-xs text-rose-600">{projectData.error}<button type="button" onClick={() => void refresh().catch(() => undefined)}>重试同步</button></div> : null}
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
                        {active === "storyboard" ? <ShotWorkspace projectId={id} state={state} onRefresh={refresh} /> : null}
                        {active === "studio" ? <EditWorkspace projectId={id} state={state} onRefresh={refresh} /> : null}
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
        <div className="flex items-center gap-2">{generation.status === "running" ? <Loader2 className="size-3.5 animate-spin text-blue-600" /> : generation.status === "queued" ? <Clock3 className="size-3.5 text-slate-400" /> : generation.status === "succeeded" ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-rose-500" />}<span className="min-w-0 flex-1 truncate text-xs text-slate-700">{meta.title}</span><span className={`text-[10px] ${active ? "text-blue-600" : generation.status === "succeeded" ? "text-emerald-600" : "text-rose-500"}`}>{generationPhaseLabel(generation)}</span>{active ? <button disabled={cancelling} className="ml-1 text-[10px] text-slate-400 hover:text-rose-500" onClick={onCancel}>{cancelling ? "取消中" : "取消"}</button> : null}</div>
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
    if (recordValue(recordValue(generation.request).metadata).mediaProjectId === projectId) return true;
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
function generationTaskMeta(generation: ServerGeneration, assets: CreativeAsset[]) { const params = recordValue(recordValue(generation.request).params); const asset = assets.find((item) => item.id === generationAssetId(generation)); const storyboard = recordValue(params.__directorStoryboardSheet); const segment = recordValue(params.__directorSegment); const storyboardReview = recordValue(params.__directorStoryboardReview); const media = generation.kind === "image" ? "图片" : generation.kind === "video" ? "视频" : generation.kind === "audio" ? "声音" : generation.kind === "transcription" ? "转写" : "分析"; return { title: asset ? `${asset.name} · ${media}` : storyboard.segmentId ? "整张故事板 · 图片" : segment.segmentId ? "视频段 · 视频" : storyboardReview.segmentId ? "整张故事板 · 视觉检查" : `${media}生成`, subtitle: generation.modelId || "生成服务" }; }

function formatTaskTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
function recordValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readLocalIds(key: string): string[] { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } }

function Overview({ state, assets, styles, onNavigate }: { state: DirectorState; assets: CreativeAsset[]; styles: VisualStyle[]; onNavigate: (section: DirectorSection) => void }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const importRef = useRef<HTMLInputElement>(null);
    const validation = useDirectorStore((store) => store.data[state.workspace.projectId]?.validation);
    const [projectBusy, setProjectBusy] = useState<"validate" | "export" | "import" | "">("");
    const runValidation = async () => {
        setProjectBusy("validate");
        try { const result = await directorApi.validate(state.workspace.projectId); await directorSync.refresh(state.workspace.projectId, ["validation"]); message.success(result.valid ? "工程规范检查通过" : `发现 ${result.diagnostics.length} 项问题`); }
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
        Boolean(styles.find((item) => item.id === state.activeStyleId)),
        Boolean(documents.script?.content.trim()),
        state.videoSegments.length > 0,
        state.videoSegments.length > 0 && state.videoSegments.every((item) => item.payload.storyboardSheet?.imageFileId),
        state.videoSegments.length > 0 && state.videoSegments.every((item) => item.payload.videoFileId),
    ];
    const progress = Math.round((stages.filter(Boolean).length / stages.length) * 100);
    const stageItems = [
        { label: "故事", detail: documents.story?.content.trim() ? "已编写" : "待创作", done: stages[0], target: "story" as const },
        { label: "导演方案", detail: styles.find((item) => item.id === state.activeStyleId)?.name || "待设置", done: stages[1], target: "style" as const },
        { label: "剧本", detail: stages[2] ? "已编写" : "待创作", done: stages[2], target: "script" as const },
        { label: "分镜规划", detail: `${state.videoSegments.length} 个视频段`, done: stages[3], target: "storyboard" as const },
        { label: "故事板", detail: `${state.videoSegments.filter((item) => item.payload.storyboardSheet?.imageFileId).length}/${state.videoSegments.length}`, done: stages[4], target: "storyboard" as const },
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
    const documentVersion = useDirectorResourceVersion(projectId, kind);
    const [logicalDocument, setLogicalDocument] = useState<DirectorLogicalDocument>();
    const [selectedPartPath, setSelectedPartPath] = useState("");
    const selectedPartPathRef = useRef(selectedPartPath);
    selectedPartPathRef.current = selectedPartPath;
    const [partContent, setPartContent] = useState("");
    const [externalChanged, setExternalChanged] = useState(false);
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
    const selectedPartRef = useRef(selectedPart);
    selectedPartRef.current = selectedPart;
    useEffect(() => {
        let active = true;
        setDocumentLoading(!logicalDocument);
        void readDirectorQuery(projectId, kind, ["document"], () => directorApi.logicalDocument(projectId, kind)).then((next) => {
            if (!active) return;
            if (dirtyRef.current) {
                setExternalChanged(next.parts.find((part) => part.path === selectedPartPathRef.current)?.hash !== selectedPartRef.current?.hash);
                return;
            }
            setExternalChanged(false);
            const nextPath = next.parts.some((part) => part.path === selectedPartPathRef.current) ? selectedPartPathRef.current : (next.parts.find((part) => !part.index) || next.parts[0])?.path || "";
            setLogicalDocument(next);
            setSelectedPartPath(nextPath);
            setPartContent(next.parts.find((part) => part.path === nextPath)?.content || "");
            if (nextPath !== selectedPartPathRef.current) setActiveOutline(0);
        }).catch((error) => active && message.error(error instanceof Error ? error.message : "文档读取失败")).finally(() => active && setDocumentLoading(false));
        return () => { active = false; };
    }, [documentVersion, kind, projectId]);
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
            setExternalChanged(false);
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
                    {externalChanged ? <span role="status" className="text-xs text-amber-700">工程文件已被外部修改，当前草稿已保留；请复制草稿后重新载入核对。</span> : null}
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
    const agentWidth = useAgentStore((store) => store.width);
    const [busyId, setBusyId] = useState("");
    const [detailAssetId, setDetailAssetId] = useState("");
    const [detailTab, setDetailTab] = useState<AssetDetailTab>("dossier");
    const [search, setSearch] = useState("");
    const [previewMediaId, setPreviewMediaId] = useState("");
    const mediaVersion = useDirectorResourceVersion(projectId, "media");
    const navigate = useNavigate();
    const previewItems = useMemo(() => assets.flatMap((asset) => asset.payload.variants
        .filter((item) => item.kind === "image")
        .map((item) => ({ id: `${asset.id}:${item.id}`, url: assetFileUrl(item.fileId, asset.revision), alt: `${asset.name} · ${item.label || "素材图片"}` } satisfies WorkspaceImagePreviewItem))), [assets, mediaVersion]);
    const previewIndex = previewMediaId ? previewItems.findIndex((item) => item.id === previewMediaId) : -1;
    useEffect(() => {
        if (detailAssetId && !assets.some((asset) => asset.id === detailAssetId)) { setDetailAssetId(""); message.info("当前素材已删除，详情已关闭"); }
    }, [assets, detailAssetId, message]);
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
        const label = asset.kind === "character" ? "形象" : "状态";
        const instruction = `请先检查剧本和该素材的全部使用位置；只有跨多个视频段持续存在、且缺少独立参考会破坏连续性时，才在当前素材文件夹中规划并创建一个新的生产${label}档案。先完成文字档案和提示词，不要自动生成媒体。`;
        prepare(projectId, { kind: "asset", projectId, assetId: asset.id, path: folderPath, title: asset.name, subtitle: asset.kind, instruction });
    };
    const columns = (["character", "scene", "prop"] as const).map((kind) => ({
        kind,
        label: kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具",

        items: assets.filter((item) => item.kind === kind && `${item.name} ${item.payload.description}`.toLowerCase().includes(search.trim().toLowerCase())),
        needsReview: assets.filter((item) => item.kind === kind && item.payload.needsReview).length,
    }));
    const detailAsset = assets.find((item) => item.id === detailAssetId);
    return (
        <div className="relative flex h-full min-w-0 flex-col bg-white">
            <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5"><div className="flex items-baseline gap-3"><h1 className="text-lg font-semibold">素材库</h1><span className="text-xs text-slate-500">按分镜需求积累，供当前项目复用</span></div><Input aria-label="搜索素材" placeholder="搜索素材" prefix={<Search className="size-3.5 text-slate-400" />} value={search} onChange={(event) => setSearch(event.target.value)} allowClear className="max-w-60" /></header>
            <ScrollArea orientation="horizontal" className="min-h-0 flex-1" viewportClassName="director-asset-horizontal-viewport">
                <div className="grid h-full min-w-[900px] grid-cols-3 bg-white px-1">
                    {columns.map((column) => (
                        <section key={column.kind} className="relative flex min-h-0 min-w-0 flex-col pl-3 before:absolute before:bottom-8 before:left-0 before:top-8 before:border-l before:border-solid before:border-slate-200/70 first:before:hidden" aria-labelledby={`asset-column-${column.kind}`}>
                            <div className="flex h-14 shrink-0 items-center justify-between gap-3 bg-white pr-3">
                                <div className="flex min-w-0 items-center gap-2 whitespace-nowrap"><h2 id={`asset-column-${column.kind}`} className="text-[15px] font-semibold leading-none text-slate-950">{column.label}</h2><span className="font-mono text-[10px] leading-none text-slate-400">{counts[column.kind]}</span>{column.needsReview ? <span className="ml-1 text-[10px] leading-none text-slate-400">待检查 {column.needsReview}</span> : null}</div>
                                <Button type="text" size="small" aria-label={`新增${column.label}`} icon={<Plus className="size-4" />} onClick={() => { prepare(projectId, { kind: "director", projectId, entityKind: "script", entityId: "script", title: `新增${column.label}`, subtitle: "按创作需求建立素材", instruction: `请按当前创作需求新增一个${column.label}，先检查素材库是否可复用，完成档案和提示词，不自动生成媒体。` }); }} />
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
                                        onDetail={() => { setDetailTab("dossier"); setDetailAssetId(asset.id); }}
                                        usages={state.videoSegments.filter((segment) => segmentAssetRefs(segment).some((ref) => ref.id === asset.id))}
                                        onUsages={() => { setDetailTab("usages"); setDetailAssetId(asset.id); }}
                                        onAction={(kind, media) => void action(asset, kind, media)}
                                    />
                                )) : <AssetColumnEmpty kind={column.kind} />}
                                </div>
                            </ScrollArea>
                        </section>
                    ))}
                </div>
            </ScrollArea>
            <AssetDetailDialog asset={detailAsset} initialTab={detailTab} generations={generations} leftInset={agentCollapsed ? 0 : agentWidth + 1} onRefresh={onRefresh} onClose={() => setDetailAssetId("")} onAgent={(path) => { if (detailAsset) openAgent(detailAsset, path); }} onNewVariant={(path) => { if (detailAsset) planVariant(detailAsset, path); }} onLocate={(taskId) => navigate(`/director/${projectId}/studio?task=${encodeURIComponent(taskId)}`)} />
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
    const [externalChanges, setExternalChanges] = useState({ style: false, rules: false });
    const [rulesLoading, setRulesLoading] = useState(true);
    const [editingRules, setEditingRules] = useState(false);
    const directionVersion = useDirectorResourceVersion(projectId, "direction");
    const styleDirtyRef = useRef(false);
    const rulesDirtyRef = useRef(false);
    const uploadRef = useRef<HTMLInputElement>(null);
    const style = styles.find((item) => item.id === selectedId);
    const previewUrl = style?.references.board ? serverApiUrl(`/director/projects/${projectId}/direction/style-board?v=${directionVersion}`) : "";
    const styleDirty = styleDocument !== savedStyleDocument;
    const rulesDirty = rules !== savedRules;
    styleDirtyRef.current = styleDirty;
    rulesDirtyRef.current = rulesDirty;
    useEffect(() => { void serverApi.visualStyleTemplates().then(setTemplates); }, []);
    useEffect(() => { setSelectedId(activeStyleId || styles[0]?.id || ""); }, [activeStyleId, styles[0]?.id]);
    useEffect(() => {
        let canceled = false;
        setStyleLoading(!styleHash);
        void readDirectorQuery(projectId, "direction", [visualStylePath], () => directorApi.file(projectId, visualStylePath)).then((file) => {
            if (canceled || file.hash === styleHash) return;
            if (styleDirtyRef.current) { setExternalChanges((current) => ({ ...current, style: true })); return; }
            setExternalChanges((current) => ({ ...current, style: false }));
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
    }, [projectId, directionVersion, message]);
    useEffect(() => {
        let canceled = false;
        setRulesLoading(!rulesHash);
        void readDirectorQuery(projectId, "direction", [directingRulesPath], () => directorApi.file(projectId, directingRulesPath)).then((file) => {
            if (canceled) return;
            if (file.hash === rulesHash) return;
            if (rulesDirtyRef.current) { setExternalChanges((current) => ({ ...current, rules: true })); return; }
            setExternalChanges((current) => ({ ...current, rules: false }));
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
    }, [projectId, directionVersion, message]);
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
        if (!styleDirty || styleLoading || busy || externalChanges.style || styleSaveBlocked === styleDocument) return;
        const timer = window.setTimeout(() => void saveStyleDocument(), 600);
        return () => window.clearTimeout(timer);
    }, [projectId, styleDocument, styleDirty, styleLoading, styleHash, styleFrontmatter, styleSaveBlocked, busy, externalChanges.style]);
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
        if (!rulesDirty || rulesLoading || busy || externalChanges.rules || rulesSaveBlocked === rules) return;
        const timer = window.setTimeout(() => void saveRules(), 600);
        return () => window.clearTimeout(timer);
    }, [projectId, rules, rulesDirty, rulesLoading, rulesHash, rulesFrontmatter, rulesSaveBlocked, busy, externalChanges.rules]);
    return (
        <div className="director-treatment-page">
            {externalChanges.style || externalChanges.rules ? <p role="status" className="px-6 py-2 text-xs text-amber-700">工程文件已被外部修改，草稿已保留并暂停自动保存；请复制草稿后重新载入核对。</p> : null}
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
                            {style?.boardStale ? <span className="ml-auto self-center text-[10px] text-rose-500">文字已更新，参考板待复核</span> : null}
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

function AssetCard({ asset, busy, activeGenerations, usages, onAgent, onPreview, onDetail, onUsages, onAction }: { asset: CreativeAsset; busy: boolean; activeGenerations: ServerGeneration[]; usages: DirectorVideoSegment[]; onAgent: () => void; onPreview: () => void; onDetail: () => void; onUsages: () => void; onAction: (kind: "regenerate" | "copy" | "delete", media?: "image" | "audio") => void }) {
    const primaryImage = primaryAssetImage(asset);
    const generating = activeGenerations.some((generation) => generation.kind === "image");
    return <article className="overflow-hidden rounded border border-slate-200 bg-white" style={{ contentVisibility: "auto", containIntrinsicSize: "290px" }}>
        <div className="relative aspect-video bg-slate-50">
            {primaryImage ? <button type="button" aria-label={`查看${asset.name}大图`} className="block size-full cursor-zoom-in" onClick={onPreview}><img src={assetFileUrl(primaryImage.fileId, asset.revision)} alt={asset.name} className="size-full object-contain" /></button> : <MediaPlaceholder label="待补充设计图" />}
            {generating ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/60"><Loader2 className="size-5 animate-spin text-blue-600" /></div> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 px-3 py-3">
            <button type="button" className="min-w-0 w-full text-left" onClick={onDetail}><h2 className="truncate text-sm font-semibold">{asset.name}</h2><p className="mt-1 truncate text-[11px] text-slate-500">{assetInventory(asset)}</p><p className="mt-1 text-[11px] text-slate-500">{usages.length ? `已用于 ${usages.length} 个视频段` : "尚未被视频段引用"}</p></button>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
                <AssetAction icon={Eye} label="详情" onClick={onDetail} />
                <AssetAction icon={ListVideo} label="使用位置" onClick={onUsages} />
                <AssetAction icon={Bot} label="Agent" onClick={onAgent} />
                <AssetMoreMenu includeRegenerate busy={busy || generating} generating={generating} onDetail={onDetail} onAction={onAction} />
            </div>
        </div>
    </article>;
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

function AssetDetailDialog({ asset, initialTab = "dossier", segment, onUse, generations, leftInset, onRefresh, onClose, onAgent, onNewVariant, onLocate }: { asset?: CreativeAsset; initialTab?: AssetDetailTab; segment?: DirectorVideoSegment; onUse?: (variantId?: string) => Promise<void>; generations: ServerGeneration[]; leftInset: number; onRefresh: () => Promise<void>; onClose: () => void; onAgent: (path?: string) => void; onNewVariant: (path?: string) => void; onLocate: (segmentId: string) => void }) {
    const { message, modal } = App.useApp();
    const [loadedDetail, setLoadedDetail] = useState<DirectorAssetDetail>();
    const detail = loadedDetail?.assetId === asset?.id ? loadedDetail : undefined;
    const [detailError, setDetailError] = useState("");
    const assetsVersion = useDirectorResourceVersion(asset?.projectId || "", "assets");
    const segmentsVersion = useDirectorResourceVersion(asset?.projectId || "", "segments");
    const assetIdRef = useRef(asset?.id);
    assetIdRef.current = asset?.id;
    const [tab, setTab] = useState<AssetDetailTab>("dossier");
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<{ items: WorkspaceImagePreviewItem[]; activeIndex: number } | null>(null);
    const reload = async (force = false) => {
        if (!asset) return;
        const value = await readDirectorQuery(asset.projectId, "assets", ["detail", asset.id], () => directorApi.assetDetail(asset.id), force);
        if (assetIdRef.current === value.assetId) { setLoadedDetail(value); setDetailError(""); }
    };
    const setDetail = (_value: DirectorAssetDetail) => { void reload(true).catch((error) => setDetailError(error instanceof Error ? error.message : "素材详情加载失败")); };
    useEffect(() => { setTab(initialTab); }, [asset?.id, initialTab]);
    useEffect(() => {
        if (!asset) return;
        let active = true;
        void readDirectorQuery(asset.projectId, "assets", ["detail", asset.id], () => directorApi.assetDetail(asset.id)).then((value) => {
            if (active) { setLoadedDetail(value); setDetailError(""); }
        }).catch((error) => active && setDetailError(error instanceof Error ? error.message : "素材详情加载失败"));
        return () => { active = false; };
    }, [asset?.id, assetsVersion, segmentsVersion]);
    useEffect(() => { if (detail && tab.startsWith("variant:") && !detail.variants.some((item) => `variant:${item.variantId}` === tab)) setTab("primary"); }, [detail, tab]);
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
    return createPortal(<div className={`fixed inset-y-0 right-0 z-[100] flex items-center justify-center ${segment ? "bg-white" : "bg-slate-950/30 p-3 backdrop-blur-[1px]"}`} style={{ left: leftInset }} onMouseDown={onClose}>
        <section role="dialog" aria-modal="true" aria-label={`${asset.name}素材工作台`} className={`director-light flex h-full w-full flex-col overflow-hidden bg-white ${segment ? "" : "rounded-xl border border-slate-200 shadow-[0_24px_70px_rgba(15,23,42,.24)]"}`} onMouseDown={(event) => event.stopPropagation()}>
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
                <div className="flex min-w-0 items-center gap-4">{segment ? <button className="flex shrink-0 items-center gap-1 text-xs text-blue-600" onClick={onClose}><ArrowLeft className="size-4" />返回分镜 · SEG {String(segment.position + 1).padStart(2, "0")}</button> : null}<div className="min-w-0"><h1 className="!m-0 truncate text-lg font-semibold leading-tight text-slate-950">{asset.name}</h1>{segment ? <p className="!mb-0 mt-1 truncate text-xs leading-tight text-slate-500">用于「{segment.title}」</p> : null}</div></div>
                <div className="flex items-center gap-1"><Button type="text" size="small" icon={<Bot className="size-4" />} onClick={() => onAgent(activePath)}>交给 Agent</Button><button type="button" aria-label="关闭素材详情" className="cursor-pointer p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950" onClick={onClose}><X className="size-4" /></button></div>
            </header>
            <nav className="hide-scrollbar flex h-12 shrink-0 items-end gap-1 overflow-x-auto border-b border-slate-200 px-5" aria-label="素材详情页面">
                {tabs.map((item) => <button key={item.id} type="button" className={`h-12 shrink-0 cursor-pointer border-b-2 px-3 text-sm transition ${tab === item.id ? "border-blue-600 font-medium text-slate-950" : "border-transparent text-slate-500 hover:text-slate-900"}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
                <button type="button" className="h-12 shrink-0 cursor-pointer px-3 text-sm text-blue-600 hover:bg-blue-50" onClick={() => onNewVariant(detail?.folderPath)}>＋ {asset.kind === "character" ? "新增形象" : "新增状态"}</button>
                {tab.startsWith("variant:") ? <Dropdown trigger={["click"]} menu={{ items: [{ key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "移到回收站" }], onClick: () => modal.confirm({ title: "移除这个生产变体？", content: "文件会移入项目 .trash，可恢复。", okText: "移除", okButtonProps: { danger: true }, cancelText: "取消", onOk: async () => { if (!detail) return; setDetail(await directorApi.deleteAssetVariant(asset.id, tab.slice(8))); setTab("primary"); } }) }}><button type="button" aria-label="变体操作" className="mb-2 ml-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal className="size-4" /></button></Dropdown> : null}
            </nav>
            <div className="min-h-0 flex-1 bg-white">
                {detailError ? <div role="alert" className="px-5 py-2 text-xs text-rose-600">{detailError}<button type="button" className="ml-3" onClick={() => void reload(true).catch(() => undefined)}>重试</button></div> : null}
                {!detail ? <div className="grid size-full place-items-center"><Spin /></div> : tab === "dossier" ? <ScrollArea className="h-full"><article className="director-markdown mx-auto max-w-4xl px-10 py-8"><Streamdown mode="static">{detail.dossier.content || `# ${asset.name}\n\n等待 Agent 补充素材档案。`}</Streamdown></article></ScrollArea>
                    : visual ? <AssetVisualTab asset={asset} workspace={visual} segment={segment} busy={busy} onGenerate={() => void generate(visual.kind === "variant" ? "variant-visual" : "primary-visual")} onAddInput={(file) => void addInput(file, visual.kind === "variant" ? "variant-visual" : "primary-visual")} onRemoveInput={async (inputId) => setDetail(await directorApi.removeAssetMediaInput(asset.id, inputId))} onPreview={openMedia} />
                    : tab === "sound" ? <AssetSoundTab asset={asset} detail={detail} busy={busy} onGenerate={() => void generate("sound")} onAddInput={(file) => void addInput(file, "sound")} onRemoveInput={async (inputId) => setDetail(await directorApi.removeAssetMediaInput(asset.id, inputId))} />
                    : <AssetUsagesTab detail={detail} onLocate={onLocate} />}
            </div>
            {segment && onUse ? <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-200 px-5 py-3"><span className="text-xs text-slate-500">素材自动保存在库中，使用后关联当前视频段</span><Button type="primary" loading={busy} disabled={!visual?.outputs.length} onClick={async () => { setBusy(true); try { await onUse(visual?.variantId); onClose(); } catch (error) { message.error(error instanceof Error ? error.message : "引用失败"); } finally { setBusy(false); } }}>{asset.kind === "character" ? "使用此形象并返回" : "使用此素材并返回"}</Button></footer> : null}
        </section>
        <WorkspaceImagePreviewLightbox items={currentDirectorPreviewItems(preview?.items || [])} activeIndex={preview?.activeIndex ?? null} onClose={() => setPreview(null)} onChangeIndex={(activeIndex) => setPreview((current) => current ? { ...current, activeIndex } : null)} />
    </div>, document.body);
}

function AssetVisualTab({ asset, workspace, segment, busy, onGenerate, onAddInput, onRemoveInput, onPreview }: { asset: CreativeAsset; workspace: DirectorAssetVisualWorkspace; segment?: DirectorVideoSegment; busy: boolean; onGenerate: () => void; onAddInput: (file: File) => void; onRemoveInput: (id: string) => void; onPreview: (items: DirectorAssetMedia[], media: DirectorAssetMedia) => void }) {
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
        <section className="flex min-h-0 flex-col">{segment ? <div className="shrink-0 border-b border-slate-200 px-5 py-4"><h2 className="text-sm font-semibold">本段素材需求</h2><p className="mt-2 text-xs leading-6 text-slate-500">{workspace.description || segment.payload.description || segment.title}</p></div> : null}<div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-5"><div><h2 className="text-sm font-semibold text-slate-950">最终提示词 · prompt.md</h2>{generationPreview ? <p className="mt-0.5 text-[10px] text-slate-400">原样发送 · {generationPreview.model.name} · {String(generationPreview.params.size || "默认尺寸")}</p> : null}</div><CopyPromptButton value={actualPrompt} /></div><ScrollArea className="min-h-0 flex-1"><pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12px] leading-6 text-slate-700">{actualPrompt || (previewError ? previewError : "正在读取最终提示词…")}</pre></ScrollArea></section>
    </div>;
}

function CopyPromptButton({ value }: { value: string }) { const copy = useCopyText(); return <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate-500 hover:text-blue-700" onClick={() => void copy(value, "已复制提示词")}><Copy className="size-3.5" />复制</button>; }

function AssetSoundTab({ asset, detail, busy, onGenerate, onAddInput, onRemoveInput }: { asset: CreativeAsset; detail: DirectorAssetDetail; busy: boolean; onGenerate: () => void; onAddInput: (file: File) => void; onRemoveInput: (id: string) => void }) {
    const sound = detail.sound;
    return <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[58fr_42fr]"><section className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50 p-6 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-slate-950">{asset.kind === "character" ? "角色声音" : asset.kind === "scene" ? "环境声" : "道具音效"}</h2><p className="mt-1 text-xs text-slate-500">最多使用一个参考声音</p></div><Button type="primary" loading={busy} icon={<AudioLines className="size-3.5" />} onClick={onGenerate}>{sound.output ? "重新生成" : "生成声音"}</Button></div><div className="mt-10 rounded-lg border border-slate-200 bg-white p-5">{sound.output ? <DirectorMedia kind="audio" className="w-full" controls src={directorMediaUrl(sound.output.fileId)} /> : <MediaPlaceholder icon={AudioLines} label="还没有声音结果" />}</div><div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-5"><div><p className="text-xs font-medium text-slate-700">参考声音</p><p className="mt-1 text-[11px] text-slate-400">{sound.input?.name || "未添加"}</p></div>{sound.input ? <div className="flex items-center gap-2"><DirectorMedia kind="audio" className="h-8 w-56" controls src={directorMediaUrl(sound.input.fileId)} /><button type="button" className="cursor-pointer p-2 text-slate-400 hover:text-rose-600" onClick={() => onRemoveInput(sound.input!.id)}><Trash2 className="size-4" /></button></div> : <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-blue-600"><Upload className="size-3.5" />添加参考<input type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onAddInput(file); }} /></label>}</div>{asset.kind === "character" && sound.sampleText ? <div className="mt-5 border-t border-slate-200 pt-5"><p className="text-xs font-medium text-slate-700">试听文本</p><p className="mt-2 text-sm leading-6 text-slate-600">{sound.sampleText}</p></div> : null}</section><section className="flex min-h-0 flex-col"><div className="flex h-12 items-center justify-between border-b border-slate-200 px-5"><h2 className="text-sm font-semibold text-slate-950">声音提示词</h2><CopyPromptButton value={sound.prompt} /></div><ScrollArea className="min-h-0 flex-1"><pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12px] leading-6 text-slate-700">{sound.prompt || "等待 Agent 完成声音提示词。"}</pre></ScrollArea></section></div>;
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
