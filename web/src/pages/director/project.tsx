import { useEffect, useRef, useState, type ComponentProps } from "react";
import { App, Button, ConfigProvider, Progress as AntProgress, Select, Spin, Tag, theme as antdTheme, Tooltip } from "antd";
import {
    AudioLines,
    Bot,
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
    Package,
    Pause,
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
    Users,
    Video,
} from "lucide-react";
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
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "story", label: "故事", icon: FileText },
    { id: "script", label: "剧本", icon: ScrollText },
    { id: "assets", label: "素材", icon: Package },
    { id: "storyboard", label: "分镜", icon: Clapperboard },
    { id: "studio", label: "视频创作台", icon: Scissors },
];

function Progress(props: ComponentProps<typeof AntProgress>) {
    return <AntProgress {...props} strokeColor="#2563eb" trailColor="#e2e8f0" />;
}

export default function DirectorProjectPage() {
    const { id = "", section = "overview" } = useParams();
    const active = sections.some((item) => item.id === section) ? (section as DirectorSection) : "overview";
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
        setAssets(nextAssets);
        setStyles(nextStyles);
    };
    useEffect(() => {
        let active = true;
        openPanel(id);
        Promise.all([loadState(id), serverApi.creativeAssets(id), serverApi.visualStyles(id)])
            .then(([, nextAssets, nextStyles]) => {
                if (!active) return;
                setAssets(nextAssets);
                setStyles(nextStyles);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "导演项目加载失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [id, loadState, message, openPanel]);
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
        window.addEventListener("infinite-canvas:director-updated", update);
        window.addEventListener("infinite-canvas:creative-asset-updated", refreshAssets);
        window.addEventListener("infinite-canvas:visual-style-updated", refreshAssets);
        return () => {
            window.removeEventListener("infinite-canvas:director-updated", update);
            window.removeEventListener("infinite-canvas:creative-asset-updated", refreshAssets);
            window.removeEventListener("infinite-canvas:visual-style-updated", refreshAssets);
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
            <main className="director-light flex h-full min-w-0 bg-white text-slate-950">
                {!agentCollapsed ? <AgentPanel projectId={id} themeMode="light" /> : null}
                <div className="flex min-w-0 flex-1 flex-col bg-white">
                    <header className="flex h-16 shrink-0 items-stretch border-b border-black/10 bg-white px-5">
                        <Tooltip title="返回导演项目库">
                            <button type="button" aria-label="返回导演项目库" className="mr-3 grid w-11 shrink-0 place-items-center text-slate-500 transition hover:bg-blue-50 hover:text-blue-700" onClick={() => navigate("/director")}>
                                <House className="size-[18px]" />
                            </button>
                        </Tooltip>
                        <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="导演台功能">
                            {sections.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => navigate(`/director/${id}/${item.id}`)}
                                        className={`relative flex shrink-0 items-center gap-2 px-3 text-sm transition ${active === item.id ? "text-blue-600 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-blue-600" : "text-slate-500 hover:bg-blue-50 hover:text-blue-700"}`}
                                    >
                                        <Icon className="size-4" />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </nav>
                        <button
                            className="ml-4 flex shrink-0 items-center gap-2 px-3 text-xs text-black/45 hover:bg-black/[.025] hover:text-black/75"
                            onClick={() => {
                                setAgentCollapsed((value) => !value);
                                if (agentCollapsed) openPanel(id);
                            }}
                        >
                            <Bot className="size-4" />
                            {agentCollapsed ? "展开 Agent" : "收起 Agent"}
                        </button>
                    </header>
                    <section className={`min-w-0 flex-1 bg-white ${active === "story" || active === "script" ? "overflow-hidden" : "overflow-auto"}`}>
                        {active === "overview" ? <Overview state={state} assets={assets} styles={styles} onNavigate={(target) => navigate(`/director/${id}/${target}`)} /> : null}
                        {active === "story" || active === "script" ? <Writing projectId={id} kind={active} state={state} onRefresh={refresh} /> : null}
                        {active === "assets" ? <AssetGallery projectId={id} assets={assets} styles={styles} onRefresh={refresh} /> : null}
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
    const stages = [
        Boolean(documents.story?.content.trim()),
        documents.script?.status !== "draft",
        Boolean(styles.find((item) => item.status === "confirmed")),
        assets.length > 0 && confirmedAssets === assets.length,
        state.sequences.length > 0 && state.sequences.every((item) => item.status !== "draft"),
        state.shots.length > 0 && state.shots.every((item) => item.payload.videoFileId),
    ];
    const progress = Math.round((stages.filter(Boolean).length / stages.length) * 100);
    const stageItems = [
        { label: "故事", detail: documents.story?.content.trim() ? "已编写" : "待创作", done: stages[0], target: "story" as const },
        { label: "剧本", detail: statusLabel(documents.script?.status || "未开始"), done: stages[1], target: "script" as const },
        { label: "素材", detail: `${confirmedAssets}/${assets.length}`, done: stages[2] && stages[3], target: "assets" as const },
        { label: "故事板", detail: `${state.sequences.filter((item) => item.status !== "draft").length}/${state.sequences.length}`, done: stages[4], target: "storyboard" as const },
        { label: "镜头视频", detail: `${state.shots.filter((item) => item.payload.videoFileId).length}/${state.shots.length}`, done: stages[5], target: "storyboard" as const },
        { label: "成片", detail: stages[5] ? "可合成" : "待就绪", done: false, target: "studio" as const },
    ];
    const nextStage = stageItems.find((item) => !item.done) || stageItems.at(-1)!;
    return (
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
            <div className="grid gap-px overflow-hidden border border-slate-200 bg-slate-200 md:grid-cols-4">
                {[
                    ["目标时长", `${Math.round(state.workspace.targetDurationSeconds / 60)} 分钟`],
                    ["画幅", state.workspace.aspectRatio],
                    ["来源", state.sources[0]?.name || "对话创作"],
                    ["当前风格", styles.find((item) => item.status === "confirmed")?.name || "待确认"],
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
                <div className="mt-6 grid gap-px overflow-hidden border border-slate-200 bg-slate-200 md:grid-cols-3 xl:grid-cols-6">
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
                        <Notice count={state.sequences.filter((item) => item.status === "draft").length} label="待确认故事板" />
                        <Notice count={state.shots.filter((item) => !item.payload.videoFileId).length} label="缺少视频的镜头" />
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

function Writing({ projectId, kind, state, onRefresh }: { projectId: string; kind: "story" | "script"; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const fileRef = useRef<HTMLInputElement>(null);
    const source = state.sources[0];
    const document = state.documents.find((item) => item.kind === kind)!;
    const [content, setContent] = useState(document.content);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [activeOutline, setActiveOutline] = useState(0);
    const previewRef = useRef<HTMLElement>(null);
    const outlineRef = useRef<HTMLElement>(null);
    useEffect(() => {
        setContent(document.content);
        setEditing(false);
        setActiveOutline(0);
    }, [document.content, kind]);
    const giveAgent = useAgentStore((store) => store.prepareComposer);
    const dirty = content !== document.content;
    const contentLength = content.replace(/\s/g, "").length;
    const sectionCount = (content.match(/^#{1,3}\s/gm) || []).length;
    const outline = content
        .split("\n")
        .map((line) => line.match(/^(#{1,3})\s+(.+)/))
        .filter(Boolean)
        .map((match, index) => ({ id: index + 1, depth: match![1].length, title: match![2] }));
    const previewHeadings = () => Array.from(previewRef.current?.querySelectorAll<HTMLElement>("h1, h2, h3") || []);
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
    const save = async (nextStatus?: DirectorDocument["status"]) => {
        setBusy(true);
        try {
            await directorApi.updateDocument(projectId, kind, { revision: document.revision, content, ...(nextStatus ? { status: nextStatus } : {}) });
            await onRefresh();
            message.success(nextStatus ? `剧本已${statusLabel(nextStatus)}` : "已保存");
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
                    <span className="text-sm font-medium text-slate-700">{kind === "story" ? "故事正文" : "分场剧本"}</span>
                    {kind === "script" ? <StatusPill status={document.status === "locked" ? "confirmed" : document.status} /> : null}
                    <span className="font-mono text-[11px] text-slate-400">REV {document.revision}</span>
                    <span className="hidden text-[11px] text-slate-400 sm:inline">
                        {contentLength.toLocaleString()} 字 · {sectionCount} 节
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
                    {kind === "script" && document.status === "draft" ? (
                        <Button size="small" className="!border-blue-200 !bg-blue-50 !text-blue-700" icon={<Check className="size-4" />} onClick={() => void save("confirmed")}>
                            确认
                        </Button>
                    ) : null}
                </div>
            </div>
            {!editing ? (
                <div data-testid={`director-${kind}-preview`} className={`director-document-preview thin-scrollbar ${kind === "script" ? "director-script-preview" : "director-story-preview"}`}>
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
                                {content}
                            </Streamdown>
                        </div>
                    </article>
                </div>
            ) : (
                <DirectorMarkdownEditor
                    key={`${projectId}:${kind}:${document.revision}`}
                    content={content}
                    dirty={dirty}
                    saving={busy}
                    label={`${kind === "story" ? "故事" : "剧本"} Markdown 编辑器`}
                    placeholder={kind === "story" ? "在这里创作故事" : "按场次写动作、对白与旁白"}
                    onChange={setContent}
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

function AssetGallery({ projectId, assets, styles, onRefresh }: { projectId: string; assets: CreativeAsset[]; styles: VisualStyle[]; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const [busyId, setBusyId] = useState("");
    const [filter, setFilter] = useState<"all" | CreativeAssetKind>("all");
    const visibleAssets = filter === "all" ? assets : assets.filter((item) => item.kind === filter);
    const counts = { all: assets.length, character: assets.filter((item) => item.kind === "character").length, scene: assets.filter((item) => item.kind === "scene").length, prop: assets.filter((item) => item.kind === "prop").length };
    const action = async (asset: CreativeAsset, kind: "regenerate" | "copy" | "confirm" | "lock" | "delete", mediaKind: "image" | "audio" = "image") => {
        setBusyId(asset.id);
        try {
            if (kind === "regenerate") await serverApi.generateCreativeAsset(asset.id, { kind: mediaKind, revision: asset.revision, allowDraftStyle: true });
            if (kind === "copy") await serverApi.createCreativeAsset(projectId, { kind: asset.kind, name: `${asset.name} 副本`, payload: asset.payload });
            if (kind === "confirm" || kind === "lock") await serverApi.updateCreativeAsset(asset.id, { revision: asset.revision, status: kind === "confirm" ? "confirmed" : "locked" });
            if (kind === "delete") await serverApi.deleteCreativeAsset(asset.id);
            await onRefresh();
            message.success(kind === "regenerate" ? "已开始重新生成，将直接替换主结果" : "操作完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setBusyId("");
        }
    };
    return (
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
                <div className="flex min-w-0 flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Sparkles className="size-4 text-blue-600" />
                        <span>当前风格</span>
                        <strong className="truncate font-medium text-slate-900">{styles.find((item) => item.status === "confirmed")?.name || styles[0]?.name || "待确认"}</strong>
                    </div>
                    <span className="hidden h-4 w-px bg-slate-200 sm:block" />
                    <div className="flex" role="group" aria-label="素材分类">
                        {(
                            [
                                ["all", "全部"],
                                ["character", "角色"],
                                ["scene", "场景"],
                                ["prop", "道具"],
                            ] as const
                        ).map(([kind, label]) => (
                            <button
                                key={kind}
                                className={`border-b-2 px-3 py-2 text-sm transition ${filter === kind ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:bg-blue-50 hover:text-blue-700"}`}
                                onClick={() => setFilter(kind)}
                            >
                                {label}
                                <span className="ml-1.5 font-mono text-[10px] text-slate-400">{counts[kind]}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <Button
                    type="text"
                    className="!text-slate-600"
                    icon={<Bot className="size-4" />}
                    onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "script", entityId: "script", title: "拆解创作素材", subtitle: "从剧本整理角色、场景和道具" })}
                >
                    让 Agent 拆解素材
                </Button>
            </div>
            {visibleAssets.length ? (
                <div className="mt-6 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
                    {visibleAssets.map((asset) => (
                        <AssetCard
                            key={asset.id}
                            asset={asset}
                            busy={busyId === asset.id}
                            onAgent={() => prepare(projectId, { kind: "asset", projectId, assetId: asset.id, title: asset.name, subtitle: asset.kind })}
                            onAction={(kind, media) => void action(asset, kind, media)}
                        />
                    ))}
                </div>
            ) : (
                <EmptyPanel
                    icon={filter === "prop" ? Package : Users}
                    title={filter === "all" ? "还没有素材" : `还没有${filter === "character" ? "角色" : filter === "scene" ? "场景" : "道具"}`}
                    description="和 Agent 对话，让它从已确认剧本中提出候选清单。"
                />
            )}
        </div>
    );
}

function AssetCard({ asset, busy, onAgent, onAction }: { asset: CreativeAsset; busy: boolean; onAgent: () => void; onAction: (kind: "regenerate" | "copy" | "confirm" | "lock" | "delete", media?: "image" | "audio") => void }) {
    const primaryImage = asset.payload.variants.find((item) => item.id === asset.payload.primaryImageId) || asset.payload.variants.find((item) => item.kind === "image");
    const primaryAudio = asset.payload.variants.find((item) => item.id === asset.payload.primaryAudioId) || asset.payload.variants.find((item) => item.kind === "audio");
    return (
        <article className="group overflow-hidden border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-[0_12px_30px_rgba(15,23,42,.06)]">
            <div className="relative aspect-[16/10] bg-slate-50">
                {primaryImage ? (
                    <img src={serverApiUrl(`/files/${primaryImage.fileId}/content`)} className="size-full object-cover" />
                ) : (
                    <div className="grid size-full place-items-center text-slate-300">
                        <ImageIcon className="size-9" />
                    </div>
                )}
                <div className="absolute left-3 top-3 bg-slate-950/75 px-2 py-1 text-[10px] tracking-widest text-white">{asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}</div>
                <div className="absolute right-3 top-3 bg-white/95 px-2 py-1 shadow-sm">
                    <StatusPill status={asset.status} />
                </div>
            </div>
            <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="truncate font-serif text-xl text-slate-950">{asset.name}</h2>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{asset.payload.description || "等待设定"}</p>
                    </div>
                </div>
                {primaryAudio ? (
                    <audio className="mt-4 h-8 w-full" controls src={serverApiUrl(`/files/${primaryAudio.fileId}/content`)} />
                ) : (
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                        <AudioLines className="size-3.5" />
                        {asset.kind === "character" ? "声线待生成" : asset.kind === "scene" ? "氛围声待生成" : "动作音效待生成"}
                    </div>
                )}
                <div className="mt-5 flex flex-wrap items-center border-t border-slate-200 pt-2">
                    <FlatAction icon={Bot} label="Agent" onClick={onAgent} />
                    <FlatAction icon={RefreshCw} label="抽图" loading={busy} onClick={() => onAction("regenerate", "image")} />
                    <FlatAction icon={AudioLines} label="抽声音" loading={busy} onClick={() => onAction("regenerate", "audio")} />
                    <FlatAction icon={Copy} label="复制" onClick={() => onAction("copy")} />
                    {asset.status === "draft" ? <FlatAction icon={Check} label="确认" onClick={() => onAction("confirm")} /> : asset.status === "confirmed" ? <FlatAction icon={Lock} label="锁定" onClick={() => onAction("lock")} /> : null}
                    <FlatAction icon={Trash2} label="删除" danger onClick={() => onAction("delete")} />
                </div>
            </div>
        </article>
    );
}

function FlatAction({ icon: Icon, label, loading, danger, onClick }: { icon: typeof Film; label: string; loading?: boolean; danger?: boolean; onClick: () => void }) {
    return (
        <button disabled={loading} className={`flex items-center gap-1.5 px-2 py-2 text-xs transition ${danger ? "text-rose-400 hover:bg-rose-50 hover:text-rose-600" : "text-slate-500 hover:bg-blue-50 hover:text-blue-700"}`} onClick={onClick}>
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
            {label}
        </button>
    );
}

function Storyboard({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const [view, setView] = useState<"boards" | "shots">("boards");
    const [busy, setBusy] = useState("");
    const createSequence = async () => {
        try {
            await directorApi.createSequence(projectId, {
                title: `剧情段落 ${state.sequences.length + 1}`,
                summary: "待 Agent 根据剧本补充分镜节奏",
                payload: { storyboard: Array.from({ length: 6 }, (_, position) => ({ id: nanoid(), position, title: `镜头 ${position + 1}`, description: "待规划", durationSeconds: 4 })) },
            });
            await onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "请先确认剧本");
        }
    };
    const updateSequence = async (sequence: DirectorSequence, patch: Record<string, unknown>) => {
        setBusy(sequence.id);
        try {
            await directorApi.updateSequence(sequence.id, { revision: sequence.revision, ...patch });
            await onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新失败");
        } finally {
            setBusy("");
        }
    };
    const extract = async (sequence: DirectorSequence) => {
        setBusy(sequence.id);
        try {
            for (const panel of sequence.payload.storyboard || [])
                await directorApi.createShot(projectId, {
                    sequenceId: sequence.id,
                    position: panel.position,
                    title: panel.title || `镜头 ${panel.position + 1}`,
                    payload: { description: panel.description, durationSeconds: panel.durationSeconds, firstFrameFileId: panel.imageFileId, boundary: "cut" },
                });
            await onRefresh();
            setView("shots");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "请先确认故事板");
        } finally {
            setBusy("");
        }
    };
    return (
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div className="flex items-center gap-5 text-sm">
                    <button className={`px-4 py-2 ${view === "boards" ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-500 hover:text-blue-700"}`} onClick={() => setView("boards")}>
                        故事板 <span className="ml-1 font-mono text-[10px] text-slate-400">{state.sequences.length}</span>
                    </button>
                    <button className={`px-4 py-2 ${view === "shots" ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-500 hover:text-blue-700"}`} onClick={() => setView("shots")}>
                        镜头列表 <span className="ml-1 font-mono text-[10px] text-slate-400">{state.shots.length}</span>
                    </button>
                </div>
                {view === "boards" ? (
                    <Button type="text" className="!text-slate-600" icon={<Plus className="size-4" />} onClick={() => void createSequence()}>
                        新建剧情段落
                    </Button>
                ) : null}
            </div>
            {view === "boards" ? (
                <div className="mt-6 space-y-7">
                    {state.sequences.map((sequence) => (
                        <SequenceBoard
                            key={sequence.id}
                            sequence={sequence}
                            busy={busy === sequence.id}
                            onAgent={() => prepare(projectId, { kind: "director", projectId, entityKind: "sequence", entityId: sequence.id, title: sequence.title, subtitle: "剧情段落故事板" })}
                            onConfirm={() => void updateSequence(sequence, { status: "confirmed" })}
                            onExtract={() => void extract(sequence)}
                            onReorder={(storyboard) => void updateSequence(sequence, { payload: { ...sequence.payload, storyboard } })}
                        />
                    ))}
                    {state.sequences.length ? (
                        <Button className="!h-12 w-full !border-dashed !border-slate-300 !bg-transparent !text-slate-500" icon={<Plus className="size-4" />} onClick={() => void createSequence()}>
                            新建剧情段落
                        </Button>
                    ) : (
                        <EmptyPanel icon={Clapperboard} title="还没有故事板" description="让 Agent 根据已确认剧本规划第一个剧情段落。" />
                    )}
                </div>
            ) : (
                <ShotList projectId={projectId} shots={state.shots} sequences={state.sequences} onRefresh={onRefresh} />
            )}
        </div>
    );
}

function SequenceBoard({
    sequence,
    busy,
    onAgent,
    onConfirm,
    onExtract,
    onReorder,
}: {
    sequence: DirectorSequence;
    busy: boolean;
    onAgent: () => void;
    onConfirm: () => void;
    onExtract: () => void;
    onReorder: (panels: DirectorStoryboardPanel[]) => void;
}) {
    const panels = sequence.payload.storyboard || [];
    const move = (index: number, direction: number) => {
        const next = [...panels];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onReorder(next.map((item, position) => ({ ...item, position })));
    };
    return (
        <article data-testid="director-storyboard-card" className="overflow-hidden border border-slate-300 bg-white [contain-intrinsic-size:auto_640px] [content-visibility:auto]">
            <header className="flex flex-wrap items-center justify-between gap-5 px-6 py-5">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-sm text-blue-600">SEQ {String(sequence.position + 1).padStart(2, "0")}</span>
                        <h2 className="font-serif text-2xl text-slate-950">{sequence.title}</h2>
                        <StatusPill status={sequence.status} />
                        {sequence.payload.needsReview ? <Tag color="error">需要检查</Tag> : null}
                    </div>
                    <p className="mt-2 truncate text-xs text-slate-500">{sequence.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <LayoutDashboard className="size-3.5" />
                        {panels.length} 格
                    </span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock3 className="size-3.5" />
                        {panels.reduce((sum, panel) => sum + (panel.durationSeconds || 4), 0)} 秒
                    </span>
                    <FlatAction icon={Bot} label="交给 Agent" onClick={onAgent} />
                    {sequence.status === "draft" ? <FlatAction icon={Check} label="确认故事板" loading={busy} onClick={onConfirm} /> : <FlatAction icon={Scissors} label="拆为镜头" loading={busy} onClick={onExtract} />}
                </div>
            </header>
            <div data-testid="director-storyboard-grid" className="grid gap-px border-t border-slate-300 bg-slate-300 sm:grid-cols-2 xl:grid-cols-3">
                {panels.map((panel, index) => (
                    <div key={panel.id} className="group relative aspect-video overflow-hidden bg-slate-100">
                        <div className="absolute inset-0">
                            {panel.imageFileId ? (
                                <img src={serverApiUrl(`/files/${panel.imageFileId}/content`)} className="size-full object-cover" />
                            ) : (
                                <div className="grid size-full place-items-center bg-slate-100 text-slate-400">
                                    <ImageIcon className="size-8" />
                                </div>
                            )}
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-slate-950/75 px-4 py-3 text-white">
                            <div className="flex items-baseline gap-2">
                                <span className="font-mono text-base">{String(index + 1).padStart(2, "0")}</span>
                                <span className="font-mono text-xs text-white/80">{panel.durationSeconds || 4}s</span>
                                <strong className="truncate text-sm">{panel.title || `镜头 ${index + 1}`}</strong>
                            </div>
                            <p className="mt-1 truncate text-xs text-white/75">{panel.description || "待规划画面与动作"}</p>
                        </div>
                        <div className="absolute right-2 top-2 flex overflow-hidden bg-slate-950/80 text-white opacity-0 transition group-hover:opacity-100">
                            <button aria-label={`重新设计${panel.title || `镜头 ${index + 1}`}`} className="flex items-center gap-1 px-2 py-1.5 text-[11px] hover:bg-white/15" onClick={onAgent}>
                                <RefreshCw className="size-3" />
                                重抽
                            </button>
                            <button aria-label={`前移${panel.title || `镜头 ${index + 1}`}`} className="px-2 py-1.5 text-[11px] hover:bg-white/15" onClick={() => move(index, -1)}>
                                ← 前移
                            </button>
                            <button aria-label={`后移${panel.title || `镜头 ${index + 1}`}`} className="px-2 py-1.5 text-[11px] hover:bg-white/15" onClick={() => move(index, 1)}>
                                后移 →
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </article>
    );
}

function ShotList({ projectId, shots, sequences, onRefresh }: { projectId: string; shots: DirectorShot[]; sequences: DirectorSequence[]; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const update = async (shot: DirectorShot, patch: Record<string, unknown>) => {
        try {
            await directorApi.updateShot(shot.id, { revision: shot.revision, ...patch });
            await onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "镜头更新失败");
        }
    };
    const regenerate = async (shot: DirectorShot) => {
        try {
            await directorApi.generateShot(shot.id, shot.revision);
            message.success("镜头视频已进入生成队列，将直接替换当前结果");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "镜头生成失败");
        }
    };
    return shots.length ? (
        <div className="mt-7 space-y-4">
            {shots.map((shot) => (
                <article key={shot.id} className="grid overflow-hidden border border-slate-200 bg-white md:grid-cols-[280px_1fr]">
                    <div className="aspect-video bg-slate-50 md:aspect-auto">
                        {shot.payload.firstFrameFileId ? (
                            <img className="size-full object-cover" src={serverApiUrl(`/files/${shot.payload.firstFrameFileId}/content`)} />
                        ) : (
                            <div className="grid size-full place-items-center text-slate-300">
                                <Video className="size-8" />
                            </div>
                        )}
                    </div>
                    <div className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] tracking-wider text-blue-600">
                                    {sequences.find((item) => item.id === shot.sequenceId)?.title} · SHOT {shot.position + 1}
                                </div>
                                <h2 className="mt-2 font-serif text-xl text-slate-950">{shot.title}</h2>
                            </div>
                            <div className="flex">
                                <FlatAction icon={Bot} label="Agent" onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "shot", entityId: shot.id, title: shot.title, subtitle: "独立镜头" })} />
                                <FlatAction icon={RefreshCw} label="重新生成" onClick={() => void regenerate(shot)} />
                                {shot.status === "draft" ? <FlatAction icon={Check} label="确认" onClick={() => void update(shot, { status: "confirmed" })} /> : null}
                            </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-500">{shot.payload.description || "等待补充画面描述"}</p>
                        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500">
                            {[shot.payload.shotSize, shot.payload.cameraAngle, shot.payload.cameraMove, `${shot.payload.durationSeconds || 4}s`].filter(Boolean).map((item) => (
                                <span key={String(item)} className="border border-slate-200 px-2 py-1">
                                    {String(item)}
                                </span>
                            ))}
                            <Select
                                size="small"
                                variant="borderless"
                                value={shot.payload.boundary || "cut"}
                                popupClassName="director-select"
                                className="!text-xs"
                                options={[
                                    { value: "cut", label: "CUT 普通切镜" },
                                    { value: "continue", label: "CONTINUE 连续续写" },
                                ]}
                                onChange={(boundary) => void update(shot, { payload: { ...shot.payload, boundary } })}
                            />
                        </div>
                    </div>
                </article>
            ))}
        </div>
    ) : (
        <EmptyPanel icon={Clapperboard} title="还没有独立镜头" description="先确认故事板，再拆分成镜头。" />
    );
}

function Studio({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const order = state.timeline.payload.shotOrder?.length ? state.timeline.payload.shotOrder : state.shots.map((item) => item.id);
    const shots = order.map((id) => state.shots.find((item) => item.id === id)).filter(Boolean) as DirectorShot[];
    const [playing, setPlaying] = useState(false);
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
            await directorApi.updateTimeline(projectId, { revision: state.timeline.revision, payload: { ...state.timeline.payload, shotOrder: next } });
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
    const render = async () => {
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
    const totalDuration = shots.reduce((sum, shot) => sum + (shot.payload.durationSeconds || 4), 0);
    return (
        <div className="flex min-h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 lg:px-8">
                <div className="flex flex-wrap items-center gap-5 text-sm text-slate-600">
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                        <ListVideo className="size-4" />
                        时间线
                    </span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span>{shots.length} 个镜头</span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span className="flex items-center gap-1.5">
                        <Clock3 className="size-4" />
                        总时长 {formatTime(totalDuration)}
                    </span>
                    {missingVideos ? <span className="text-orange-600">缺少视频 {missingVideos} 个镜头</span> : <span className="text-emerald-600">视频已就绪</span>}
                </div>
                <div className="flex gap-2">
                    <Button
                        type="text"
                        className="!text-slate-600"
                        icon={<Bot className="size-4" />}
                        onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "timeline", entityId: "timeline", title: "时间线", subtitle: "镜头与声音编排" })}
                    >
                        交给 Agent 铺轨
                    </Button>
                    <Tooltip title={missingVideos ? `仍有 ${missingVideos} 个镜头缺少视频` : "导出 H.264/AAC MP4"}>
                        <Button disabled={Boolean(missingVideos)} loading={rendering} className="!border-blue-600 !bg-blue-600 !text-white" icon={<Film className="size-4" />} onClick={() => void render()}>
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
            <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
                <div className="flex h-16 items-center gap-2 border-b border-slate-200 bg-white px-5">
                    <button aria-label="跳到开始" className="grid size-8 place-items-center text-slate-500 hover:bg-blue-50 hover:text-blue-700">
                        <SkipBack className="size-4" />
                    </button>
                    <button aria-label={playing ? "暂停" : "播放"} className="grid size-10 place-items-center rounded-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => setPlaying((value) => !value)}>
                        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </button>
                    <button aria-label="跳到结尾" className="grid size-8 place-items-center text-slate-500 hover:bg-blue-50 hover:text-blue-700">
                        <SkipForward className="size-4" />
                    </button>
                    <span className="ml-3 font-mono text-xs text-slate-600">00:00:00:00 / {formatTime(totalDuration)}</span>
                    <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                        <span className="border border-slate-200 px-3 py-1.5">1080p</span>
                        <span className="border border-slate-200 px-3 py-1.5">24 fps</span>
                        <span className="border border-slate-200 px-3 py-1.5">{state.workspace.aspectRatio}</span>
                    </div>
                </div>
                <div className="min-h-64 overflow-x-auto bg-white pb-5">
                    <div className="relative min-w-[1000px]">
                        <div className="flex h-10 border-b border-slate-200 pl-32">
                            {Array.from({ length: Math.max(7, Math.ceil(totalDuration / 10) + 1) }, (_, index) => (
                                <div key={index} className="w-40 shrink-0 border-l border-slate-200 pl-1 pt-3 font-mono text-[9px] text-slate-400">
                                    {formatTime(index * 10)}
                                </div>
                            ))}
                        </div>
                        <div data-testid="director-playhead" className="pointer-events-none absolute bottom-0 left-[calc(8rem+32%)] top-0 z-20 w-px bg-blue-600">
                            <span className="absolute -left-1.5 top-0 h-0 w-0 border-x-[6px] border-t-[9px] border-x-transparent border-t-blue-600" />
                        </div>
                        <div className="flex min-h-40 border-b border-slate-200">
                            <TrackLabel icon={Video} label="镜头轨道" />
                            <div className="flex min-w-max flex-1 items-start gap-1 bg-slate-50 p-3">
                                {shots.map((shot, index) => (
                                    <div
                                        key={shot.id}
                                        draggable
                                        onDragStart={() => setDragged(shot.id)}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={() => drop(shot.id)}
                                        className={`relative w-48 shrink-0 cursor-grab border ${shot.payload.videoStale ? "border-orange-400" : "border-slate-300"} bg-white`}
                                    >
                                        <div className="relative aspect-video bg-slate-100">
                                            {shot.payload.videoFileId ? (
                                                <video muted src={serverApiUrl(`/files/${shot.payload.videoFileId}/content`)} className="size-full object-cover" />
                                            ) : shot.payload.firstFrameFileId ? (
                                                <img src={serverApiUrl(`/files/${shot.payload.firstFrameFileId}/content`)} className="size-full object-cover opacity-60" />
                                            ) : (
                                                <div className="grid size-full place-items-center">
                                                    <Video className="size-6 text-slate-300" />
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
                            {(["dialogue", "narration", "ambient", "sfx", "music"] as const).map((kind) => {
                                const track = state.timeline.payload.tracks?.find((item) => item.kind === kind);
                                return (
                                    <div key={kind} className="flex h-16 border-b border-slate-200">
                                        <TrackLabel icon={AudioLines} label={{ dialogue: "对白", narration: "旁白", ambient: "环境声", sfx: "道具音效", music: "音乐" }[kind]} />
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
        <div className="flex w-32 shrink-0 items-center justify-between border-r border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
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
