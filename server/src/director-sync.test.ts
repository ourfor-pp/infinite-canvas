import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, statSync, utimesSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { after, before, test } from "node:test";
import type { DirectorProjectChanged } from "./director-sync.js";

const root = mkdtempSync(join(tmpdir(), "director-sync-"));
process.env.DATA_DIR = root; process.env.AUTH_MODE = "fnos"; process.env.APP_SECRET = "test-secret";
const [{ app }, { db }, workspace, sync, { getDirectorSyncSnapshot }, assets] = await Promise.all([import("./app.js"), import("./database.js"), import("./director-workspace.js"), import("./director-sync.js"), import("./director-sync-snapshot.js"), import("./creative-assets.js")]);
const events: Array<{ userId: string; event: DirectorProjectChanged }> = [];
sync.setDirectorSyncEmitter((userId, event) => events.push({ userId, event }));
const server = app.listen(0, "127.0.0.1"); let origin = "";
before(async () => { await new Promise<void>((resolve) => server.once("listening", resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`; });
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); rmSync(root, { recursive: true, force: true }); });
const headers = { "X-Trim-Userid": "sync-user", "X-Trim-Username": "sync", "X-Trim-Isadmin": "false", "Content-Type": "application/json" };
async function request(path: string, init: RequestInit = {}) { const response = await fetch(origin + path, { ...init, headers: { ...headers, ...init.headers } }); return { response, body: await response.json() }; }
async function project(id: string) {
    assert.equal((await request("/projects", { method: "POST", body: JSON.stringify({ id, title: id, kind: "director" }) })).response.status, 201);
    const folder = workspace.ensureDirectorProjectWorkspace("sync-user", id);
    getDirectorSyncSnapshot("sync-user", id, [...sync.directorResources], true); return folder;
}
async function prop(id: string) {
    const folder = await project(id);
    const asset = assets.createCreativeAsset("sync-user", id, { kind: "prop", name: "测试道具", payload: { description: "蓝色圆环" } });
    const detail = workspace.getDirectorAssetDetail("sync-user", asset.id);
    const image = join(folder, detail.folderPath, "design/primary.gif"); mkdirSync(dirname(image), { recursive: true });
    writeFileSync(image, Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    workspace.reconcileDirectorProjectFiles("sync-user", id);
    return { folder, asset, image, snapshot: getDirectorSyncSnapshot("sync-user", id, [...sync.directorResources]) };
}
const waitFor = async (condition: () => boolean) => { const until = Date.now() + 3000; while (!condition() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(condition(), true, "文件监测应在三秒内发布同步事件"); };

test("统一事件有界合并且版本独立持久，用户与项目严格隔离", async () => {
    await project("batch"); const baseline = sync.getDirectorSyncVersion("sync-user", "batch"); events.length = 0;
    for (let i = 0; i < 100; i++) sync.markDirectorProjectChanged("sync-user", "batch", ["assets", "media"]);
    sync.markDirectorProjectChanged("foreign", "batch", ["assets"]);
    const next = sync.getDirectorSyncVersion("sync-user", "batch");
    assert.equal(next, baseline + 1); assert.equal(events.length, 1);
    assert.deepEqual(events[0], { userId: "sync-user", event: { type: "director.project.changed", projectId: "batch", version: next, changes: [{ resource: "assets" }, { resource: "media" }] } });
    assert.equal((db.prepare("SELECT version FROM director_sync_versions WHERE user_id=? AND project_id=?").get("sync-user", "batch") as { version: number }).version, next);
    assert.throws(() => getDirectorSyncSnapshot("foreign", "batch", ["assets"]), /不存在/);
    assert.throws(() => getDirectorSyncSnapshot("sync-user", "batch", ["unknown"]));
});

test("原地覆盖同大小并保留时间戳的图片推进媒体哈希及素材版本", async () => {
    const { asset, image, snapshot } = await prop("overwrite");
    const before = snapshot.data.assets!.find((item) => item.id === asset.id)!; const fileId = before.payload.variants[0]!.fileId;
    const bytes = readFileSync(image); const stats = statSync(image); bytes[13] = bytes[13]! ^ 255;
    writeFileSync(image, bytes); utimesSync(image, stats.atime, stats.mtime);
    workspace.reconcileDirectorProjectFiles("sync-user", "overwrite");
    const after = getDirectorSyncSnapshot("sync-user", "overwrite", ["assets", "media"]);
    assert.equal(after.data.assets![0]!.payload.variants[0]!.fileId, fileId); assert.ok(after.data.assets![0]!.revision > before.revision);
    assert.notEqual(after.data.mediaVersions![fileId], snapshot.data.mediaVersions![fileId]);
    assert.equal(after.data.assets![0]!.payload.variants[0]!.contentVersion, after.data.mediaVersions![fileId]);
    const fetched = await fetch(`${origin}/files/${fileId}/content?v=${after.data.mediaVersions![fileId]}`, { headers });
    assert.equal(fetched.headers.get("etag"), `"${after.data.mediaVersions![fileId]}"`); assert.match(fetched.headers.get("cache-control")!, /max-age=3600/);
    const unversioned = await fetch(`${origin}/files/${fileId}/content`, { headers }); assert.match(unversioned.headers.get("cache-control")!, /no-cache/);
});

test("原生文件替换由 watcher 更新投影并推送，不依赖 HTTP 读取", async () => {
    const { image, snapshot } = await prop("watch"); const oldRevision = snapshot.data.assets![0]!.revision; const start = events.length;
    const bytes = readFileSync(image); bytes[14] = bytes[14]! ^ 255; writeFileSync(image + ".new", bytes); renameSync(image + ".new", image);
    await waitFor(() => events.slice(start).some(({ event }) => event.projectId === "watch" && event.changes.some((change) => change.resource === "media")));
    assert.ok((db.prepare("SELECT revision FROM creative_assets WHERE user_id='sync-user' AND project_id='watch'").get() as { revision: number }).revision > oldRevision);
});

test("校验接口不会提前消费文件变化而漏掉业务同步", async () => {
    const { folder, asset } = await prop("validate-first"); const detail = workspace.getDirectorAssetDetail("sync-user", asset.id); const path = join(folder, detail.dossier.path);
    writeFileSync(path, readFileSync(path, "utf8").replace("测试道具", "已改名道具")); workspace.validateDirectorProject("sync-user", "validate-first");
    assert.equal(assets.getCreativeAsset("sync-user", asset.id).name, "已改名道具");
});

test("无效中间文档保留有效快照，恢复后重新同步", async () => {
    const folder = await project("invalid"); const path = join(folder, "story/index.md"); const original = readFileSync(path, "utf8");
    writeFileSync(path, original + "\n第一版正文\n"); workspace.reconcileDirectorProjectFiles("sync-user", "invalid");
    const before = getDirectorSyncSnapshot("sync-user", "invalid", ["story"]);
    writeFileSync(path, "---\nid: [\n---\n坏文件"); const diagnostics = workspace.reconcileDirectorProjectFiles("sync-user", "invalid");
    assert.ok(diagnostics.some((item) => item.severity === "error"));
    assert.deepEqual(getDirectorSyncSnapshot("sync-user", "invalid", ["story"]).data.state.documents, before.data.state.documents);
    writeFileSync(path, original + "\n第二版正文\n"); workspace.reconcileDirectorProjectFiles("sync-user", "invalid");
    assert.match(getDirectorSyncSnapshot("sync-user", "invalid", ["story"]).data.state.documents![0]!.content, /第二版正文/);
    assert.equal((db.prepare("SELECT needs_reconcile FROM director_sync_versions WHERE user_id='sync-user' AND project_id='invalid'").get() as { needs_reconcile: number }).needs_reconcile, 0);
});

test("删除主图清除主媒体和版本，项目删除通知保留单调版本", async () => {
    const { image, snapshot } = await prop("delete"); const fileId = snapshot.data.assets![0]!.payload.variants[0]!.fileId;
    rmSync(image); workspace.reconcileDirectorProjectFiles("sync-user", "delete");
    const next = getDirectorSyncSnapshot("sync-user", "delete", ["assets", "media"]);
    assert.equal(next.data.assets![0]!.payload.primaryImageId, null); assert.deepEqual(next.data.assets![0]!.payload.variants, []); assert.equal(next.data.mediaVersions![fileId], undefined);
    assert.equal((await request("/projects/delete", { method: "DELETE" })).response.status, 200);
    assert.ok(sync.getDirectorSyncVersion("sync-user", "delete") > next.version);
    assert.equal((await request("/director/projects/delete/sync?resources=project")).response.status, 404);
});

test("任务投影不返回文档，先按项目筛选再限制列表", async () => {
    await project("tasks"); const insert = db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,created_at,updated_at) VALUES(?,'sync-user','video','succeeded','model',?,?,?)");
    for (let i = 0; i < 120; i++) insert.run(`foreign-${i}`, JSON.stringify({ params: { __directorSegment: { projectId: "batch" } } }), "2030-01-02", "2030-01-02");
    insert.run("own-task", JSON.stringify({ params: { __directorSegment: { projectId: "tasks" } } }), "2030-01-01", "2030-01-01");
    sync.markDirectorGenerationChanged("sync-user", "own-task"); const result = getDirectorSyncSnapshot("sync-user", "tasks", ["generations"]);
    assert.deepEqual(result.data.state, {}); assert.equal(result.data.assets, undefined); assert.deepEqual(result.data.generations!.map((item) => item.id), ["own-task"]);
});

test("删除被视频段引用的素材仍更新投影，保留缺失引用诊断", async () => {
    const { folder, asset } = await prop("delete-referenced");
    await request("/director/projects/delete-referenced/documents/script", { method: "PUT", body: JSON.stringify({ revision: 1, content: "雨夜拿起道具。" }) });
    const sequence = await request("/director/projects/delete-referenced/sequences", { method: "POST", body: JSON.stringify({ title: "雨夜" }) });
    const segment = await request("/director/projects/delete-referenced/production-tasks", { method: "POST", body: JSON.stringify({ sequenceId: sequence.body.data.id, title: "拿起道具", payload: { durationSeconds: 8, propRefs: [{ id: asset.id, revision: asset.revision }] } }) });
    assert.equal(segment.response.status, 201);
    const detail = workspace.getDirectorAssetDetail("sync-user", asset.id);
    rmSync(join(folder, detail.folderPath), { recursive: true });
    const diagnostics = workspace.reconcileDirectorProjectFiles("sync-user", "delete-referenced");
    const snapshot = getDirectorSyncSnapshot("sync-user", "delete-referenced", ["assets", "segments", "validation"]);
    assert.equal(snapshot.data.assets!.length, 0); assert.equal(snapshot.data.state.videoSegments!.length, 1);
    assert.ok(diagnostics.some((item) => item.code === "ASSET_REFERENCE_MISSING"));
});

test("文档反复原子替换后继续监听原地写入，不被先行索引吞掉", async () => {
    const folder = await project("repeated-atomic");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const path = join(folder, "story/index.md");
    for (let index = 0; index < 3; index++) {
        writeFileSync(path + ".tmp", `---\nid: story\nkind: story\nname: 故事\n---\n第 ${index} 稿`); renameSync(path + ".tmp", path);
        await waitFor(() => (db.prepare("SELECT content FROM director_documents WHERE project_id=? AND kind='story'").get("repeated-atomic") as { content: string }).content.includes(`第 ${index} 稿`));
    }
    writeFileSync(path, "---\nid: story\nkind: story\nname: 故事\n---\n原地更新后正文");
    workspace.refreshDirectorProjectInstructions("sync-user", "repeated-atomic");
    await waitFor(() => (db.prepare("SELECT content FROM director_documents WHERE project_id=? AND kind='story'").get("repeated-atomic") as { content: string }).content.includes("原地更新后正文"));
});

test("删除音频依赖清空视频段与时间线引用，保留工程诊断", async () => {
    const folder = await project("delete-audio");
    await request("/director/projects/delete-audio/documents/script", { method: "PUT", body: JSON.stringify({ revision: 1, content: "雨声。" }) });
    const sequence = await request("/director/projects/delete-audio/sequences", { method: "POST", body: JSON.stringify({ id: "audio-sequence", title: "雨声" }) });
    await request("/director/projects/delete-audio/production-tasks", { method: "POST", body: JSON.stringify({ id: "audio-segment", sequenceId: sequence.body.data.id, title: "听雨", payload: { durationSeconds: 8 } }) });
    const path = join(folder, "productions/audio-segment/task.md");
    const audio = join(folder, "productions/audio-segment/model-audio.wav"); mkdirSync(dirname(audio), { recursive: true }); writeFileSync(audio, "audio fixture");
    writeFileSync(path, readFileSync(path, "utf8").replace("audioReferences: []", "audioReferences:\n  - path: productions/audio-segment/model-audio.wav\n    purpose: sound\n    description: Rain ambience"));
    const timelinePath = join(folder, "timeline/timeline.json");
    writeFileSync(timelinePath, JSON.stringify({ videoClips: [{ id: "rain-picture", taskId: "audio-segment", trimIn: 0, trimOut: 8 }], tracks: [{ id: "ambient", kind: "ambient", clips: [{ id: "rain", segmentId: "audio-segment", path: "productions/audio-segment/model-audio.wav", start: 0, duration: 8 }] }] }));
    workspace.reconcileDirectorProjectFiles("sync-user", "delete-audio");
    rmSync(audio); const diagnostics = workspace.reconcileDirectorProjectFiles("sync-user", "delete-audio");
    const snapshot = getDirectorSyncSnapshot("sync-user", "delete-audio", ["segments", "timeline"]);
    assert.deepEqual((snapshot.data.state.videoSegments![0]!.payload as { audioReferences: unknown[] }).audioReferences, []);
    assert.equal((snapshot.data.state.timeline!.payload as { tracks: Array<{ clips: Array<{ fileId?: string; path?: string }> }> }).tracks[0]!.clips[0]!.fileId, undefined, "缺失音频保留待修复片段，不能静默删除");
    assert.ok(diagnostics.some((item) => item.code === "SEGMENT_AUDIO_MISSING"));
    assert.match(readFileSync(timelinePath, "utf8"), /model-audio.wav/, "不重写权威创作文件");
});
