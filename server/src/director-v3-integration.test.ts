import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
const temp = mkdtempSync(join(tmpdir(), "director-v3-integration-"));
process.env.DATA_DIR = temp;
process.env.AUTH_MODE = "dev";
process.env.APP_SECRET = "isolated-test";
const { app } = await import("./app.js");
const { db } = await import("./database.js");
const { storeLocalFile } = await import("./file-store.js");
const { directorProjectRoot } = await import("./director-workspace.js");
const server = app.listen(0, "127.0.0.1");
let base = "";
before(async () => { await new Promise<void>((resolve) => server.once("listening", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("测试端口未就绪"); base = `http://127.0.0.1:${address.port}/api`; });
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); rmSync(temp, { recursive: true, force: true }); });
async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as { data?: any; error?: { message: string; details?: unknown } };
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result.error)}`);
    return result.data;
}
test("素材错误依赖返回文件诊断且不破坏工程同步", async () => {
    const projectId = "asset-dependencies-validation";
    await request("/projects", { id: projectId, kind: "director", title: "素材校验" });
    await request(`/director/projects/${projectId}`);
    const workspace = await import("./director-workspace.js");
    const root = directorProjectRoot("dev-admin", projectId);
    const path = join(root, "assets/characters/bird/character.md");
    mkdirSync(dirname(path), { recursive: true });
    const document = "---\nid: bird\nkind: character\nname: 啄木鸟\ndependencies: {}\n---\n## 描述\n黑白羽毛。\n";
    writeFileSync(path, document);
    workspace.reconcileDirectorProjectFiles("dev-admin", projectId);
    const row = () => db.prepare("SELECT payload FROM creative_assets WHERE project_id=? AND id='bird'").get(projectId) as { payload: string };
    const before = row().payload;
    writeFileSync(path, document.replace("dependencies: {}", "dependencies: []"));
    const diagnostics = workspace.reconcileDirectorProjectFiles("dev-admin", projectId);
    assert.ok(diagnostics.some((item) => item.code === "FRONTMATTER_INVALID" && item.path.endsWith("character.md") && item.message.includes("dependencies")));
    assert.equal(row().payload, before);
    await request(`/director/projects/${projectId}/sync?resources=project,assets,validation&refresh=1`);
    writeFileSync(path, document);
    assert.ok(!workspace.reconcileDirectorProjectFiles("dev-admin", projectId).some((item) => item.code === "FRONTMATTER_INVALID"));
    await request(`/director/projects/${projectId}/sync?resources=project,assets,validation&refresh=1`);
});
test("v3 一段一视频、保存恢复、无图预检、独立选片与固定快照真实合成", async () => {
    const projectId = "v3-integration";
    await request("/projects", { id: projectId, kind: "director", title: "隔离剪辑验收" });
    let state = await request(`/director/projects/${projectId}`);
    assert.deepEqual(state.timeline.payload.videoClips, []);
    await request(`/director/projects/${projectId}/documents/script`, { revision: state.documents.find((item: any) => item.kind === "script").revision, content: "# 场景\n\n甲转身。乙停步注视。" }, "PUT");
    await request(`/director/projects/${projectId}/screenplay-breakdown`, { revision: 1, scriptRevision: 2, scenes: [{ id: "scene", heading: "内景 门前", title: "门前", location: "门前", timeOfDay: "日", interiorExterior: "interior", characterNames: [], propNames: [], openingState: "甲面向门外", endingState: "乙停步", dramaticTurn: "发现对方", requiredDialogue: [], beats: [{ id: "turn", summary: "甲转身", estimatedSeconds: 30 }, { id: "stop", summary: "乙停步", estimatedSeconds: 15 }], estimatedSeconds: 45 }], reviewIssues: [] }, "PUT");
    const sequence = await request(`/director/projects/${projectId}/sequences`, { id: "sequence", title: "门前" });
    for (const [id, name] of [["main", "主镜头"], ["reaction", "反应镜头"]]) await request(`/director/projects/${projectId}/segments`, { design: { id, kind: "segment-design", name, sequenceId: sequence.id, order: id === "main" ? 1 : 2, sourceSceneId: "scene", sourceBeatIds: [id === "main" ? "turn" : "stop"], estimatedSeconds: 8, previsMode: "skip" }, hash: "", content: "可独立完成的文字设计" }, "PUT");
    const designs = await request(`/director/projects/${projectId}/segments`);
    assert.equal(designs.total, 2); assert.equal(designs.items[0].estimatedSeconds, 8);
    const { createSession, sendMessage, getSessionEvents, subscribeConversation } = await import("./agent/service.js");
    const session = createSession("dev-admin", projectId, "引用名称测试");
    db.prepare("UPDATE agent_sessions SET status='running' WHERE id=?").run(session.id);
    const mention = { type: "director" as const, mentionId: "mention-main", projectId, entityKind: "segment-design" as const, entityId: "main" };
    const queued = await sendMessage("dev-admin", projectId, { preferredSessionId: session.id, clientMessageId: "name-test", submissionMode: "queue", content: { version: 1, segments: [mention, { type: "text", text: " 请修订" }] } });
    assert.equal(queued.queuedMessages[0].displayText, "@主镜头 请修订");
    const stored = { text: "@main 请修订", content: { version: 1, segments: [{ ...mention, label: "main" }, { type: "text", text: " 请修订" }] } };
    db.prepare("INSERT INTO agent_events(session_id,seq,kind,payload,created_at) VALUES(?,1,'user_text',?,?)").run(session.id, JSON.stringify(stored), new Date().toISOString());
    const restored = getSessionEvents("dev-admin", session.id);
    assert.equal(restored[0].payload.text, "@主镜头 请修订");
    assert.equal((restored[0].payload.content as any).segments[0].entityId, "main");
    assert.equal((restored[0].payload.content as any).segments[0].label, "主镜头");
    db.prepare("UPDATE agent_sessions SET event_seq=1 WHERE id=?").run(session.id);
    const replay: any[] = [];
    const unsubscribe = subscribeConversation("dev-admin", projectId, "name-replay", (event) => replay.push(event), { sessionId: session.id, seq: 0 });
    unsubscribe();
    assert.equal(replay.find((event) => event.type === "delta").events[0].payload.text, "@主镜头 请修订");
    assert.equal(JSON.parse((db.prepare("SELECT payload FROM agent_events WHERE session_id=? AND seq=1").get(session.id) as { payload: string }).payload).text, "@main 请修订", "展示恢复不改写历史数据库");
    let task = await request(`/director/projects/${projectId}/production-tasks`, { id: "task", sequenceId: sequence.id, title: "主画面与反应", payload: { durationSeconds: 8, segmentId: "main", referenceImages: [] } });
    const long = await request(`/director/projects/${projectId}/production-tasks`, { id: "long", sequenceId: sequence.id, title: "长镜头后半", payload: { segmentId: "reaction" } });
    const checked = await request(`/director/production-tasks/${long.id}/preflight`);
    assert.equal(long.payload.durationSeconds, 8, "制作时长来自完整分镜段");
    assert.ok(checked.blockedReasons.length > 0, "缺少最终提示或执行器时不得声称可提交");
    assert.ok(!checked.blockedReasons.some((reason: string) => reason.includes("缺少故事板")));
    state = await request(`/director/projects/${projectId}`);
    assert.deepEqual(state.videoSegments.find((item: any) => item.id === "task").payload.segmentId, "main");
    const source = join(temp, "source.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
    const media = storeLocalFile("dev-admin", source, "source.mp4", "video/mp4");
    task = state.videoSegments.find((item: any) => item.id === "task");
    task = await request(`/director/production-tasks/${task.id}`, { revision: task.revision, payload: { videoFileId: media.id, nativeAudioFileId: media.id, videoDurationSeconds: 3, videoQualityPreset: "preview" } }, "PUT");
    const taskPath = join(directorProjectRoot("dev-admin", projectId), "productions/task/task.md");
    const taskDocument = readFileSync(taskPath, "utf8");
    assert.ok(!taskDocument.includes("durationSeconds:"));
    const main = (await request(`/director/projects/${projectId}/segments`)).items.find((item: any) => item.id === "main");
    await request(`/director/projects/${projectId}/segments`, { design: { ...main, estimatedSeconds: 10 }, content: main.content, hash: main.hash }, "PUT");
    state = await request(`/director/projects/${projectId}`);
    const retimed = state.videoSegments.find((item: any) => item.id === "task");
    assert.equal(retimed.payload.durationSeconds, 10, "制作时长自动读取分镜，不保留第二份计划");
    assert.equal(retimed.payload.videoDurationSeconds, 3, "旧视频实际时长不随分镜改写");
    assert.equal(retimed.payload.videoStale, true);
    assert.equal(readFileSync(taskPath, "utf8"), taskDocument, "改分镜不改写原制作输入");
    const duplicatePath = join(dirname(taskPath), "../duplicate/task.md");
    mkdirSync(dirname(duplicatePath), { recursive: true });
    writeFileSync(duplicatePath, taskDocument.replace("id: task", "id: duplicate").replace("order: 1", "order: 3"));
    const duplicateFiles = await request(`/director/projects/${projectId}/validation`);
    assert.ok(duplicateFiles.diagnostics.some((item: any) => item.code === "DUPLICATE_SEGMENT_PRODUCTION"));
    unlinkSync(duplicatePath);
    state = await request(`/director/projects/${projectId}`);
    assert.deepEqual(state.timeline.payload.videoClips, [], "完成媒体不会自动入轨");
    const videoClips = [{ id: "first", taskId: "task", trimIn: 0, trimOut: 1, linkedAudio: false }, { id: "reaction-cut", taskId: "task", trimIn: 1.5, trimOut: 2.5, linkedAudio: false }];
    const tracks = [{ id: "dialogue", kind: "model-original", clips: [{ id: "voice", taskId: "task", start: .25, trimIn: .5, duration: 1.5, volume: .5 }] }];
    await request(`/director/projects/${projectId}/timeline`, { revision: state.timeline.revision, payload: { videoClips, tracks } }, "PUT");
    state = await request(`/director/projects/${projectId}`);
    assert.deepEqual(state.timeline.payload.videoClips, videoClips);
    const validation = await request(`/director/projects/${projectId}/validation`);
    assert.ok(validation.diagnostics.some((item: any) => item.code === "EDIT_CONTENT_UNCOVERED" && item.message.includes("stop")), "未采用的另一段仍提示节拍未覆盖");
    const duplicate = await fetch(base + `/director/projects/${projectId}/production-tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "duplicate", sequenceId: sequence.id, title: "重复任务", payload: { segmentId: "main" } }) });
    assert.equal(duplicate.status, 409);
    const selected = state.videoSegments.find((item: any) => item.id === "task");
    for (const payload of [{ segmentRanges: [{ segmentId: "main", start: 0, end: 4 }] }, { durationSeconds: 4 }]) {
        const rejected = await fetch(base + `/director/production-tasks/${selected.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: selected.revision, payload }) });
        assert.equal(rejected.status, 400);
    }
    const otherScene = await request(`/director/projects/${projectId}/sequences`, { id: "other-scene", title: "另一场" });
    const wrongScene = await fetch(base + `/director/production-tasks/${selected.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: selected.revision, sequenceId: otherScene.id }) });
    assert.equal(wrongScene.status, 400, "仅修改制作记录父场景也必须核对分镜归属");
    const plan = await request(`/director/projects/${projectId}/playback-plan`);
    assert.deepEqual(plan.segments.map((clip: any) => clip.clipId), ["first", "reaction-cut"]);
    assert.equal(plan.duration, 2); assert.equal(plan.audio.length, 1); assert.equal(plan.audio[0].start, .25);
    const mediaBefore = (db.prepare("SELECT payload FROM director_shots WHERE id='task'").get() as { payload: string }).payload;
    const { syncDirectorGeneration } = await import("./director-render.js");
    for (const status of ["running", "failed", "canceled"]) {
        await syncDirectorGeneration({ user_id: "dev-admin", id: "unsuccessful", status, request: JSON.stringify({ metadata: { directorSegment: { projectId, segmentId: "task" } } }) } as import("./generation-service.js").GenerationRow);
        assert.equal((db.prepare("SELECT payload FROM director_shots WHERE id='task'").get() as { payload: string }).payload, mediaBefore, `${status} 保留现有媒体`);
    }
    const fullPayload = JSON.parse(mediaBefore);
    db.prepare("UPDATE director_shots SET payload=? WHERE id='task'").run(JSON.stringify({ ...fullPayload, videoDurationSeconds: 1 }));
    const invalidCut = await fetch(base + `/director/projects/${projectId}/playback-plan`);
    assert.equal(invalidCut.status, 409);
    assert.match(JSON.stringify(await invalidCut.json()), /超出.*实际素材/);
    db.prepare("UPDATE director_shots SET payload=? WHERE id='task'").run(mediaBefore);
    const render = await request(`/director/projects/${projectId}/renders`, { timelineRevision: state.timeline.revision });
    const record = db.prepare("SELECT payload FROM director_renders WHERE id=?").get(render.id) as { payload: string };
    const snapshot = JSON.parse(record.payload).snapshot;
    assert.ok(snapshot.segments.every((clip: any) => clip.path.startsWith(join(temp, "director-render-inputs"))));
    const frozen = readFileSync(snapshot.segments[0].path);
    const root = directorProjectRoot("dev-admin", projectId);
    writeFileSync(join(root, "productions/task/preview.mp4"), "replaced after submit");
    assert.deepEqual(readFileSync(snapshot.segments[0].path), frozen);
    let result;
    for (let attempt = 0; attempt < 200; attempt++) { result = (await request(`/director/projects/${projectId}/renders`)).find((item: any) => item.id === render.id); if (["succeeded", "failed"].includes(result.status)) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.equal(result.status, "succeeded", result.error);
    const output = join(root, `renders/${render.id}/final.mp4`);
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output], { encoding: "utf8" }));
    assert.ok(Math.abs(duration - 2) < .1);
    assert.deepEqual(JSON.parse(readFileSync(join(root, `renders/${render.id}/render.json`), "utf8")).timeline.videoClips, videoClips);
});



test("预演独立状态、定妆帧版本、快照与读取归属隔离", async () => {
    const projectId = "previs-files", userId = "dev-admin";
    await request("/projects", { id: projectId, kind: "director", title: "预演文件回归" });
    await request(`/director/projects/${projectId}/documents/script`, { revision: 1, content: "# 桥边\n三人相遇并递还盒子。" }, "PUT");
    const sequence = await request(`/director/projects/${projectId}/sequences`, { id: "station", title: "桥边相遇" });
    await request(`/director/projects/${projectId}/segments`, { design: { id: "meeting", kind: "segment-design", name: "桥边相遇", sequenceId: sequence.id, order: 1, estimatedSeconds: 12 }, hash: "", content: "交叉走位、递物与道别" }, "PUT");
    const segment = (await request(`/director/projects/${projectId}/segments`)).items[0];
    const root = directorProjectRoot(userId, projectId), folder = dirname(join(root, segment.path));
    const sample = JSON.parse(readFileSync(new URL("./agent/scenes/director/skills/director-stage-previs/references/example.json", import.meta.url), "utf8"));
    writeFileSync(join(folder, "../../scene.json"), JSON.stringify(sample.scene));
    writeFileSync(join(folder, "previs.json"), JSON.stringify(sample.plan));
    const workspace = await import("./director-workspace.js");
    workspace.reconcileDirectorProjectFiles(userId, projectId);
    const previs = await import("./director-previs.js");
    const current = await request(`/director/projects/${projectId}/segments/meeting/previs`);
    assert.deepEqual(current.diagnostics, []); assert.equal(current.plan.shots.length, 3);
    assert.equal(current.previsMode, "required");
    assert.throws(() => previs.readDirectorPrevis("other", projectId, "meeting"));
    assert.equal((await fetch(base + `/director/projects/v3-integration/segments/meeting/previs`)).status, 404);
    assert.throws(() => previs.createDirectorLookFrame(userId, projectId, "meeting", 10, "old-hash"), /预演已经修改/);
    const frame = previs.createDirectorLookFrame(userId, projectId, "meeting", 10, current.hash);
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZ0AAAAASUVORK5CYII=", "base64");
    writeFileSync(join(root, frame.path, "primary.png"), image);
    workspace.reconcileDirectorProjectFiles(userId, projectId);
    let viewed = previs.readDirectorPrevis(userId, projectId, "meeting");
    assert.equal(viewed.lookFrames[0].stale, false); assert.ok(viewed.lookFrames[0].fileId);
    const before = readFileSync(join(folder, "previs.json"), "utf8");
    sample.plan.shots[0].keys[0].position[0] += 1;
    writeFileSync(join(folder, "previs.json"), JSON.stringify(sample.plan));
    viewed = previs.readDirectorPrevis(userId, projectId, "meeting");
    assert.equal(viewed.lookFrames[0].stale, true);
    assert.equal(viewed.lookFrames[0].sourceHash, current.hash);
    previs.createDirectorLookFrame(userId, projectId, "meeting", 10, viewed.hash, frame.id);
    assert.equal(previs.readDirectorPrevis(userId, projectId, "meeting").lookFrames[0].stale, true, "提取新画面不冒充旧图已重绘");
    const snapshot = previs.freezeDirectorGenerationInputs(userId, projectId, "immutable", "run-1", [{ fileId: viewed.lookFrames[0].fileId!, kind: "image" }], "原始提示", { meeting: viewed.hash });
    const frozenFile = (await import("./file-store.js")).getStoredFile(userId, snapshot.references[0].fileId)!;
    writeFileSync(join(root, frame.path, "primary.png"), "changed");
    assert.deepEqual(readFileSync(frozenFile.path), image);
    assert.equal(readFileSync(join(root, "productions/immutable/runs/run-1/prompt.md"), "utf8"), "原始提示");
    assert.throws(() => previs.freezeDirectorGenerationInputs(userId, projectId, "immutable", "run-2", [], "", { meeting: current.hash }), /预演在提交期间变化/);
    const snapshotManifest = JSON.parse(readFileSync(join(root, snapshot.path), "utf8"));
    assert.equal(snapshotManifest.previs[0].hash, viewed.hash);
    // Invalid optional images do not block otherwise valid staging.
    writeFileSync(join(root, frame.path, "frame.json"), "{}");
    assert.equal(previs.validDirectorPrevis(userId, projectId, "meeting").diagnostics.length, 0);
    assert.equal(previs.readDirectorPrevis(userId, projectId, "meeting").warnings.length, 1);
    writeFileSync(join(folder, "previs.json"), before);
    assert.throws(() => previs.updateDirectorLookFrame(userId, projectId, "meeting", "missing", { remove: true, expectedHash: "wrong" }), /预演已经修改/);
});

test("本段素材按身份与变体去重，粗模不算缺图，漏绑角色仍可见", async () => {
    const projectId = "previs-asset-references", userId = "dev-admin";
    await request("/projects", { id: projectId, kind: "director", title: "素材需求回归" });
    await request(`/director/projects/${projectId}/documents/script`, { revision: 1, content: "林地，两只青蛙与猫头鹰相遇。" }, "PUT");
    const sequence = await request(`/director/projects/${projectId}/sequences`, { id: "forest", title: "林地" });
    await request(`/director/projects/${projectId}/segments`, { design: { id: "meeting", kind: "segment-design", name: "相遇", sequenceId: sequence.id, order: 1, estimatedSeconds: 4 }, hash: "", content: "" }, "PUT");
    const workspace = await import("./director-workspace.js"), previs = await import("./director-previs.js");
    const root = directorProjectRoot(userId, projectId), segment = (await request(`/director/projects/${projectId}/segments`)).items[0];
    const folder = dirname(join(root, segment.path));
    const write = (path: string, data: string | Buffer) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZ0AAAAASUVORK5CYII=", "base64");
    write("assets/characters/frog/character.md", "---\nid: frog\nkind: character\nname: 青蛙\n---\n");
    write("assets/characters/frog/identity/primary.png", png);
    write("assets/locations/tree/location.md", "---\nid: tree\nkind: location\nname: 老杉树\n---\n");
    write("assets/characters/frog/variants/wet/variant.md", "---\nid: wet\nkind: asset-variant\nname: 湿身\n---\n");
    write("assets/characters/frog/variants/wet/primary.png", png);
    const scene = { version: 1, id: "forest", name: "林地", objects: [
        { id: "a", name: "青蛙一", kind: "animal", assetId: "frog", position: [0, 0, 0] },
        { id: "b", name: "青蛙二", kind: "animal", assetId: "frog", position: [1, 0, 0] },
        { id: "c", name: "猫头鹰", kind: "animal", position: [2, 0, 0] },
        { id: "offstage", name: "未出场角色", kind: "human", position: [100, 0, 0] },
        { id: "tree", name: "主干代理", kind: "box", assetId: "tree", position: [0, 0, -2] },
        { id: "ground", name: "地面", kind: "ground", position: [0, 0, 0] },
        { id: "bark", name: "树皮分块", kind: "box", position: [0, 1, -2] },
    ] };
    const plan = { version: 1, segmentId: "meeting", duration: 4, initial: Object.fromEntries(scene.objects.map((o) => [o.id, { position: o.position, yaw: 0 }])),
        actions: ["a", "b", "c"].map((objectId) => ({ id: objectId, objectId, kind: "touch", target: "bark", start: 0, end: 4 })),
        shots: [{ id: "wide", name: "全景", start: 0, end: 4, keys: [{ time: 0, position: [0, 3, 8], target: [0, 1, 0] }] }] };
    writeFileSync(join(folder, "../../scene.json"), JSON.stringify(scene)); writeFileSync(join(folder, "previs.json"), JSON.stringify(plan));
    workspace.reconcileDirectorProjectFiles(userId, projectId);
    let refs = previs.readDirectorPrevis(userId, projectId, "meeting").assetReferences;
    assert.equal(refs.length, 3);
    assert.deepEqual(refs.find((r) => r.assetId === "frog")?.objectIds, ["a", "b"]);
    assert.equal(refs.find((r) => r.assetId === "frog")?.status, "ready");
    assert.equal(refs.find((r) => r.name === "猫头鹰")?.status, "unbound");
    assert.equal(refs.find((r) => r.assetId === "tree")?.status, "missing-image");
    assert.ok(refs.every((r) => !r.objectIds.some((id) => ["ground", "bark", "offstage"].includes(id))));
    const document = readFileSync(join(root, segment.path), "utf8");
    writeFileSync(join(root, segment.path), document.replace("kind: segment-design", "kind: segment-design\nassetReferences:\n  - objectId: a\n    variantId: wet\n  - objectId: tree\n  - objectId: bark"));
    workspace.reconcileDirectorProjectFiles(userId, projectId);
    refs = (await request(`/director/projects/${projectId}/segments/meeting/previs`)).assetReferences;
    assert.equal(refs.find((r) => r.variantId === "wet")?.status, "ready");
    assert.deepEqual(refs.find((r) => r.assetId === "frog" && !r.variantId)?.objectIds, ["b"]);
    assert.equal(refs.find((r) => r.objectIds.includes("bark"))?.status, "unbound", "明确声明需要身份的静物仍提示漏绑");
    assert.notEqual(refs.find((r) => r.variantId === "wet")?.fileId, refs.find((r) => r.assetId === "frog" && !r.variantId)?.fileId);
    writeFileSync(join(root, segment.path), readFileSync(join(root, segment.path), "utf8").replace("variantId: wet", "variantId: nonexistent"));
    assert.equal(previs.readDirectorPrevis(userId, projectId, "meeting").assetReferences.find((r) => r.variantId === "nonexistent")?.status, "unbound");
    unlinkSync(join(root, "assets/characters/frog/identity/primary.png"));
    assert.equal(previs.readDirectorPrevis(userId, projectId, "meeting").assetReferences.find((r) => r.assetId === "frog" && !r.variantId)?.status, "missing-image", "历史媒体登记不能掩盖主图已删除");
});
