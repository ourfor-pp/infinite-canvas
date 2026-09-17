import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { Bot, Box, Image as ImageIcon, Pause, Play, Save, SkipBack, SkipForward, Download, Pencil, Trash2 } from "lucide-react";
import { directorApi } from "@/services/api/director";
import { agentApi } from "@/services/api/agent";
import { readDirectorQuery, readDirectorSegmentPlans } from "@/services/director-queries";
import { useAgentStore } from "@/stores/use-agent-store";
import type { DirectorSegmentPlan, DirectorState } from "@/types/director";
import type { LookFrame, PrevisDocument, PrevisRender } from "@/types/previs";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";
import { PrevisViewport } from "./previs-viewport";

const action = "inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
const fields = [["purpose", "叙事目的"], ["staging", "人物调度"], ["camera", "摄影"], ["action", "动作与表演"], ["dialogue", "对白"], ["sound", "声音"], ["openingState", "开始状态"], ["endingState", "结束状态"], ["connection", "前后衔接"]] as const;
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;

export function SequenceWorkspace({ projectId, state, onRefresh }: { projectId: string; state: DirectorState; onRefresh: () => Promise<void> }) {
    const { message } = App.useApp(), prepare = useAgentStore((store) => store.prepareComposer);
    const version = useDirectorResourceVersion(projectId, "segments"), mediaVersion = useDirectorResourceVersion(projectId, "media"), assetsVersion = useDirectorResourceVersion(projectId, "assets");
    const [selection, setSelection] = useState<{ id: string; time: number; objectId?: string }>(() => { try { return JSON.parse(localStorage.getItem(`director-previs-view:${projectId}`) || "null") || { id: "", time: 0 }; } catch { return { id: "", time: 0 }; } });
    const [segments, setSegments] = useState<DirectorSegmentPlan[]>([]), [document, setDocument] = useState<PrevisDocument>();
    const [error, setError] = useState(""), [playing, setPlaying] = useState(false), [busy, setBusy] = useState(false);
    const [jobs, setJobs] = useState<PrevisRender[]>([]), [drafts, setDrafts] = useState<Record<string, DirectorSegmentPlan>>({});
    const [frameId, setFrameId] = useState("");
    const current = segments.find((item) => item.id === selection.id) || segments[0];
    const currentId = current?.id, data = document?.segmentId === currentId ? document : undefined;
    const duration = data?.plan?.duration || current?.estimatedSeconds || 0, time = Math.min(selection.id === currentId ? selection.time : 0, duration);
    const live = useRef({ time, id: currentId, duration }); live.current = { time, id: currentId, duration };
    const draft = currentId ? drafts[currentId] : undefined;
    const canPlay = Boolean(data?.scene && data.plan && !data.diagnostics.length);
    const exports = jobs.filter((job) => job.segmentId === currentId && job.kind === "video" && job.status !== "cancelled");
    const exportJob = exports.find((job) => ["queued", "running"].includes(job.status)) || exports.find((job) => job.sourceHash === data?.hash) || exports[0];
    const exportedVideo = exportJob?.status === "succeeded" && exportJob.result ? exportJob : exports.find((job) => job.status === "succeeded" && job.result && job.sourceHash === data?.hash) || exports.find((job) => job.status === "succeeded" && job.result);
    const exporting = Boolean(exportJob && ["queued", "running"].includes(exportJob.status));
    const selectedFrame = data?.lookFrames.find((frame) => frame.id === frameId) || data?.lookFrames.filter((frame) => frame.time <= time).at(-1) || data?.lookFrames[0];
    const object = data?.scene?.objects.find((item) => item.id === selection.objectId);
    const selectedReference = data?.assetReferences.find((item) => item.objectIds.includes(selection.objectId || ""));
    const currentActions = data?.plan?.actions.filter((item) => item.objectId === object?.id && item.start <= time && item.end > time) || [];
    const load = async (force = false) => { if (currentId) { const value = await readDirectorQuery(projectId, "segments", ["previs", currentId, assetsVersion, mediaVersion], () => directorApi.previs(projectId, currentId), force); setDocument(value); } };
    useEffect(() => {
        let active = true;
        void readDirectorSegmentPlans(projectId).then((items) => { if (active) setSegments(items); }).catch((reason) => { if (active) setError(reason.message); });
        return () => { active = false; };
    }, [projectId, version]);
    useEffect(() => {
        let active = true; setError("");
        if (currentId) void readDirectorQuery(projectId, "segments", ["previs", currentId, assetsVersion, mediaVersion], () => directorApi.previs(projectId, currentId)).then((value) => { if (active) setDocument(value); }).catch((reason) => { if (active) setError(reason.message); });
        return () => { active = false; };
    }, [projectId, currentId, version, mediaVersion, assetsVersion]);
    useEffect(() => {
        if (!currentId) return;
        let active = true, timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try { const result = await directorApi.previsRenders(projectId, currentId); if (active) { setJobs(result.items); if (result.items.some((job) => ["running", "queued"].includes(job.status))) timer = setTimeout(poll, 1500); } }
            catch (reason) { if (active) setError((reason as Error).message); }
        };
        void poll(); return () => { active = false; clearTimeout(timer); };
    }, [projectId, currentId, busy]);
    useEffect(() => {
        if (!playing || !canPlay) return;
        let frame = 0, last = performance.now();
        const tick = (now: number) => {
            const next = Math.min(live.current.duration, live.current.time + (now - last) / 1000); last = now;
            setSelection((value) => ({ ...value, id: live.current.id || "", time: next }));
            if (next >= live.current.duration) setPlaying(false); else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
    }, [playing, canPlay, currentId]);
    useEffect(() => { if (!playing && currentId) { try { localStorage.setItem(`director-previs-view:${projectId}`, JSON.stringify({ ...selection, id: currentId, time })); } catch { /* UI preference only */ } } }, [selection, currentId, projectId, playing, time]);
    useEffect(() => { const pause = () => { if (globalThis.document.hidden) setPlaying(false); }; globalThis.document.addEventListener("visibilitychange", pause); return () => globalThis.document.removeEventListener("visibilitychange", pause); }, []);
    const seek = (value: number) => { setPlaying(false); setFrameId(""); setSelection((before) => ({ ...before, id: currentId || "", time: Math.max(0, Math.min(duration, value)) })); };
    const reference = () => ({ kind: "director" as const, projectId, entityKind: "segment-design" as const, entityId: current!.id, title: current!.name, subtitle: `${clock(time)}${object ? ` · ${object.name}` : ""}`, timeSeconds: time, objectId: object?.id });
    const run = async (task: () => Promise<void>) => { setBusy(true); try { await task(); } catch (reason) { message.error((reason as Error).message); } finally { setBusy(false); } };
    const generateFrame = async (existing?: LookFrame) => {
        if (!current || !data) return;
        const captured = await directorApi.captureLookFrame(projectId, current.id, existing?.time ?? time, data.hash, existing?.id);
        const store = useAgentStore.getState(), conversation = await agentApi.conversation(projectId, store.currentSessionIds[projectId]);
        const frame = captured.frame;
        const next = await agentApi.send(projectId, { preferredSessionId: conversation.session?.id, clientMessageId: crypto.randomUUID(), submissionMode: ["running", "waiting_for_user"].includes(conversation.session?.status || "") ? "queue" : "direct", content: { version: 1, segments: [
            { type: "director", mentionId: crypto.randomUUID(), projectId, entityKind: "segment-design", entityId: current.id, timeSeconds: frame.time, lookFrameId: frame.id },
            { type: "text", text: existing ? "请重绘选中的定妆帧，先核对当前预演、素材身份和已有提示词，再生成并保存。" : "请生成当前时刻的定妆帧，沿用已建立的定妆帧；等待预演画面提取完成，结合角色身份、场景和风格编写显式提示词，再生成并保存。" },
        ] }, attachmentFileIds: [] });
        if (next.session) store.setCurrentSession(projectId, next.session.id);
        store.openPanel(projectId); setFrameId(frame.id); await load(true); message.success("定妆帧任务已交给 Agent");
    };
    const save = async () => {
        if (!draft) return;
        const result = await directorApi.saveSegmentPlan(projectId, draft);
        setSegments((items) => items.map((item) => item.id === draft.id ? { ...draft, hash: result.hash } : item));
        setDrafts(({ [draft.id]: _saved, ...rest }) => rest); await onRefresh(); await load(true); message.success("分镜段已保存");
    };
    return <section data-testid="director-previs-workspace" className="grid h-full min-h-0 min-w-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden bg-white text-slate-800 max-[1000px]:grid-cols-[180px_minmax(0,1fr)] max-[600px]:grid-cols-[140px_minmax(0,1fr)]">
        <aside aria-label="分镜段列表" className="min-h-0 overflow-y-auto border-r border-slate-200">
            {state.sequences.map((scene) => <section key={scene.id}><h2 className="px-4 pb-2 pt-4 text-[11px] font-medium text-slate-400">{scene.title}</h2>{segments.filter((item) => item.sequenceId === scene.id).sort((a, b) => a.order - b.order).map((segment, index) => <button key={segment.id} aria-label={`选择分镜段 ${segment.name}`} aria-pressed={currentId === segment.id} onClick={() => { setPlaying(false); setFrameId(""); setSelection({ id: segment.id, time: 0 }); }} className={`flex w-full gap-3 border-l-2 px-3 py-4 text-left hover:bg-slate-50 ${currentId === segment.id ? "border-blue-600 bg-blue-50/60" : "border-transparent"}`}><span className="font-mono text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium leading-5">{segment.name}</span><span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-slate-500">{segment.action || segment.purpose}</span><span className="mt-1 block text-[10px] text-slate-400">{segment.estimatedSeconds ? `${segment.estimatedSeconds} 秒` : "时长待安排"} · {state.videoSegments.find((task) => task.payload.segmentId === segment.id)?.payload.videoFileId ? "已生成" : "未生成"}{state.videoSegments.find((task) => task.payload.segmentId === segment.id)?.payload.videoStale ? " · 待检查" : ""}{drafts[segment.id] ? " · 未保存" : ""}</span></span></button>)}</section>)}
        </aside>
        <div className="min-h-0 min-w-0 overflow-y-auto" aria-label="分镜预演工作区">
            <header className="flex min-h-12 flex-wrap items-center gap-2 px-5 py-2"><h1 className="text-sm font-medium">{current?.name || "分镜与预演"}</h1>{current?.estimatedSeconds ? <span className="text-xs text-slate-400">整段 {current.estimatedSeconds} 秒</span> : null}<span className="flex-1" /><button className={action} onClick={() => current ? prepare(projectId, reference()) : prepare(projectId, { kind: "director", projectId, entityKind: "script", entityId: "script", title: "剧本", subtitle: "分镜编排" })}><Bot size={14} />{current ? "交给 Agent 修订" : "交给 Agent 编排"}</button></header>
            {data?.warnings?.map((warning) => <p key={warning} className="px-5 pb-2 text-xs text-amber-700">{warning}</p>)}
            {error && <p role="alert" className="px-5 pb-3 text-xs text-rose-600">{error}</p>}
            <div className={`mx-5 grid min-w-0 gap-4 ${selectedFrame ? "grid-cols-[minmax(0,1fr)_minmax(180px,28%)] max-[1100px]:grid-cols-1" : "grid-cols-1"}`}>
                {canPlay && data?.scene && data.plan ? <PrevisViewport scene={data.scene} plan={data.plan} time={time} aspectRatio={data.aspectRatio} onSelect={(objectId) => setSelection((before) => ({ ...before, objectId }))} /> : <div className="flex min-h-72 flex-col items-center justify-center bg-slate-50 px-6 text-center text-slate-400"><Box size={36} strokeWidth={1} /><p className="mt-4 text-sm">{data?.previsMode === "skip" ? "本段已选择跳过预演" : "让 Agent 编排这段戏的空间与动作"}</p>{data?.diagnostics.map((item) => <p className="mt-2 text-xs leading-5" key={item}>{item}</p>)}</div>}
                {selectedFrame && <aside aria-label="定妆帧" className="flex min-w-0 flex-col"><div className="mb-2 flex items-center gap-2 text-xs"><span className="flex-1">定妆帧 · {clock(selectedFrame.time)}</span>{selectedFrame.stale && <span className="text-amber-700">待检查</span>}</div>{selectedFrame.fileId ? <a href={directorMediaUrl(selectedFrame.fileId)} target="_blank" rel="noreferrer" className="flex min-h-40 flex-1 items-center bg-slate-50"><img alt={`${current?.name} 定妆帧`} className="w-full object-contain" src={`${directorMediaUrl(selectedFrame.fileId)}${directorMediaUrl(selectedFrame.fileId).includes("?") ? "&" : "?"}v=${mediaVersion}`} /></a> : <div className="flex min-h-40 flex-1 items-center justify-center bg-slate-50 text-xs text-slate-400">等待 Agent 生成图片</div>}<div className="mt-2 flex flex-wrap items-center gap-1"><label className="mr-auto flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={selectedFrame.useForVideo} disabled={busy || !selectedFrame.fileId} onChange={(event) => void run(async () => { await directorApi.updateLookFrame(projectId, current!.id, selectedFrame.id, { expectedHash: data!.hash, useForVideo: event.target.checked }); await load(true); })} />用于视频制作</label><button className={action} disabled={busy} onClick={() => void run(() => generateFrame(selectedFrame))}><ImageIcon size={13} />重绘</button><button aria-label="移除定妆帧" className={action} disabled={busy} onClick={() => void run(async () => { await directorApi.updateLookFrame(projectId, current!.id, selectedFrame.id, { expectedHash: data!.hash, remove: true }); setFrameId(""); await load(true); })}><Trash2 size={13} /></button></div><details className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer">提示词与参考输入</summary><p className="mt-2 whitespace-pre-wrap leading-5">{selectedFrame.prompt || "尚未编写提示词"}</p>{selectedFrame.references.map((item) => <p key={item.path} title={item.path}>{item.label || item.purpose}</p>)}</details></aside>}
            </div>
            {current && <section aria-label="预演时间轴" className="px-5 pb-4 pt-3">
                <div className="flex flex-wrap items-center gap-1"><button aria-label="后退一帧" className={action} disabled={!canPlay} onClick={() => seek(time - 1 / 24)}><SkipBack size={14} /></button><button aria-label={playing ? "暂停预演" : "播放预演"} className={action} disabled={!canPlay} onClick={() => { if (time >= duration) seek(0); setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button aria-label="前进一帧" className={action} disabled={!canPlay} onClick={() => seek(time + 1 / 24)}><SkipForward size={14} /></button><span className="ml-2 font-mono text-[11px] text-slate-400">{clock(time)} / {clock(duration)}</span><span className="flex-1" /><button className={action} disabled={!canPlay || busy} onClick={() => void run(() => generateFrame())}><ImageIcon size={14} />生成当前帧定妆图</button><button className={action} disabled={!canPlay || busy} onClick={() => void run(async () => { await directorApi.renderPrevis(projectId, current.id, data!.hash); message.success("预演导出已提交"); })}><Download size={14} />导出预演</button></div>
                <input aria-label="预演时间" type="range" min={0} max={duration || 1} step={1 / 24} value={time} disabled={!canPlay} onChange={(event) => seek(Number(event.target.value))} className="my-2 block w-full accent-blue-600" />
                <div className="flex h-7 overflow-hidden rounded bg-slate-50">{data?.plan?.shots.map((shot) => <button key={shot.id} title={`${shot.name} · ${clock(shot.start)}–${clock(shot.end)}`} onClick={() => seek(shot.start)} className={`truncate border-r border-white px-2 text-left text-[10px] ${time >= shot.start && time < shot.end ? "bg-blue-50 text-blue-700" : "text-slate-500"}`} style={{ width: `${(shot.end - shot.start) / duration * 100}%` }}>{shot.name}</button>)}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">{data?.plan?.actions.map((item) => <button key={item.id} onClick={() => seek(item.start)} title={item.kind}>{clock(item.start)} · {data.scene?.objects.find((object) => object.id === item.objectId)?.name} · {({ stand: "站立", walk: "行走", run: "跑动", turn: "转身", look: "看向", raise: "抬手", point: "指向", hold: "持物", give: "递物", touch: "接触" })[item.kind]}</button>)}{data?.plan?.dialogue.map((item) => <button key={item.id} title={item.text} onClick={() => seek(item.start)}>{clock(item.start)} · 对白</button>)}{data?.lookFrames.map((frame) => <button key={frame.id} className="text-blue-600" onClick={() => { seek(frame.time); setFrameId(frame.id); }}>{clock(frame.time)} · 定妆帧</button>)}</div>
                {data && exportJob && <div aria-label="预演导出状态" className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    {exporting && <><span>{exportJob.status === "queued" ? "等待导出" : `正在导出 ${Math.round(exportJob.progress * 100)}%`}</span><button className={action} disabled={busy} onClick={() => void run(async () => { await directorApi.controlPrevisRender(projectId, exportJob.id, "cancel"); })}>取消</button></>}
                    {exportJob.status === "failed" && <><span>导出失败：{exportJob.error || "请重试"}</span><button className={action} disabled={busy || !canPlay} onClick={() => void run(async () => { if (exportJob.sourceHash === data.hash) await directorApi.controlPrevisRender(projectId, exportJob.id, "retry"); else await directorApi.renderPrevis(projectId, current.id, data.hash); })}>重试</button></>}
                    {exportedVideo?.result && <a className="text-blue-600" href={directorMediaUrl(exportedVideo.result.fileId)} target="_blank" rel="noreferrer">查看导出视频</a>}
                    {!exporting && (exportedVideo || exportJob).sourceHash !== data.hash && <span className="text-amber-700">需重新导出</span>}
                </div>}
            </section>}
            {data && <section aria-label="本段引用素材" className="border-t border-slate-100 px-5 py-4">
                <h2 className="mb-3 text-xs font-medium">本段引用素材</h2>
                {data.assetReferences.length ? <div className="flex gap-4 overflow-x-auto">{data.assetReferences.map((reference) => <button key={`${reference.assetId || reference.objectIds[0]}:${reference.variantId || ""}`} title={reference.reason || reference.name} onClick={() => setSelection((before) => ({ ...before, objectId: reference.objectIds[0] }))} className={`w-24 shrink-0 text-left ${reference.objectIds.includes(object?.id || "") ? "text-blue-700" : "text-slate-500"}`}>
                    {reference.fileId ? <img alt={reference.name} src={directorMediaUrl(reference.fileId)} className="h-14 w-full object-contain" /> : <ImageIcon size={26} strokeWidth={1} className="mx-auto my-3.5" />}
                    <span className="mt-1 block truncate text-[11px]">{reference.name}</span>
                    {reference.status !== "ready" && <span className="mt-1 block text-[10px] text-amber-700">{reference.status === "unbound" ? "待绑定" : "待生成"}</span>}
                </button>)}</div> : <p className="text-xs text-slate-400">本段暂无独立素材引用</p>}
            </section>}
            {object && <p aria-label="当前预演对象" className="px-5 pb-4 text-xs text-slate-500">{object.name} · {selectedReference ? selectedReference.status === "unbound" ? "待绑定素材身份" : "已绑定素材身份" : "预演对象"} · 当前{currentActions.length ? currentActions.map((item) => ({ stand: "站立", walk: "行走", run: "跑动", turn: "转身", look: "看向", raise: "抬手", point: "指向", hold: "持物", give: "递物", touch: "接触" })[item.kind]).join("、") : "保持状态"}</p>}

            {current && <section aria-label="分镜段设计" className="border-t border-slate-100 px-5 py-4"><div className="mb-4 flex items-center"><h2 className="flex-1 text-xs font-medium">分镜段设计</h2>{draft ? <><button className={action} disabled={busy} onClick={() => void run(save)}><Save size={14} />保存</button><button className={action} onClick={() => setDrafts(({ [current.id]: _cancelled, ...rest }) => rest)}>取消</button></> : <button className={action} onClick={() => setDrafts((values) => ({ ...values, [current.id]: { ...current } }))}><Pencil size={14} />编辑</button>}</div>{draft ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-500">名称<input className="mt-2 w-full border-b border-slate-200 py-1 text-slate-800 outline-none" value={draft.name} onChange={(event) => setDrafts((values) => ({ ...values, [current.id]: { ...draft, name: event.target.value } }))} /></label><label className="text-xs text-slate-500">整段视频时长{current.videoLimits ? `（${current.videoLimits.min}–${current.videoLimits.max} 秒）` : "（秒）"}<input type="number" min={current.videoLimits?.min} max={current.videoLimits?.max} step={.01} className="mt-2 w-full border-b border-slate-200 py-1 text-slate-800 outline-none" value={draft.estimatedSeconds || ""} onChange={(event) => setDrafts((values) => ({ ...values, [current.id]: { ...draft, estimatedSeconds: Number(event.target.value) } }))} /></label><label className="col-span-full flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={draft.previsMode === "skip"} onChange={(event) => setDrafts((values) => ({ ...values, [current.id]: { ...draft, previsMode: event.target.checked ? "skip" : "required" } }))} />本段跳过预演，直接使用文字与参考素材制作</label>{fields.map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<textarea className="mt-2 min-h-20 w-full resize-y rounded border border-slate-200 p-2 text-xs leading-6 text-slate-700 outline-none focus:border-blue-400" value={draft[key]} onChange={(event) => setDrafts((values) => ({ ...values, [current.id]: { ...draft, [key]: event.target.value } }))} /></label>)}</div> : <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{fields.filter(([key]) => current[key]).map(([key, label]) => <div key={key}><h3 className="mb-1 text-[11px] text-slate-400">{label}</h3><p className="whitespace-pre-wrap text-xs leading-6 text-slate-600">{current[key]}</p></div>)}{current.content && <p className="col-span-full whitespace-pre-wrap text-xs leading-6 text-slate-600">{current.content}</p>}</div>}</section>}
        </div>
    </section>;
}
