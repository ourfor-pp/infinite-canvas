import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-server-"));
process.env.DATA_DIR = testData;
process.env.AUTH_MODE = "fnos";
process.env.APP_SECRET = "test-secret";

const [{ app }, { db }, { parseGatewayUser }] = await Promise.all([import("./app.js"), import("./database.js"), import("./auth.js")]);
let origin = "";
const server = app.listen(0, "127.0.0.1");

before(async () => {
    await new Promise<void>((resolvePromise) => server.once("listening", resolvePromise));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务启动失败");
    origin = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    db.close();
    rmSync(testData, { recursive: true, force: true });
});

const userOne = { "X-Trim-Userid": "user-1", "X-Trim-Username": "user-one", "X-Trim-Isadmin": "true" };
const userTwo = { "X-Trim-Userid": "user-2", "X-Trim-Username": "user-two", "X-Trim-Isadmin": "false" };

test("fnOS 身份只接受完整网关 Header", () => {
    assert.equal(parseGatewayUser({ "x-trim-userid": "only-id" }), null);
    assert.deepEqual(parseGatewayUser({ "x-trim-userid": " u1 ", "x-trim-username": " 张三 ", "x-trim-isadmin": "TRUE" }), { id: "u1", username: "张三", isAdmin: true });
});

test("缺少 fnOS 身份时拒绝访问", async () => {
    const response = await fetch(`${origin}/session`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
});

test("项目按用户隔离并检测 revision 冲突", async () => {
    const project = { id: "project-1", title: "测试画布", nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
    const created = await api("/projects", userOne, { method: "POST", body: JSON.stringify(project) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.revision, 1);

    const hidden = await api("/projects/project-1", userTwo);
    assert.equal(hidden.response.status, 404);

    const updated = await api("/projects/project-1", userOne, { method: "PUT", body: JSON.stringify({ ...project, title: "新标题", revision: 1 }) });
    assert.equal(updated.body.data.revision, 2);
    const conflict = await api("/projects/project-1", userOne, { method: "PUT", body: JSON.stringify({ ...project, revision: 1 }) });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.details.current.revision, 2);
});

test("创作资产按项目隔离、保存自然语言描述并检测 revision", async () => {
    const created = await api("/projects/project-1/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "character", name: "林夏", payload: { description: "二十八岁的清瘦调查记者，短发，深色风衣。", voiceDescription: "冷静、低声线" } }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.revision, 1);
    assert.equal(created.body.data.payload.voiceDescription, "冷静、低声线");
    const assetId = created.body.data.id;
    assert.equal((await api(`/creative-assets/${assetId}`, userTwo)).response.status, 404);

    const updated = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "confirmed", payload: { description: "二十八岁的清瘦调查记者，短发，深色风衣与旧相机。" } }) });
    assert.equal(updated.body.data.revision, 2);
    assert.equal(updated.body.data.payload.voiceDescription, "冷静、低声线");
    const conflict = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, name: "旧名称" }) });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.details.current.revision, 2);

    const firstView = await api(`/creative-assets/${assetId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 120, y: 160 }) });
    const secondView = await api(`/creative-assets/${assetId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 520, y: 160 }) });
    assert.notEqual(firstView.body.data.nodeId, secondView.body.data.nodeId);
    const project = await api("/projects/project-1", userOne);
    assert.equal(project.body.data.nodes.filter((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === assetId).length, 2);
    assert.equal(project.body.data.nodes.some((node: { type: string; title: string }) => node.type === "group" && node.title === "角色设定"), false);
    const businessNode = project.body.data.nodes.find((node: { id: string }) => node.id === firstView.body.data.nodeId);
    assert.deepEqual({ type: businessNode.type, width: businessNode.width, height: businessNode.height }, { type: "character", width: 420, height: 760 });

    assert.equal((await api(`/creative-assets/${assetId}`, userOne, { method: "DELETE" })).response.status, 200);
    const afterDelete = await api("/projects/project-1", userOne);
    assert.equal(afterDelete.body.data.nodes.some((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === assetId), false);
});

test("素材 CRUD 不能跨用户读取或修改", async () => {
    const asset = { id: "asset-1", kind: "text", title: "提示词", data: { content: "hello" }, coverUrl: "", tags: [] };
    assert.equal((await api("/assets", userOne, { method: "POST", body: JSON.stringify(asset) })).response.status, 201);
    const snapshot = { id: "asset-character-1", kind: "character", title: "林夏", data: { snapshot: { kind: "character", name: "林夏", status: "draft", payload: { description: "调查记者" } } }, coverUrl: "", tags: ["主角"] };
    assert.equal((await api("/assets", userOne, { method: "POST", body: JSON.stringify(snapshot) })).response.status, 201);
    assert.equal((await api("/assets", userOne)).body.data.some((item: { id: string }) => item.id === snapshot.id), true);
    assert.equal((await api("/assets", userTwo)).body.data.length, 0);
    assert.equal((await api("/assets/asset-1", userTwo, { method: "PUT", body: JSON.stringify({ ...asset, title: "越权" }) })).response.status, 404);
});

test("普通设置响应会移除浏览器旧版 ComfyUI 地址", async () => {
    const internalUrl = "http://192.168.199.218:8188";
    const saved = await api("/settings", userOne, {
        method: "PUT",
        body: JSON.stringify({ config: { channels: [{ id: "legacy-channel", name: "旧节点", baseUrl: internalUrl }], apiKey: "secret" } }),
    });
    assert.equal(saved.response.status, 200);
    assert.equal(JSON.stringify(saved.body).includes(internalUrl), false);
    assert.equal(JSON.stringify((await api("/settings", userOne)).body).includes(internalUrl), false);
    assert.equal(JSON.stringify((await api("/settings", userOne)).body).includes("secret"), false);
});

test("AI 渠道只能由管理员配置，普通用户只看到模型能力", async () => {
    const fakeProvider = createServer((request, response) => {
        if (request.url === "/v1/models") return json(response, { data: [{ id: "test-text-model" }] });
        response.writeHead(404).end();
    });
    await new Promise<void>((resolvePromise) => fakeProvider.listen(0, "127.0.0.1", resolvePromise));
    const address = fakeProvider.address();
    if (!address || typeof address === "string") throw new Error("供应商模拟服务启动失败");
    try {
        assert.equal((await api("/admin/ai/providers", userTwo)).response.status, 403);
        assert.equal((await api("/admin/ai/model-endpoints", userTwo)).response.status, 403);
        assert.equal((await api("/admin/ai/config", userTwo, { method: "PUT", body: JSON.stringify({ config: { canvasImageCount: "5" } }) })).response.status, 403);
        const endpoints = await api("/admin/ai/model-endpoints", userOne);
        assert.equal(endpoints.body.data.some((endpoint: { key: string; output: string }) => endpoint.key === "openai-images" && endpoint.output === "image"), true);
        const provider = await api("/admin/ai/providers", userOne, { method: "POST", body: JSON.stringify({
            name: "测试 OpenAI Compatible",
            type: "openai-compatible",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "provider-secret",
            enabled: true,
            concurrency: 2,
            models: [{ id: "test-text-model", name: "测试文本", endpoint: "openai-chat", enabled: true }],
        }) });
        assert.equal(provider.response.status, 201);
        assert.equal(provider.body.data.credentialConfigured, true);
        assert.equal(JSON.stringify(provider.body).includes("provider-secret"), false);
        assert.equal((await api(`/admin/ai/providers/${provider.body.data.id}/test`, userOne, { method: "POST" })).response.status, 200);
        const models = await api("/ai/models", userTwo);
        assert.equal(models.body.data.some((model: { value: string }) => model.value === `${provider.body.data.id}::test-text-model`), true);
        const modelRef = `${provider.body.data.id}::test-text-model`;
        await api("/admin/ai/model-defaults", userOne, { method: "PUT", body: JSON.stringify({ text: modelRef, image: "", video: "", audio: "" }) });
        assert.equal((await api("/ai/model-defaults", userTwo)).body.data.text, modelRef);
        await api("/admin/ai/config", userOne, { method: "PUT", body: JSON.stringify({ config: { canvasImageCount: "5" } }) });
        assert.equal((await api("/ai/config", userTwo)).body.data.config.canvasImageCount, "5");
        assert.equal(JSON.stringify(models.body).includes(String(address.port)), false);
        assert.equal(JSON.stringify(models.body).includes("provider-secret"), false);
        const injected = await api("/generations", userTwo, { method: "POST", body: JSON.stringify({ kind: "text", model: `${provider.body.data.id}::test-text-model`, prompt: "测试", params: { apiKey: "client-secret" } }) });
        assert.equal(injected.response.status, 400);
    } finally {
        await new Promise<void>((resolvePromise) => fakeProvider.close(() => resolvePromise()));
    }
});

test("Anthropic 根地址自动规范为 v1 并发现 New API 模型", async () => {
    const fakeProvider = createServer((request, response) => {
        if (request.url === "/v1/models" && request.headers["x-api-key"] === "anthropic-secret") return json(response, { data: [{ id: "claude-test" }] });
        response.writeHead(404).end();
    });
    await new Promise<void>((resolvePromise) => fakeProvider.listen(0, "127.0.0.1", resolvePromise));
    const address = fakeProvider.address();
    if (!address || typeof address === "string") throw new Error("供应商模拟服务启动失败");
    try {
        const provider = await api("/admin/ai/providers", userOne, { method: "POST", body: JSON.stringify({
            name: "测试 Anthropic New API",
            type: "anthropic",
            baseUrl: `http://127.0.0.1:${address.port}`,
            credentialMode: "apiKey",
            apiKey: "anthropic-secret",
            enabled: true,
            concurrency: 1,
            models: [],
        }) });
        assert.equal(provider.response.status, 201);
        assert.equal(provider.body.data.baseUrl, `http://127.0.0.1:${address.port}/v1`);
        const tested = await api(`/admin/ai/providers/${provider.body.data.id}/test`, userOne, { method: "POST" });
        assert.deepEqual(tested.body.data, { available: true, models: 1 });
        const discovered = await api(`/admin/ai/providers/${provider.body.data.id}/models/discover`, userOne, { method: "POST" });
        assert.deepEqual(discovered.body.data, { models: ["claude-test"] });
        assert.deepEqual((await api("/admin/ai/providers", userOne)).body.data.find((item: { id: string }) => item.id === provider.body.data.id).models, []);
        const configured = await api(`/admin/ai/providers/${provider.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({
            name: provider.body.data.name,
            type: "anthropic",
            baseUrl: provider.body.data.baseUrl,
            credentialMode: "apiKey",
            enabled: true,
            concurrency: 1,
            models: [{ id: "custom-model", name: "自定义名称", endpoint: "anthropic-messages", enabled: false }],
        }) });
        assert.equal(configured.response.status, 200);
        assert.deepEqual((await api(`/admin/ai/providers/${provider.body.data.id}/models/discover`, userOne, { method: "POST" })).body.data, { models: ["claude-test"] });
        assert.deepEqual((await api("/admin/ai/providers", userOne)).body.data.find((item: { id: string }) => item.id === provider.body.data.id).models, [{ id: "custom-model", name: "自定义名称", endpoint: "anthropic-messages", output: "text", inputs: ["text", "image"], enabled: false, agentEnabled: false }]);
    } finally {
        await new Promise<void>((resolvePromise) => fakeProvider.close(() => resolvePromise()));
    }
});

test("Agent 配置、会话和 Skill 由后端鉴权并按项目隔离", async () => {
    const provider = await api("/admin/ai/providers", userOne, { method: "POST", body: JSON.stringify({
        name: "Agent 测试渠道",
        type: "openai-compatible",
        baseUrl: "http://127.0.0.1:65534/v1",
        apiKey: "agent-provider-secret",
        enabled: true,
        concurrency: 1,
        models: [{ id: "agent-test-model", name: "Agent 测试模型", endpoint: "openai-chat", enabled: true, agentEnabled: true }],
    }) });
    const modelRef = `${provider.body.data.id}::agent-test-model`;
    assert.equal((await api("/admin/ai/agent", userTwo)).response.status, 403);
    assert.equal((await api("/admin/ai/agent", userOne, { method: "PUT", body: JSON.stringify({ modelRef }) })).response.status, 200);
    const publicConfig = await api("/agent/config", userTwo);
    assert.deepEqual(publicConfig.body.data, { ready: true, modelName: "Agent 测试模型", providerName: "Agent 测试渠道", protocolVersion: 1, storageVersion: 1 });
    assert.equal(JSON.stringify(publicConfig.body).includes(modelRef), false);

    assert.equal((await api("/agent/conversations/project/project-1", userTwo)).response.status, 404);
    const session = await api("/agent/conversations/project/project-1/sessions", userOne, { method: "POST", body: "{}" });
    assert.equal(session.response.status, 201);
    assert.equal((await api(`/agent/sessions/${session.body.data.id}/activate`, userTwo, { method: "POST" })).response.status, 404);

    assert.equal((await api("/agent/skills", userTwo)).response.status, 200);
});

test("公网图片生成由后端执行并把结果回存到用户媒体库", async () => {
    const fakeProvider = createServer((request, response) => {
        if (request.url === "/v1/images/generations" && request.method === "POST") return json(response, { data: [{ b64_json: Buffer.from("provider-image").toString("base64") }] });
        response.writeHead(404).end();
    });
    await new Promise<void>((resolvePromise) => fakeProvider.listen(0, "127.0.0.1", resolvePromise));
    const address = fakeProvider.address();
    if (!address || typeof address === "string") throw new Error("供应商模拟服务启动失败");
    try {
        const provider = await api("/admin/ai/providers", userOne, { method: "POST", body: JSON.stringify({
            name: "测试图片服务",
            type: "openai-compatible",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "provider-secret",
            enabled: true,
            concurrency: 1,
            models: [{ id: "test-image-model", name: "测试图片", endpoint: "openai-images-generations", enabled: true }],
        }) });
        const created = await api("/generations", userTwo, { method: "POST", body: JSON.stringify({ kind: "image", model: `${provider.body.data.id}::test-image-model`, prompt: "后端生成" }) });
        let generation = created.body.data;
        for (let index = 0; index < 20 && !["succeeded", "failed"].includes(generation.status); index += 1) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            generation = (await api(`/generations/${created.body.data.id}`, userTwo)).body.data;
        }
        assert.equal(generation.status, "succeeded");
        assert.equal(generation.result.files.length, 1);
        assert.equal(JSON.stringify(generation).includes(String(address.port)), false);
        assert.equal((await fetch(`${origin}/files/${generation.result.files[0].fileId}/content`, { headers: userTwo })).status, 200);

        const creative = await api("/projects/project-1/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "scene", name: "雨夜车站", payload: { description: "潮湿、冷色调的旧车站" } }) });
        const creativeGeneration = await api(`/creative-assets/${creative.body.data.id}/generations`, userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: `${provider.body.data.id}::test-image-model`, prompt: "雨夜旧车站设定图" }) });
        let creativeTask = creativeGeneration.body.data;
        for (let index = 0; index < 20 && !["succeeded", "failed"].includes(creativeTask.status); index += 1) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            creativeTask = (await api(`/generations/${creativeGeneration.body.data.id}`, userOne)).body.data;
        }
        const creativeResult = await api(`/creative-assets/${creative.body.data.id}`, userOne);
        assert.equal(creativeTask.status, "succeeded");
        assert.equal(creativeResult.body.data.payload.variants.length, 1);
        assert.ok(creativeResult.body.data.payload.primaryImageId);
    } finally {
        await new Promise<void>((resolvePromise) => fakeProvider.close(() => resolvePromise()));
    }
});

test("文件上传、Range 下载、路径穿越和越权访问", async () => {
    const form = new FormData();
    form.set("file", new Blob(["0123456789"], { type: "video/mp4" }), "sample.mp4");
    const uploaded = await api("/files", userOne, { method: "POST", body: form });
    assert.equal(uploaded.response.status, 201);
    const id = uploaded.body.data.fileId;

    const range = await fetch(`${origin}/files/${id}/content`, { headers: { ...userOne, Range: "bytes=2-5" } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), "2345");
    assert.equal((await fetch(`${origin}/files/${id}/content`, { headers: userTwo })).status, 404);
    assert.equal((await fetch(`${origin}/files/..%2Fapp.db/content`, { headers: userOne })).status, 404);
});

test("固定 ComfyUI 工作流由后端执行并持久化结果", async () => {
    let promptCounter = 0;
    const fakeComfy = createServer((request, response) => {
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname === "/system_stats") return json(response, { system: {} });
        if (url.pathname === "/prompt") return json(response, { prompt_id: `prompt-${++promptCounter}` });
        if (url.pathname.startsWith("/history/")) {
            const id = url.pathname.split("/").pop() || "";
            return json(response, { [id]: { status: { status_str: "success" }, outputs: { "11": { images: [{ filename: "result.png", type: "output" }] } } } });
        }
        if (url.pathname === "/view") {
            response.writeHead(200, { "Content-Type": "image/png" });
            return response.end(Buffer.from("generated-image"));
        }
        response.writeHead(404).end();
    });
    await new Promise<void>((resolvePromise) => fakeComfy.listen(0, "127.0.0.1", resolvePromise));
    const address = fakeComfy.address();
    if (!address || typeof address === "string") throw new Error("ComfyUI 模拟服务启动失败");
    try {
        await api("/admin/comfyui/servers", userOne, { method: "POST", body: JSON.stringify({ name: "测试节点", url: `http://127.0.0.1:${address.port}`, enabled: true, models: ["hidream-o1-full-fp8-local"] }) });
        const ordinaryModels = await api("/ai/models", userTwo);
        assert.equal(JSON.stringify(ordinaryModels.body).includes(String(address.port)), false);
        assert.equal((await api("/admin/comfyui/servers", userTwo)).response.status, 403);
        const created = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: "comfyui::hidream-o1-full-fp8-local", prompt: "测试图片", params: { size: "16:9", count: 1 } }) });
        let generation = created.body.data;
        for (let index = 0; index < 20 && !["succeeded", "failed"].includes(generation.status); index += 1) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            generation = (await api(`/generations/${created.body.data.id}`, userOne)).body.data;
        }
        assert.equal(generation.status, "succeeded");
        assert.equal(generation.result.files.length, 1);
        assert.equal((await api(`/generations/${created.body.data.id}`, userTwo)).response.status, 404);
    } finally {
        await new Promise<void>((resolvePromise) => fakeComfy.close(() => resolvePromise()));
    }
});

async function api(path: string, headers: Record<string, string>, init: RequestInit = {}) {
    const requestHeaders = new Headers(init.headers);
    Object.entries(headers).forEach(([name, value]) => requestHeaders.set(name, value));
    if (typeof init.body === "string" && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
    const response = await fetch(`${origin}${path}`, { ...init, headers: requestHeaders });
    return { response, body: await response.json() };
}

function json(response: import("node:http").ServerResponse, value: unknown) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
}
