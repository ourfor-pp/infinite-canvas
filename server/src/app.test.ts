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

const [{ app }, { db }, { parseGatewayUser }, { applyCanvasOps, createTextNodes }, { resolveAgentToolSearchMode }, { parseSkillAllowedTools }] = await Promise.all([import("./app.js"), import("./database.js"), import("./auth.js"), import("./agent/canvas-tools.js"), import("./agent/service.js"), import("./agent/skill-registry.js")]);
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

test("Agent Tool Search 按协议启用并允许显式覆盖", () => {
    assert.equal(resolveAgentToolSearchMode("anthropic-messages"), "true");
    assert.equal(resolveAgentToolSearchMode("openai-chat"), "false");
    assert.equal(resolveAgentToolSearchMode("openai-chat", "auto:25"), "auto:25");
    assert.equal(resolveAgentToolSearchMode("anthropic-messages", "invalid"), "true");
});

test("Agent Skill 解析单行和列表 allowed-tools", () => {
    assert.deepEqual(parseSkillAllowedTools("---\nname: demo\nallowed-tools: [Read, mcp__infinite_canvas__canvas_get_state]\n---\n"), ["Read", "mcp__infinite_canvas__canvas_get_state"]);
    assert.deepEqual(parseSkillAllowedTools("---\nname: demo\nallowed-tools:\n  - ToolSearch\n  - mcp__infinite_canvas__generation_create\n---\n"), ["ToolSearch", "mcp__infinite_canvas__generation_create"]);
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
    const created = await api("/projects/project-1/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "character", name: "林夏", payload: { description: "二十八岁的清瘦调查记者，短发，深色风衣。", voiceDescription: "冷静、低声线", voiceSampleText: "这件事，我会亲自查清楚。" } }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.revision, 1);
    assert.equal(created.body.data.payload.voiceDescription, "冷静、低声线");
    assert.equal(created.body.data.payload.voiceSampleText, "这件事，我会亲自查清楚。");
    const assetId = created.body.data.id;
    assert.equal((await api(`/creative-assets/${assetId}`, userTwo)).response.status, 404);

    const updated = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "confirmed", payload: { description: "二十八岁的清瘦调查记者，短发，深色风衣与旧相机。" } }) });
    assert.equal(updated.body.data.revision, 2);
    assert.equal(updated.body.data.payload.voiceDescription, "冷静、低声线");
    const conflict = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, name: "旧名称" }) });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.details.current.revision, 2);
    const referenceVariant = { id: "reference-audio-1", kind: "audio", fileId: "reference-file-1", label: "参考音频", prompt: "", usage: "reference_input", createdAt: new Date().toISOString() };
    const withReference = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, payload: { variants: [referenceVariant] } }) });
    assert.equal(withReference.response.status, 200);
    const invalidPrimary = await api(`/creative-assets/${assetId}/variants/${referenceVariant.id}/primary`, userOne, { method: "POST", body: JSON.stringify({ revision: 3 }) });
    assert.equal(invalidPrimary.response.status, 400);
    assert.equal(invalidPrimary.body.error.code, "CREATIVE_ASSET_REFERENCE_NOT_PRIMARY");

    const firstView = await api(`/creative-assets/${assetId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 120, y: 160 }) });
    const secondView = await api(`/creative-assets/${assetId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 520, y: 160 }) });
    assert.notEqual(firstView.body.data.nodeId, secondView.body.data.nodeId);
    const project = await api("/projects/project-1", userOne);
    assert.equal(project.body.data.nodes.filter((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === assetId).length, 2);
    assert.equal(project.body.data.nodes.some((node: { type: string; title: string }) => node.type === "group" && node.title === "角色设定"), false);
    const businessNode = project.body.data.nodes.find((node: { id: string }) => node.id === firstView.body.data.nodeId);
    assert.deepEqual({ type: businessNode.type, width: businessNode.width, height: businessNode.height }, { type: "character", width: 420, height: 690 });

    assert.equal((await api(`/creative-assets/${assetId}`, userOne, { method: "DELETE" })).response.status, 200);
    const afterDelete = await api("/projects/project-1", userOne);
    assert.equal(afterDelete.body.data.nodes.some((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === assetId), false);
});

test("视觉风格支持项目默认、画布放置、隔离和删除回收", async () => {
    const projectId = "visual-style-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "风格测试", nodes: [], connections: [] }) });
    const created = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "冷峻悬疑", mode: "custom", description: "低饱和冷灰色调，硬朗侧光。" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.revision, 1);
    const styleId = created.body.data.id;
    assert.equal((await api(`/visual-styles/${styleId}`, userTwo)).response.status, 404);

    const placed = await api(`/visual-styles/${styleId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 100, y: 200 }) });
    assert.equal(placed.response.status, 201);
    await api(`/visual-styles/${styleId}/default`, userOne, { method: "POST" });
    const project = await api(`/projects/${projectId}`, userOne);
    assert.equal(project.body.data.defaultVisualStyleId, styleId);
    assert.equal(project.body.data.nodes.some((node: { metadata?: { visualStyleId?: string } }) => node.metadata?.visualStyleId === styleId), true);

    assert.equal((await api(`/visual-styles/${styleId}`, userOne, { method: "DELETE" })).response.status, 200);
    const deleted = await api(`/projects/${projectId}`, userOne);
    assert.equal(deleted.body.data.defaultVisualStyleId, null);
    assert.equal(deleted.body.data.nodes.some((node: { metadata?: { visualStyleId?: string } }) => node.metadata?.visualStyleId === styleId), false);
});

test("Agent 画布操作校验语义端口类型和单连接限制", async () => {
    const projectId = "semantic-port-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "端口测试", nodes: [], connections: [] }) });
    const created = applyCanvasOps(userOne["X-Trim-Userid"], projectId, [
        { type: "add_node", id: "text-source", nodeType: "text" },
        { type: "add_node", id: "style-source", nodeType: "visual-style" },
        { type: "add_node", id: "style-source-2", nodeType: "visual-style" },
        { type: "add_node", id: "character-target", nodeType: "character" },
        { type: "connect_nodes", fromNodeId: "text-source", fromPortId: "output", toNodeId: "character-target", toPortId: "setting" },
        { type: "connect_nodes", fromNodeId: "style-source", fromPortId: "style", toNodeId: "character-target", toPortId: "style" },
    ], 1);
    assert.equal(created.revision, 2);
    assert.throws(() => applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "connect_nodes", fromNodeId: "text-source", fromPortId: "output", toNodeId: "character-target", toPortId: "reference-image" }], 2), /类型不兼容/);
    assert.throws(() => applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "connect_nodes", fromNodeId: "style-source-2", fromPortId: "style", toNodeId: "character-target", toPortId: "style" }], 2), /只允许一条连接/);
});

test("Agent 使用通用文本工具将多章节故事保存为一个节点", async () => {
    const projectId = "story-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "故事画布", nodes: [], connections: [] }) });
    const markdown = "# 山海回声\n\n## 第一章\n\n潮水退去。\n\n## 第二章\n\n灯塔重新亮起。";

    const created = createTextNodes(userOne["X-Trim-Userid"], projectId, { expectedRevision: 1, items: [{ title: "山海回声", text: markdown, width: 520, height: 680, fontSize: 15 }] });
    assert.equal(created.applied, 1);
    assert.equal(created.project.nodes.length, 1);
    assert.deepEqual(created.project.nodes[0], {
        id: created.project.nodes[0].id,
        type: "text",
        title: "山海回声",
        position: { x: 420, y: 0 },
        width: 520,
        height: 680,
        metadata: { content: markdown, status: "success", fontSize: 15 },
    });
    assert.throws(() => createTextNodes(userOne["X-Trim-Userid"], projectId, { expectedRevision: 1, items: [{ title: "重复故事", text: markdown }] }), /画布版本已从 1 更新为 2/);
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
    assert.deepEqual(publicConfig.body.data, { ready: true, modelName: "Agent 测试模型", providerName: "Agent 测试渠道", protocolVersion: 3, storageVersion: 2 });
    assert.equal(JSON.stringify(publicConfig.body).includes(modelRef), false);

    assert.equal((await api("/agent/projects/project-1/conversation", userTwo)).response.status, 404);
    const session = await api("/agent/projects/project-1/sessions", userOne, { method: "POST", body: "{}" });
    assert.equal(session.response.status, 201);
    const second = await api("/agent/projects/project-1/sessions", userOne, { method: "POST", body: "{}" });
    const conversation = await api(`/agent/projects/project-1/conversation?sessionId=${session.body.data.id}`, userOne);
    assert.equal(conversation.body.data.session.id, session.body.data.id);
    assert.deepEqual(new Set(conversation.body.data.sessions.map((item: { id: string }) => item.id)), new Set([session.body.data.id, second.body.data.id]));
    assert.equal((await api(`/agent/sessions/${session.body.data.id}/fork`, userTwo, { method: "POST" })).response.status, 404);
    const heldSession = session.body.data.id;
    db.prepare("UPDATE agent_sessions SET status='running', current_run_id='test-running' WHERE id=?").run(heldSession);
    const queuedInput = { preferredSessionId: heldSession, clientMessageId: "queue-test-1", submissionMode: "queue", content: { version: 1, segments: [{ type: "text", text: "稍后处理这个任务" }] }, attachmentFileIds: [] };
    const queued = await api("/agent/projects/project-1/messages", userOne, { method: "POST", body: JSON.stringify(queuedInput) });
    assert.equal(queued.response.status, 202);
    assert.equal(queued.body.data.queuedMessages[0].displayText, "稍后处理这个任务");
    assert.equal((await api("/agent/projects/project-1/messages", userOne, { method: "POST", body: JSON.stringify(queuedInput) })).body.data.queuedMessages.length, 1);
    assert.equal((await api(`/agent/sessions/${heldSession}/queued-messages`, userTwo)).response.status, 404);
    const turnIndex = await api(`/agent/sessions/${heldSession}/turn-index`, userOne);
    assert.equal(turnIndex.response.status, 200);
    await api(`/agent/sessions/${heldSession}/queued-messages/${queued.body.data.queuedMessages[0].id}`, userOne, { method: "DELETE" });
    assert.equal((await api(`/agent/sessions/${heldSession}/queued-messages`, userOne)).body.data.length, 0);
    db.prepare("UPDATE agent_sessions SET status='idle', current_run_id=NULL WHERE id=?").run(heldSession);

    db.prepare("INSERT INTO agent_events(session_id,seq,run_id,kind,payload,created_at) VALUES(?,1,'branch-run-1','user_text',?,datetime('now'))").run(heldSession, JSON.stringify({ text: "第一条消息", content: { version: 1, segments: [{ type: "text", text: "第一条消息" }] } }));
    db.prepare("INSERT INTO agent_events(session_id,seq,run_id,kind,payload,created_at) VALUES(?,2,'branch-run-1','assistant_text',?,datetime('now'))").run(heldSession, JSON.stringify({ text: "第一条回复", sdkMessageUuid: "sdk-anchor-1" }));
    db.prepare("INSERT INTO agent_events(session_id,seq,run_id,kind,payload,created_at) VALUES(?,3,'branch-run-2','user_text',?,datetime('now'))").run(heldSession, JSON.stringify({ text: "需要修改的消息", content: { version: 1, segments: [{ type: "text", text: "需要修改的消息" }] } }));
    db.prepare("INSERT INTO agent_events(session_id,seq,run_id,kind,payload,created_at) VALUES(?,4,'branch-run-2','assistant_text',?,datetime('now'))").run(heldSession, JSON.stringify({ text: "不应进入分支" }));
    db.prepare("UPDATE agent_sessions SET sdk_session_id='sdk-session-1', event_seq=4 WHERE id=?").run(heldSession);
    const branch = await api(`/agent/sessions/${heldSession}/fork`, userOne, { method: "POST", body: JSON.stringify({ fromEventSeq: 3 }) });
    assert.equal(branch.response.status, 201);
    assert.deepEqual(branch.body.data.events.filter((item: { kind: string }) => item.kind === "user_text").map((item: { payload: { text: string } }) => item.payload.text), ["第一条消息"]);
    assert.equal(JSON.stringify(branch.body.data.events).includes("不应进入分支"), false);
    const branchRow = db.prepare("SELECT sdk_session_id, fork_pending, fork_resume_at FROM agent_sessions WHERE id=?").get(branch.body.data.id) as { sdk_session_id: string; fork_pending: number; fork_resume_at: string };
    assert.deepEqual(branchRow, { sdk_session_id: "sdk-session-1", fork_pending: 1, fork_resume_at: "sdk-anchor-1" });
    assert.equal((await api(`/agent/sessions/${heldSession}/fork`, userTwo, { method: "POST", body: JSON.stringify({ fromEventSeq: 3 }) })).response.status, 404);

    const longSession = await api("/agent/projects/project-1/sessions", userOne, { method: "POST", body: "{}" });
    const insertLongEvent = db.prepare("INSERT INTO agent_events(session_id,seq,run_id,kind,payload,created_at) VALUES(?,?,?,?,?,datetime('now'))");
    db.transaction(() => {
        insertLongEvent.run(longSession.body.data.id, 1, "long-run", "user_text", JSON.stringify({ text: "不能被流式事件挤掉的用户消息" }));
        for (let seq = 2; seq <= 602; seq += 1) insertLongEvent.run(longSession.body.data.id, seq, "long-run", "assistant_text", JSON.stringify({ text: "字", delta: true, streamId: "long-answer" }));
        insertLongEvent.run(longSession.body.data.id, 603, "long-run", "assistant_text", JSON.stringify({ text: "完整回答", delta: false, streamId: "long-answer" }));
        insertLongEvent.run(longSession.body.data.id, 604, "long-run", "run_state", JSON.stringify({ state: "completed", finalAssistantEventSeq: 603 }));
        db.prepare("UPDATE agent_sessions SET event_seq=604, status='completed' WHERE id=?").run(longSession.body.data.id);
    })();
    const longConversation = await api(`/agent/projects/project-1/conversation?sessionId=${longSession.body.data.id}`, userOne);
    assert.deepEqual(longConversation.body.data.session.events.map((item: { kind: string }) => item.kind), ["user_text", "assistant_text", "run_state"]);
    assert.equal(longConversation.body.data.session.events[0].payload.text, "不能被流式事件挤掉的用户消息");
    assert.equal(longConversation.body.data.session.events[1].payload.text, "完整回答");
    assert.equal(longConversation.body.data.session.events[1].seq, 603);
    assert.equal(longConversation.body.data.session.events[2].payload.finalAssistantEventSeq, longConversation.body.data.session.events[1].seq);

    const skills = await api("/agent/skills", userTwo);
    assert.equal(skills.response.status, 200);
    assert.equal(skills.body.data.some((skill: { id: string }) => skill.id === "write-story"), true);
    const runs = await api("/admin/agent/runs", userOne);
    assert.equal(runs.response.status, 200);
    assert.equal(runs.body.data.every((run: { toolSearchMode?: string; toolSearchCallCount?: number }) => typeof run.toolSearchMode === "string" && typeof run.toolSearchCallCount === "number"), true);
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
