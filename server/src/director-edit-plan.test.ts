import assert from "node:assert/strict";
import test from "node:test";
import { resolveEditPlan } from "./director-edit-plan.js";
const source = { taskId: "task", revision: 1, fileId: "cumulative", trimIn: 8, duration: 12, audioFileId: "cumulative", audioTrimIn: 8 };
test("同一任务重复裁切，并以独立片段 ID 和累计素材时间解析", () => {
    const plan = resolveEditPlan({ videoClips: [{ id: "a", taskId: "task", trimIn: 1, trimOut: 4 }, { id: "b", taskId: "task", trimIn: 7, trimOut: 11 }] }, [source]);
    assert.deepEqual(plan.segments.map(({ clipId, trimIn, duration, start }) => ({ clipId, trimIn, duration, start })), [{ clipId: "a", trimIn: 9, duration: 3, start: 0 }, { clipId: "b", trimIn: 15, duration: 4, start: 3 }]);
    assert.deepEqual(plan.audio.map(({ trimIn, start, duration }) => ({ trimIn, start, duration })), [{ trimIn: 9, start: 0, duration: 3 }, { trimIn: 15, start: 3, duration: 4 }]);
    assert.equal(plan.duration, 7);
});
test("解关联原声跨画面边界播放，且不重复附加原声", () => {
    const plan = resolveEditPlan({ videoClips: [{ id: "a", taskId: "task", trimIn: 2, trimOut: 4, linkedAudio: false }, { id: "b", taskId: "task", trimIn: 7, trimOut: 11, linkedAudio: false }], tracks: [{ clips: [{ id: "voice", taskId: "task", start: .5, duration: 5, trimIn: 1, volume: .5 }] }] }, [source]);
    assert.equal(plan.audio.length, 1); assert.equal(plan.audio[0].start, .5); assert.equal(plan.audio[0].trimIn, 9); assert.equal(plan.audio[0].duration, 5);
});
test("任务输出替换为短片时拒绝旧裁切，不静默缩短", () => {
    const edit = { videoClips: [{ id: "repeat", taskId: "task", trimIn: 1, trimOut: 10 }] };
    assert.equal(resolveEditPlan(edit, [source]).segments[0].fileId, "cumulative");
    assert.throws(() => resolveEditPlan(edit, [{ ...source, fileId: "new", duration: 8 }]), /repeat.*超出/);
});
test("生成任务本身不自动进入空剪辑", () => { assert.deepEqual(resolveEditPlan({ videoClips: [] }, [source]), { segments: [], audio: [], duration: 0 }); });
