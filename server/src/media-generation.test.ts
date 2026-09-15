import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "neutral-media-test-"));
process.env.DATA_DIR = root;
process.env.AUTH_MODE = "dev";
process.env.APP_SECRET = "neutral-test";
const { app } = await import("./app.js");
const { db } = await import("./database.js");
const { saveMediaExecutorSettings, refreshMediaExecutorCatalog } = await import("./media-executor-settings.js");
const { createMediaGeneration } = await import("./media-generation.js");
const { getGenerationForAgent } = await import("./generation-service.js");
const { mediaGenerationStatus, saveMediaResult, readMediaTranscription } = await import("./agent/media-tools.js");
const { resolveMediaContinuation } = await import("./media-capabilities.js");
const media = Buffer.from("transport fixture, not quality acceptance");
const sha256 = createHash("sha256").update(media).digest("hex");
const jobs = new Map<string, Record<string, unknown>>();
const transcript = { version: 1, source: "transcription", model: "qwen3-asr-1.7b-local", text: "完整转写", language: "Chinese", languages: ["Chinese"], duration: 60,
    segments: Array.from({ length: 30 }, (_, index) => ({ index, text: `片段${index}`, language: "Chinese", start: index, end: index + 1, timestampSource: "vad" })) };
const acknowledged = new Set<string>();
let submissions = 0, observedFailure = false, base = "";
const executor = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer private-test-token");
    assert.equal(req.headers["x-media-protocol"], "2");
    const send = (body: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === "/v1/capabilities") return send({ version: "2", capabilities: [{ id: "minimax-music3-local", available: true, modes: ["music"], operations: ["generate"] }] });
    if (req.url === "/health") return send({ protocolVersion: "2", models: { "qwen3-asr-1.7b-local": { engine: "asr" } }, runtimes: { asr: true }, comfyFeatures: { music3: true }, h3Runtime: null });
    if (req.url === "/v1/files") { for await (const _ of req) { /* consume multipart */ } return send({ id: "uploaded-audio" }); }
    if (req.url === "/v1/jobs/validate") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString());
        if (input.mode !== "transcription") { assert.equal(input.mode, "music"); assert.equal(input.operation, "generate"); }
        assert.equal(input.metadata, undefined);
        return send({ valid: true, plan: { capabilityVersion: "1", mode: input.mode, seed: 42 } });
    }
    if (req.url === "/v1/jobs" && req.method === "POST") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString()); jobs.set(input.id, input); submissions++;
        req.socket.destroy(); // Execution accepted, HTTP response lost.
        return;
    }
    const id = req.url?.split("/")[3] || "";
    if (req.url?.endsWith("/ack")) {
        assert.equal(getGenerationForAgent("dev-admin", id)?.status, "succeeded");
        acknowledged.add(id);
        return send({ acknowledged: true });
    }
    if (req.url?.endsWith("transcription.json")) return send(transcript);
    if (req.url?.includes("/files/")) { res.writeHead(200, { "Content-Type": "audio/wav" }); res.end(media); return; }
    if (!jobs.has(id)) return send({ detail: "missing" }, 404);
    if (!observedFailure) { observedFailure = true; return send({ detail: "temporary observation outage" }, 503); }
    if (jobs.get(id)?.mode === "transcription") return send({ status: "succeeded", progress: 1, diagnostics: { phase: "completed", peakBytes: 123 }, result: { files: [{ name: "transcription.json", mimeType: "application/json" }] } });
    return send({ status: "succeeded", progress: 1, result: { files: [{ name: "music.wav", sha256 }], execution: { capabilityVersion: "1", seed: 42 } } });
});
const server = app.listen(0, "127.0.0.1");
before(async () => {
    await new Promise<void>((resolve) => executor.listen(0, "127.0.0.1", resolve));
    saveMediaExecutorSettings({ url: `http://127.0.0.1:${(executor.address() as { port: number }).port}`, token: "private-test-token" });
    await refreshMediaExecutorCatalog();
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => { await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), new Promise<void>((resolve) => executor.close(() => resolve()))]); db.close(); rmSync(root, { recursive: true, force: true }); });
const input = { kind: "audio", model: "comfyui::minimax-music3-local", mode: "music", operation: "generate", prompt: "Quiet piano", params: { seconds: 5 } };
test("中立接口预检不创建任务，拒绝私有执行字段", async () => {
    const response = await fetch(base + "/media/generations/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    assert.equal((db.prepare("SELECT count(*) AS n FROM generations").get() as { n: number }).n, 0);
    const rejected = await fetch(base + "/media/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, params: { __directorSegment: {} } }) });
    assert.equal(rejected.status, 400);
});
test("接受后断线与临时查询失败仍恢复同一任务，保存结果隔离项目且拒绝覆盖", async () => {
    const task = await createMediaGeneration("dev-admin", input, "project-a");
    let row = getGenerationForAgent("dev-admin", task.id)!;
    for (let i = 0; i < 150 && ["queued", "running"].includes(row.status); i++) { await new Promise((resolve) => setTimeout(resolve, 20)); row = getGenerationForAgent("dev-admin", task.id)!; }
    assert.equal(row.status, "succeeded", row.error || "not finished"); assert.equal(submissions, 1); assert.equal(observedFailure, true);
    const result = mediaGenerationStatus("dev-admin", "project-a", task.id).result as unknown as { files: Array<{ fileId: string }> };
    assert.throws(() => mediaGenerationStatus("dev-admin", "project-b", task.id));
    assert.throws(() => mediaGenerationStatus("another-user", "project-a", task.id));
    const path = join(root, "saved/music.wav");
    saveMediaResult("dev-admin", "project-a", task.id, result.files[0].fileId, path);
    assert.deepEqual(readFileSync(path), media);
    assert.throws(() => saveMediaResult("dev-admin", "project-a", task.id, result.files[0].fileId, path));
    await assert.rejects(resolveMediaContinuation("dev-admin", { generationId: task.id, fileId: result.files[0].fileId }), /续接状态/);
    assert.equal(JSON.stringify(mediaGenerationStatus("dev-admin", "project-a", task.id)).includes("private-test-token"), false);
});

test("ASR 保存权威 JSON、分页与项目隔离，落库后才 ACK", async () => {
    const { storeLocalFile } = await import("./file-store.js");
    const path = join(root, "reference.wav");
    writeFileSync(path, "transport fixture");
    const reference = storeLocalFile("dev-admin", path, "reference.wav", "audio/wav");
    const task = await createMediaGeneration("dev-admin", { kind: "transcription", model: "local-media::qwen3-asr-1.7b-local", mode: "transcription", operation: "transcribe", references: [{ kind: "audio", fileId: reference.id }] }, "asr-project");
    for (let i = 0; i < 150 && !acknowledged.has(task.id); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const row = getGenerationForAgent("dev-admin", task.id)!;
    assert.equal(row.kind, "transcription");
    assert.equal(row.status, "succeeded", row.error || "not completed");
    assert.ok(acknowledged.has(task.id));
    const page = readMediaTranscription("dev-admin", "asr-project", task.id, 0, 7);
    assert.equal(page.total, 30); assert.equal(page.nextOffset, 7); assert.equal(page.segments.length, 7);
    assert.equal(readMediaTranscription("dev-admin", "asr-project", task.id, 28, 7).nextOffset, null);
    assert.throws(() => readMediaTranscription("dev-admin", "another-project", task.id));
    assert.throws(() => readMediaTranscription("another-user", "asr-project", task.id));
    const saved = join(root, "saved/transcription.json");
    saveMediaResult("dev-admin", "asr-project", task.id, page.fileId, saved);
    assert.deepEqual(JSON.parse(readFileSync(saved, "utf8")), transcript);
    assert.equal((mediaGenerationStatus("dev-admin", "asr-project", task.id).diagnostics as { peakBytes: number }).peakBytes, 123);
});


test("异步工程回写失败持久记录并可恢复，重试不重复采用媒体", async () => {
    const { storeLocalFile } = await import("./file-store.js");
    const { resumeGenerationEffects } = await import("./generation-effects.js");
    const request = async (path: string, value?: unknown) => (await (await fetch(base + path, { method: value ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(value ? { body: JSON.stringify(value) } : {}) })).json() as { data: any }).data;
    await request("/projects", { id: "effects-project", kind: "director", title: "回写恢复" });
    await request("/director/projects/effects-project");
    const generationId = "recover-effect", now = new Date().toISOString();
    db.prepare("INSERT INTO director_sequences(id,user_id,project_id,position,title,created_at,updated_at) VALUES('effect-sequence','dev-admin','effects-project',0,'场次',?,?)").run(now, now);
    const shot = { id: "effect-task", payload: { durationSeconds: 4 } };
    db.prepare("INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,payload,created_at,updated_at) VALUES(?,'dev-admin','effects-project','effect-sequence',0,'任务',?,?,?)").run(shot.id, JSON.stringify(shot.payload), now, now);
    const path = join(root, "broken.mp4"); writeFileSync(path, "invalid media");
    const broken = storeLocalFile("dev-admin", path, "broken.mp4", "video/mp4");
    db.prepare("UPDATE director_shots SET payload=? WHERE id=?").run(JSON.stringify({ ...shot.payload, videoGenerationId: generationId }), shot.id);
    db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,result,created_at,updated_at) VALUES(?,'dev-admin','video','succeeded','test',?,?,?,?)").run(generationId, JSON.stringify({ metadata: { directorSegment: { projectId: "effects-project", segmentId: shot.id } } }), JSON.stringify({ files: [broken] }), now, now);
    db.prepare("INSERT INTO generation_effects(generation_id,handler,status) VALUES(?,'director','pending')").run(generationId);
    await resumeGenerationEffects();
    let effect = db.prepare("SELECT status,attempts,error FROM generation_effects WHERE generation_id=?").get(generationId) as { status: string; attempts: number; error: string | null };
    assert.equal(effect.status, "pending"); assert.equal(effect.attempts, 1); assert.ok(effect.error);
    assert.equal(getGenerationForAgent("dev-admin", generationId)!.status, "succeeded");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=64x64:r=24:d=1", "-c:v", "libx264", path]);
    const repaired = storeLocalFile("dev-admin", path, "repaired.mp4", "video/mp4");
    db.prepare("UPDATE generations SET result=? WHERE id=?").run(JSON.stringify({ files: [repaired] }), generationId);
    db.prepare("UPDATE generation_effects SET retry_after=0 WHERE generation_id=?").run(generationId);
    await resumeGenerationEffects();
    effect = db.prepare("SELECT status,attempts,error FROM generation_effects WHERE generation_id=?").get(generationId) as typeof effect;
    assert.equal(effect.status, "done"); assert.equal(effect.error, null);
    const adopted = db.prepare("SELECT payload,revision FROM director_shots WHERE id=?").get(shot.id) as { payload: string; revision: number };
    assert.equal(JSON.parse(adopted.payload).videoAdoptedGenerationId, generationId);
    db.prepare("UPDATE generation_effects SET status='pending' WHERE generation_id=?").run(generationId);
    await resumeGenerationEffects();
    assert.deepEqual(db.prepare("SELECT payload,revision FROM director_shots WHERE id=?").get(shot.id), adopted);
});


test("画布统一入口发现、校验、提交、查询和采用中立结果", async () => {
    const { buildAgentToolDefinitions } = await import("./agent/mcp/index.js");
    const { agentScenes } = await import("./agent/scenes/index.js");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects(id,user_id,title,payload,created_at,updated_at) VALUES('canvas-flow','dev-admin','test',?, ?, ?)").run(JSON.stringify({ id: "canvas-flow", nodes: [], connections: [] }), now, now);
    const context = { session: { projectId: "canvas-flow" }, run: { userId: "dev-admin" }, resolveWorkspacePath: (path: string) => join(root, "workspace", path), appendEvent() {} } as unknown as Parameters<typeof buildAgentToolDefinitions>[0];
    const tools = buildAgentToolDefinitions(context, agentScenes.canvas);
    const call = async (name: string, input: Record<string, unknown>) => {
        const result = await tools.find((tool) => tool.name === name)!.handler(input);
        assert.equal(result.isError, undefined, JSON.stringify(result));
        return JSON.parse((result.content[0] as { text: string }).text).data;
    };
    assert.equal((await call("media_list_capabilities", {})).executor.available, true);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    assert.equal((await call("media_validate_generation", { request: { source: "executor", ...input } })).valid, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n, count);
    const bypass = await tools.find((tool) => tool.name === "media_generate")!.handler({ request: { source: "channel", kind: "audio", model: input.model, prompt: "bypass" } });
    assert.equal(bypass.isError, true);
    const task = await call("media_generate", { request: { source: "executor", ...input } });
    let status = task;
    for (let i = 0; i < 150 && ["queued", "running"].includes(status.status); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        status = await call("media_get_generation_status", { generationId: task.id });
    }
    assert.equal(status.status, "succeeded");
    assert.equal((await call("canvas_get_state", { view: "summary" })).nodeCount, 0);
    const adopted = await call("canvas_adopt_result", { generationId: task.id, fileId: status.result.files[0].fileId, expectedRevision: 1 });
    assert.ok(adopted.nodeId);
    assert.equal((await call("canvas_get_state", {})).nodes[0].type, "audio");
});
