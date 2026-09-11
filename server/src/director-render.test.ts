import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileDirectorStoryboardPrompt, extractDirectorStoryboardOpeningFrame, resolveH3Route, resolveStoryboardImageModelPlan } from "./director-render.js";

test("起始锚点只裁取整张故事板的第一画格，支持三种布局", async () => {
    const directory = await mkdtemp(join(tmpdir(), "storyboard-guide-test-"));
    const run = promisify(execFile);
    try {
        for (const layout of ["2x2", "3x2", "3x3"] as const) {
            const columns = layout === "2x2" ? 2 : 3;
            const rows = layout === "3x3" ? 3 : 2;
            const width = 600, height = 600;
            const pixels = Buffer.alloc(width * height * 3);
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                pixels[(y * width + x) * 3 + (x < width / columns && y < height / rows ? 0 : 1)] = 255;
            }
            const source = join(directory, `${layout}.ppm`), output = join(directory, `${layout}.png`);
            await writeFile(source, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
            await extractDirectorStoryboardOpeningFrame(source, output, layout);
            const { stdout } = await run("ffmpeg", ["-v", "error", "-i", output, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 2_000_000 });
            assert.equal(stdout.length, (width / columns - 4) * (height / rows - 4) * 3);
            for (let i = 0; i < stdout.length; i += 3) assert.deepEqual([...stdout.subarray(i, i + 3)], [255, 0, 0]);
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
});

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
    const prompt = compileDirectorStoryboardPrompt("晨会", { durationSeconds: 8, dramaticBeat: "会议室从松散变为安静", openingState: "员工仍在交谈", endingState: "所有人看向白板" }, sheet([1, 1, 1, 1]), "真实职场，奶油高光，短促切镜，快速蒙太奇", { positioning: "都市职场现实喜剧，面向成年观众", photography: "稳定观察", performance: "克制生活化", pacing: "完整动作优先", sound: "保留办公室环境声", prohibitions: "禁止无意义慢动作" });
    assert.match(prompt, /Visual appearance only/);
    assert.match(prompt, /Ignore any editing-rhythm, rapid-cut, montage or pacing instructions/);
    assert.match(prompt, /Within one Shot, keep the same camera setup/);
    assert.match(prompt, /Project directing rules: creative positioning — 都市职场现实喜剧，面向成年观众; core intent — not specified; photography — 稳定观察/);
    assert.match(prompt, /prohibitions — 禁止无意义慢动作/);
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
