import { useEffect, useState } from "react";
import { App } from "antd";
import { useSearchParams } from "react-router-dom";
import { Plus, Save, Film, ArrowLeft } from "lucide-react";
import { nanoid } from "nanoid";
import { directorApi } from "@/services/api/director";
import type { DirectorShotDesign, DirectorState, DirectorVideoSegment, DirectorVideoSegmentPreflight } from "@/types/director";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";

const field = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500";
const action = "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
const textFields = [["purpose", "叙事目的"], ["staging", "人物调度"], ["camera", "画面与摄影"], ["action", "动作与表演"], ["dialogue", "对白"], ["sound", "声音"], ["openingState", "开始状态"], ["endingState", "结束状态"], ["connection", "前后衔接"]] as const;
type Props = { projectId: string; state: DirectorState; onRefresh: () => Promise<void> };
const related = (task: DirectorVideoSegment, shotId: string) => Array.isArray(task.payload.shotIds) && task.payload.shotIds.includes(shotId);

export function ShotWorkspace({ projectId, state, onRefresh }: Props) {
    const { message } = App.useApp();
    const version = useDirectorResourceVersion(projectId, "segments");
    const [page, setPage] = useState(0);
    const [data, setData] = useState<{ items: DirectorShotDesign[]; total: number }>({ items: [], total: 0 });
    const [mode, setMode] = useState<"design" | "tasks">("design");
    const [selected, setSelected] = useState<DirectorShotDesign>();
    const [task, setTask] = useState<DirectorVideoSegment | "new">();
    const [search, setSearch] = useSearchParams();
    useEffect(() => { const target = state.videoSegments.find((item) => item.id === search.get("task")); if (target) { setTask(target); const next = new URLSearchParams(search); next.delete("task"); setSearch(next, { replace: true }); } }, [search, setSearch, state.videoSegments]);
    useEffect(() => {
        let active = true;
        directorApi.shotDesigns(projectId, page * 50).then((value) => { if (active) setData(value); }).catch((error) => { if (active) message.error(error.message); });
        return () => { active = false; };
    }, [projectId, version, page, message]);
    const refresh = async () => { await onRefresh(); setData(await directorApi.shotDesigns(projectId, page * 50)); };
    const create = async () => {
        try {
            const sequence = state.sequences[0] || await directorApi.createSequence(projectId, { title: "场景 1" });
            if (!state.sequences.length) await onRefresh();
            setSelected({ id: nanoid(), kind: "shot-design", name: "新镜头", sequenceId: sequence.id, order: data.total + 1, sourceBeatIds: [], estimatedSeconds: 8, purpose: "", staging: "", camera: "", action: "", dialogue: "", sound: "", openingState: "", endingState: "", connection: "", referenceImages: [], content: "", hash: "" });
        } catch (error) { message.error(error instanceof Error ? error.message : "创建失败"); }
    };
    const createTask = async () => {
        try { if (!state.sequences.length) { await directorApi.createSequence(projectId, { title: "场景 1" }); await onRefresh(); } setTask("new"); }
        catch (error) { message.error(error instanceof Error ? error.message : "创建失败"); }
    };
    if (task) return <TaskEditor key={task === "new" ? "new" : task.id} {...{ projectId, state }} task={task === "new" ? undefined : task} shots={data.items} initialShot={selected?.id} onDone={async () => { await refresh(); setTask(undefined); }} onClose={() => setTask(undefined)} />;
    if (selected) return <ShotEditor key={selected.id} design={selected} state={state} projectId={projectId} onClose={() => setSelected(undefined)} onSaved={async (saved) => { setSelected(saved); await refresh(); }} onTask={(value) => setTask(value)} />;
    return <section className="flex h-full min-h-0 flex-col bg-white text-slate-800">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-3">
            <button className={`${action} ${mode === "design" ? "text-blue-700" : ""}`} aria-pressed={mode === "design"} onClick={() => setMode("design")}>镜头规划 · {data.total}</button>
            <button className={`${action} ${mode === "tasks" ? "text-blue-700" : ""}`} aria-pressed={mode === "tasks"} onClick={() => setMode("tasks")}>制作任务 · {state.videoSegments.length}</button>
            <span className="flex-1" />
            <button className={action} onClick={() => mode === "design" ? void create() : void createTask()}><Plus size={15} />{mode === "design" ? "新建镜头" : "新建任务"}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <p className="mb-6 text-xs text-slate-500">{mode === "design" ? "先设计完整场景，再安排制作。预计时长只表达创作意图。" : "一个任务可覆盖多个镜头，同一镜头也可由多个任务完成。"}</p>
            {mode === "design" ? state.sequences.map((sequence) => {
                const shots = data.items.filter((shot) => shot.sequenceId === sequence.id);
                return <div key={sequence.id} className="mb-8"><h2 className="mb-2 text-sm font-semibold">{sequence.title}</h2>{shots.map((shot) => {
                    const tasks = state.videoSegments.filter((item) => related(item, shot.id));
                    return <button key={shot.id} onClick={() => setSelected(shot)} className="flex w-full items-start gap-5 border-b border-slate-100 py-4 text-left hover:bg-slate-50"><span className="w-7 pt-0.5 font-mono text-xs text-slate-400">{shot.order}</span><div className="flex-1"><div className="text-sm font-medium">{shot.name}</div><div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{shot.purpose || shot.action || "待完善镜头设计"}</div></div><div className="text-right text-xs leading-5 text-slate-500"><div>预计 {shot.estimatedSeconds || "待定"} 秒</div><div className={tasks.length ? "text-blue-600" : ""}>{tasks.length === 0 ? "尚未安排制作" : tasks.length > 1 ? `跨 ${tasks.length} 个任务` : (tasks[0].payload.shotIds as string[]).length > 1 ? "与其他镜头共用任务" : "已安排制作"}</div></div></button>;
                })}{!shots.length && <div className="py-4 text-xs text-slate-400">此页暂无镜头</div>}</div>;
            }) : state.videoSegments.map((item) => <button key={item.id} onClick={() => setTask(item)} className="flex w-full items-center gap-4 border-b border-slate-100 py-4 text-left hover:bg-slate-50"><Film size={20} className="text-slate-400" /><div className="flex-1"><div className="text-sm font-medium">{item.title}</div><div className="mt-1 text-xs text-slate-500">{Array.isArray(item.payload.shotIds) ? item.payload.shotIds.length : 0} 个镜头 · 任务 {item.payload.durationSeconds} 秒</div></div><span className="text-xs text-slate-500">{item.payload.videoStale ? "来源变化，待检查" : item.payload.videoFileId ? "已有视频" : "待制作"}</span></button>)}
            {!data.total && mode === "design" && <div className="py-16 text-center text-sm text-slate-400">从文字镜头开始，无需先准备图片。</div>}
            {mode === "design" && data.total > 50 && <div className="flex justify-end gap-3"><button className={action} disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span className="py-2 text-sm">{page + 1}</span><button className={action} disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>下一页</button></div>}
        </div>
    </section>;
}

function ShotEditor({ projectId, design, state, onClose, onSaved, onTask }: { projectId: string; design: DirectorShotDesign; state: DirectorState; onClose: () => void; onSaved: (saved: DirectorShotDesign) => Promise<void>; onTask: (task: DirectorVideoSegment | "new") => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState(design);
    const [busy, setBusy] = useState(false);
    const save = async () => { setBusy(true); try { const value = await directorApi.saveShotDesign(projectId, draft); setDraft({ ...draft, hash: value.hash }); await onSaved({ ...draft, hash: value.hash }); message.success("镜头已保存"); } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); } };
    const patch = (value: Partial<DirectorShotDesign>) => setDraft((current) => ({ ...current, ...value }));
    const tasks = state.videoSegments.filter((task) => related(task, draft.id));
    return <section className="h-full overflow-auto bg-white px-8 pb-10 text-slate-800">
        <div className="sticky top-0 z-10 -mx-8 mb-6 flex items-center gap-3 border-b border-slate-100 bg-white px-6 py-3"><button className={action} onClick={onClose}><ArrowLeft size={15} />镜头规划</button><span className="flex-1" /><button className={action} disabled={busy} onClick={() => void save()}><Save size={15} />保存镜头</button></div>
        <input aria-label="镜头名称" className="mb-6 w-full border-0 text-2xl font-semibold outline-none" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        <div className="mb-6 grid grid-cols-2 gap-4"><label className="text-xs text-slate-500">所属场景<select className={`${field} mt-2`} value={draft.sequenceId} onChange={(event) => patch({ sequenceId: event.target.value })}>{state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.title}</option>)}</select></label><label className="text-xs text-slate-500">预计时长（秒）<input className={`${field} mt-2`} type="number" min={.01} step={.01} value={draft.estimatedSeconds || ""} onChange={(event) => patch({ estimatedSeconds: Number(event.target.value) || undefined })} /></label></div>
        <div className="mb-6 grid grid-cols-2 gap-4"><label className="text-xs text-slate-500">来源场次<select className={`${field} mt-2`} value={draft.sourceSceneId || ""} onChange={(event) => patch({ sourceSceneId: event.target.value || undefined, sourceBeatIds: [] })}><option value="">待指定</option>{state.screenplayBreakdown.payload.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label><label className="text-xs text-slate-500">来源节拍<select multiple className={`${field} mt-2`} value={draft.sourceBeatIds} onChange={(event) => patch({ sourceBeatIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}>{state.screenplayBreakdown.payload.scenes.find((scene) => scene.id === draft.sourceSceneId)?.beats.map((beat) => <option key={beat.id} value={beat.id}>{beat.summary}</option>)}</select></label></div>
        <div className="grid gap-5 lg:grid-cols-2">{textFields.map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<textarea className={`${field} mt-2 min-h-24 resize-y`} value={draft[key]} onChange={(event) => patch({ [key]: event.target.value })} /></label>)}</div>
        <label className="mt-5 block text-xs text-slate-500">补充镜头设计<textarea className={`${field} mt-2 min-h-32`} value={draft.content} onChange={(event) => patch({ content: event.target.value })} /></label>
        <label className="mt-5 block text-xs text-slate-500">参考图片（工程内路径，每行一张，可留空）<textarea className={`${field} mt-2`} value={draft.referenceImages.join("\n")} onChange={(event) => patch({ referenceImages: event.target.value.split("\n").filter(Boolean) })} /></label>
        <ReferenceImages projectId={projectId} paths={draft.referenceImages.join("\n")} />
        <div className="mt-8 flex items-center"><h3 className="flex-1 text-sm font-semibold">关联制作任务 · {tasks.length}</h3><button className={action} disabled={!draft.hash} onClick={() => onTask("new")}><Plus size={15} />安排任务</button></div>{tasks.map((task) => <button key={task.id} className={`${action} mt-2 mr-2`} onClick={() => onTask(task)}>{task.title}</button>)}
    </section>;
}

function TaskEditor({ projectId, task, shots, initialShot, state, onDone, onClose }: Omit<Props, "onRefresh"> & { task?: DirectorVideoSegment; shots: DirectorShotDesign[]; initialShot?: string; onDone: () => Promise<void>; onClose: () => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState({ id: task?.id || nanoid(), title: task?.title || "新制作任务", sequenceId: task?.sequenceId || state.sequences[0]?.id || "", seconds: task?.payload.durationSeconds || 8, shotIds: (task?.payload.shotIds as string[] | undefined) || (initialShot ? [initialShot] : []), refs: ((task?.payload.referenceImages as string[] | undefined) || []).join("\n"), boundary: task?.payload.boundary || "cut", previous: task?.payload.continuationFromSegmentId || "", intent: task?.payload.generationIntent || "storyboard", transitionFrom: task?.payload.transitionFromSegmentId || "", transitionTo: task?.payload.transitionToSegmentId || "" });
    const [shotPage, setShotPage] = useState(0);
    const [choices, setChoices] = useState({ items: shots, total: shots.length });
    useEffect(() => { let active = true; directorApi.shotDesigns(projectId, shotPage * 50).then((value) => { if (active) setChoices(value); }).catch((error) => message.error(error.message)); return () => { active = false; }; }, [projectId, shotPage, message]);
    const [prompt, setPrompt] = useState(String(task?.payload.videoPrompt || ""));
    const [promptHash, setPromptHash] = useState("");
    const [current, setCurrent] = useState(task);
    const [preflight, setPreflight] = useState<DirectorVideoSegmentPreflight>();
    const [busy, setBusy] = useState(false);
    const promptPath = String(task?.payload.promptPath || `productions/${draft.id}/video-prompt.md`);
    useEffect(() => { if (task) directorApi.file(projectId, promptPath).then((file) => { setPrompt(file.content); setPromptHash(file.hash); }).catch((error) => message.error(error.message)); }, [projectId, promptPath, task, message]);
    const save = async () => {
        const payload = { shotIds: draft.shotIds, durationSeconds: draft.seconds, referenceImages: draft.refs.split("\n").filter(Boolean), boundary: draft.boundary, continuationFromSegmentId: draft.previous || undefined, generationIntent: draft.intent, transitionFromSegmentId: draft.transitionFrom || undefined, transitionToSegmentId: draft.transitionTo || undefined };
        const saved = current ? await directorApi.updateVideoSegment(current.id, { revision: current.revision, title: draft.title, sequenceId: draft.sequenceId, payload }) : await directorApi.createVideoSegment(projectId, { id: draft.id, title: draft.title, sequenceId: draft.sequenceId, payload });
        setCurrent(saved);
        const expectedHash = current ? promptHash : (await directorApi.file(projectId, promptPath)).hash;
        setPromptHash(expectedHash);
        const file = await directorApi.updateMarkdownFile(projectId, promptPath, prompt, expectedHash);
        setPromptHash(file.hash);
        const fresh = await directorApi.state(projectId);
        const updated = fresh.videoSegments.find((item) => item.id === saved.id)!;
        setCurrent(updated);
        return updated;
    };
    const run = async (generate = false) => { setBusy(true); try { const saved = await save(); const checked = await directorApi.videoSegmentPreflight(saved.id); setPreflight(checked); if (generate && !checked.blockedReasons.length) { await directorApi.generateVideoSegment(saved.id, saved.revision, "preview"); message.success("制作任务已提交"); await onDone(); } else if (!generate) message.success("任务已保存并完成预检"); } catch (error) { message.error(error instanceof Error ? error.message : "任务操作失败"); } finally { setBusy(false); } };
    return <section className="h-full overflow-auto bg-white px-8 pb-10 text-slate-800"><div className="sticky top-0 z-10 -mx-8 mb-6 flex gap-2 border-b border-slate-100 bg-white px-6 py-3"><button className={action} onClick={onClose}><ArrowLeft size={15} />返回分镜</button><span className="flex-1" /><button className={action} disabled={busy} onClick={() => void run()}>保存并预检</button><button className={`${action} text-blue-700`} disabled={busy} onClick={() => void run(true)}><Film size={15} />生成预览</button></div>
        <input aria-label="任务名称" className="mb-6 w-full text-2xl font-semibold outline-none" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        {task?.payload.videoFileId && <video controls className="mb-6 max-h-80 w-full bg-slate-950" src={directorMediaUrl(task.payload.videoFileId)} />}
        <div className="grid gap-5 lg:grid-cols-2"><label className="text-xs text-slate-500">所属场景<select className={`${field} mt-2`} value={draft.sequenceId} onChange={(event) => setDraft({ ...draft, sequenceId: event.target.value })}>{state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.title}</option>)}</select></label><label className="text-xs text-slate-500">本次生成时长（秒）<input className={`${field} mt-2`} type="number" min={.1} step={.1} value={draft.seconds} onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })} /></label></div>
        <fieldset className="mt-6"><legend className="mb-2 text-xs text-slate-500">覆盖镜头（可多选）</legend><div className="flex flex-wrap gap-4">{choices.items.map((shot) => <label key={shot.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.shotIds.includes(shot.id)} onChange={(event) => setDraft({ ...draft, shotIds: event.target.checked ? [...draft.shotIds, shot.id] : draft.shotIds.filter((id) => id !== shot.id) })} />{shot.name}</label>)}</div><div className="mt-2 flex items-center gap-3 text-xs text-slate-500"><span>已选 {draft.shotIds.length} 个镜头</span>{choices.total > 50 && <><button className={action} disabled={!shotPage} onClick={() => setShotPage(shotPage - 1)}>上一页</button><span>{shotPage + 1}</span><button className={action} disabled={(shotPage + 1) * 50 >= choices.total} onClick={() => setShotPage(shotPage + 1)}>下一页</button></>}</div></fieldset>
        <div className="mt-6 grid gap-5 lg:grid-cols-2"><label className="text-xs text-slate-500">生成方式<select className={`${field} mt-2`} value={draft.intent === "transition" ? "transition" : draft.boundary} onChange={(event) => setDraft({ ...draft, intent: event.target.value === "transition" ? "transition" : "storyboard", boundary: event.target.value === "continue" ? "continue" : "cut" })}><option value="cut">独立生成（单镜头或多镜头）</option><option value="continue">连续镜头续接</option><option value="transition">首尾帧过渡</option></select></label>{draft.boundary === "continue" && <label className="text-xs text-slate-500">续接来源<select className={`${field} mt-2`} value={draft.previous} onChange={(event) => setDraft({ ...draft, previous: event.target.value })}><option value="">选择任务</option>{state.videoSegments.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}{draft.intent === "transition" && ([['transitionFrom', '首帧来自任务尾帧'], ['transitionTo', '尾帧来自任务首帧']] as const).map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<select className={`${field} mt-2`} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}><option value="">选择任务</option>{state.videoSegments.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>)}</div>
        <label className="mt-6 block text-xs text-slate-500">显式参考图片（工程内路径，每行一张，可留空）<textarea className={`${field} mt-2`} value={draft.refs} onChange={(event) => setDraft({ ...draft, refs: event.target.value })} /></label>
        <ReferenceImages projectId={projectId} paths={draft.refs} />
        <label className="mt-6 block text-xs text-slate-500">最终视频提示词 · 原样提交<textarea className={`${field} mt-2 min-h-64 font-mono`} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
        {preflight && <div className="mt-6 text-sm leading-7"><p className="text-slate-500">{preflight.route.reason}</p>{preflight.blockedReasons.map((reason) => <p key={reason} className="text-rose-600">{reason}</p>)}{preflight.warnings.map((reason) => <p key={reason} className="text-slate-500">{reason}</p>)}{!preflight.blockedReasons.length && <p className="text-blue-700">预检通过，可以生成。</p>}</div>}
    </section>;
}

function ReferenceImages({ projectId, paths }: { projectId: string; paths: string }) {
    const [images, setImages] = useState<Array<{ path: string; fileId?: string }>>([]);
    useEffect(() => {
        let active = true;
        const timer = setTimeout(() => { void Promise.all(paths.split("\n").map((path) => path.trim()).filter(Boolean).map(async (path) => {
            try { return { path, ...(await directorApi.referenceImage(projectId, path)) }; } catch { return { path }; }
        })).then((value) => { if (active) setImages(value); }); }, 300);
        return () => { active = false; clearTimeout(timer); };
    }, [projectId, paths]);
    return <div className="mt-3 flex flex-wrap gap-3">{images.map(({ path, fileId }, index) => <div key={`${path}:${index}`} className="w-40 text-xs text-slate-500">{fileId ? <a href={directorMediaUrl(fileId)} target="_blank" rel="noreferrer"><img src={directorMediaUrl(fileId)} alt={path} className="mb-1 h-24 w-full object-contain" /></a> : <p className="py-3 text-rose-600">图片不可用</p>}<p className="break-all">{path}</p></div>)}</div>;
}
