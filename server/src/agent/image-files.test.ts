import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
const root = mkdtempSync(join(tmpdir(), "agent-image-files-"));
process.env.DATA_DIR = root;
const [{ db }, { storeLocalFile }, { exposeImagePaths }, { buildPrompt, workspaceReadHooks }, { agentScenes }, { buildAgentToolDefinitions }] = await Promise.all([
    import("../database.js"), import("../file-store.js"), import("./image-files.js"), import("./service.js"), import("./scenes/index.js"), import("./mcp/index.js"),
]);
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
const now = new Date().toISOString();
db.prepare("INSERT INTO users VALUES('u','test',0,?,?)").run(now, now);
const workspace = join(root, "workspace"); mkdirSync(workspace);
const source = join(root, "image.png");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=", "base64");
writeFileSync(source, png);
const file = storeLocalFile("u", source, "image.png", "image/png");
test("图片附件向两种引擎暴露可读路径，不再引导图片理解 MCP", () => {
    for (const engine of ["builtin", "codex"] as const) {
        const session = { engine, project_id: "p" } as Parameters<typeof buildPrompt>[0];
        const prompt = buildPrompt(session, { attachments: [{ fileId: file.id, name: "image.png", mimeType: "image/png", path: "attachments/image.png" }] }, null);
        assert.match(prompt, /attachments\/image.png/);
        assert.match(prompt, /图片使用原生看图/);
        assert.doesNotMatch(prompt, /不要用 Read|图片和声音使用媒体理解工具/);
        for (const scene of [agentScenes.canvas, agentScenes.director]) {
            const context = { session: { projectId: "p" }, run: { userId: "u" } } as Parameters<typeof buildAgentToolDefinitions>[0];
            assert.ok(!buildAgentToolDefinitions(context, scene, engine).some((tool) => tool.name === "media_understand_images"));
        }
    }
});
test("画布图片与联系表、抽帧返回工作区路径，不暴露服务端文件路径或他人文件", () => {
    const resolvePath = (path: string) => join(workspace, path);
    const payload = { nodes: [{ metadata: { storageKey: `server:${file.id}` } }], contactSheet: file, frames: [{ file }] };
    const result = exposeImagePaths("u", payload, resolvePath) as typeof payload & { nodes: [{ metadata: { path: string } }]; contactSheet: { path: string }; frames: [{ file: { path: string } }] };
    for (const path of [result.nodes[0].metadata.path, result.contactSheet.path, result.frames[0].file.path]) {
        assert.ok(path.startsWith(".cache/image-inputs/"));
        assert.deepEqual(readFileSync(resolvePath(path)), png);
    }
    assert.equal((exposeImagePaths("other", file, resolvePath) as { path?: string }).path, undefined);
});
test("内置 Read 允许工作区图片，继续拒绝越界路径与符号链接", async () => {
    const hook = workspaceReadHooks(workspace).PreToolUse![0].hooks[0];
    const read = (path: string) => hook({ tool_name: "Read", tool_input: { file_path: path } } as Parameters<typeof hook>[0], undefined, { signal: new AbortController().signal });
    const result = exposeImagePaths("u", file, (path) => join(workspace, path)) as { path: string };
    assert.deepEqual(await read(result.path), {});
    assert.match(JSON.stringify(await read(source)), /deny/);
    symlinkSync(source, join(workspace, "escape.png"));
    assert.match(JSON.stringify(await read("escape.png")), /deny/);
});
