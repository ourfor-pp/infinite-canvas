export type H3CumulativeMedia = { fileId: string; chain: Array<{ segmentId: string; generationId: string; frames: number }> };
export type H3MediaRange = { fileId: string; trimIn: number; duration: number };

// Adjacent segments use the latest shared decode, including its revised VAE tail.
export function planH3CumulativeSources(segmentIds: string[], cumulative: Map<string, H3CumulativeMedia>) {
    const sources = new Map<string, H3MediaRange>();
    segmentIds.forEach((id, index) => {
        const media = cumulative.get(id);
        if (!media) return;
        const chain = media.chain;
        if (chain.at(-1)?.segmentId !== id) throw new Error("累计视频末段与时间线不一致");
        for (let sourceIndex = chain.length - 1, timelineIndex = index; sourceIndex >= 0 && timelineIndex >= 0; sourceIndex--, timelineIndex--) {
            const segment = chain[sourceIndex];
            if (segment.segmentId !== segmentIds[timelineIndex]) break;
            const start = chain[sourceIndex - 1]?.frames || 0;
            if (segment.frames <= start) throw new Error("累计视频帧数必须递增");
            sources.set(segment.segmentId, { fileId: media.fileId, trimIn: start / 24, duration: (segment.frames - start) / 24 });
        }
    });
    return sources;
}

// A production source is independent of edit order. Repeated or interleaved clips
// use the same decoded range; a selected descendant supplies its validated chain.
export function planH3TaskSources(taskIds: string[], cumulative: Map<string, H3CumulativeMedia>) {
    const needed = new Set(taskIds);
    const sources = new Map<string, H3MediaRange>();
    for (const [id, media] of [...cumulative].sort((a, b) => a[1].chain.length - b[1].chain.length)) {
        if (media.chain.at(-1)?.segmentId !== id) throw new Error("累计视频末任务不一致");
        media.chain.forEach((task, index) => {
            const start = media.chain[index - 1]?.frames || 0;
            if (task.frames <= start) throw new Error("累计视频帧数必须递增");
            if (needed.has(task.segmentId)) sources.set(task.segmentId, { fileId: media.fileId, trimIn: start / 24, duration: (task.frames - start) / 24 });
        });
    }
    return sources;
}
