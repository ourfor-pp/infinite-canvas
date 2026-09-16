import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useSearchParams } from "react-router-dom";
import { Film, Bot, Image as ImageIcon } from "lucide-react";
import { useAgentStore } from "@/stores/use-agent-store";
import { nanoid } from "nanoid";
import { WorkspaceImagePreviewLightbox, type WorkspaceImagePreviewItem } from "@/components/workspace-image-preview-lightbox";
import { readDirectorQuery, readDirectorShotDesigns } from "@/services/director-queries";
import { directorApi } from "@/services/api/director";
import type { DirectorShotDesign, DirectorState, DirectorVideoSegment, DirectorVideoSegmentPreflight } from "@/types/director";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";

const action = "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
type Props = { projectId: string; state: DirectorState; onRefresh: () => Promise<void> };

const shotImageUrl = (shot?: DirectorShotDesign) => shot?.storyboardImage ? `${directorMediaUrl(shot.storyboardImage.fileId)}${directorMediaUrl(shot.storyboardImage.fileId).includes("?") ? "&" : "?"}hash=${shot.storyboardImage.hash}` : undefined;

export function ProductionWorkspace({ projectId, state, onRefresh }: Props) {
    const { message } = App.useApp();
    const version = useDirectorResourceVersion(projectId, "segments");
    const mediaVersion = useDirectorResourceVersion(projectId, "media");
    const [shots, setShots] = useState<DirectorShotDesign[]>([]);
    const [selection, setSelection] = useState<{ shotId?: string; taskId?: string }>({});
    const [opened, setOpened] = useState<Array<{ key: string; taskId?: string; shotId?: string }>>([]);
    const [search, setSearch] = useSearchParams();
    useEffect(() => {
        let active = true;
        void readDirectorShotDesigns(projectId).then((items) => { if (active) setShots(items); }).catch((error) => { if (active) message.error(error.message); });
        return () => { active = false; };
    }, [projectId, version, mediaVersion, message]);
    const ordered = state.sequences.flatMap((scene) => shots.filter((shot) => shot.sequenceId === scene.id).sort((a, b) => a.order - b.order));
    const explicitTask = state.videoSegments.find((item) => item.id === selection.taskId);
    const shot = ordered.find((item) => item.id === selection.shotId) || (explicitTask ? ordered.find((item) => explicitTask.payload.shotIds?.includes(item.id)) : ordered[0]);
    const linked = state.videoSegments.filter((item) => shot && item.payload.shotIds?.includes(shot.id));
    const selectedTask = explicitTask || (!selection.taskId?.startsWith("new:") ? linked[0] : undefined);
    const activeKey = selectedTask?.id || (shot ? `shot:${shot.id}` : undefined);
    useEffect(() => { if (activeKey) setOpened((items) => items.some((item) => item.key === activeKey) ? items : [...items, { key: activeKey, taskId: selectedTask?.id, shotId: shot?.id }]); }, [activeKey, selectedTask?.id, shot?.id]);
    useEffect(() => { const target = state.videoSegments.find((item) => item.id === search.get("task")); if (target) { setSelection({ taskId: target.id }); const next = new URLSearchParams(search); next.delete("task"); setSearch(next, { replace: true }); } }, [search, setSearch, state.videoSegments]);
    return <section className="flex h-full min-h-0 overflow-hidden bg-white text-slate-800">
        <div aria-label="视频与提示词工作区" className="min-w-0 flex-1 overflow-hidden">
            {opened.map((entry) => <div key={entry.key} hidden={entry.key !== activeKey} className="h-full"><TaskEditor projectId={projectId} state={state} task={state.videoSegments.find((task) => task.id === entry.taskId)} shots={shots} initialShot={entry.shotId} previewShot={entry.key === activeKey ? shot : ordered.find((shot) => shot.id === entry.shotId)} active={entry.key === activeKey} onDone={onRefresh} /></div>)}
            {!activeKey && <div className="grid h-full place-items-center text-sm text-slate-400">暂无镜头，请先完成分镜设计</div>}
        </div>
        <aside aria-label="制作镜头列表" className="w-60 shrink-0 overflow-y-auto border-l border-slate-100 px-3 py-4 max-[800px]:w-44">
            <div className="mb-4 flex items-center gap-2 px-1 text-xs"><span className="font-medium">镜头列表</span><span className="text-slate-400">{shots.length}</span></div>
            {state.sequences.map((scene) => <section key={scene.id} className="mb-5"><h2 className="mb-2 px-1 text-[11px] text-slate-400">{scene.title}</h2><div className="space-y-2">{ordered.filter((item) => item.sequenceId === scene.id).map((item, index) => {
                const task = state.videoSegments.find((task) => task.payload.shotIds?.includes(item.id));
                return <button key={item.id} aria-label={`制作镜头 ${item.name}`} aria-pressed={shot?.id === item.id} className={`w-full rounded-md p-1 text-left hover:bg-slate-50 ${shot?.id === item.id ? "bg-blue-50" : ""}`} onClick={() => setSelection({ shotId: item.id })}>
                    <div className="aspect-video overflow-hidden">{shotImageUrl(item) ? <img alt="" loading="lazy" src={shotImageUrl(item)} className="size-full bg-slate-50 object-contain" /> : <div className="grid size-full place-items-center bg-slate-50 text-slate-300"><ImageIcon size={22} /></div>}</div>
                    <p className={`mt-2 truncate text-xs ${shot?.id === item.id ? "text-blue-600" : "text-slate-600"}`}>{String(index + 1).padStart(2, "0")} {item.name}</p><p className="mt-1 text-[10px] text-slate-400">{task?.payload.videoStale ? "待检查" : task?.payload.videoFileId ? "已有视频" : "待生成"}</p>
                </button>;
            })}</div></section>)}
        </aside>
    </section>;
}
function TaskEditor({ projectId, task, shots, initialShot, previewShot, active, state, onDone }: Omit<Props, "onRefresh"> & { task?: DirectorVideoSegment; shots: DirectorShotDesign[]; initialShot?: string; previewShot?: DirectorShotDesign; active: boolean; onDone: () => Promise<void> }) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const [draft, setDraft] = useState({ id: task?.id || nanoid(), title: task?.title || previewShot?.name || "视频制作", sequenceId: task?.sequenceId || shots.find((shot) => shot.id === initialShot)?.sequenceId || state.sequences[0]?.id || "", seconds: task?.payload.durationSeconds || 8, shotIds: (task?.payload.shotIds as string[] | undefined) || (initialShot ? [initialShot] : []), refs: ((task?.payload.referenceImages as string[] | undefined) || (previewShot?.storyboardImage ? [previewShot.storyboardImage.path] : [])).join("\n"), boundary: task?.payload.boundary || "cut", previous: task?.payload.continuationFromSegmentId || "", intent: task?.payload.generationIntent || "storyboard", transitionFrom: task?.payload.transitionFromSegmentId || "", transitionTo: task?.payload.transitionToSegmentId || "" });
    const [prompt, setPrompt] = useState(String(task?.payload.videoPrompt || ""));
    const [promptHash, setPromptHash] = useState("");
    const [current, setCurrent] = useState(task);
    const [preflight, setPreflight] = useState<DirectorVideoSegmentPreflight>();
    const [busy, setBusy] = useState(false);
    const promptPath = String(task?.payload.promptPath || `productions/${draft.id}/video-prompt.md`);
    const latestBoard = draft.shotIds.length === 1 ? shots.find((shot) => shot.id === draft.shotIds[0])?.storyboardImage : undefined;
    const taskFolder = promptPath.slice(0, promptPath.lastIndexOf("/"));
    const references = [...new Set(draft.refs.split("\n").filter(Boolean).map((path) => latestBoard && path.slice(0, path.lastIndexOf("/")) === taskFolder && /^storyboard\.(png|jpe?g|webp|gif)$/i.test(path.split("/").at(-1) || "") ? latestBoard.path : path))].join("\n");
    const video = useRef<HTMLVideoElement>(null);
    const promptEdited = useRef(false);
    useEffect(() => { if (!active) video.current?.pause(); }, [active]);
    useEffect(() => { let live = true; if (task) void readDirectorQuery(projectId, "segments", ["production-prompt", promptPath, task.revision], () => directorApi.file(projectId, promptPath)).then((file) => { if (live && !promptEdited.current) { setPrompt(file.content); setPromptHash(file.hash); } }).catch((error) => { if (live) message.error(error.message); }); return () => { live = false; }; }, [projectId, promptPath, task?.id, task?.revision]);
    const save = async () => {
        const payload = { shotIds: draft.shotIds, durationSeconds: draft.seconds, referenceImages: references.split("\n").filter(Boolean), boundary: draft.boundary, continuationFromSegmentId: draft.previous || undefined, generationIntent: draft.intent, transitionFromSegmentId: draft.transitionFrom || undefined, transitionToSegmentId: draft.transitionTo || undefined };
        const saved = current ? await directorApi.updateVideoSegment(current.id, { revision: current.revision, title: draft.title, sequenceId: draft.sequenceId, payload }) : await directorApi.createVideoSegment(projectId, { id: draft.id, title: draft.title, sequenceId: draft.sequenceId, payload });
        setCurrent(saved);
        const expectedHash = current ? promptHash : (await directorApi.file(projectId, promptPath)).hash;
        setPromptHash(expectedHash);
        const file = await directorApi.updateMarkdownFile(projectId, promptPath, prompt, expectedHash);
        setPromptHash(file.hash);
        promptEdited.current = false;
        const fresh = await directorApi.state(projectId);
        const updated = fresh.videoSegments.find((item) => item.id === saved.id)!;
        setCurrent(updated);
        setDraft((value) => ({ ...value, refs: references }));
        await onDone();
        return updated;
    };
    const run = async (quality: "preview" | "final") => { setBusy(true); try { const saved = await save(); const checked = await directorApi.videoSegmentPreflight(saved.id); setPreflight(checked); if (!checked.blockedReasons.length) { await directorApi.generateVideoSegment(saved.id, saved.revision, quality); message.success(quality === "preview" ? "预览生成已提交" : "正片生成已提交"); await onDone(); } } catch (error) { message.error(error instanceof Error ? error.message : "生成失败"); } finally { setBusy(false); } };
    const media = task?.payload.videoFileId ? task : current;
    return <section className="flex h-full min-h-0 flex-col">
        <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-slate-100 px-5">
            <span className="mr-auto truncate text-xs font-medium">{previewShot?.name || draft.title}</span>
            <button className={action} disabled={busy || !prompt.trim()} onClick={() => void run("preview")}><Film size={14} />预览生成</button>
            <button className={`${action} text-blue-700`} disabled={busy || !prompt.trim()} onClick={() => void run("final")}><Film size={14} />正片生成</button>
            <button className={action} onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: "shot-design", entityId: initialShot || previewShot?.id || "", title: previewShot?.name || draft.title, subtitle: "镜头" })}><Bot size={14} />交给 Agent 修订</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
            <section aria-label="视频预览" className="px-5 py-4">
                <div className="flex aspect-video max-h-[50vh] items-center justify-center bg-slate-50">{media?.payload.videoFileId ? <video ref={video} controls className="size-full object-contain" src={directorMediaUrl(media.payload.videoFileId)} /> : <div className="flex flex-col items-center gap-3 text-slate-400"><Film size={36} /><p className="text-xs">尚未生成视频</p></div>}</div>
            </section>
            <section aria-label="引用素材" className="border-t border-slate-200 px-5 py-3">
                <h2 className="mb-3 text-xs font-semibold">引用素材</h2>
                <ReferenceImages projectId={projectId} paths={references} />
                {!references.trim() && <p className="mt-2 text-xs text-slate-400">未设置参考图片</p>}
            </section>
            <section aria-label="视频提示词" className="border-t border-slate-200 px-5 py-4"><h2 className="mb-3 text-xs font-semibold">视频提示词</h2><textarea aria-label="最终视频提示词" ref={(element) => { if (element) { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`; } }} className="block min-h-48 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-xs leading-6 text-slate-600 outline-none" value={prompt} onChange={(event) => { promptEdited.current = true; setPrompt(event.target.value); }} /></section>
            {preflight && <div className="mt-4 text-xs leading-6">{preflight.blockedReasons.map((reason) => <p key={reason} className="text-rose-600">{reason}</p>)}{preflight.warnings.map((reason) => <p key={reason} className="text-slate-500">{reason}</p>)}</div>}
        </div>
    </section>;
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
