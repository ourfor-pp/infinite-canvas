import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "qwen-image-canvas-"));
process.env.DATA_DIR = root;
process.env.AUTH_MODE = "dev";
process.env.APP_SECRET = "qwen-image-test";
const { refreshMediaExecutorCatalog, saveMediaExecutorSettings } = await import("./media-executor-settings.js");
const { listPublicModels, listExecutorModels, resolveImageModel } = await import("./provider-service.js");
const { prepareExecutorRequest } = await import("./media-capabilities.js");
const { db } = await import("./database.js");
const { storeLocalFile } = await import("./file-store.js");
const model = "qwen-image-2.1-local", value = `local-media::${model}`;
saveMediaExecutorSettings({ url: "http://executor.test", token: "test" });
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

test("画布模型目录按执行器能力暴露 Qwen 2.1 文生图和十图编辑，离线隐藏", async (t) => {
    let ready = true;
    t.mock.method(globalThis, "fetch", async () => Response.json({ protocolVersion: "2", models: {}, comfyFeatures: { qwenImage21: ready } }));
    await refreshMediaExecutorCatalog();
    const item = listPublicModels().find((item) => item.value === value)!;
    assert.equal(item.name, "Qwen Image 2.1");
    assert.deepEqual(item.imageModes, ["generate", "edit"]);
    assert.equal(item.maxReferenceImages, 10);
    const admin = listExecutorModels().find((item) => item.value === value)!;
    assert.equal(admin.name, item.name);
    assert.deepEqual(admin.imageModes, item.imageModes);
    assert.equal(admin.maxReferenceImages, item.maxReferenceImages);
    assert.equal(admin.engine, "comfy");
    assert.equal(admin.specialWorkflow, false);
    for (const mode of ["generate", "edit"] as const) assert.equal(resolveImageModel(value, mode).providerId, "local-media");
    ready = false;
    await refreshMediaExecutorCatalog();
    assert.equal(listPublicModels().some((item) => item.value === value), false);
    assert.equal(listExecutorModels().some((item) => item.value === value), false);
    assert.throws(() => resolveImageModel(value, "generate"), /尚未部署或运行时离线/);
});

test("画布通用图片参数转换为执行器参数，透明开关明确表达且不混入系统提示", async () => {
    const prompt = "蓝色茶壶";
    const result = await prepareExecutorRequest("user", "image", model, { kind: "image", prompt, params: { count: 1, size: "1536x1024", quality: "high", background: "transparent", systemPrompt: "should not be sent", seed: 42 } });
    assert.equal(result.mode, "text-to-image");
    assert.equal(result.operation, "generate");
    assert.deepEqual(result.params, { width: 1536, height: 1024, seed: 42 });
    assert.ok(result.prompt.startsWith(prompt));
    assert.ok(result.prompt.includes("RGBA"));
    assert.ok(!result.prompt.includes("should not be sent"));
    const plain = await prepareExecutorRequest("user", "plain", model, { kind: "image", prompt, params: { size: "auto", background: "auto" } });
    assert.equal(plain.prompt, prompt);
    assert.deepEqual(plain.params, {});
    await assert.rejects(prepareExecutorRequest("user", "batch", model, { kind: "image", prompt, params: { count: 2 } }), /每个任务生成一张/);
});

test("画布图片参考上传后走 image-edit，尺寸转为参考分辨率", async (t) => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,created_at,updated_at) VALUES('image-user','image-user',?,?)").run(now, now);
    const path = join(root, "reference.png");
    writeFileSync(path, "reference fixture");
    const file = storeLocalFile("image-user", path, "reference.png", "image/png");
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        assert.equal(url, "http://executor.test/v1/files");
        assert.ok(init.body instanceof FormData);
        return Response.json({ id: "uploaded.png" });
    });
    const result = await prepareExecutorRequest("image-user", "edit", model, { kind: "image", prompt: "改成红色", params: { count: 1, size: "2048x2048", quality: "auto" }, references: [{ fileId: file.id, kind: "image" }] });
    assert.equal(result.mode, "image-edit");
    assert.deepEqual(result.params, { referenceResolution: 2048 });
    assert.equal(result.references[0].fileId, "uploaded.png");
});


test("管理员与画布复用全部可选本地模型，专用工作流独立标记，休眠模型仍可用", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ protocolVersion: "2", models: { "qwen3-asr-1.7b-local": { engine: "asr" } }, runtimes: { asr: false }, configuredRuntimes: { asr: true }, comfyFeatures: { qwenImage21: true, music3: true } }));
    await refreshMediaExecutorCatalog();
    const admin = listExecutorModels();
    const selectable = listPublicModels().filter((item) => ["local-media", "comfyui"].includes(item.providerId));
    assert.deepEqual(admin.filter((item) => !item.specialWorkflow).map((item) => item.value).sort(), selectable.map((item) => item.value).sort());
    assert.equal(admin.find((item) => item.id === "minimax-music3-local")?.output, "audio");
    assert.equal(admin.find((item) => item.id === "qwen3-asr-1.7b-local")?.output, "transcription");
    assert.equal(admin.find((item) => item.id === "qwen-image-inpaint-local")?.specialWorkflow, true);
    assert.equal(new Set(admin.map((item) => item.value)).size, admin.length);
});
