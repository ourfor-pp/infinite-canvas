import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderContext } from "./ai-adapters.js";
const root = mkdtempSync(join(tmpdir(), "video-contract-"));
process.env.DATA_DIR = root;
process.env.APP_SECRET = "video-test";
const { adapterFor } = await import("./ai-adapters.js");
const { storeLocalFile } = await import("./file-store.js");
const { db } = await import("./database.js");
const now = new Date().toISOString();
db.prepare("INSERT INTO users(id,username,created_at,updated_at) VALUES('video-user','video-user',?,?)").run(now, now);
const path = join(root, "reference.png"); writeFileSync(path, Buffer.from("image"));
const file = storeLocalFile("video-user", path, "reference.png", "image/png");
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
function context(endpoint: string, params: Record<string, unknown>) {
    return { row: { id: "p", type: "custom", base_url: "https://provider.test/v1" }, credentials: { apiKey: "test" }, model: { id: "test", endpoint }, userId: "video-user", request: { kind: "video", videoInputVersion: 1, prompt: "茶杯", params, references: [{ fileId: file.id, kind: "image", role: "first-frame" }] }, signal: AbortSignal.timeout(5000), onDelta() {}, onRemoteTask() {}, onProgress() {} } as unknown as ProviderContext;
}
for (const endpoint of ["openai-video", "gemini-video", "ark-seedance"]) test(`${endpoint} 正确映射画布视频参数`, async (t) => {
    let submitted: any;
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
        if (init.method === "POST") { submitted = init.body instanceof FormData ? init.body : JSON.parse(String(init.body)); return Response.json({ id: "job", name: "operations/job" }); }
        throw new Error("poll boundary");
    });
    await assert.rejects(adapterFor(endpoint as any).generateVideo!(context(endpoint, { seconds: 8, size: "1280x720", ratio: "16:9", resolution: "720p", generateAudio: false, watermark: false })), /poll boundary/);
    if (endpoint === "openai-video") { assert.ok(submitted.has("input_reference")); assert.ok(!submitted.has("input_reference[]")); assert.equal(submitted.get("seconds"), "8"); }
    if (endpoint === "gemini-video") { assert.deepEqual(submitted.parameters, { aspectRatio: "16:9", durationSeconds: 8, resolution: "720p" }); assert.ok(submitted.instances[0].image); }
    if (endpoint === "ark-seedance") { assert.equal(submitted.duration, 8); assert.equal(submitted.generate_audio, false); assert.equal(submitted.content[1].role, "first_frame"); }
});

test("管理员不能声明适配器无法传递的视频参数", async () => {
    const { providerInputSchema } = await import("./provider-service.js");
    const input = (endpoint: string, videoParameters: object, videoReferenceRoles = ["first-frame"]) => ({ name: "test", type: "openai-compatible", baseUrl: "https://provider.test/v1", models: [{ id: "test", name: "test", endpoint, videoReferenceRoles, videoParameters }] });
    assert.equal(providerInputSchema.safeParse(input("openai-video", { generateAudio: true })).success, false);
    assert.equal(providerInputSchema.safeParse(input("gemini-video", { sizes: ["1280x720"] })).success, false);
    assert.equal(providerInputSchema.safeParse(input("ark-seedance", { maxVideos: 2 })).success, false);
    assert.equal(providerInputSchema.safeParse(input("ark-seedance", { maxVideos: 2, maxAudios: 1, maxImages: 9, maxTotal: 12 }, ["reference"])).success, true);
});

test("Gemini 多参考图完整传递，Ark 不发送未声明的开关", async (t) => {
    const submitted: any[] = [];
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
        if (init.method === "POST") { submitted.push(JSON.parse(String(init.body))); return Response.json({ id: "job", name: "operations/job" }); }
        throw new Error("poll boundary");
    });
    const gemini = context("gemini-video", { ratio: "16:9", seconds: 8, resolution: "720p" });
    gemini.request.references = [{ fileId: file.id, kind: "image", role: "reference" }, { fileId: file.id, kind: "image", role: "reference" }];
    await assert.rejects(adapterFor("gemini-video").generateVideo!(gemini), /poll boundary/);
    assert.equal(submitted[0].instances[0].referenceImages.length, 2);
    assert.equal(submitted[0].instances[0].image, undefined);
    await assert.rejects(adapterFor("ark-seedance").generateVideo!(context("ark-seedance", { ratio: "16:9", seconds: 5, resolution: "720p" })), /poll boundary/);
    assert.equal(submitted[1].generate_audio, undefined);
    assert.equal(submitted[1].watermark, undefined);
});
