import { useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { Bot, Image as ImageIcon, Save, ArrowLeft, Pencil } from "lucide-react";
import { readDirectorQuery, readDirectorShotDesigns } from "@/services/director-queries";
import { directorApi } from "@/services/api/director";
import { useAgentStore } from "@/stores/use-agent-store";
import type { DirectorShotStoryboard, DirectorShotDesign, DirectorState } from "@/types/director";
import { WorkspaceImagePreviewLightbox, type WorkspaceImagePreviewItem } from "@/components/workspace-image-preview-lightbox";
import { directorMediaUrl, useDirectorResourceVersion } from "./use-director-sync";

const action = "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-blue-700 disabled:opacity-40";
const field = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500";
const textFields = [["purpose", "叙事目的"], ["staging", "人物调度"], ["camera", "画面与摄影"], ["action", "动作与表演"], ["dialogue", "对白"], ["sound", "声音"], ["openingState", "开始状态"], ["endingState", "结束状态"], ["connection", "前后衔接"]] as const;
type Props = { projectId: string; state: DirectorState; onRefresh: () => Promise<void> };

export function ShotWorkspace({ projectId, state, onRefresh }: Props) {
    const { message } = App.useApp();
    const prepare = useAgentStore((store) => store.prepareComposer);
    const version = useDirectorResourceVersion(projectId, "segments");
    const [selection, setSelection] = useState<{ sceneId: string; shotId?: string }>(() => {
        try { return JSON.parse(localStorage.getItem(`director-board-view:${projectId}`) || "null") || { sceneId: "" }; } catch { return { sceneId: "" }; }
    });
    const { sceneId, shotId } = selection;
    const select = (patch: Partial<typeof selection>) => {
        const next = { ...selection, ...patch }; setSelection(next);
        try { localStorage.setItem(`director-board-view:${projectId}`, JSON.stringify(next)); } catch { /* UI preference is optional. */ }
    };
    const [preview, setPreview] = useState<WorkspaceImagePreviewItem[]>([]);
    const [shots, setShots] = useState<DirectorShotDesign[]>([]);
    const [editing, setEditing] = useState<DirectorShotDesign>();
    const orderedShots = state.sequences.flatMap((scene) => shots.filter((shot) => shot.sequenceId === scene.id).sort((a, b) => a.order - b.order));
    const currentShot = orderedShots.find((item) => item.id === shotId) || orderedShots.find((item) => item.sequenceId === sceneId) || orderedShots[0];
    const sequence = state.sequences.find((item) => item.id === (currentShot?.sequenceId || sceneId)) || state.sequences[0];
    const mediaVersion = useDirectorResourceVersion(projectId, "media");
    const boardCache = useMemo(() => new Map<string, { shotId: string; items: DirectorShotStoryboard[]; total: number }>(), [projectId, version, mediaVersion]);
    const [, refreshBoards] = useState(0);
    const [boardError, setBoardError] = useState("");
    const boards = currentShot ? boardCache.get(currentShot.id)?.items || [] : [];
    useEffect(() => {
        let active = true; setBoardError("");
        if (currentShot && !boardCache.has(currentShot.id)) void readDirectorQuery(projectId, "segments", ["shot-storyboard", currentShot.id], () => directorApi.shotStoryboards(projectId, currentShot.id, 0)).then((result) => {
            if (boardCache.size >= 64) boardCache.delete(boardCache.keys().next().value!);
            boardCache.set(currentShot.id, result);
            if (active) refreshBoards((value) => value + 1);
        }).catch((error) => { if (active) setBoardError(error.message); });
        return () => { active = false; };
    }, [projectId, currentShot?.id, boardCache]);
    const selected = boards[0];
    const sheet = selected;
    const boardUrl = (image: { fileId: string; hash: string }) => `${directorMediaUrl(image.fileId)}${directorMediaUrl(image.fileId).includes("?") ? "&" : "?"}hash=${image.hash}`;
    useEffect(() => {
        let active = true;
        void readDirectorShotDesigns(projectId).then((items) => { if (active) setShots(items); }).catch((error) => { if (active) message.error(error.message); });
        return () => { active = false; };
    }, [projectId, version, message]);
    const giveAgent = (instruction: string) => prepare(projectId, { kind: "director", projectId, entityKind: currentShot ? "shot-design" : "script", entityId: currentShot ? currentShot.id : "script", title: currentShot ? currentShot.name : sequence?.title || "分镜策划", subtitle: "故事板与镜头表达", instruction: `当前场景：${sequence?.title || "按剧本场景"}。${sheet ? `当前故事板目录：${sheet.id}；提示词：${sheet.promptPath}。` : ""}${instruction} 本轮只处理故事板、镜头与声音说明，不创建或提交视频生成。` });
    const openImage = (fileId: string, title: string, hash?: string) => setPreview([{ id: fileId, url: hash ? boardUrl({ fileId, hash }) : directorMediaUrl(fileId), alt: title }]);
    const editShot = async (shot: DirectorShotDesign) => {
        try {
            const file = await directorApi.file(projectId, shot.path!);
            setEditing({ ...shot, hash: file.hash, content: file.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "") });
        } catch (error) { message.error(error instanceof Error ? error.message : "读取镜头失败"); }
    };
    if (editing) return <ShotEditor projectId={projectId} state={state} design={editing} onClose={() => setEditing(undefined)} onSaved={async (saved) => { setShots((items) => items.map((item) => item.id === saved.id ? saved : item)); setEditing(saved); await onRefresh(); }} />;
    return <section data-testid="director-storyboard-card" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white text-slate-800">
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[240px_minmax(0,1fr)] max-[1000px]:grid-cols-[200px_minmax(0,1fr)] max-[600px]:grid-cols-[150px_minmax(0,1fr)]">
            <aside aria-label="镜头列表" className="min-h-0 overflow-y-auto border-r border-slate-200">
                {state.sequences.map((scene) => <section key={scene.id}><h2 className="px-4 pb-2 pt-3 text-[11px] font-medium text-slate-400">{scene.title}</h2>{orderedShots.filter((shot) => shot.sequenceId === scene.id).map((shot, index) => <div key={shot.id} className={`group relative border-l-2 ${shot.id === currentShot?.id ? "border-blue-600 bg-blue-50/70" : "border-transparent"}`}>
                    <button aria-label={`选择镜头 ${shot.name}`} aria-pressed={shot.id === currentShot?.id} onClick={() => { select({ shotId: shot.id, sceneId: shot.sequenceId }); }} className="flex w-full gap-3 px-3 py-4 text-left hover:bg-slate-50/70"><span className="pt-0.5 font-mono text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><h3 className="pr-3 text-xs font-medium leading-5">{shot.name}</h3><p className="mt-1 line-clamp-1 text-[11px] text-slate-400">{shot.camera}</p><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{shot.action || shot.purpose}</p></div></button>
                    <button aria-label={`编辑镜头 ${shot.name}`} className="absolute right-1 top-3 rounded p-1.5 text-slate-400 opacity-0 hover:text-blue-600 focus:opacity-100 group-hover:opacity-100" onClick={() => void editShot(shot)}><Pencil size={12} /></button>
                </div>)}{!shots.some((shot) => shot.sequenceId === scene.id) && <p className="px-4 pb-3 text-xs text-slate-400">尚无镜头设计</p>}</section>)}
            </aside>
            <div aria-label="故事板工作区" className="min-h-0 min-w-0 overflow-y-auto">
                {boardError && <p role="alert" className="px-5 py-3 text-xs text-rose-600">{boardError}</p>}
                {sheet?.errors.map((error) => <p role="alert" key={error} className="px-5 py-2 text-xs text-rose-600">{error}</p>)}
                <section aria-label="当前故事板" className="px-5 pb-4 pt-3">
                    <header className="mb-3 flex flex-wrap items-center gap-3"><h1 className="text-sm font-semibold">{selected?.title || currentShot?.name || "故事板"}</h1><span className="flex-1" /><button className={action} onClick={() => giveAgent("请先核对本页分镜说明与显式参考，展示或修订最终生图提示词，再用原生生图能力绘制这张完整故事板，按工程约定保存并登记。保留其他故事板。") }><ImageIcon size={14} />{sheet?.image?.fileId ? "重绘故事板" : "绘制故事板"}</button><button className={action} disabled={!currentShot} onClick={() => { if (currentShot) prepare(projectId, { kind: "director", projectId, entityKind: "shot-design", entityId: currentShot.id, title: currentShot.name, subtitle: "镜头" }); }}><Bot size={14} />交给 Agent 修订</button></header>
                    <div data-testid="director-storyboard-sheet" className="min-w-0 bg-slate-50/50">{sheet?.image?.fileId ? <button aria-label="放大查看完整故事板" className="block w-full cursor-zoom-in" onClick={() => openImage(sheet.image!.fileId, selected.title, sheet.image!.hash)}><img alt={selected.title} src={boardUrl(sheet.image!)} draggable={false} className="block h-auto w-full object-contain" /></button> : <div className="flex min-h-64 flex-col items-center justify-center text-slate-400"><ImageIcon size={36} strokeWidth={1} /><p className="mt-4 text-sm">{selected ? "这张故事板还未绘制" : "当前镜头尚无故事板"}</p><p className="mt-2 px-4 text-xs">{currentShot?.purpose || "先安排画面、动作和镜头衔接"}</p></div>}</div>
                </section>
                <section aria-label="引用素材" className="border-t border-slate-200 px-5 py-3"><h2 className="mb-3 text-xs font-semibold">引用素材</h2><div className="flex gap-4 overflow-x-auto">{sheet?.references?.map((item, index) => <button key={`${item.fileId}:${index}`} className="w-28 shrink-0 text-left" disabled={!item.fileId} onClick={() => { if (item.fileId) openImage(item.fileId, item.name, item.hash); }}>{item.fileId ? <img alt={item.name} src={item.hash ? boardUrl({ fileId: item.fileId, hash: item.hash }) : directorMediaUrl(item.fileId)} className="h-16 w-full object-contain" /> : <span className="block py-4 text-xs text-rose-600">{item.error}</span>}<span className="mt-1 block truncate text-[11px] text-slate-500">{item.name}</span></button>)}{!sheet?.references?.length && <p className="py-2 text-xs text-slate-400">尚未记录本页引用素材</p>}</div></section>
                <section aria-label="故事板提示词" className="border-t border-slate-200 px-5 py-4"><div className="mb-3 flex items-center"><h2 className="flex-1 text-xs font-semibold">故事板提示词</h2></div><p className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">{sheet?.prompt || "尚未记录故事板提示词。绘制前由 Agent 明确提示词和引用输入。"}</p></section>
            </div>
        </div>
        <WorkspaceImagePreviewLightbox items={preview} activeIndex={preview.length ? 0 : null} onClose={() => setPreview([])} onChangeIndex={() => {}} />
    </section>;
}

function ShotEditor({ projectId, design, state, onClose, onSaved }: { projectId: string; design: DirectorShotDesign; state: DirectorState; onClose: () => void; onSaved: (saved: DirectorShotDesign) => Promise<void> }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState(design);
    const [busy, setBusy] = useState(false);
    const save = async () => { setBusy(true); try { const value = await directorApi.saveShotDesign(projectId, draft); setDraft({ ...draft, hash: value.hash }); await onSaved({ ...draft, hash: value.hash }); message.success("镜头已保存"); } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); } };
    const patch = (value: Partial<DirectorShotDesign>) => setDraft((current) => ({ ...current, ...value }));
    return <section className="h-full overflow-auto bg-white px-8 pb-10 text-slate-800">
        <div className="sticky top-0 z-10 -mx-8 mb-6 flex items-center gap-3 border-b border-slate-100 bg-white px-6 py-3"><button className={action} onClick={onClose}><ArrowLeft size={15} />返回故事板</button><span className="flex-1" /><button className={action} disabled={busy} onClick={() => void save()}><Save size={15} />保存镜头</button></div>
        <input aria-label="镜头名称" className="mb-6 w-full border-0 text-2xl font-semibold outline-none" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        <div className="mb-6 grid grid-cols-2 gap-4"><label className="text-xs text-slate-500">所属场景<select className={`${field} mt-2`} value={draft.sequenceId} onChange={(event) => patch({ sequenceId: event.target.value })}>{state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.title}</option>)}</select></label><label className="text-xs text-slate-500">预计时长（秒）<input className={`${field} mt-2`} type="number" min={.01} step={.01} value={draft.estimatedSeconds || ""} onChange={(event) => patch({ estimatedSeconds: Number(event.target.value) || undefined })} /></label></div>
        <div className="mb-6 grid grid-cols-2 gap-4"><label className="text-xs text-slate-500">来源场次<select className={`${field} mt-2`} value={draft.sourceSceneId || ""} onChange={(event) => patch({ sourceSceneId: event.target.value || undefined, sourceBeatIds: [] })}><option value="">待指定</option>{state.screenplayBreakdown.payload.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label><label className="text-xs text-slate-500">来源节拍<select multiple className={`${field} mt-2`} value={draft.sourceBeatIds} onChange={(event) => patch({ sourceBeatIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}>{state.screenplayBreakdown.payload.scenes.find((scene) => scene.id === draft.sourceSceneId)?.beats.map((beat) => <option key={beat.id} value={beat.id}>{beat.summary}</option>)}</select></label></div>
        <div className="grid gap-5 lg:grid-cols-2">{textFields.map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<textarea className={`${field} mt-2 min-h-24 resize-y`} value={draft[key]} onChange={(event) => patch({ [key]: event.target.value })} /></label>)}</div>
        <label className="mt-5 block text-xs text-slate-500">补充镜头设计<textarea className={`${field} mt-2 min-h-32`} value={draft.content} onChange={(event) => patch({ content: event.target.value })} /></label>
        <label className="mt-5 block text-xs text-slate-500">参考图片（工程内路径，每行一张，可留空）<textarea className={`${field} mt-2`} value={draft.referenceImages.join("\n")} onChange={(event) => patch({ referenceImages: event.target.value.split("\n").filter(Boolean) })} /></label>

    </section>;
}
