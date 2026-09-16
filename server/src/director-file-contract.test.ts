import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import matter from "gray-matter";
import { parsePrevis } from "./previs/model.js";
import { segmentDesignFileSchema, segmentFileSchema, timelineFileSchema } from "./director-file-contract.js";

const read = (path: string) => readFileSync(new URL(`./agent/scenes/director/skills/${path}`, import.meta.url), "utf8");
const sample = () => JSON.parse(read("director-stage-previs/references/example.json"));
const segment = () => ({ id: "task", kind: "production-task", sequenceId: "station", order: 1, durationSeconds: 8, segmentRanges: [{ segmentId: "meeting", start: 0, end: 8 }] });
const timeline = () => JSON.parse(read("director-arrange-timeline/references/timeline.json"));

test("随 Skill 发布的完整样例符合实际文件契约", () => {
    assert.equal(segmentFileSchema.parse(segment()).segmentRanges[0].segmentId, "meeting");
    const { scene, plan } = sample();
    assert.equal(parsePrevis(scene, plan).plan.duration, 24);
    assert.equal(timelineFileSchema.parse(timeline()).tracks?.[0].clips[0].duration, 6);
});

test("拒绝深层时间线、对白和 Shot 错误并定位字段", () => {
    const badTimeline = timeline(); badTimeline.tracks[0].clips[0].duration = -1;
    const result = timelineFileSchema.safeParse(badTimeline);
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues[0].path, ["tracks", 0, "clips", 0, "duration"]);
    for (const path of ["../secret.wav", "/etc/passwd", "https://example.com/a.wav", "inputs/../a.wav"]) {
        const value = timeline(); value.tracks[0].clips[0].path = path;
        assert.equal(timelineFileSchema.safeParse(value).success, false, path);
    }
    const duplicate = timeline(); duplicate.videoClips.push({ ...duplicate.videoClips[0] });
    assert.equal(timelineFileSchema.safeParse(duplicate).success, false);
    const invalidRange = { ...segment(), segmentRanges: [{ segmentId: "meeting", start: 4, end: 2 }] };
    assert.equal(segmentFileSchema.safeParse(invalidRange).success, false);
    const audio = { ...segment(), audioReferences: [{ path: "voice.wav", purpose: "voice", description: "A calm voice." }] };
    assert.equal(segmentFileSchema.safeParse(audio).success, false);
    assert.equal(segmentFileSchema.safeParse({ ...segment(), boundary: "continue" }).success, false);
});

test("时间线保留淡入淡出并拒绝越界包络", () => {
    const value = timeline(); Object.assign(value.tracks[0].clips[0], { fadeIn: 0.5, fadeOut: 1 });
    const clip = timelineFileSchema.parse(value).tracks![0].clips[0];
    assert.equal(clip.fadeIn, 0.5); assert.equal(clip.fadeOut, 1);
    for (const field of ["fadeIn", "fadeOut"]) for (const invalid of [-1, 7, Infinity]) {
        const bad = structuredClone(value); bad.tracks[0].clips[0][field] = invalid;
        const result = timelineFileSchema.safeParse(bad); assert.equal(result.success, false);
        if (!result.success) assert.deepEqual(result.error.issues[0].path, ["tracks", 0, "clips", 0, field]);
    }
});

 test("分镜段时间预算独立于生成窗口，预演默认必需", () => {
    assert.equal(segmentDesignFileSchema.parse({ id: "long", kind: "segment-design", name: "长镜头", sequenceId: "scene", order: 1, estimatedSeconds: 120 }).estimatedSeconds, 120);
    assert.equal(segmentFileSchema.parse({ ...segment(), durationSeconds: 120 }).durationSeconds, 120);
    assert.equal(segmentDesignFileSchema.parse({ id: "s", kind: "segment-design", name: "段", sequenceId: "scene", order: 1 }).previsMode, "required");
    assert.equal(segmentFileSchema.safeParse({ ...segment(), segmentRanges: [] }).success, false);
});
