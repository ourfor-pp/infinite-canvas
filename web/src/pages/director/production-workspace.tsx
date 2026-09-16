import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useSearchParams } from "react-router-dom";
import { Film, Bot } from "lucide-react";
import { useAgentStore } from "@/stores/use-agent-store";
import { WorkspaceImagePreviewLightbox, type WorkspaceImagePreviewItem } from "@/components/workspace-image-preview-lightbox";
import { readDirectorQuery, readDirectorSegmentPlans } from "@/services/director-queries";
import { directorApi } from "@/services/api/director";
import type { DirectorSegmentPlan, DirectorState, DirectorVideoSegment, DirectorVideoSegmentPreflight } from "@/types/director";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";

const action = "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
type Props = { projectId: string; state: DirectorState; onRefresh: () => Promise<void> };
export function ProductionWorkspace({ projectId, state, onRefresh }: Props) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const version = useDirectorResourceVersion(projectId, "segments");
    const [segments, setSegments] = useState<DirectorSegmentPlan[]>([]);
    const [selected, setSelected] = useState("");
    const [activeTask, setActiveTask] = useState("");
    const [search, setSearch] = useSearchParams();
    useEffect(() => { let live = true; void readDirectorSegmentPlans(projectId).then((items) => { if (live) setSegments(items); }).catch((error) => { if (live) message.error(error.message); }); return () => { live = false; }; }, [projectId, version, message]);
    useEffect(() => {
        const target = state.videoSegments.find((task) => task.id === search.get("task"));
        if (target) { setSelected(target.payload.segmentRanges?.[0]?.segmentId || ""); setActiveTask(target.id); const next = new URLSearchParams(search); next.delete("task"); setSearch(next, { replace: true }); }
    }, [search, setSearch, state.videoSegments]);
    const ordered = state.sequences.flatMap((scene) => segments.filter((segment) => segment.sequenceId === scene.id).sort((a, b) => a.order - b.order));
    const segment = ordered.find((item) => item.id === selected) || ordered[0];
    const linked = state.videoSegments.filter((task) => task.payload.segmentRanges?.some((range) => range.segmentId === segment?.id)).sort((a, b) => (a.payload.segmentRanges?.find((r) => r.segmentId === segment?.id)?.start || 0) - (b.payload.segmentRanges?.find((r) => r.segmentId === segment?.id)?.start || 0));
    const taskId = linked.some((task) => task.id === activeTask) ? activeTask : linked[0]?.id;
    const runners = useRef(new Map<string, (quality: "preview" | "final") => Promise<void>>());
    const [busy, setBusy] = useState(false);
    const run = async (quality: "preview" | "final") => { const runner = runners.current.get(taskId || ""); if (!runner) return; setBusy(true); try { await runner(quality); } finally { setBusy(false); } };
    return <section className="flex h-full min-h-0 overflow-hidden bg-white text-slate-800">
        <div aria-label="视频与提示词工作区" className="flex min-w-0 flex-1 flex-col">
            <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-slate-100 px-5">
                <span className="mr-auto truncate text-xs font-medium">{segment?.name || "视频制作"}</span>
                <button className={action} disabled={busy || !taskId} onClick={() => void run("preview")}><Film size={14} />预览生成</button>
                <button className={`${action} text-blue-700`} disabled={busy || !taskId} onClick={() => void run("final")}><Film size={14} />正片生成</button>
                <button className={action} disabled={!segment} onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "segment-design", entityId: segment.id, title: segment.name, subtitle: "分镜段" })}><Bot size={14} />交给 Agent 修订</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {!segment && <p className="p-8 text-sm text-slate-400">暂无分镜段，请先完成分镜设计</p>}
                {segment && !linked.length && <p className="p-8 text-sm text-slate-400">当前分镜段尚未安排制作，请交给 Agent 按生成时长划分任务。</p>}
                {[...linked, ...state.videoSegments.filter((task) => !linked.includes(task))].map((task) => <TaskEditor key={task.id} projectId={projectId} task={task} visible={linked.some((item) => item.id === task.id)} selected={task.id === taskId} onSelect={() => setActiveTask(task.id)} onRefresh={onRefresh} register={(runner) => { if (runner) runners.current.set(task.id, runner); else runners.current.delete(task.id); }} />)}
            </div>
        </div>
        <aside aria-label="制作分镜段列表" className="w-60 shrink-0 overflow-y-auto border-l border-slate-100 px-3 py-4 max-[800px]:w-44">
            <p className="mb-4 px-1 text-xs font-medium">分镜段 · {segments.length}</p>
            {state.sequences.map((scene) => <section key={scene.id} className="mb-5"><h2 className="mb-2 px-1 text-[11px] text-slate-400">{scene.title}</h2>{ordered.filter((item) => item.sequenceId === scene.id).map((item) => {
                const tasks = state.videoSegments.filter((task) => task.payload.segmentRanges?.some((range) => range.segmentId === item.id));
                return <button key={item.id} aria-label={`制作分镜段 ${item.name}`} aria-pressed={segment?.id === item.id} className={`mb-1 w-full rounded-md p-3 text-left hover:bg-slate-50 ${segment?.id === item.id ? "bg-blue-50 text-blue-700" : "text-slate-600"}`} onClick={() => setSelected(item.id)}><p className="truncate text-xs">{item.name}</p><p className="mt-2 text-[10px] text-slate-400">{tasks.filter((task) => task.payload.videoFileId).length}/{tasks.length} 段视频{tasks.some((task) => task.payload.videoStale) ? " · 待检查" : ""}</p></button>;
            })}</section>)}
        </aside>
    </section>;
}

function TaskEditor({ projectId, task, visible, selected, onSelect, onRefresh, register }: { projectId: string; task: DirectorVideoSegment; visible: boolean; selected: boolean; onSelect: () => void; onRefresh: () => Promise<void>; register: (runner?: (quality: "preview" | "final") => Promise<void>) => void }) {
    const { message } = App.useApp();
    const [prompt, setPrompt] = useState(String(task.payload.videoPrompt || ""));
    const [hash, setHash] = useState("");
    const [preflight, setPreflight] = useState<DirectorVideoSegmentPreflight>();
    const edited = useRef(false), video = useRef<HTMLVideoElement>(null);
    const promptPath = String(task.payload.promptPath || `productions/${task.id}/video-prompt.md`);
    useEffect(() => { if (!visible) video.current?.pause(); }, [visible]);
    useEffect(() => { let live = true; if (visible) void readDirectorQuery(projectId, "segments", ["production-prompt", promptPath, task.revision], () => directorApi.file(projectId, promptPath)).then((file) => { if (live && !edited.current) { setPrompt(file.content); setHash(file.hash); } }).catch((error) => { if (live) message.error(error.message); }); return () => { live = false; }; }, [projectId, promptPath, task.revision, visible, message]);
    useEffect(() => {
        register(async (quality) => {
            try {
                if (!prompt.trim()) throw new Error("请先填写视频提示词");
                if (edited.current) { const saved = await directorApi.updateMarkdownFile(projectId, promptPath, prompt, hash); setHash(saved.hash); edited.current = false; }
                const fresh = await directorApi.state(projectId);
                const current = fresh.videoSegments.find((item) => item.id === task.id);
                if (!current) throw new Error("制作任务已不存在");
                const checked = await directorApi.videoSegmentPreflight(task.id); setPreflight(checked);
                if (checked.blockedReasons.length) return;
                await directorApi.generateVideoSegment(task.id, current.revision, quality);
                message.success(quality === "preview" ? "预览生成已提交" : "正片生成已提交"); await onRefresh();
            } catch (error) { message.error(error instanceof Error ? error.message : "生成失败"); }
        });
        return () => register();
    }, [register, projectId, task.id, promptPath, prompt, hash, onRefresh, message]);
    const snapshot = task.payload.videoFileId ? task.payload.videoInputSnapshot : task.payload.h3PromptSnapshot;
    return <article hidden={!visible} aria-label={`制作任务 ${task.title}`} className="border-b border-slate-100 px-5 py-4" onFocus={onSelect}>
        <button className={`mb-3 flex w-full items-center gap-2 text-left text-xs ${selected ? "text-blue-700" : "text-slate-500"}`} aria-pressed={selected} onClick={onSelect}><Film size={14} />{task.title}<span className="ml-auto text-[10px]">{task.payload.segmentRanges?.map((range) => `${range.start}–${range.end} 秒`).join(" / ")}{selected ? " · 当前生成目标" : ""}</span></button>
        <section aria-label="视频预览" className="flex aspect-video max-h-[50vh] items-center justify-center bg-slate-50">{task.payload.videoFileId ? <video ref={video} controls className="size-full object-contain" src={directorMediaUrl(task.payload.videoFileId)} /> : <p className="text-xs text-slate-400">尚未生成视频</p>}</section>
        {task.payload.videoStale && <p className="mt-2 text-xs text-amber-700">来源已变化，当前视频待检查</p>}
        <p className="my-3 text-[11px] text-slate-400">覆盖时间是制作计划；实际切镜以生成视频为准。生成结果不会自动加入剪辑。</p>
        {snapshot && <details className="mb-4 text-xs"><summary className="cursor-pointer py-2 text-slate-600">{task.payload.videoFileId ? "当前视频实际提交的输入" : "最近提交的输入"}</summary><div className="flex gap-3 overflow-x-auto py-3">{snapshot.references.map((ref, index) => <div key={`${ref.fileId}:${index}`} className="w-40 shrink-0"><p className="mb-2 truncate text-[11px]">{ref.label || `参考 ${index + 1}`}</p>{ref.kind === "video" ? <video controls preload="metadata" src={directorMediaUrl(ref.fileId)} className="h-24 w-full object-contain" /> : ref.kind === "audio" ? <audio controls src={directorMediaUrl(ref.fileId)} className="w-full" /> : <img alt={ref.label || "参考图片"} src={directorMediaUrl(ref.fileId)} className="h-24 w-full object-contain" />}</div>)}</div><p className="whitespace-pre-wrap leading-6 text-slate-500">{snapshot.prompt}</p></details>}
        <section aria-label="引用素材" className="border-t border-slate-100 py-3"><h2 className="mb-3 text-xs font-semibold">下次生成引用</h2><ReferenceImages projectId={projectId} paths={((task.payload.referenceImages as string[]) || []).join("\n")} /><ReferenceVideos projectId={projectId} references={task.payload.videoReferences || []} /></section>
        <section aria-label="视频提示词" className="border-t border-slate-100 py-3"><h2 className="mb-3 text-xs font-semibold">视频提示词</h2><textarea aria-label={`最终视频提示词 ${task.title}`} ref={(element) => { if (element) { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`; } }} className="block min-h-32 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-xs leading-6 text-slate-600 outline-none" value={prompt} onChange={(event) => { edited.current = true; setPrompt(event.target.value); }} /></section>
        {preflight && <div className="text-xs leading-6">{preflight.blockedReasons.map((reason) => <p key={reason} className="text-rose-600">{reason}</p>)}{preflight.warnings.map((reason) => <p key={reason} className="text-slate-500">{reason}</p>)}</div>}
    </article>;
}

function ReferenceVideos({ projectId, references }: { projectId: string; references: NonNullable<DirectorVideoSegment["payload"]["videoReferences"]> }) {
    const [items, setItems] = useState<Array<{ path: string; purpose: string; fileId?: string }>>([]);
    const version = useDirectorResourceVersion(projectId, "media");
    const key = JSON.stringify(references);
    useEffect(() => { let live = true; void Promise.all(references.map(async (ref) => { try { return { ...ref, ...(await directorApi.referenceVideo(projectId, ref.path)) }; } catch { return ref; } })).then((result) => { if (live) setItems(result); }); return () => { live = false; }; }, [projectId, key, version]);
    return <div className="flex gap-4 overflow-x-auto">{items.map((item) => <div key={item.path} title={item.path} className="w-48 shrink-0"><p className="my-2 text-[11px] text-slate-500">{item.purpose}</p>{item.fileId ? <video controls preload="metadata" src={directorMediaUrl(item.fileId)} className="aspect-video w-full" /> : <p className="text-xs text-rose-600">参考视频不可用</p>}</div>)}</div>;
}

function ReferenceImages({ projectId, paths }: { projectId: string; paths: string }) {
    const [preview, setPreview] = useState<WorkspaceImagePreviewItem[]>([]);
    const assetsVersion = useDirectorResourceVersion(projectId, "assets");
    const segmentsVersion = useDirectorResourceVersion(projectId, "segments");
    const [result, setResult] = useState<{ paths: string; images: Array<{ path: string; fileId?: string; name?: string }> }>({ paths: "", images: [] });
    const images = result.paths === paths ? result.images : [];
    useEffect(() => {
        let active = true;
        void Promise.all(paths.split("\n").map((path) => path.trim()).filter(Boolean).map(async (path) => {
            try { return { path, ...(await readDirectorQuery(projectId, "assets", ["reference-image", path], () => directorApi.referenceImage(projectId, path))) }; } catch { return { path }; }
        })).then((value) => { if (active) setResult({ paths, images: value }); });
        return () => { active = false; };
    }, [projectId, paths, assetsVersion, segmentsVersion]);
    return <><div className="flex gap-4 overflow-x-auto pb-2">{images.map(({ path, fileId, name }, index) => <div key={`${path}:${index}`} className="w-28 shrink-0 text-[11px] text-slate-500" title={path}>{fileId ? <button className="w-full cursor-zoom-in" onClick={() => setPreview([{ id: fileId, url: directorMediaUrl(fileId), alt: name || "参考图片" }])}><img src={directorMediaUrl(fileId)} alt={name || path} className="mb-1 h-16 w-full object-contain" /></button> : <p className="py-3 text-rose-600">图片不可用</p>}<p className="truncate">{name || "参考图片"}</p></div>)}</div><WorkspaceImagePreviewLightbox items={preview} activeIndex={preview.length ? 0 : null} onClose={() => setPreview([])} onChangeIndex={() => {}} /></>;
}
