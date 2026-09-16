import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { directorAudioClipFilter, resolveH3Route } from "./director-render.js";

test("普通任务与续接使用参考模式，显式首尾帧过渡独立路由", () => {
    assert.equal(resolveH3Route({ boundary: "cut", referenceImages: [] }).mode, "ref2va");
    assert.equal(resolveH3Route({ boundary: "continue" }).mode, "ref2va");
    assert.equal(resolveH3Route({ generationIntent: "transition" }).mode, "fl2va");
});

test("声音包络按片段局部时间淡入淡出后移到整片位置", async () => {
    const run = promisify(execFile);
    const filter = directorAudioClipFilter({ id: "cue", start: 1, duration: 2, volume: 0.5, fadeIn: 0.5, fadeOut: 1 }, 0);
    const { stdout } = await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-filter_complex", `${filter};[a0]apad,atrim=0:4[out]`, "-map", "[out]", "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 2_000_000 });
    assert.equal(stdout.length, 4 * 48000 * 2 * 4);
    const rms = (start: number, end: number) => {
        let sum = 0; const first = Math.floor(start * 48000) * 2, last = Math.floor(end * 48000) * 2;
        for (let i = first; i < last; i++) sum += stdout.readFloatLE(i * 4) ** 2;
        return Math.sqrt(sum / (last - first));
    };
    assert.equal(rms(0.2, 0.8), 0); assert.equal(rms(3.2, 3.8), 0);
    const plateau = rms(1.7, 1.8);
    assert.ok(Math.abs(rms(1.09, 1.11) / plateau - 0.2) < 0.03);
    assert.ok(Math.abs(rms(2.89, 2.91) / plateau - 0.1) < 0.02);
});

test("合成器拒绝未经文件契约校验的非法淡入淡出", () => {
    for (const value of [-1, 3, Infinity, NaN]) for (const field of ["fadeIn", "fadeOut"]) {
        assert.throws(() => directorAudioClipFilter({ id: "cue", start: 0, duration: 2, [field]: value }, 0), /淡入淡出/);
    }
});
