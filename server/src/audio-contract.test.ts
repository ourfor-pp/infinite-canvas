import assert from "node:assert/strict";
import { test } from "node:test";
import { audioContractFor, audioDefaults, validateAudioInput } from "./audio-contract.js";

test("Qwen 使用专属音色，不混入其他供应商参数", () => {
    const contract = audioContractFor({ id: "qwen3-tts-1.7b-customvoice-local" })!;
    const params = audioDefaults(contract);
    assert.equal(params.speaker, "Vivian");
    assert.equal(params.voice, undefined);
    assert.equal(params.speed, undefined);
    assert.equal(params.format, undefined);
    assert.deepEqual(validateAudioInput(contract, "你好", params, []), []);
    assert.ok(validateAudioInput(contract, "你好", { ...params, voice: "alloy" }, []).length);
    assert.ok(validateAudioInput(contract, "你好", { ...params, speaker: "alloy" }, []).length);
});
test("Base 必须有一段参考，VoiceDesign 必须有描述", () => {
    const base = audioContractFor({ id: "qwen3-tts-1.7b-base-local" })!;
    assert.ok(validateAudioInput(base, "你好", audioDefaults(base), []).some((error) => error.includes("音色参考")));
    assert.deepEqual(validateAudioInput(base, "你好", audioDefaults(base), [{ kind: "audio", transcript: "参考文字" }]), []);
    const design = audioContractFor({ id: "qwen3-tts-1.7b-voicedesign-local" })!;
    assert.ok(validateAudioInput(design, "你好", audioDefaults(design), []).some((error) => error.includes("音色描述")));
    assert.deepEqual(validateAudioInput(design, "你好", { ...audioDefaults(design), instructions: "低沉女声" }, []), []);
});
test("IndexTTS 显式区分音色和情绪参考并限制长度", () => {
    const contract = audioContractFor({ id: "indextts-2.5-local" })!;
    const params = audioDefaults(contract);
    assert.deepEqual(validateAudioInput(contract, "你好", params, [{ role: "reference" }, { role: "emotion" }]), []);
    assert.deepEqual(validateAudioInput(contract, "你好", params, [{ role: "reference" }]), []);
    assert.ok(validateAudioInput(contract, "你好", { ...params, emotionStrength: 1 }, [{ role: "reference" }]).length);
    assert.ok(validateAudioInput(contract, "你好", params, [{ role: "emotion" }]).length);
    assert.ok(validateAudioInput(contract, "你好", params, [{ role: "reference", durationMs: 16000 }]).length);
    assert.ok(validateAudioInput(contract, "你好", { ...params, durationFactor: 3 }, [{ role: "reference" }]).length);
});
test("音乐不接受音色或隐式参考", () => {
    const contract = audioContractFor({ id: "minimax-music3-local" })!;
    assert.equal(contract.mode, "music");
    assert.deepEqual(contract.outputFormats, ["flac"]);
    assert.deepEqual(validateAudioInput(contract, "钢琴", audioDefaults(contract), []), []);
    assert.ok(validateAudioInput(contract, "钢琴", audioDefaults(contract), [{ role: "reference" }]).length);
    assert.ok(validateAudioInput(contract, "钢琴", { ...audioDefaults(contract), seconds: 0 }, []).length);
});
test("云端音色允许按具体模型配置", () => {
    const contract = audioContractFor({ id: "custom", endpoint: "openai-tts", voices: ["speaker-A", "speaker-B"] })!;
    assert.equal(audioDefaults(contract).voice, "speaker-A");
    assert.ok(validateAudioInput(contract, "你好", { ...audioDefaults(contract), voice: "alloy" }, []).length);
});
