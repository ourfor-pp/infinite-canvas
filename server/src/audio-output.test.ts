import assert from "node:assert/strict";
import { test } from "node:test";
import { playableAudio } from "./audio-output.js";

test("PCM 输出转换为可播放 WAV，已有编码保持原样", async () => {
    const pcm = Buffer.alloc(4800);
    const output = await playableAudio(pcm, "audio/L16;codec=pcm;rate=24000");
    assert.equal(output.mimeType, "audio/wav");
    assert.equal(output.bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(output.bytes.toString("ascii", 8, 12), "WAVE");
    assert.ok(output.bytes.length > pcm.length);
    assert.equal((await playableAudio(pcm, "audio/mpeg")).bytes, pcm);
});
