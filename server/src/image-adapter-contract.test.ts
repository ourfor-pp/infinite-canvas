import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderContext } from "./ai-adapters.js";
const root = mkdtempSync(join(tmpdir(), "image-contract-"));
process.env.DATA_DIR = root;
process.env.APP_SECRET = "image-test";
const { adapterFor } = await import("./ai-adapters.js");
const { db } = await import("./database.js");
const now = new Date().toISOString();
db.prepare("INSERT INTO users(id,username,created_at,updated_at) VALUES('image-user','image-user',?,?)").run(now, now);
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
function context(endpoint: string, params: Record<string, unknown>) {
    return { row: { id: "p", type: "custom", base_url: "https://provider.test/v1" }, credentials: { apiKey: "test" }, model: { id: "test", endpoint }, userId: "image-user", request: { kind: "image", imageInputVersion: 1, prompt: "茶杯", params }, signal: AbortSignal.timeout(5000), onDelta() {}, onRemoteTask() {}, onProgress() {} } as unknown as ProviderContext;
}
test("Gemini 自动比例省略字段，明确比例正确映射并保存图片", async (t) => {
    const requests: any[] = [];
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: "image/png" } }] } }] });
    });
    const result = await adapterFor("gemini-image").generateImage!(context("gemini-image", { size: "auto", count: 1 }));
    assert.ok(Array.isArray(result.files) && result.files.length === 1);
    assert.equal(requests[0].generationConfig.imageConfig, undefined);
    await adapterFor("gemini-image").generateImage!(context("gemini-image", { size: "16:9", count: 1 }));
    assert.deepEqual(requests[1].generationConfig.imageConfig, { aspectRatio: "16:9" });
});
test("GPT 图片请求不带不支持的 response_format，透明背景保留", async (t) => {
    let body: any;
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return Response.json({ data: [{ b64_json: png }] }); });
    await adapterFor("openai-images").generateImage!(context("openai-images", { size: "1536x1024", count: 1, quality: "high", background: "transparent" }));
    assert.equal(body.response_format, undefined);
    assert.equal(body.background, "transparent");
    assert.equal(body.size, "1536x1024");
    assert.equal(body.n, 1);
});

test("云端 4K 像素尺寸原样发送到生成及编辑接口", async (t) => {
    const bodies: (string | FormData)[] = [];
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { bodies.push(init.body as string | FormData); return Response.json({ data: [{ b64_json: png }] }); });
    for (const id of ["sxh-image", "cec-image"]) {
        const ctx = context("openai-images", { size: "3840x2160", count: 1 });
        ctx.model.id = id;
        const generated = await adapterFor("openai-images").generateImage!(ctx);
        assert.equal(JSON.parse(bodies.at(-1) as string).size, "3840x2160");
        ctx.request.references = [{ fileId: (generated.files as { fileId: string }[])[0].fileId, kind: "image" }];
        await adapterFor("openai-images").generateImage!(ctx);
        assert.equal((bodies.at(-1) as FormData).get("size"), "3840x2160");
    }
});
