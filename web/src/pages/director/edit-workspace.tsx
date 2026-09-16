import { ProductionWorkspace } from "./production-workspace";
import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { ArrowDown, ArrowUp, Film, Pause, Play, Plus, Save, Trash2, Unlink, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { directorApi } from "@/services/api/director";
import { uploadServerFile } from "@/services/api/server";
import type { DirectorRender, DirectorEditClip, DirectorPlaybackPlan, DirectorState, DirectorTimeline, DirectorTimelineClip } from "@/types/director";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";
import { useDirectorStore } from "@/stores/use-director-store";

const action = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
const numberField = "w-20 rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-700 focus:border-blue-500 outline-none";
const EMPTY_RENDERS: DirectorRender[] = [];

export function EditWorkspace({ mode, ...props }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void>; mode: "production" | "edit" }) {
    const [visitedEdit, setVisitedEdit] = useState(mode === "edit");
    const [visitedProduction, setVisitedProduction] = useState(mode === "production");
    const workspace = useRef<HTMLElement>(null);
    useEffect(() => {
        workspace.current?.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => media.pause());
        if (mode === "edit") setVisitedEdit(true); else setVisitedProduction(true);
    }, [mode]);
    return <section ref={workspace} className="flex h-full min-h-0 flex-col bg-white"><div className="min-h-0 flex-1" hidden={mode !== "production"}>{visitedProduction && <ProductionWorkspace {...props} />}</div><div className="min-h-0 flex-1" hidden={mode !== "edit"}>{visitedEdit && <TimelineWorkspace {...props} active={mode === "edit"} />}</div></section>;
}

function TimelineWorkspace({ projectId, state, onRefresh, active }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void>; active: boolean }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState(state.timeline);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [plan, setPlan] = useState<DirectorPlaybackPlan>();
    const [error, setError] = useState("");
    const version = useDirectorResourceVersion(projectId, "timeline");
    const segmentsVersion = useDirectorResourceVersion(projectId, "segments");
    const renders = useDirectorStore((store) => store.data[projectId]?.renders) || EMPTY_RENDERS;
    useEffect(() => { if (!dirty) setDraft(state.timeline); }, [state.timeline, dirty]);
    useEffect(() => {
        let active = true;
        setPlan(undefined);
        directorApi.playbackPlan(projectId).then((value) => { if (active) { setPlan(value); setError(""); } }).catch((reason) => { if (active) setError(reason.message); });
        return () => { active = false; };
    }, [projectId, version, segmentsVersion, state.timeline.revision]);
    const clips = draft.payload.videoClips || [];
    const tracks = draft.payload.tracks || [];
    const edit = (payload: DirectorTimeline["payload"]) => { setDraft({ ...draft, payload }); setDirty(true); };
    const updateClip = (id: string, change: Partial<DirectorEditClip>) => edit({ ...draft.payload, videoClips: clips.map((clip) => clip.id === id ? { ...clip, ...change } : clip) });
    const audioClips = tracks.flatMap((track) => track.clips.map((clip) => ({ ...clip, trackId: track.id, trackKind: track.kind })));
    const updateAudio = (id: string, change: Partial<DirectorTimelineClip>) => edit({ ...draft.payload, tracks: tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === id ? { ...clip, ...change } : clip) })) });
    const move = (index: number, direction: -1 | 1) => { const next = [...clips]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; edit({ ...draft.payload, videoClips: next }); };
    const appendAudio = (clip: DirectorTimelineClip, videoClips = clips) => {
        const existing = tracks.find((track) => track.id === "independent-audio");
        const next = existing ? tracks.map((track) => track === existing ? { ...track, clips: [...track.clips, clip] } : track) : [...tracks, { id: "independent-audio", kind: "model-original" as const, clips: [clip] }];
        edit({ ...draft.payload, videoClips, tracks: next });
    };
    const detach = (clip: DirectorEditClip, index: number) => {
        if (!state.videoSegments.find((task) => task.id === clip.taskId)?.payload.nativeAudioFileId) { updateClip(clip.id, { linkedAudio: false }); return; }
        appendAudio({ id: nanoid(), taskId: clip.taskId, start: clips.slice(0, index).reduce((sum, item) => sum + item.trimOut - item.trimIn, 0), trimIn: clip.trimIn, duration: clip.trimOut - clip.trimIn, volume: 1 }, clips.map((item) => item.id === clip.id ? { ...item, linkedAudio: false } : item));
    };
    const save = async () => { setBusy(true); try { const saved = await directorApi.updateTimeline(projectId, { revision: draft.revision, payload: draft.payload }); setDraft(saved); setDirty(false); await onRefresh(); message.success("剪辑已保存"); } catch (reason) { message.error(reason instanceof Error ? reason.message : "保存失败"); } finally { setBusy(false); } };
    const render = async () => { setBusy(true); try { await directorApi.createRender(projectId, state.timeline.revision); await onRefresh(); message.success("已固定当前媒体并提交合成"); } catch (reason) { message.error(reason instanceof Error ? reason.message : "导出失败"); } finally { setBusy(false); } };
    const upload = async (file: File) => { try { const result = await uploadServerFile(file, file.name); const audio = new Audio(directorMediaUrl(result.fileId)); const duration = await new Promise<number>((resolve, reject) => { audio.onloadedmetadata = () => resolve(audio.duration); audio.onerror = () => reject(new Error("无法读取声音时长")); }); audio.src = ""; appendAudio({ id: nanoid(), fileId: result.fileId, start: 0, trimIn: 0, duration, volume: 1 }); } catch (reason) { message.error(reason instanceof Error ? reason.message : "声音导入失败"); } };
    return <section className="flex h-full min-h-0 flex-col bg-white text-slate-800">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-3"><Film size={16} /><span className="text-sm">时间线 · {clips.length} 个片段</span><span className="text-xs text-slate-400">{clips.reduce((sum, clip) => sum + clip.trimOut - clip.trimIn, 0).toFixed(2)} 秒</span><span className="flex-1" />{dirty && <span className="text-xs text-slate-500">未保存</span>}<button className={action} disabled={busy || !dirty} onClick={() => void save()}><Save size={14} />保存剪辑</button><button className={`${action} text-blue-700`} disabled={busy || dirty || !plan?.segments.length} onClick={() => void render()}><Film size={14} />导出 MP4</button></div>
        <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid gap-6 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div>{error ? <div role="alert" className="flex min-h-64 items-center justify-center bg-slate-50 p-8 text-sm text-rose-600">{error}</div> : plan ? <EditPreview key={`${plan.timelineRevision}:${segmentsVersion}`} plan={plan} disabled={dirty || !active} /> : <div className="grid min-h-64 place-items-center bg-slate-50 text-sm text-slate-400">读取播放计划…</div>}{dirty && <p className="mt-2 text-xs text-slate-500">保存剪辑后即可预览当前修改。</p>}</div>
                <div><h2 className="mb-3 text-xs font-semibold text-slate-500">任务当前素材</h2><div className="max-h-80 space-y-1 overflow-auto">{state.videoSegments.filter((task) => task.payload.videoFileId).map((task) => <button key={task.id} className={`${action} w-full text-left`} onClick={() => edit({ ...draft.payload, videoClips: [...clips, { id: nanoid(), taskId: task.id, trimIn: 0, trimOut: task.payload.videoDurationSeconds || task.payload.durationSeconds || 4, linkedAudio: true }] })}><Plus size={14} /><span className="flex-1 truncate">{task.title}</span><span>{(task.payload.videoDurationSeconds || task.payload.durationSeconds || 4).toFixed(1)}s</span></button>)}</div><p className="mt-3 text-xs leading-5 text-slate-400">可重复选用同一素材。生成完成后由你决定是否加入成片。</p></div>
            </div>
            {plan?.warnings.map((warning) => <p key={warning} className="px-6 pb-2 text-xs text-slate-500">{warning}</p>)}
            <div className="px-6 pb-6"><h2 className="mb-3 text-xs font-semibold text-slate-500">视频主轨</h2><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="text-slate-400"><tr><th className="py-2 font-normal">片段 / 来源</th><th className="font-normal">素材入点</th><th className="font-normal">素材出点</th><th className="font-normal">声音</th><th className="font-normal">排序 / 删除</th></tr></thead><tbody>{clips.map((clip, index) => <tr key={clip.id} className="border-t border-slate-100"><td className="py-3"><div className="text-sm">{index + 1}. {state.videoSegments.find((task) => task.id === clip.taskId)?.title || clip.taskId}</div><div className="mt-1 font-mono text-[10px] text-slate-400">{clip.id}</div></td><td><input aria-label={`片段 ${index + 1} 入点`} className={numberField} type="number" min={0} step="any" value={clip.trimIn} onChange={(event) => updateClip(clip.id, { trimIn: Number(event.target.value) })} /></td><td><input aria-label={`片段 ${index + 1} 出点`} className={numberField} type="number" min={0} step="any" value={clip.trimOut} onChange={(event) => updateClip(clip.id, { trimOut: Number(event.target.value) })} /></td><td>{clip.linkedAudio ? <button className={action} onClick={() => detach(clip, index)}><Unlink size={13} />解除原声关联</button> : <span className="text-slate-400">独立编排 / 静音</span>}</td><td><button aria-label={`上移片段 ${index + 1}`} className={action} disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button aria-label={`下移片段 ${index + 1}`} className={action} disabled={index === clips.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button><button aria-label={`删除片段 ${index + 1}`} className={action} onClick={() => edit({ ...draft.payload, videoClips: clips.filter((item) => item.id !== clip.id) })}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>{!clips.length && <p className="py-8 text-center text-sm text-slate-400">从任务素材中选片，开始剪辑。</p>}
                <div className="mb-3 mt-8 flex items-center"><h2 className="flex-1 text-xs font-semibold text-slate-500">独立声音轨</h2><label className={`${action} cursor-pointer`}><Upload size={14} />导入声音<input type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-slate-400"><tr><th className="py-2 font-normal">来源</th><th className="font-normal">成片开始</th><th className="font-normal">素材入点</th><th className="font-normal">采用时长</th><th className="font-normal">音量</th><th /></tr></thead><tbody>{audioClips.map((clip, index) => <tr key={clip.id} className="border-t border-slate-100"><td className="max-w-48 py-3"><div className="truncate">{state.videoSegments.find((task) => task.id === (clip.taskId || clip.segmentId))?.title || `声音 ${index + 1}`}</div><div className="mt-1 text-[10px] text-slate-400">{clip.trackKind === "model-original" ? "模型原声" : clip.trackKind}</div></td>{([['start', '开始'], ['trimIn', '入点'], ['duration', '时长'], ['volume', '音量']] as const).map(([key, label]) => <td key={key}><input aria-label={`声音 ${index + 1} ${label}`} className={numberField} type="number" min={0} step="any" value={clip[key] ?? (key === "volume" ? 1 : 0)} onChange={(event) => updateAudio(clip.id, { [key]: Number(event.target.value) })} /></td>)}<td><button aria-label={`删除声音 ${index + 1}`} className={action} onClick={() => edit({ ...draft.payload, tracks: tracks.map((track) => ({ ...track, clips: track.clips.filter((item) => item.id !== clip.id) })) })}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-400">声音可跨越画面边界；解除关联后不会同时播放原片段声音。</p>
                {renders.map((render) => <div key={render.id} className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs"><span className="flex-1">{render.status === "succeeded" ? "成片已导出" : render.error || `合成 ${Math.round(render.progress * 100)}%`}</span>{render.outputFileId && <a className="text-blue-700" href={directorMediaUrl(render.outputFileId)} download>下载 MP4</a>}{["queued", "running"].includes(render.status) && <button className={action} onClick={() => void directorApi.cancelRender(render.id).then(onRefresh)}>取消</button>}</div>)}
            </div>
        </div>
    </section>;
}

function EditPreview({ plan, disabled }: { plan: DirectorPlaybackPlan; disabled: boolean }) {
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [index, setIndex] = useState(0);
    const [error, setError] = useState("");
    const video = useRef<HTMLVideoElement>(null);
    const clock = useRef(0);
    const audio = useRef<Array<{ clip: DirectorTimelineClip; media: HTMLAudioElement; gain: GainNode }>>([]);
    const context = useRef<AudioContext | undefined>(undefined);
    const current = plan.segments[index];
    useEffect(() => {
        const ctx = new AudioContext(); context.current = ctx;
        audio.current = plan.audio.map((clip) => { const media = new Audio(directorMediaUrl(clip.fileId!)); media.preload = "auto"; const gain = ctx.createGain(); ctx.createMediaElementSource(media).connect(gain); gain.connect(ctx.destination); return { clip, media, gain }; });
        return () => { audio.current.forEach(({ media }) => { media.pause(); media.src = ""; }); audio.current = []; void ctx.close(); };
    }, [plan]);
    useEffect(() => { if (disabled) setPlaying(false); }, [disabled]);
    useEffect(() => {
        if (!video.current) return;
        if (playing && current) void video.current.play().catch((reason) => { setError(reason.message); setPlaying(false); });
        else video.current.pause();
        if (!playing) audio.current.forEach(({ media }) => media.pause());
    }, [playing, index, current]);
    useEffect(() => {
        if (!playing || !current) return;
        let frame = 0;
        const tick = () => {
            const media = video.current;
            if (!media || media.readyState < 2 || media.seeking) { audio.current.forEach(({ media: sound }) => sound.pause()); frame = requestAnimationFrame(tick); return; }
            const elapsed = Math.max(0, media.currentTime - current.trimIn);
            clock.current = Math.min(plan.duration, current.start + elapsed);
            setTime(clock.current);
            for (const { clip, media: sound, gain } of audio.current) {
                const offset = clock.current - clip.start;
                if (offset < 0 || offset >= clip.duration) { sound.pause(); continue; }
                const available = sound.duration - (clip.trimIn || 0);
                const local = clip.loop && available > 0 ? offset % available : offset;
                const target = (clip.trimIn || 0) + local;
                if (sound.readyState && Math.abs(sound.currentTime - target) > .12) sound.currentTime = target;
                const fadeIn = clip.fadeIn ? Math.min(1, offset / clip.fadeIn) : 1;
                const fadeOut = clip.fadeOut ? Math.min(1, (clip.duration - offset) / clip.fadeOut) : 1;
                gain.gain.value = (clip.volume ?? 1) * Math.max(0, Math.min(fadeIn, fadeOut));
                if (sound.paused) void sound.play().catch(() => undefined);
            }
            if (elapsed >= current.duration - .0001 || media.ended) {
                if (index + 1 < plan.segments.length) { clock.current = plan.segments[index + 1].start; setIndex(index + 1); }
                else { setPlaying(false); setTime(plan.duration); }
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, index, current, plan]);
    const seek = (seconds: number) => {
        const found = plan.segments.findIndex((clip) => seconds < clip.start + clip.duration);
        const next = found < 0 ? plan.segments.length - 1 : found;
        const target = plan.segments[next];
        if (!target) return;
        clock.current = seconds; setTime(seconds); setIndex(next);
        if (next === index && video.current) video.current.currentTime = target.trimIn + seconds - target.start;
    };
    const toggle = () => { if (!playing && time >= plan.duration) seek(0); void context.current?.resume(); setPlaying(!playing); };
    return <div><div className="relative flex aspect-video max-h-[420px] items-center justify-center bg-slate-950">{current ? <video key={current.clipId} ref={video} muted playsInline className="size-full object-contain" src={directorMediaUrl(current.fileId)} onLoadedMetadata={(event) => { event.currentTarget.currentTime = current.trimIn + Math.max(0, clock.current - current.start); if (playing) void event.currentTarget.play().catch(() => setPlaying(false)); }} /> : <p className="text-sm text-slate-400">尚未选用视频</p>}</div><div className="flex items-center gap-3 py-3"><button className={action} disabled={disabled || !current} aria-label={playing ? "暂停成片预览" : "播放成片预览"} onClick={toggle}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><span className="font-mono text-xs text-slate-500">{time.toFixed(2)} / {plan.duration.toFixed(2)}</span><input aria-label="成片预览进度" className="min-w-0 flex-1 accent-blue-600" type="range" min={0} max={plan.duration || 1} step={1 / 24} value={time} disabled={disabled} onChange={(event) => seek(Number(event.target.value))} /></div>{error && <p className="text-xs text-rose-600">{error}</p>}</div>;
}
