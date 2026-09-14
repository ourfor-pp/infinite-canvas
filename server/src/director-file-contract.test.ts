import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import matter from "gray-matter";
import { parse } from "yaml";
import { segmentFileSchema, storyboardFileSchema, timelineFileSchema } from "./director-file-contract.js";

const read = (path: string) => readFileSync(new URL(`./agent/scenes/director/skills/${path}`, import.meta.url), "utf8");
const board = () => parse(read("director-plan-storyboards/references/examples/storyboard.yaml"));
const segment = () => matter(read("director-plan-storyboards/references/examples/segment.md")).data;
const timeline = () => JSON.parse(read("director-arrange-timeline/references/timeline.json"));

test("随 Skill 发布的完整样例符合实际文件契约", () => {
    assert.equal(segmentFileSchema.parse(segment()).sourceBeatIds?.[0], "beat-001");
    assert.equal(storyboardFileSchema.parse(board()).frames.length, 4);
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
    const duplicate = timeline(); duplicate.segmentOrder.push("segment-001");
    assert.equal(timelineFileSchema.safeParse(duplicate).success, false);
    const frame = board(); frame.frames[1].timeSeconds = 0;
    assert.equal(storyboardFileSchema.safeParse(frame).success, false);
    const dialogue = board(); dialogue.frames[0].dialogues = [{ speakerAssetId: "char", speakerName: "甲", text: "你好", language: "zh-CN", delivery: "quiet", startSeconds: 3, endSeconds: 1 }];
    assert.equal(storyboardFileSchema.safeParse(dialogue).success, false);
    const audio = segment(); audio.audioReferences = [{ path: "voice.wav", purpose: "voice", description: "A calm voice." }];
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
