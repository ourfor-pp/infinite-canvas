import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
