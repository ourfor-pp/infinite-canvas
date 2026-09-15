import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useSearchParams } from "react-router-dom";
import { Plus, Film, Bot, Image as ImageIcon } from "lucide-react";
import { useAgentStore } from "@/stores/use-agent-store";
import { nanoid } from "nanoid";
import { readDirectorQuery, readDirectorShotDesigns } from "@/services/director-queries";
import { directorApi } from "@/services/api/director";
import type { DirectorShotDesign, DirectorState, DirectorVideoSegment, DirectorVideoSegmentPreflight } from "@/types/director";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";

const field = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500";
const action = "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
type Props = { projectId: string; state: DirectorState; onRefresh: () => Promise<void> };

const shotImageUrl = (shot?: DirectorShotDesign) => shot?.storyboardImage ? `${directorMediaUrl(shot.storyboardImage.fileId)}${directorMediaUrl(shot.storyboardImage.fileId).includes("?") ? "&" : "?"}hash=${shot.storyboardImage.hash}` : undefined;

export function ProductionWorkspace({ projectId, state, onRefresh }: Props) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
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
    const activeKey = selection.taskId?.startsWith("new:") ? selection.taskId : selectedTask?.id;
    useEffect(() => { if (activeKey) setOpened((items) => items.some((item) => item.key === activeKey) ? items : [...items, { key: activeKey, taskId: selectedTask?.id, shotId: shot?.id }]); }, [activeKey, selectedTask?.id, shot?.id]);
    useEffect(() => { const target = state.videoSegments.find((item) => item.id === search.get("task")); if (target) { setSelection({ taskId: target.id }); const next = new URLSearchParams(search); next.delete("task"); setSearch(next, { replace: true }); } }, [search, setSearch, state.videoSegments]);
    const create = async () => { try { if (!state.sequences.length) { await directorApi.createSequence(projectId, { title: "场景 1" }); await onRefresh(); } setSelection({ shotId: shot?.id, taskId: `new:${nanoid()}` }); } catch (error) { message.error(error instanceof Error ? error.message : "创建失败"); } };
    const unlinked = state.videoSegments.filter((task) => !ordered.some((shot) => task.payload.shotIds?.includes(shot.id)));
    return <section className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-slate-800">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-100 px-5"><span className="min-w-0 truncate text-xs font-medium">{shot?.name || selectedTask?.title || "视频制作"}</span>{linked.length > 0 && <select aria-label="当前制作任务" className="max-w-64 bg-transparent px-2 py-1 text-xs text-slate-500 outline-none" value={selectedTask?.id || ""} onChange={(event) => setSelection({ shotId: shot?.id, taskId: event.target.value })}>{selection.taskId?.startsWith("new:") && <option value="">新制作</option>}{linked.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>}<span className="flex-1" /><button className={action} onClick={() => prepare(projectId, { kind: "director", projectId, entityKind: shot ? "shot-design" : "script", entityId: shot?.id || "script", title: shot?.name || "视频制作", subtitle: "制作范围与镜头实现", instruction: "请读取当前镜头设计、最新故事板和已有制作任务，核对当前视频提示词及显式参考，安排制作范围和接续。不自动提交视频生成。" })}><Bot size={14} />交给 Agent 策划</button><button className={action} onClick={() => void create()}><Plus size={14} />新建制作</button></header>
        <div aria-label="视频与提示词工作区" className="min-h-0 flex-1 overflow-hidden">
            {opened.map((entry) => <div key={entry.key} hidden={entry.key !== activeKey} className="h-full"><TaskEditor projectId={projectId} state={state} task={state.videoSegments.find((task) => task.id === entry.taskId)} shots={shots} initialShot={entry.shotId} previewShot={entry.key === activeKey ? shot : ordered.find((shot) => shot.id === entry.shotId)} active={entry.key === activeKey} onDone={onRefresh} /></div>)}
            {!activeKey && <div className="grid h-full grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)] max-[800px]:grid-cols-1"><div className="flex min-h-0 items-center justify-center bg-slate-50/50 p-5">{shotImageUrl(shot) ? <img alt={`${shot?.name} 最新故事板`} src={shotImageUrl(shot)} className="max-h-full max-w-full object-contain" /> : <Film size={40} className="text-slate-300" />}</div><div className="flex flex-col items-center justify-center gap-4 px-6 text-sm text-slate-400"><p>当前镜头尚未安排视频制作</p><button className={`${action} text-blue-600`} onClick={() => void create()}><Plus size={14} />为此镜头新建制作</button></div></div>}
        </div>
        <section aria-label="制作镜头列表" className="h-52 shrink-0 border-t border-slate-200 px-5 pb-3 pt-2"><div className="mb-2 flex items-center gap-2 text-xs"><span className="font-medium">镜头列表</span><span className="text-slate-400">{shots.length}</span></div><div className="flex gap-6 overflow-x-auto pb-2">{state.sequences.map((scene) => <div key={scene.id} className="shrink-0"><h2 className="mb-2 text-[11px] text-slate-400">{scene.title}</h2><div className="flex gap-3">{ordered.filter((item) => item.sequenceId === scene.id).map((item, index) => { const tasks = state.videoSegments.filter((task) => task.payload.shotIds?.includes(item.id)); return <button key={item.id} aria-label={`制作镜头 ${item.name}`} aria-pressed={shot?.id === item.id} className="w-36 shrink-0 text-left" onClick={() => setSelection({ shotId: item.id })}><div className={`aspect-video overflow-hidden border-2 ${shot?.id === item.id ? "border-blue-500" : "border-transparent"}`}>{shotImageUrl(item) ? <img alt="" loading="lazy" src={shotImageUrl(item)} className="size-full bg-slate-50 object-contain" /> : <div className="grid size-full place-items-center bg-slate-50 text-slate-300"><ImageIcon size={22} /></div>}</div><p className={`mt-1 truncate text-[11px] ${shot?.id === item.id ? "text-blue-600" : "text-slate-600"}`}>{String(index + 1).padStart(2, "0")} {item.name}</p><p className="mt-1 text-[10px] text-slate-400">{tasks.length ? `${tasks.length} 项制作 · ${tasks.some((task) => task.payload.videoStale) ? "待检查" : tasks.some((task) => task.payload.videoFileId) ? "已有视频" : "待生成"}` : "待安排制作"}</p></button>; })}</div></div>)}{unlinked.length > 0 && <div className="shrink-0"><h2 className="mb-2 text-[11px] text-slate-400">待重新关联的制作</h2><div className="flex gap-2">{unlinked.map((task) => <button key={task.id} className={`${action} w-36 flex-col items-start text-left`} onClick={() => setSelection({ taskId: task.id })}><Film size={22} /><span className="line-clamp-2 text-xs">{task.title}</span></button>)}</div></div>}</div></section>
    </section>;
}
function TaskEditor({ projectId, task, shots, initialShot, previewShot, active, state, onDone }: Omit<Props, "onRefresh"> & { task?: DirectorVideoSegment; shots: DirectorShotDesign[]; initialShot?: string; previewShot?: DirectorShotDesign; active: boolean; onDone: () => Promise<void> }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState({ id: task?.id || nanoid(), title: task?.title || "新制作任务", sequenceId: task?.sequenceId || shots.find((shot) => shot.id === initialShot)?.sequenceId || state.sequences[0]?.id || "", seconds: task?.payload.durationSeconds || 8, shotIds: (task?.payload.shotIds as string[] | undefined) || (initialShot ? [initialShot] : []), refs: ((task?.payload.referenceImages as string[] | undefined) || []).join("\n"), boundary: task?.payload.boundary || "cut", previous: task?.payload.continuationFromSegmentId || "", intent: task?.payload.generationIntent || "storyboard", transitionFrom: task?.payload.transitionFromSegmentId || "", transitionTo: task?.payload.transitionToSegmentId || "" });
    const [prompt, setPrompt] = useState(String(task?.payload.videoPrompt || ""));
    const [promptHash, setPromptHash] = useState("");
    const [current, setCurrent] = useState(task);
    const [preflight, setPreflight] = useState<DirectorVideoSegmentPreflight>();
    const [busy, setBusy] = useState(false);
    const promptPath = String(task?.payload.promptPath || `productions/${draft.id}/video-prompt.md`);
    const latestBoard = draft.shotIds.length === 1 ? shots.find((shot) => shot.id === draft.shotIds[0])?.storyboardImage : undefined;
    const taskFolder = promptPath.slice(0, promptPath.lastIndexOf("/"));
    const references = [...new Set(draft.refs.split("\n").filter(Boolean).map((path) => latestBoard && path.slice(0, path.lastIndexOf("/")) === taskFolder && /^storyboard\.(png|jpe?g|webp|gif)$/i.test(path.split("/").at(-1) || "") ? latestBoard.path : path))].join("\n");
    const referencesUpdated = references !== [...new Set(draft.refs.split("\n").filter(Boolean))].join("\n");
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
    const run = async (generate = false) => { setBusy(true); try { const saved = await save(); const checked = await directorApi.videoSegmentPreflight(saved.id); setPreflight(checked); if (generate && !checked.blockedReasons.length) { await directorApi.generateVideoSegment(saved.id, saved.revision, "preview"); message.success("制作任务已提交"); await onDone(); } else if (!generate) message.success("任务已保存并完成预检"); } catch (error) { message.error(error instanceof Error ? error.message : "任务操作失败"); } finally { setBusy(false); } };
    const media = task?.payload.videoFileId ? task : current;
    return <section className="grid h-full min-h-0 grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] max-[800px]:grid-cols-1 max-[800px]:overflow-auto">
        <div aria-label="视频预览" className="flex min-h-0 flex-col border-r border-slate-100 p-5"><section aria-label="本次生成参考" className="mb-4 shrink-0">        <div className="flex items-center text-xs text-slate-500"><span className="flex-1">本次生成参考</span>{previewShot?.storyboardImage && <button className="text-blue-600 hover:text-blue-700" onClick={() => setDraft({ ...draft, refs: [...new Set([...references.split("\n").filter(Boolean), previewShot.storyboardImage!.path])].join("\n") })}>引用当前故事板</button>}</div>
        <ReferenceImages projectId={projectId} paths={references} />
        {!references.trim() && <p className="mt-2 text-xs text-slate-400">未设置参考图片</p>}
</section><div className="mb-3 flex items-center gap-2 text-xs"><Film size={14} /><span>{media?.payload.videoFileId ? "当前视频" : "当前镜头故事板"}</span><span className="flex-1" />{media?.payload.videoStale && <span className="text-slate-500">来源变化，待检查</span>}</div><div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50/50">{media?.payload.videoFileId ? <video ref={video} controls className="max-h-full w-full" src={directorMediaUrl(media.payload.videoFileId)} /> : shotImageUrl(previewShot) ? <img alt={`${previewShot?.name} 最新故事板`} src={shotImageUrl(previewShot)} className="max-h-full max-w-full object-contain" /> : <div className="flex flex-col items-center gap-3 text-slate-400"><Film size={36} /><p className="text-xs">尚未生成视频</p></div>}</div>{!media?.payload.videoFileId && <p className="mt-3 text-[11px] text-slate-400">故事板用于对照；本次生成使用上方显式参考。</p>}</div>
        <div aria-label="视频提示词与设置" className="flex min-h-0 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <input aria-label="任务名称" className="mb-4 w-full bg-transparent text-sm font-medium outline-none" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        {referencesUpdated && <p className="mb-3 text-xs leading-5 text-slate-500">故事板引用已更新为当前镜头版本，保存后生效；请同步核对提示词中的画格与图片编号。</p>}
        <label className="mt-4 block text-xs text-slate-500">最终视频提示词 · 原样提交<textarea aria-label="最终视频提示词" className={`${field} mt-2 min-h-48 resize-y leading-6`} value={prompt} onChange={(event) => { promptEdited.current = true; setPrompt(event.target.value); }} /></label>
        <details className="mt-4"><summary className="cursor-pointer text-xs text-slate-500">制作范围与参考设置</summary><div className="mt-4">
        <div className="grid gap-5 lg:grid-cols-2"><label className="text-xs text-slate-500">所属场景<select className={`${field} mt-2`} value={draft.sequenceId} onChange={(event) => setDraft({ ...draft, sequenceId: event.target.value })}>{state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.title}</option>)}</select></label><label className="text-xs text-slate-500">本次生成时长（秒）<input className={`${field} mt-2`} type="number" min={.1} step={.1} value={draft.seconds} onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })} /></label></div>
        <fieldset className="mt-6"><legend className="mb-2 text-xs text-slate-500">覆盖镜头（可多选）</legend><div className="flex flex-wrap gap-4">{shots.map((shot) => <label key={shot.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.shotIds.includes(shot.id)} onChange={(event) => setDraft({ ...draft, shotIds: event.target.checked ? [...draft.shotIds, shot.id] : draft.shotIds.filter((id) => id !== shot.id) })} />{shot.name}</label>)}</div><p className="mt-2 text-xs text-slate-400">已选 {draft.shotIds.length} 个镜头</p></fieldset>
        <div className="mt-6 grid gap-5 lg:grid-cols-2"><label className="text-xs text-slate-500">生成方式<select className={`${field} mt-2`} value={draft.intent === "transition" ? "transition" : draft.boundary} onChange={(event) => setDraft({ ...draft, intent: event.target.value === "transition" ? "transition" : "storyboard", boundary: event.target.value === "continue" ? "continue" : "cut" })}><option value="cut">独立生成（单镜头或多镜头）</option><option value="continue">连续镜头续接</option><option value="transition">首尾帧过渡</option></select></label>{draft.boundary === "continue" && <label className="text-xs text-slate-500">续接来源<select className={`${field} mt-2`} value={draft.previous} onChange={(event) => setDraft({ ...draft, previous: event.target.value })}><option value="">选择任务</option>{state.videoSegments.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}{draft.intent === "transition" && ([['transitionFrom', '首帧来自任务尾帧'], ['transitionTo', '尾帧来自任务首帧']] as const).map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<select className={`${field} mt-2`} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}><option value="">选择任务</option>{state.videoSegments.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>)}</div>
        <label className="mt-6 block text-xs text-slate-500">显式参考图片（工程内路径，每行一张，可留空）<textarea className={`${field} mt-2`} value={references} onChange={(event) => setDraft({ ...draft, refs: event.target.value })} /></label>
        </div></details>
        {preflight && <div className="mt-6 text-sm leading-7"><p className="text-slate-500">{preflight.route.reason}</p>{preflight.blockedReasons.map((reason) => <p key={reason} className="text-rose-600">{reason}</p>)}{preflight.warnings.map((reason) => <p key={reason} className="text-slate-500">{reason}</p>)}{!preflight.blockedReasons.length && <p className="text-blue-700">预检通过，可以生成。</p>}</div>}
        </div><footer className="flex shrink-0 items-center gap-2 border-t border-slate-100 px-4 py-3"><label className="flex items-center gap-1 text-xs text-slate-500"><input aria-label="生成时长" type="number" min={.1} step={.1} className="w-12 bg-transparent outline-none" value={draft.seconds} onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })} />秒</label><span className="flex-1" /><button className={action} disabled={busy} onClick={() => void run()}>保存并预检</button><button className={`${action} text-blue-700`} disabled={busy} onClick={() => void run(true)}><Film size={14} />生成预览</button></footer></div>
    </section>;
}

function ReferenceImages({ projectId, paths }: { projectId: string; paths: string }) {
    const [result, setResult] = useState<{ paths: string; images: Array<{ path: string; fileId?: string }> }>({ paths: "", images: [] });
    const images = result.paths === paths ? result.images : [];
    useEffect(() => {
        let active = true;
        void Promise.all(paths.split("\n").map((path) => path.trim()).filter(Boolean).map(async (path) => {
            try { return { path, ...(await readDirectorQuery(projectId, "assets", ["reference-image", path], () => directorApi.referenceImage(projectId, path))) }; } catch { return { path }; }
        })).then((value) => { if (active) setResult({ paths, images: value }); });
        return () => { active = false; };
    }, [projectId, paths]);
    return <div className="mt-3 flex gap-3 overflow-x-auto pb-2">{images.map(({ path, fileId }, index) => <div key={`${path}:${index}`} className="w-24 shrink-0 text-[10px] text-slate-500" title={path}>{fileId ? <a href={directorMediaUrl(fileId)} target="_blank" rel="noreferrer"><img src={directorMediaUrl(fileId)} alt={path} className="mb-1 h-14 w-full object-contain" /></a> : <p className="py-3 text-rose-600">图片不可用</p>}<p className="truncate">{path.split("/").slice(-2).join("/")}</p></div>)}</div>;
}
