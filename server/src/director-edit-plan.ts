export type EditVideoClip = { id: string; taskId: string; trimIn: number; trimOut: number; linkedAudio?: boolean };
export type EditAudioClip = { id: string; taskId?: string; segmentId?: string; fileId?: string; start: number; duration: number; trimIn?: number; trimOut?: number; fadeIn?: number; fadeOut?: number; volume?: number; muted?: boolean; loop?: boolean };
export type TaskMedia = { taskId: string; revision: number; fileId: string; trimIn: number; duration: number; audioFileId?: string; audioTrimIn?: number };
export function resolveEditPlan(edit: { videoClips?: EditVideoClip[]; tracks?: Array<{ clips?: EditAudioClip[] }> }, sources: TaskMedia[]) {
    const byId = new Map(sources.map((source) => [source.taskId, source]));
    const audio: EditAudioClip[] = [];
    let start = 0;
    const segments = (edit.videoClips || []).map((clip) => {
        const source = byId.get(clip.taskId);
        if (!source?.fileId) throw new Error(`片段 ${clip.id} 的任务 ${clip.taskId} 尚无可用视频`);
        if (!Number.isFinite(clip.trimIn) || !Number.isFinite(clip.trimOut) || clip.trimIn < 0 || clip.trimOut <= clip.trimIn || clip.trimOut > source.duration + .001) throw new Error(`片段 ${clip.id} 裁切 ${clip.trimIn}–${clip.trimOut} 秒超出任务 ${clip.taskId} 的实际素材 0–${source.duration} 秒，请调整裁切`);
        const duration = clip.trimOut - clip.trimIn;
        if (clip.linkedAudio !== false && source.audioFileId) audio.push({ id: `linked-${clip.id}`, taskId: clip.taskId, fileId: source.audioFileId, start, duration, trimIn: (source.audioTrimIn || 0) + clip.trimIn, volume: 1 });
        const resolved = { clipId: clip.id, taskId: clip.taskId, segmentId: clip.taskId, revision: source.revision, fileId: source.fileId, trimIn: source.trimIn + clip.trimIn, duration, start };
        start += duration;
        return resolved;
    });
    for (const original of (edit.tracks || []).flatMap((track) => track.clips || [])) {
        if (original.muted) continue;
        const taskId = original.taskId || original.segmentId;
        const source = taskId ? byId.get(taskId) : undefined;
        const trimIn = original.trimIn || 0;
        if (taskId && (!source?.audioFileId || !original.loop && trimIn + original.duration > source.duration + .001)) throw new Error(`声音片段 ${original.id} 的任务原声缺失或裁切超出实际长度`);
        const clip = source ? { ...original, fileId: source.audioFileId, trimIn: (source.audioTrimIn || 0) + trimIn } : original;
        if (!clip.fileId) throw new Error(`声音片段 ${clip.id} 尚无可用媒体`);
        audio.push(clip);
    }
    return { segments, audio, duration: start };
}
