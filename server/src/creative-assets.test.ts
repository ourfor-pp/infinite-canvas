import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-assets-"));
process.env.DATA_DIR = testData;
process.env.APP_SECRET = "creative-assets-test";

const [{ db }, { createCreativeAsset, deleteCanvasNodes, getCreativeAsset, placeCreativeAsset }] = await Promise.all([
    import("./database.js"),
    import("./creative-assets.js"),
]);

after(() => { db.close(); rmSync(testData, { recursive: true, force: true }); });

test("删除业务节点同步删除资产实体、全部视图和连接", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,is_admin,created_at,updated_at) VALUES(?,?,1,?,?)").run(userId, "测试用户", now, now);
    const payload = { id: projectId, title: "测试画布", nodes: [{ id: "text-1", type: "text", metadata: {} }], connections: [], createdAt: now, updatedAt: now };
    db.prepare("INSERT INTO projects(id,user_id,title,payload,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(projectId, userId, payload.title, JSON.stringify(payload), now, now);
    const asset = createCreativeAsset(userId, projectId, { kind: "character", name: "临时角色", payload: { description: "测试" } });
    const first = placeCreativeAsset(userId, asset.id, { x: 100, y: 100 });
    const second = placeCreativeAsset(userId, asset.id, { x: 600, y: 100 });
    const row = db.prepare("SELECT payload,revision FROM projects WHERE id=?").get(projectId) as { payload: string; revision: number };
    const project = JSON.parse(row.payload) as { connections: unknown[] };
    project.connections.push({ id: "link-1", fromNodeId: "text-1", fromPortId: "output", toNodeId: first.nodeId, toPortId: "setting" });
    db.prepare("UPDATE projects SET payload=? WHERE id=?").run(JSON.stringify(project), projectId);

    const saved = deleteCanvasNodes(userId, projectId, [first.nodeId], row.revision);

    assert.equal(saved.nodes.some((node: { id: string }) => node.id === first.nodeId || node.id === second.nodeId), false);
    assert.equal(saved.connections.length, 0);
    assert.throws(() => getCreativeAsset(userId, asset.id), /不存在/);
});
