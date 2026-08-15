import assert from "node:assert/strict";
import test from "node:test";
import { compileH3Prompt } from "./h3-prompt.js";

const sheet = { frames: [
    { shotNumber: 1, timeSeconds: 0, description: "受辱·夺玉", action: "", cameraAngle: "", cameraMove: "", sound: "脚步踩雪" },
    { shotNumber: 1, timeSeconds: 10, description: "受辱·夺玉", action: "", cameraAngle: "", cameraMove: "", sound: "玉佩落地" },
] };

test("H3 FL2VA 遵循官方结构且只允许对白中文进入可发声块", () => {
    const prompt = compileH3Prompt("fl2va", { durationSeconds: 10, dialogue: "赵天昊：「听说你娘给你留了块玉？」", audio: "脚步踩雪、玉佩落地" }, sheet);
    assert.match(prompt, /^How the reference pictures align with the target video/);
    assert.match(prompt, /integrated_multimodal_description: \[Shot 1\]/);
    assert.match(prompt, /<d>\[Chinese\] 听说你娘给你留了块玉？<\/d>/);
    assert.match(prompt, /No other speech, narration, singing, or vocalization occurs/);
    assert.match(prompt, /non_diegetic_music: N\/A$/);
    assert.doesNotMatch(prompt, /Title:/);
    assert.doesNotMatch(prompt, /受辱·夺玉/);
    assert.doesNotMatch(prompt, /赵天昊/);
    assert.doesNotMatch(prompt, /脚步踩雪/);
});

test("H3 无对白时明确禁止人声，Ref2VA 保持官方六段顺序", () => {
    const prompt = compileH3Prompt("ref2va", { durationSeconds: 8 }, sheet);
    const fields = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"];
    assert.deepEqual(fields.map((field) => prompt.indexOf(field)), [...fields.map((field) => prompt.indexOf(field))].sort((a, b) => a - b));
    assert.match(prompt, /No character speaks, sings, narrates, or vocalizes/);
    assert.doesNotMatch(prompt, /受辱·夺玉/);
});
