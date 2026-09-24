import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
const root = mkdtempSync(join(tmpdir(), "canvas-tools-"));
process.env.DATA_DIR = root;
const [{ db }, canvas, { storeLocalFile }, media, { buildAgentToolDefinitions }, { agentScenes, sceneTools }] = await Promise.all([
    import("../database.js"), import("./canvas-tools.js"), import("../file-store.js"), import("./media-tools.js"), import("./mcp/index.js"), import("./scenes/index.js"),
]);
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
const now = new Date().toISOString();
db.prepare("INSERT INTO users VALUES('u','test',0,?,?)").run(now, now);
function project(id: string, nodes: unknown[] = []) {
    db.prepare("INSERT INTO projects(id,user_id,title,payload,created_at,updated_at) VALUES(?,'u',?,?,?,?)").run(id, id, JSON.stringify({ id, title: id, nodes, connections: [] }), now, now);
}
function generation(id: string, projectId: string, result: unknown, source = "executor", status = "succeeded") {
    db.prepare("INSERT INTO generations(id,user_id,kind,status,request,result,created_at,updated_at) VALUES(?,'u','image',?,?,?,?,?)").run(id, status, JSON.stringify(source === "executor" ? { metadata: { mediaProjectId: projectId } } : { params: { __agentCanvas: { projectId } } }), JSON.stringify(result), now, now);
}
function read(id: string, input: Record<string, unknown> = {}) { return canvas.readCanvasState("u", id, canvas.canvasToolSchemas.canvas_get_state.parse(input)) as Record<string, any>; }
function context(projectId: string, requireDecision = async (..._args: unknown[]) => ({})) {
    return { session: { projectId }, run: { userId: "u" }, resolveWorkspacePath: (path: string) => join(root, "workspace", path), appendEvent() {}, requireDecision, requestClientAction: async (name: string, input: unknown) => ({ name, input }) } as unknown as Parameters<typeof buildAgentToolDefinitions>[0];
}
function tool(projectId: string, name: string, requireDecision?: (...args: unknown[]) => Promise<{}>) { return buildAgentToolDefinitions(context(projectId, requireDecision), agentScenes.canvas).find((item) => item.name === name)!; }
function output(result: Awaited<ReturnType<ReturnType<typeof tool>["handler"]>>) { return JSON.parse((result.content[0] as { text: string }).text).data; }

test("原生生图 Skill 示例通过 MCP 同时保存图片、编辑提示词与参考连线", async () => {
    project("native-image", [{ id: "reference-image", type: "image", metadata: { content: "/reference.png" } }]);
    const skill = readFileSync(new URL("./scenes/canvas/skills/canvas-edit/SKILL.md", import.meta.url), "utf8");
    const example = [...skill.matchAll(/```json\n([^`]+)\n```/g)].map((match) => JSON.parse(match[1]))
        .find((input) => input.ops.some((op: { nodeType?: string }) => op.nodeType === "image"));
    assert.ok(example);
    const result = await tool("native-image", "canvas_apply_ops").handler({ ...example, expectedRevision: 1 });
    assert.equal(result.isError, undefined);
    const saved = canvas.getCanvasState("u", "native-image");
    const image = saved.nodes.find((node) => node.id === "generated-image")!;
    assert.equal(image.metadata?.content, "/api/files/generated-file");
    assert.equal(image.metadata?.storageKey, "server:generated-file");
    assert.ok(image.metadata?.prompt);
    assert.equal(image.metadata?.composerContent, image.metadata?.prompt);
    assert.equal(saved.connections.length, 1);
    assert.equal(saved.connections[0].fromNodeId, "reference-image");
    assert.equal(saved.connections[0].toNodeId, image.id);
    assert.equal(saved.connections[0].fromPortId, "output");
    assert.equal(saved.connections[0].toPortId, "input");
});

test("分页画布读取不泄漏长正文，指定节点逐段读取并拒绝跨版本分页", () => {
    project("pages", Array.from({ length: 55 }, (_, i) => ({ id: `n${i}`, type: "text", metadata: { content: "x".repeat(30_000), hidden: "private" } })));
    const first = read("pages");
    assert.equal(first.nodes.length, 20);
    assert.equal(first.nextOffset, 20);
    assert.ok(JSON.stringify(first).length < 12_000);
    assert.equal(read("pages", { offset: 40, expectedRevision: 1 }).nodes.length, 15);
    const text = read("pages", { view: "content", nodeIds: ["n1"], contentLimit: 100 });
    assert.equal(text.content.length, 100);
    assert.equal(text.nextContentOffset, 100);
    assert.equal(read("pages", { view: "content", nodeIds: ["n1"], contentOffset: 29_999 }).content, "x");
    assert.throws(() => read("pages", { view: "content" }), /指定一个/);
    assert.throws(() => canvas.readCanvasState("other", "pages", canvas.canvasToolSchemas.canvas_get_state.parse({})), /无权/);
    canvas.applyCanvasOps("u", "pages", [{ type: "update_node", id: "n1", metadata: { content: "changed" } }], 1);
    assert.throws(() => read("pages", { offset: 20, expectedRevision: 1 }), /重新读取/);
});

test("MCP 新增返回节点 ID 而非完整画布，删除统一确认且拒绝确认后的过期 revision", async () => {
    project("delete");
    const added = output(await tool("delete", "canvas_apply_ops").handler({ expectedRevision: 1, ops: [{ type: "add_node", nodeType: "text", metadata: { content: "draft" } }] }));
    assert.equal(added.project, undefined);
    assert.equal(added.nodeIds.length, 1);
    let approvals = 0;
    const deletion = tool("delete", "canvas_delete", async () => { approvals++; canvas.applyCanvasOps("u", "delete", [{ type: "add_node", id: "new" }], 2); return {}; });
    const stale = await deletion.handler({ expectedRevision: 2, nodeIds: added.nodeIds });
    assert.equal(stale.isError, true);
    assert.equal(approvals, 1);
    assert.equal(read("delete").nodeCount, 2);
    const removed = await tool("delete", "canvas_delete", async () => { approvals++; return {}; }).handler({ expectedRevision: 3, nodeIds: added.nodeIds });
    assert.equal(removed.isError, undefined);
    assert.equal(approvals, 2);
    assert.equal(read("delete").nodeCount, 1);
    assert.equal((await tool("delete", "canvas_get_state").handler({ projectId: "pages" })).isError, true);
});

test("生成结果采用校验任务、文件、类型与 revision，两种任务共用查询与保存", () => {
    project("adopt");
    const path = join(root, "result.png"); writeFileSync(path, "fixture");
    const file = storeLocalFile("u", path, "result.png", "image/png");
    generation("executor", "adopt", { files: [file] });
    generation("channel", "adopt", { files: [file] }, "channel");
    generation("foreign", "pages", { files: [file] });
    generation("pending", "adopt", { files: [file] }, "executor", "running");
    const adopt = (generationId: string, expectedRevision: number, extra = {}) => canvas.adoptCanvasResult("u", "adopt", { generationId, expectedRevision, fileId: file.id, ...extra });
    assert.throws(() => adopt("foreign", 1), /不属于/);
    assert.throws(() => adopt("pending", 1), /未完成/);
    assert.throws(() => adopt("executor", 1, { fileId: "unrelated" }), /不是当前任务/);
    const adopted = adopt("executor", 1);
    assert.equal(canvas.getCanvasState("u", "adopt").nodes[0].metadata?.content, file.url);
    assert.throws(() => adopt("channel", 1, { nodeId: adopted.nodeId }), /画布版本/);
    assert.equal(adopt("channel", 2, { nodeId: adopted.nodeId }).revision, 3);
    generation("text", "adopt", { text: "# 正文" }, "channel");
    assert.throws(() => canvas.adoptCanvasResult("u", "adopt", { generationId: "text", expectedRevision: 3, nodeId: adopted.nodeId }), /类型/);
    assert.equal(media.mediaGenerationStatus("u", "adopt", "channel").id, "channel");
    assert.equal(media.mediaGenerationStatus("u", "adopt", "executor").id, "executor");
    assert.throws(() => media.mediaGenerationStatus("u", "adopt", "foreign"), /不属于/);
    media.saveMediaResult("u", "adopt", "channel", file.id, join(root, "saved.png"));
    assert.throws(() => media.saveMediaResult("u", "adopt", "channel", file.id, join(root, "saved.png")), /exist/);
});

test("素材搜索覆盖正文并保持用户隔离与分页", () => {
    canvas.addAsset("u", { kind: "text", title: "A", payload: { content: "needle one" } });
    canvas.addAsset("u", { kind: "text", title: "B", payload: { content: "needle two" } });
    assert.equal(canvas.listAssets("u", { kind: "text", keyword: "needle" }).length, 2);
    assert.equal(canvas.listAssets("u", { keyword: "needle", offset: 1, limit: 1 }).length, 1);
    assert.equal(canvas.listAssets("other", { keyword: "needle" }).length, 0);
});

test("工具注册与 schema 同步，Codex 去重且生成校验失败不会创建任务", async () => {
    project("tools");
    for (const engine of ["builtin", "codex"] as const) {
        const names = buildAgentToolDefinitions(context("tools"), agentScenes.canvas, engine).map((item) => item.name).sort();
        assert.deepEqual(names, sceneTools(agentScenes.canvas, engine).map((item) => item.id).sort());
        assert.equal(names.length, engine === "codex" ? 19 : 21);
        assert.ok(!names.some((name) => name.startsWith("generation_") || ["canvas_create_text_nodes", "canvas_list_projects", "prompts_search", "site_navigate"].includes(name)));
    }
    const before = (db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    const failed = await tool("tools", "media_validate_generation").handler({ request: { source: "channel", kind: "image", model: "missing", prompt: "test" } });
    assert.equal(failed.isError, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n, before);
    const selected = output(await tool("tools", "canvas_view").handler({ action: "select", ids: [] }));
    assert.equal(selected.name, "canvas_select_nodes");
    assert.equal((await tool("tools", "canvas_view").handler({ action: "focus", ids: [] })).isError, true);
});

test("媒体过程节点显示进度和实际输入，采用复用节点并保留提示与引用角色", async () => {
    const { syncAgentGenerationCanvas } = await import("./generation-canvas.js");
    const path = join(root, "process-input.png"); writeFileSync(path, "image");
    const reference = storeLocalFile("u", path, "reference.png", "image/png");
    const videoPath = join(root, "process-output.mp4"); writeFileSync(videoPath, "video");
    const video = storeLocalFile("u", videoPath, "output.mp4", "video/mp4");
    project("process", [{ id: "source", type: "image", metadata: { storageKey: `server:${reference.id}` } }]);
    generation("process-job", "process", { files: [video] }, "executor", "queued");
    const request = { kind: "video", model: "test-model", prompt: "真实提交的提示词", references: [{ fileId: reference.id, kind: "image", role: "first-frame" }], metadata: { mediaProjectId: "process" } };
    db.prepare("UPDATE generations SET kind='video',request=?,progress=0 WHERE id='process-job'").run(JSON.stringify(request));
    const row = () => db.prepare("SELECT * FROM generations WHERE id='process-job'").get() as Parameters<typeof syncAgentGenerationCanvas>[0];
    syncAgentGenerationCanvas(row());
    let state = canvas.getCanvasState("u", "process");
    const node = state.nodes.find(node => node.metadata?.agentGenerationId === "process-job")!;
    assert.equal(node.metadata?.status, "loading");
    assert.equal(node.metadata?.composerContent, request.prompt);
    assert.equal(state.connections[0].fromNodeId, "source");
    db.prepare("UPDATE generations SET status='running',progress=0.45 WHERE id='process-job'").run();
    syncAgentGenerationCanvas(row());
    assert.equal(canvas.getCanvasState("u", "process").nodes.find(item => item.id === node.id)?.metadata?.agentGenerationProgress, 0.45);
    db.prepare("UPDATE generations SET status='succeeded',progress=1 WHERE id='process-job'").run();
    syncAgentGenerationCanvas(row());
    state = canvas.getCanvasState("u", "process");
    const adopted = canvas.adoptCanvasResult("u", "process", { generationId: "process-job", fileId: video.id, expectedRevision: state.revision });
    assert.equal(adopted.nodeId, node.id);
    state = canvas.getCanvasState("u", "process");
    assert.equal(state.nodes.length, 2);
    assert.equal(state.connections.length, 1);
    assert.equal(state.nodes.find(item => item.id === node.id)?.metadata?.content, video.url);
    assert.deepEqual((state.nodes.find(item => item.id === node.id)?.metadata?.generationRequest as typeof request).references, request.references);
    canvas.applyCanvasOps("u", "process", [{ type: "delete_node", id: node.id }], state.revision);
    syncAgentGenerationCanvas(row());
    assert.equal(canvas.getCanvasState("u", "process").nodes.length, 1);
});

test("过程音频自动出现且失败可见；导演任务不写入画布", async () => {
    const { syncAgentGenerationCanvas } = await import("./generation-canvas.js");
    project("audio-process");
    generation("audio-job", "audio-process", {}, "executor", "queued");
    db.prepare("UPDATE generations SET kind='audio' WHERE id='audio-job'").run();
    const row = () => db.prepare("SELECT * FROM generations WHERE id='audio-job'").get() as Parameters<typeof syncAgentGenerationCanvas>[0];
    syncAgentGenerationCanvas(row());
    assert.equal(canvas.getCanvasState("u", "audio-process").nodes[0].type, "audio");
    db.prepare("UPDATE generations SET status='failed',error='测试失败' WHERE id='audio-job'").run();
    syncAgentGenerationCanvas(row());
    assert.equal(canvas.getCanvasState("u", "audio-process").nodes[0].metadata?.errorDetails, "测试失败");
    project("director-process");
    db.prepare("UPDATE projects SET kind='director' WHERE id='director-process'").run();
    generation("director-job", "director-process", {}, "executor", "queued");
    syncAgentGenerationCanvas(db.prepare("SELECT * FROM generations WHERE id='director-job'").get() as Parameters<typeof syncAgentGenerationCanvas>[0]);
    assert.equal(canvas.getCanvasState("u", "director-process").nodes.length, 0);
});


test("外部参考尚无节点时补建，续接视频同样保留来源连线", () => {
    const path = join(root, "continuation.mp4"); writeFileSync(path, "video");
    const file = storeLocalFile("u", path, "continuation.mp4", "video/mp4");
    project("continuation-input", [{ id: "target", type: "video" }]);
    const ops = canvas.generationReferenceOps("u", { kind: "video", model: "test", prompt: "继续", continuation: { generationId: "previous", fileId: file.id } }, "target", [], { x: 500, y: 0 });
    canvas.applyCanvasOps("u", "continuation-input", ops, 1);
    const state = canvas.getCanvasState("u", "continuation-input");
    assert.equal(state.nodes.length, 2);
    assert.equal(state.nodes[1].metadata?.storageKey, `server:${file.id}`);
    assert.equal(state.connections[0].fromNodeId, state.nodes[1].id);
    assert.equal(state.connections[0].toNodeId, "target");
});


test("Agent 新增未指定尺寸的媒体节点仍有可见边界", () => {
    project("node-dimensions");
    canvas.applyCanvasOps("u", "node-dimensions", [{ type: "add_node", id: "clip", nodeType: "video" }, { type: "add_node", id: "voice", nodeType: "audio" }], 1);
    const state = canvas.getCanvasState("u", "node-dimensions");
    assert.equal(state.nodes[0].width, 320);
    assert.equal(state.nodes[0].height, 200);
    assert.equal(state.nodes[1].height, 120);
    assert.equal(canvas.canvasToolSchemas.canvas_apply_ops.safeParse({ expectedRevision: 2, ops: [{ type: "add_node", nodeType: "video", width: 0 }] }).success, false);
});
