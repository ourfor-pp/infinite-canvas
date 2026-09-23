import assert from "node:assert/strict";
import { test } from "node:test";
import { imageContractFor, imageContractForMode, imageDefaults, imageRequestParams, validateImageInput } from "./image-contract.js";

test("图片模型的能力与参数限制相互独立", () => {
    const contract = imageContractFor({ id: "qwen-image-2.1-local", imageModes: ["generate", "edit"], maxReferenceImages: 10 })!;
    const params = imageRequestParams(contract, imageDefaults(contract));
    assert.deepEqual(params, { size: "auto", count: 1, background: "auto" });
    assert.deepEqual(validateImageInput(contract, "茶杯", params, 0), []);
    assert.ok(validateImageInput(contract, "茶杯", { ...params, count: 2 }, 0).length);
    assert.ok(validateImageInput(contract, "茶杯", params, 11).length);
    assert.deepEqual(validateImageInput(contract, "茶杯", { ...params, size: "1536x1024" }, 1), []);
    assert.match(imageContractForMode(contract, true).sizeLabel, /自动跟随参考图/);
});
test("Gemini 使用比例，不能混入像素尺寸、质量和透明背景", () => {
    const contract = imageContractFor({ id: "gemini", endpoint: "gemini-image", imageModes: ["generate", "edit"], maxReferenceImages: 3 })!;
    assert.deepEqual(imageRequestParams(contract, { size: "16:9", quality: "high", background: "transparent", count: 1 }), { size: "16:9", count: 1 });
    assert.ok(validateImageInput(contract, "茶杯", { size: "2048x2048", count: 1 }, 0).length);
    assert.ok(validateImageInput(contract, "茶杯", { size: "16:9", quality: "high" }, 0).length);
});
test("具体模型配置覆盖默认参数，纯编辑模型要求参考", () => {
    const contract = imageContractFor({ id: "custom", endpoint: "openai-images", imageModes: ["edit"], maxReferenceImages: 2, imageParameters: { sizes: ["2048x2048"], qualities: ["high"], backgrounds: [], maxCount: 1 } })!;
    const params = imageRequestParams(contract, imageDefaults(contract));
    assert.deepEqual(params, { size: "2048x2048", count: 1, quality: "high" });
    assert.ok(validateImageInput(contract, "茶杯", params, 0).length);
    assert.deepEqual(validateImageInput(contract, "茶杯", params, 1), []);
    assert.equal(imageContractFor({ id: "realesrgan-x4-local" }), undefined);
});
test("DALL-E 不继承 GPT 图片的透明背景和质量选项", () => {
    const contract = imageContractFor({ id: "dall-e-3", endpoint: "openai-images-generations", imageModes: ["generate"] })!;
    assert.deepEqual(contract.qualities, ["standard", "hd"]);
    assert.equal(contract.maxCount, 1);
    assert.deepEqual(contract.backgrounds, []);
});

test("Qwen 原生 2K 横竖预设通过文生图和编辑校验", () => {
    const contract = imageContractFor({ id: "qwen-image-2.1-local", imageModes: ["generate", "edit"], maxReferenceImages: 10 })!;
    for (const size of ["2048x2048", "2400x1792", "1792x2400", "2528x1696", "1696x2528", "2752x1536", "1536x2752"]) {
        for (const refs of [0, 1]) assert.deepEqual(validateImageInput(contract, "茶杯", { size }, refs), []);
    }
});
