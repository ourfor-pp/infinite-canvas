import assert from "node:assert/strict";
import test from "node:test";
import { compileDirectorStoryboardPrompt, resolveH3Route, resolveStoryboardImageModelPlan } from "./director-render.js";

const sheet = (shotNumbers: number[]) => ({
    id: "sheet",
    segmentId: "segment",
    revision: 1,
    layout: "2x2" as const,
    frames: shotNumbers.map((shotNumber, position) => ({ id: `frame-${position}`, position, shotNumber, timeSeconds: position * 2, kind: "keyframe" as const, description: "", action: "", cameraAngle: "", cameraMove: "", dialogue: "", sound: "" })),
});

test("普通视频段无论内部 Shot 数量都使用整张故事板 Ref2VA", () => {
    assert.deepEqual(resolveH3Route({ boundary: "cut" }, sheet([1, 1, 1, 1])), { mode: "ref2va", reason: "完整故事板作为视频段构图与动作参考" });
    assert.deepEqual(resolveH3Route({ boundary: "cut" }, sheet([1, 1, 2, 2])), { mode: "ref2va", reason: "完整故事板包含 2 个内部切镜，按整板时序生成" });
});

test("连续段使用 Ref2VA 尾部音视频，独立视觉过渡才使用 FL2VA", () => {
    assert.deepEqual(resolveH3Route({ boundary: "continue" }, sheet([1, 1, 1, 1])), { mode: "ref2va", reason: "连续视频段使用上一段尾部音视频与当前完整故事板续写" });
    assert.deepEqual(resolveH3Route({ generationIntent: "transition" }, sheet([1, 1, 1, 1])), { mode: "fl2va", reason: "视觉过渡使用前段尾帧与后段首帧生成" });
});

test("故事板只继承视觉风格并明确忽略风格中的快切节奏", () => {
    const prompt = compileDirectorStoryboardPrompt("晨会", { durationSeconds: 8, dramaticBeat: "会议室从松散变为安静", openingState: "员工仍在交谈", endingState: "所有人看向白板" }, sheet([1, 1, 1, 1]), "真实职场，奶油高光，短促切镜，快速蒙太奇");
    assert.match(prompt, /Visual appearance only/);
    assert.match(prompt, /Ignore any editing-rhythm, rapid-cut, montage or pacing instructions/);
    assert.match(prompt, /Within one Shot, keep the same camera setup/);
});

test("故事板使用任意已配置图片模型并按其能力路由参考图", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({ fileId: `file-${index}` }));
    assert.deepEqual(resolveStoryboardImageModelPlan({ inputs: ["text", "image"], maxReferenceImages: 3, imagePromptProfile: "generic" }, candidates), {
        imagePromptProfile: "generic", references: candidates.slice(0, 3), omitted: candidates.slice(3),
    });
    assert.deepEqual(resolveStoryboardImageModelPlan({ inputs: ["text"], imagePromptProfile: "gpt-image-2" }, candidates), {
        imagePromptProfile: "gpt-image-2", references: [], omitted: candidates,
    });
});
