import assert from "node:assert/strict";
import { test } from "node:test";
import { videoContractFor, videoDefaults, videoRequestParams, videoReferenceRole, validateVideoInput } from "./video-contract.js";
const contract = (id: string, endpoint?: string) => videoContractFor({ id, endpoint })!;
test("两个提质模型共用分辨率和帧率输入，不要求提示词或生成时长", () => {
    for (const id of ["flashvsr-turbo-local", "seedvr2-local"]) {
        const c = contract(id), params = videoRequestParams(c, videoDefaults(c));
        assert.deepEqual(params, { resolution: "1080p", fps: 48 });
        assert.deepEqual(validateVideoInput(c, "", params, [{ kind: "video" }]), []);
        assert.ok(validateVideoInput(c, "", params, []).length);
        assert.ok(validateVideoInput(c, "", params, [{ kind: "image" }]).length);
        assert.ok(validateVideoInput(c, "", { ...params, seconds: 5 }, [{ kind: "video" }]).length);
        assert.ok(validateVideoInput(c, "change content", params, [{ kind: "video" }]).length);
        assert.deepEqual(videoRequestParams(c, { vquality: "4k", videoFps: "source" }), { resolution: "4k", fps: "source" });
    }
});
test("H3 首尾帧与多参考模型分别校验输入，不夹带云端开关", () => {
    const c = contract("minimax-h3-fl2va-local"), params = videoRequestParams(c, videoDefaults(c));
    assert.deepEqual(params, { seconds: 4, ratio: "16:9", resolution: "480p" });
    assert.ok(validateVideoInput(c, "杯子旋转", params, []).length);
    assert.deepEqual(validateVideoInput(c, "杯子旋转", params, [{ kind: "image", role: videoReferenceRole(c, "image", 0) }]), []);
    assert.ok(validateVideoInput(c, "杯子旋转", params, [{ kind: "video", role: "reference" }]).length);
    const ref = contract("minimax-h3-ref2va-local");
    assert.deepEqual(validateVideoInput(ref, "杯子旋转", params, [{ kind: "video", role: "reference" }]), []);
    assert.ok(validateVideoInput(ref, "杯子旋转", params, [{ kind: "audio", role: "reference" }]).length);
});
test("OpenAI 尺寸与时长不继承其他视频模型设置", () => {
    const c = contract("sora-2", "openai-video"), params = videoRequestParams(c, { ...videoDefaults(c), videoGenerateAudio: "false", vquality: "768p" });
    assert.deepEqual(params, { size: "1280x720", seconds: 4 });
    assert.deepEqual(validateVideoInput(c, "杯子旋转", params, []), []);
    for (const patch of [{ seconds: 6 }, { resolution: "768p" }, { generateAudio: false }, { size: "16:9" }]) assert.ok(validateVideoInput(c, "杯子旋转", { ...params, ...patch }, []).length);
});
test("模型配置控制首尾帧与时长，高分辨率限制前置校验", () => {
    const c = videoContractFor({ id: "veo", endpoint: "gemini-video", videoReferenceRoles: ["first-frame", "last-frame"], videoParameters: { seconds: [8], resolutions: ["720p", "1080p"] } })!;
    const params = videoRequestParams(c, videoDefaults(c));
    assert.deepEqual(validateVideoInput(c, "运动", params, [{ kind: "image", role: "first-frame" }, { kind: "image", role: "last-frame" }]), []);
    assert.ok(validateVideoInput(c, "运动", params, [{ kind: "image", role: "last-frame" }]).length);
    assert.ok(validateVideoInput(c, "运动", params, [{ kind: "image", role: "reference" }]).length);
    assert.ok(validateVideoInput(c, "运动", { ...params, seconds: 4, resolution: "1080p" }, []).length);
    assert.equal(videoContractFor({ id: "unknown" }), undefined);
});
test("Veo 多参考图要求 8 秒且不漏掉参考", () => {
    const c = videoContractFor({ id: "veo", endpoint: "gemini-video", videoReferenceRoles: ["reference"] })!;
    const params = videoRequestParams(c, videoDefaults(c));
    assert.ok(validateVideoInput(c, "运动", { ...params, seconds: 4 }, [{ kind: "image", role: "reference" }]).length);
    assert.deepEqual(validateVideoInput(c, "运动", { ...params, seconds: 8 }, [{ kind: "image", role: "reference" }]), []);
});
