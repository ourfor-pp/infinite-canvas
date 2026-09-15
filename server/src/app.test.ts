import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import PDFDocument from "pdfkit";
import AdmZip from "adm-zip";

const fixtureSheet = (duration: number, count = 4) => ({ revision: 1, layout: count === 6 ? "3x2" : "2x2", frames: Array.from({ length: count }, (_, index) => ({ id: `frame-${index}`, position: index, shotNumber: 1, timeSeconds: index * duration / (count - 1), kind: index === 0 ? "shot-start" : index === count - 1 ? "shot-end" : "keyframe", description: "静态画面", action: "", cameraAngle: "", cameraMove: "", sound: "" })) });
const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-server-"));
process.env.DATA_DIR = testData;
process.env.AUTH_MODE = "fnos";
process.env.APP_SECRET = "test-secret";

const [{ app }, { db }, { parseGatewayUser }, { applyCanvasOps, createAgentCreativeAssetBatch }, { isRetriableAgentDiagnostic, recoverAgentRuns, resolveAgentNativeTools, resolveAgentToolSearchMode }, { parseSkillAllowedTools, syncBuiltInAgentSkills }, { providerInputSchema }, { agentScenes }, { getDirectorVideoSegmentPreflight, updateDirectorStoryboardPrompts }, { listDirectorVideoSegments }, { applyDirectorAssetGeneration }] = await Promise.all([import("./app.js"), import("./database.js"), import("./auth.js"), import("./agent/canvas-tools.js"), import("./agent/service.js"), import("./agent/skill-registry.js"), import("./provider-service.js"), import("./agent/scenes/index.js"), import("./director-render.js"), import("./director.js"), import("./director-workspace.js")]);
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

test("Agent 将 steer 后的 EDE 空回合识别为可自动续接", () => {
    assert.equal(isRetriableAgentDiagnostic("[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"), true);
    assert.equal(isRetriableAgentDiagnostic("[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null"), true, "运行中补充消息可能以 null stop_reason 提前结束当前 SDK 回合");
    assert.equal(isRetriableAgentDiagnostic("[ede_diagnostic] result_type=assistant last_content_type=none stop_reason=null"), true);
    assert.equal(isRetriableAgentDiagnostic("permission denied"), false);
});

test("Agent 使用原生 Skill 且危险内置工具保持禁用", () => {
    const enabled = resolveAgentNativeTools(true);
    assert.deepEqual(enabled.tools, { type: "preset", preset: "claude_code" });
    assert.equal(enabled.allowedTools.includes("Skill"), false, "SDK 已弃用在顶层 allowedTools 放行 Skill");
    assert.equal(enabled.autoAllowedTools.includes("Skill"), true);
    assert.deepEqual(enabled.settings.permissions.allow, enabled.autoAllowedTools);
    assert.equal(enabled.allowedTools.includes("ToolSearch"), true);
    assert.equal(enabled.disallowedTools.includes("Bash"), true);
    assert.equal(enabled.disallowedTools.includes("AskUserQuestion"), true, "提问必须走场景 ask_user，不能显示成 SDK 权限审批");
    assert.equal(enabled.disallowedTools.includes("Write"), true);
    const disabled = resolveAgentNativeTools(false);
    assert.equal(disabled.allowedTools.includes("ToolSearch"), false);
    assert.equal(disabled.disallowedTools.includes("ToolSearch"), true);
    const director = resolveAgentNativeTools(true, "director");
    assert.equal(director.allowedTools.includes("Write"), true);
    assert.equal(director.allowedTools.includes("Edit"), true);
    assert.equal(director.allowedTools.includes("Glob"), true);
    assert.equal(director.disallowedTools.includes("Bash"), true);
});

test("Agent Skill 解析单行和列表 allowed-tools", () => {
    assert.deepEqual(parseSkillAllowedTools("---\nname: demo\nallowed-tools: [Read, mcp__infinite_canvas__canvas_get_state]\n---\n"), ["Read", "mcp__infinite_canvas__canvas_get_state"]);
    assert.deepEqual(parseSkillAllowedTools("---\nname: demo\nallowed-tools:\n  - ToolSearch\n  - mcp__infinite_canvas__generation_create\n---\n"), ["ToolSearch", "mcp__infinite_canvas__generation_create"]);
});

test("画布与导演 Agent 的 Skill 和工具清单完全隔离", () => {
    assert.equal(agentScenes.canvas.skillIds.some((id) => id.startsWith("director-")), false);
    assert.equal(agentScenes.director.skillIds.every((id) => id.startsWith("director-")), true);
    assert.equal(agentScenes.director.skillIds.length, 14);
    assert.equal(agentScenes.director.skillIds.includes("director-write-story"), true);
    assert.equal(agentScenes.canvas.skillIds.includes("director-write-story"), false);
    assert.equal(agentScenes.canvas.tools.some((item) => item.id.startsWith("director_")), false);
    assert.equal(agentScenes.director.tools.some((item) => item.id.startsWith("canvas_") || item.id.startsWith("creative_asset") || item.id.startsWith("visual_style") || String(item.id) === "site_navigate"), false);
    assert.equal(agentScenes.director.tools.map((item) => String(item.id)).some((id) => id === "director_list_video_segments" || id === "director_update_video_segment"), false, "导演内容读写应使用受控文件工具，不再暴露语义 CRUD");
    assert.equal(agentScenes.director.tools.some((item) => item.id === "director_generate_task"), true);
});

test("项目工作区只同步当前 Agent 场景 Skills 并清理旧场景", () => {
    const workspace = mkdtempSync(join(testData, "scene-skills-"));
    syncBuiltInAgentSkills(workspace, agentScenes.canvas.skillIds);
    assert.deepEqual(readdirSync(join(workspace, ".claude", "skills")).filter((name) => !name.startsWith(".")).sort(), [...agentScenes.canvas.skillIds].sort());
    syncBuiltInAgentSkills(workspace, agentScenes.director.skillIds);
    const directorSkills = readdirSync(join(workspace, ".claude", "skills")).filter((name) => !name.startsWith(".")).sort();
    assert.deepEqual(directorSkills, [...agentScenes.director.skillIds].sort());
    assert.equal(directorSkills.includes("canvas-edit"), false);
    assert.equal(directorSkills.includes("director-write-story"), true);
    syncBuiltInAgentSkills(workspace, agentScenes.director.skillIds);
    assert.deepEqual(readdirSync(join(workspace, ".claude", "skills")).filter((name) => !name.startsWith(".")).sort(), directorSkills);
});

test("视频模型必须显式声明首尾帧与 Extend 能力", () => {
    const base = { name: "视频渠道", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: false, models: [{ id: "video-model", name: "视频模型", endpoint: "openai-video", enabled: true, videoExtend: true, videoReferenceRoles: ["first-frame"] }] };
    assert.equal(providerInputSchema.safeParse(base).success, false);
    assert.equal(providerInputSchema.safeParse({ ...base, models: [{ ...base.models[0], videoReferenceRoles: ["first-frame", "last-frame", "continuation"] }] }).success, true);
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

test("导演项目隔离、长篇分块、阶段确认与过期依赖", async () => {
    const projectId = "director-project-1";
    const created = await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "长片测试" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.kind, "director");
    assert.equal((await api("/projects?kind=canvas", userOne)).body.data.some((item: { id: string }) => item.id === projectId), false);
    assert.equal((await api("/projects?kind=director", userOne)).body.data.some((item: { id: string }) => item.id === projectId), true);
    assert.equal((await api(`/director/projects/${projectId}`, userTwo)).response.status, 404);

    const initial = await api(`/director/projects/${projectId}`, userOne);
    assert.deepEqual(initial.body.data.documents.map((item: { kind: string }) => item.kind).sort(), ["script", "story"]);
    assert.equal(initial.body.data.screenplayBreakdown.stale, true);
    assert.equal(initial.body.data.timeline.revision, 1);
    assert.deepEqual(initial.body.data.workspace.directingRules, { positioning: "", intent: "", photography: "", performance: "", pacing: "", sound: "", prohibitions: "" });
    const directingPlan = await api(`/director/projects/${projectId}/workspace`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, directingRules: { positioning: "都市悬疑长片；冷峻克制；面向成年观众", photography: "稳定观察人物与空间", performance: "克制生活化", pacing: "完整动作优先", sound: "环境声维持空间连续", prohibitions: "禁止无意义慢动作" } }) });
    assert.equal(directingPlan.response.status, 200);
    assert.equal(directingPlan.body.data.revision, 2);
    assert.equal(directingPlan.body.data.directingRules.performance, "克制生活化");
    assert.equal(directingPlan.body.data.directingRules.positioning, "都市悬疑长片；冷峻克制；面向成年观众");
    const directingRulesFile = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent("direction/directing-rules.md")}`, userOne);
    assert.match(directingRulesFile.body.data.content, /## 创作定位\n\n都市悬疑长片；冷峻克制；面向成年观众/);
    assert.match(directingRulesFile.body.data.content, /## 核心导演意图/);

    const chapter = "林夏走进雨夜车站。她看见旧怀表，决定追查失踪案。".repeat(450);
    const novel = Array.from({ length: 100 }, (_, index) => `第${index + 1}章 雨夜\n${chapter}`).join("\n");
    assert.ok(novel.length > 1_000_000);
    const form = new FormData();
    form.set("file", new Blob([novel], { type: "text/plain" }), "百万字小说.txt");
    const uploaded = await api("/files", userOne, { method: "POST", body: form });
    const sourceCreated = await api(`/director/projects/${projectId}/sources`, userOne, { method: "POST", body: JSON.stringify({ fileId: uploaded.body.data.fileId }) });
    assert.equal(sourceCreated.response.status, 202);
    let source = sourceCreated.body.data;
    for (let index = 0; index < 100 && source.status === "processing"; index += 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
        source = (await api(`/director/projects/${projectId}`, userOne)).body.data.sources[0];
    }
    assert.equal(source.status, "ready");
    assert.equal(source.chapterCount, 100);
    assert.equal(source.charCount > 1_000_000, true);
    const chunks = await api(`/director/sources/${source.id}/chunks?q=${encodeURIComponent("旧怀表")}&limit=5`, userOne);
    assert.equal(chunks.response.status, 200);
    assert.equal(chunks.body.data.length, 5);

    const story = await api(`/director/projects/${projectId}/documents/story`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, content: "# 故事\n林夏追查旧怀表。" }) });
    assert.equal(story.body.data.revision, 2);
    assert.equal(story.body.data.status, undefined, "导演文档不再暴露确认状态");
    const storyConflict = await api(`/director/projects/${projectId}/documents/story`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, content: "旧稿" }) });
    assert.equal(storyConflict.response.status, 409);
    const gatedSequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ title: "雨夜车站" }) });
    assert.equal(gatedSequence.response.status, 409);
    const script = await api(`/director/projects/${projectId}/documents/script`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, content: "## 场 1 · 雨夜车站\n林夏：我会找到真相。" }) });
    assert.equal(script.response.status, 200);
    const screenplayBreakdown = await api(`/director/projects/${projectId}/screenplay-breakdown`, userOne, { method: "PUT", body: JSON.stringify({
        revision: 1,
        scriptRevision: 2,
        scenes: [{
            id: "S001", heading: "场 1 · 外景 · 雨夜车站 · 夜", title: "雨夜车站", location: "车站", timeOfDay: "夜", interiorExterior: "exterior",
            characterNames: ["林夏"], propNames: ["旧怀表"], openingState: "林夏没有线索", endingState: "林夏决定追查旧怀表", dramaticTurn: "旧怀表成为失踪案线索",
            requiredDialogue: ["我会找到真相。"], beats: [{ id: "S001-B01", summary: "林夏发现旧怀表并作出决定", estimatedSeconds: 25 }], estimatedSeconds: 25,
        }],
        reviewIssues: [],
    }) });
    assert.equal(screenplayBreakdown.response.status, 200);
    assert.equal(screenplayBreakdown.body.data.stale, false);
    assert.equal(screenplayBreakdown.body.data.payload.estimatedDurationSeconds, 25);
    const revisedScript = await api(`/director/projects/${projectId}/documents/script`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, content: "## 场 1 · 雨夜车站\n林夏握紧旧怀表。\n\n林夏：我一定会找到真相。" }) });
    assert.equal(revisedScript.response.status, 200);
    assert.equal((await api(`/director/projects/${projectId}/screenplay-breakdown`, userOne)).body.data.stale, true, "剧本 revision 改变后制作拆解必须过期");
    const refreshedBreakdown = await api(`/director/projects/${projectId}/screenplay-breakdown`, userOne, { method: "PUT", body: JSON.stringify({
        revision: 2,
        scriptRevision: 3,
        scenes: screenplayBreakdown.body.data.payload.scenes,
        reviewIssues: [{ type: "duration", sceneIds: ["S001"], summary: "当前场次短于项目目标", suggestion: "补足关键选择的表演过程" }],
    }) });
    assert.equal(refreshedBreakdown.response.status, 200);
    assert.equal(refreshedBreakdown.body.data.stale, false);
    assert.equal(refreshedBreakdown.body.data.payload.review.status, "needs_revision");
    const sequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ id: "z-first-sequence", position: 0, title: "雨夜车站", summary: "线索出现", payload: { storyboard: Array.from({ length: 6 }, (_, position) => ({ id: `panel-${position}`, position, title: `镜头 ${position + 1}` })) } }) });
    assert.equal(sequence.response.status, 201);
    const segment = await api(`/director/projects/${projectId}/production-tasks`, userOne, { method: "POST", body: JSON.stringify({ sequenceId: sequence.body.data.id, title: "车站全景", payload: { durationSeconds: 8, storyboardSheet: fixtureSheet(8, 6), boundary: "cut", characterRefs: [{ id: "character-stable-id", revision: 3 }] } }) });
    assert.equal(segment.response.status, 201);
    assert.equal(segment.body.data.payload.storyboardFrameCount, 6);
    assert.equal(segment.body.data.payload.storyboardSheet.layout, "3x2");
    assert.equal(segment.body.data.payload.storyboardSheet.frames.length, 6);
    const laterSequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ id: "a-later-sequence", position: 1, title: "清晨离站" }) });
    await api(`/director/projects/${projectId}/production-tasks`, userOne, { method: "POST", body: JSON.stringify({ id: "a-later-segment", sequenceId: laterSequence.body.data.id, position: 0, title: "清晨站台", payload: { durationSeconds: 4, storyboardSheet: fixtureSheet(4), sourceSceneId: "S002", sourceBeatIds: ["S002-B01"], sourceDurationSeconds: 4, dramaticBeat: "林夏决定离开车站", openingState: "林夏停在空荡站台", endingState: "林夏提起行李走向出口" } }) });
    const orderedState = await api(`/director/projects/${projectId}`, userOne);
    assert.deepEqual(orderedState.body.data.videoSegments.map((item: { title: string }) => item.title), ["车站全景", "清晨站台"], "视频段必须按剧情段落位置和段内位置排序，而不是按随机 ID 排序");
    const promptSegment = orderedState.body.data.videoSegments[1];
    const { ensureDirectorProjectWorkspace: promptRoot, reconcileDirectorProjectFiles: reconcilePromptFixture } = await import("./director-workspace.js");
    writeFileSync(join(promptRoot(userOne["X-Trim-Userid"], projectId), `productions/${promptSegment.id}/storyboard.png`), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZ0AAAAASUVORK5CYII=", "base64"));
    reconcilePromptFixture(userOne["X-Trim-Userid"], projectId);
    const existingSheetId = JSON.parse((db.prepare("SELECT payload FROM director_shots WHERE id=?").get(promptSegment.id) as { payload: string }).payload).storyboardSheet.imageFileId;
    const originalSheet = { ...promptSegment.payload.storyboardSheet, imageFileId: existingSheetId, generationId: "existing-generation", promptSnapshot: "old prompt", frames: promptSegment.payload.storyboardSheet.frames.map((frame: Record<string, unknown>, index: number) => ({ ...frame, croppedFileId: `crop-${index}` })) };
    db.prepare("UPDATE director_shots SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...promptSegment.payload, storyboardSheet: originalSheet, videoFileId: "existing-video" }), promptSegment.id, userOne["X-Trim-Userid"]);
    const guidePreflight = getDirectorVideoSegmentPreflight(userOne["X-Trim-Userid"], promptSegment.id, true);
    assert.equal(guidePreflight.storyboardStartGuide, undefined, "普通任务不隐式裁切首格");
    const framingPreflightResponse = await api(`/director/production-tasks/${promptSegment.id}/preflight`, userOne);
    assert.equal(framingPreflightResponse.body.data.storyboardFileId, existingSheetId, "异步预检必须返回解析结果，不能序列化Promise为空对象");
    assert.equal(getDirectorVideoSegmentPreflight(userOne["X-Trim-Userid"], promptSegment.id, false).storyboardStartGuide, undefined);
    db.prepare("UPDATE director_shots SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...promptSegment.payload, boundary: "continue", storyboardSheet: originalSheet }), promptSegment.id, userOne["X-Trim-Userid"]);
    assert.equal(getDirectorVideoSegmentPreflight(userOne["X-Trim-Userid"], promptSegment.id, true).storyboardStartGuide, undefined, "连续段不得被新故事板起始画格覆盖前段起点");
    db.prepare("UPDATE director_shots SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...promptSegment.payload, storyboardSheet: originalSheet, videoFileId: "existing-video" }), promptSegment.id, userOne["X-Trim-Userid"]);
    const promptUpdate = updateDirectorStoryboardPrompts(userOne["X-Trim-Userid"], projectId, { items: [{ segmentId: promptSegment.id, revision: (db.prepare("SELECT revision FROM director_shots WHERE id=?").get(promptSegment.id) as { revision: number }).revision, frames: originalSheet.frames.map((frame: Record<string, unknown>, index: number) => ({ id: frame.id, shotNumber: Number(frame.shotNumber || 1), timeSeconds: Number(frame.timeSeconds || 0), kind: String(frame.kind || "keyframe"), description: `画格 ${index + 1} 的明确画面`, action: "人物沿站台向前行走", cameraAngle: "平视中景", cameraMove: "缓慢跟拍", h3Visual: "A medium tracking shot follows the person walking forward along the wet platform.", dialogues: [], sound: "rainfall and synchronized footsteps" })) }] });
    assert.equal(promptUpdate.updated, 1);
    const updatedPromptSegment = (await api(`/director/projects/${projectId}`, userOne)).body.data.videoSegments[1];
    assert.equal(updatedPromptSegment.payload.storyboardSheet.imageFileId, existingSheetId, "安全提示词更新必须保留故事板媒体");
    assert.equal(updatedPromptSegment.payload.storyboardSheet.generationId, "existing-generation");
    assert.equal(updatedPromptSegment.payload.storyboardSheet.frames[0].croppedFileId, undefined, "画格裁切不再参与普通视频生成");
    assert.match(updatedPromptSegment.payload.storyboardSheet.promptSnapshot, /人物沿站台向前行走/);
    assert.equal(updatedPromptSegment.payload.storyboardStale, true);
    assert.equal(updatedPromptSegment.payload.videoStale, true);
    db.prepare("UPDATE director_shots SET status='locked' WHERE id=? AND user_id=?").run(promptSegment.id, userOne["X-Trim-Userid"]);
    assert.throws(() => updateDirectorStoryboardPrompts(userOne["X-Trim-Userid"], projectId, { items: [{ segmentId: promptSegment.id, revision: updatedPromptSegment.revision, frames: updatedPromptSegment.payload.storyboardSheet.frames.map((frame: Record<string, unknown>) => ({ id: String(frame.id), shotNumber: Number(frame.shotNumber || 1), timeSeconds: Number(frame.timeSeconds || 0), kind: String(frame.kind || "keyframe"), description: String(frame.description || ""), action: String(frame.action || ""), cameraAngle: String(frame.cameraAngle || ""), cameraMove: String(frame.cameraMove || ""), h3Visual: String(frame.h3Visual || "A static continuation of the current composition."), dialogues: Array.isArray(frame.dialogues) ? frame.dialogues : [], sound: String(frame.sound || "quiet ambient room tone") })) }] }), /已锁定/);
    const promptView = listDirectorVideoSegments(userOne["X-Trim-Userid"], projectId, { sequenceId: laterSequence.body.data.id, view: "prompt" }) as unknown as { items: Array<{ payload: { storyboardSheet: { imageFileId?: string; hasImage: boolean } } }> };
    assert.equal(promptView.items[0].payload.storyboardSheet.imageFileId, undefined, "精简提示词视图不得返回重媒体字段");
    assert.equal(promptView.items[0].payload.storyboardSheet.hasImage, true);
    const currentSegmentRevision = (db.prepare("SELECT revision FROM director_shots WHERE id=? AND user_id=?").get(segment.body.data.id, userOne["X-Trim-Userid"]) as { revision: number }).revision;
    const storyboardWithoutStyle = await api(`/director/production-tasks/${segment.body.data.id}/storyboard/generate`, userOne, { method: "POST", body: JSON.stringify({ revision: currentSegmentRevision }) });
    assert.equal(storyboardWithoutStyle.response.status, 409);
    assert.equal(storyboardWithoutStyle.body.error.code, "DIRECTOR_ASSET_MISSING", "付费生成应先报告视频段中已经失效的素材引用");
    const directorStyle = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "雨夜冷调", mode: "custom", description: "冷灰雨夜电影风格" }) });
    assert.equal(directorStyle.body.data.status, "draft", "导演风格可以保留通用存储状态，但不再以确认状态作为阶段门");
    const adoptedDirectorStyle = await api(`/visual-styles/${directorStyle.body.data.id}/default`, userOne, { method: "POST" });
    assert.equal(adoptedDirectorStyle.response.status, 200, "导演项目可以直接采用尚未确认的风格");
    const stateWithStyle = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(stateWithStyle.body.data.activeStyleId, directorStyle.body.data.id);
    const editedStyle = await api(`/visual-styles/${directorStyle.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, description: "冷灰雨夜电影风格，增加潮湿反光" }) });
    assert.equal(editedStyle.body.data.status, "draft", "导演风格修改不需要额外确认即可继续作为当前风格");
    const stateAfterStyleEdit = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(stateAfterStyleEdit.body.data.activeStyleId, directorStyle.body.data.id);
    const confirmed = await api(`/director/sequences/${sequence.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "confirmed" }) });
    assert.equal(confirmed.response.status, 200);
    assert.deepEqual(segment.body.data.payload.characterRefs, [{ id: "character-stable-id", revision: 3 }]);
    const lockRevision = (db.prepare("SELECT revision FROM director_shots WHERE id=? AND user_id=?").get(segment.body.data.id, userOne["X-Trim-Userid"]) as { revision: number }).revision;
    const lockedShot = await api(`/director/production-tasks/${segment.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: lockRevision, status: "locked" }) });
    assert.equal(lockedShot.response.status, 200);
    const rejectedLockedEdit = await api(`/director/production-tasks/${segment.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: lockedShot.body.data.revision, title: "未经审批的改名" }) });
    assert.equal(rejectedLockedEdit.response.status, 423);
    await api(`/director/projects/${projectId}/documents/story`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, content: "# 故事\n林夏在雪夜追查旧怀表。" }) });
    const stale = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(stale.body.data.sequences[0].payload.needsReview, true);
    assert.equal(stale.body.data.videoSegments[0].payload.needsReview, true);
    const revisedDirection = await api(`/director/projects/${projectId}/workspace`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, directingRules: { pacing: "关键反应后保留停顿" } }) });
    assert.equal(revisedDirection.response.status, 200);
    assert.equal(revisedDirection.body.data.directingRules.photography, "稳定观察人物与空间", "局部更新导演规则必须保留其他字段");
    assert.equal(revisedDirection.body.data.directingRules.positioning, "都市悬疑长片；冷峻克制；面向成年观众", "局部更新不得丢失创作定位章节");
    const directionStale = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(directionStale.body.data.videoSegments.every((item: { payload: { needsReview?: boolean } }) => item.payload.needsReview), true, "导演规则更新只标记现有视频段待检查");
    assert.equal(directionStale.body.data.videoSegments.some((item: { payload: { storyboardStale?: boolean } }) => item.payload.storyboardStale), true, "已有故事板应因导演规则变化而过期，但不得自动重生成");
});

test("导演来源解析 Markdown、PDF 与 EPUB", async () => {
    const projectId = "director-source-formats";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "格式测试" }) });
    const markdown = await uploadDirectorSource(projectId, new Blob(["# 第一章\n雨夜车站。\n\n# 第二章\n旧怀表。"], { type: "text/markdown" }), "小说.md");
    assert.equal(markdown.status, "ready");
    assert.equal(markdown.chapterCount, 2);

    const pdf = new PDFDocument({ autoFirstPage: true }); const pdfChunks: Buffer[] = [];
    pdf.on("data", (chunk) => pdfChunks.push(chunk));
    const pdfReady = new Promise<Buffer>((resolvePromise) => pdf.on("end", () => resolvePromise(Buffer.concat(pdfChunks))));
    pdf.fontSize(18).text("Chapter 1"); pdf.fontSize(12).text("A rainy station and an old watch."); pdf.end();
    const pdfSource = await uploadDirectorSource(projectId, new Blob([Uint8Array.from(await pdfReady)], { type: "application/pdf" }), "novel.pdf");
    assert.equal(pdfSource.status, "ready");
    assert.equal(pdfSource.charCount > 20, true);

    const epub = new AdmZip();
    epub.addFile("mimetype", Buffer.from("application/epub+zip"));
    epub.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
    epub.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>雨夜</dc:title><dc:identifier id="bookid">test-book</dc:identifier><dc:language>zh</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="chapter1"/></spine></package>`));
    epub.addFile("OEBPS/toc.ncx", Buffer.from(`<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>雨夜</text></docTitle><navMap><navPoint id="nav1" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="chapter1.xhtml"/></navPoint></navMap></ncx>`));
    epub.addFile("OEBPS/chapter1.xhtml", Buffer.from(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章 雨夜</h1><p>林夏走进车站，发现一枚旧怀表。</p></body></html>`));
    const epubSource = await uploadDirectorSource(projectId, new Blob([Uint8Array.from(epub.toBuffer())], { type: "application/epub+zip" }), "novel.epub");
    assert.equal(epubSource.status, "ready");
    assert.equal(epubSource.chapterCount, 1);
});

test("导演文件工程支持哈希冲突、校验和 ZIP 往返", async () => {
    const projectId = "director-file-workspace";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "文件工程" }) });
    await api(`/director/projects/${projectId}`, userOne);
    const current = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent("story/index.md")}`, userOne);
    assert.equal(current.response.status, 200);
    const content = `${current.body.data.content.trimEnd()}\n\n第一章正文。\n`;
    const saved = await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", headers: { "If-Match": current.body.data.hash }, body: JSON.stringify({ path: "story/index.md", content }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    const conflict = await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", headers: { "If-Match": current.body.data.hash }, body: JSON.stringify({ path: "story/index.md", content: `${content}\n旧页面覆盖` }) });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.code, "DIRECTOR_FILE_CONFLICT");

    const chapterTwo = `---\nid: chapter-workspace-002\nkind: story-chapter\nname: 第二章 雪夜\norder: 2\n---\n# 第二章 雪夜\n\n林夏循着怀表走进雪夜。\n`;
    const chapterOne = `---\nid: chapter-workspace-001\nkind: story-chapter\nname: 第一章 车站\norder: 1\n---\n# 第一章 车站\n\n林夏在空站台捡到怀表。\n`;
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: "story/chapters/chapter-002.md", content: chapterTwo }) })).response.status, 200);
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: "story/chapters/chapter-001.md", content: chapterOne }) })).response.status, 200);
    const logicalStory = await api(`/director/projects/${projectId}/logical-documents/story`, userOne);
    assert.equal(logicalStory.response.status, 200);
    assert.deepEqual(logicalStory.body.data.parts.map((part: { path: string }) => part.path), ["story/index.md", "story/chapters/chapter-001.md", "story/chapters/chapter-002.md"]);
    assert.match(logicalStory.body.data.content, /## 第一章 车站[\s\S]*## 第二章 雪夜/);
    const firstChapter = logicalStory.body.data.parts[1];
    const revisedChapter = await api(`/director/projects/${projectId}/logical-documents/story/part`, userOne, { method: "PUT", headers: { "If-Match": firstChapter.hash }, body: JSON.stringify({ path: firstChapter.path, content: "# 第一章 车站\n\n林夏在末班车离开后捡到怀表。" }) });
    assert.equal(revisedChapter.response.status, 200, JSON.stringify(revisedChapter.body));
    assert.match(revisedChapter.body.data.content, /末班车离开后/);
    const rawChapter = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent(firstChapter.path)}`, userOne);
    assert.match(rawChapter.body.data.content, /id: chapter-workspace-001/);
    assert.equal((await api(`/director/projects/${projectId}/logical-documents/story/part`, userOne, { method: "PUT", headers: { "If-Match": firstChapter.hash }, body: JSON.stringify({ path: firstChapter.path, content: "旧章节" }) })).response.status, 409);

    const sceneTwo = `---\nid: scene-workspace-002\nkind: screenplay-scene\nname: 第二场 候车厅\norder: 2\n---\n# 第二场 候车厅\n\n林夏推开旧门。\n`;
    const sceneOne = `---\nid: scene-workspace-001\nkind: screenplay-scene\nname: 第一场 站台\norder: 1\n---\n# 第一场 站台\n\n雨水沿着站牌落下。\n`;
    await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: "screenplay/scenes/scene-002.md", content: sceneTwo }) });
    await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: "screenplay/scenes/scene-001.md", content: sceneOne }) });
    const logicalScript = await api(`/director/projects/${projectId}/logical-documents/script`, userOne);
    assert.deepEqual(logicalScript.body.data.parts.slice(1).map((part: { name: string }) => part.name), ["第一场 站台", "第二场 候车厅"]);
    assert.match(logicalScript.body.data.content, /## 第一场 站台[\s\S]*## 第二场 候车厅/);

    const currentStyle = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent("direction/visual-style.md")}`, userOne);
    assert.equal(currentStyle.response.status, 200);
    const styleFrontmatter = currentStyle.body.data.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0] || "";
    const styleContent = `${styleFrontmatter}# 水墨喜剧\n\n## 总体风格\n\n轻盈的水墨喜剧，留白充足。\n\n## 媒介\n\n二维水墨动画\n\n## 通用渲染\n\n宣纸晕染与清晰墨线并存\n\n## 角色呈现\n\n圆润剪影，表情清楚\n\n## 场景呈现\n\n浅景深的水墨山景\n\n## 道具呈现\n\n墨线勾勒结构\n\n## 色彩\n\n纸白、墨黑与少量朱砂\n\n## 光线\n\n柔和散射光\n\n## 反差\n\n中低反差\n\n## 材质与质感\n\n宣纸纤维与水痕\n\n## 镜头与景深\n\n绘本式空间层次\n\n## 构图\n\n大面积留白\n\n## 后期处理\n\n保留纸纹\n\n## 避免元素\n\n- 写实皮肤\n- 三维塑料感\n`;
    const savedStyle = await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", headers: { "If-Match": currentStyle.body.data.hash }, body: JSON.stringify({ path: "direction/visual-style.md", content: styleContent }) });
    assert.equal(savedStyle.response.status, 200, JSON.stringify(savedStyle.body));
    const mirroredStyles = await api(`/projects/${projectId}/visual-styles`, userOne);
    const mirroredStyle = mirroredStyles.body.data.find((item: { name: string }) => item.name === "水墨喜剧");
    assert.equal(mirroredStyle.description, "轻盈的水墨喜剧，留白充足。");
    assert.equal(mirroredStyle.dna.medium, "二维水墨动画");
    assert.equal(mirroredStyle.dna.characterRendering, "圆润剪影，表情清楚");
    assert.deepEqual(mirroredStyle.dna.exclusions, ["写实皮肤", "三维塑料感"]);

    const validation = await api(`/director/projects/${projectId}/validate`, userOne, { method: "POST", body: JSON.stringify({}) });
    assert.equal(validation.body.data.valid, true);

    const audioForm = new FormData();
    audioForm.set("file", new Blob(["reference audio"], { type: "audio/wav" }), "wind.wav");
    const audioUpload = await api("/files", userOne, { method: "POST", body: audioForm });
    const audioSequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ title: "声音参考" }) });
    assert.equal(audioSequence.response.status, 201, JSON.stringify(audioSequence.body));
    const audioSegment = await api(`/director/projects/${projectId}/production-tasks`, userOne, { method: "POST", body: JSON.stringify({ sequenceId: audioSequence.body.data.id, title: "风声", payload: { durationSeconds: 4, audioReferences: [{ fileId: audioUpload.body.data.fileId, purpose: "sound", description: "soft wind" }] } }) });
    assert.equal(audioSegment.response.status, 201, JSON.stringify(audioSegment.body));
    const invalidAudioSegment = await api(`/director/projects/${projectId}/production-tasks`, userOne, { method: "POST", body: JSON.stringify({ sequenceId: audioSequence.body.data.id, title: "无效音频", payload: { audioReferences: [{ fileId: "missing-audio", purpose: "sound", description: "wind" }] } }) });
    assert.equal(invalidAudioSegment.response.status, 400);

    const exportResponse = await fetch(`${origin}/director/projects/${projectId}/export`, { headers: userOne });
    assert.equal(exportResponse.status, 200);
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    assert.equal(archive.subarray(0, 2).toString(), "PK");
    const importedResponse = await fetch(`${origin}/director/projects/import`, { method: "POST", headers: { ...userOne, "Content-Type": "application/zip", "X-Project-Name": encodeURIComponent("往返工程") }, body: new Uint8Array(archive) });
    const importedBody = await importedResponse.json() as { data: { projectId: string }; error?: unknown };
    assert.equal(importedResponse.status, 201, JSON.stringify(importedBody));
    const imported = importedBody;
    const importedStory = await api(`/director/projects/${imported.data.projectId}/file?path=${encodeURIComponent("story/index.md")}`, userOne);
    assert.match(importedStory.body.data.content, /第一章正文/);

    const importedState = await api(`/director/projects/${imported.data.projectId}`, userOne);
    const importedAudio = importedState.body.data.videoSegments.find((segment: { title: string }) => segment.title === "风声").payload.audioReferences[0];
    assert.equal(importedAudio.purpose, "sound");
    assert.equal(importedAudio.description, "soft wind");
    assert.notEqual(importedAudio.fileId, audioUpload.body.data.fileId);

    const malicious = new AdmZip();
    malicious.addFile("/escape.txt", Buffer.from("escape"));
    const rejected = await fetch(`${origin}/director/projects/import`, { method: "POST", headers: { ...userOne, "Content-Type": "application/zip" }, body: new Uint8Array(malicious.toBuffer()) });
    assert.equal(rejected.status, 400);
});


test("导演分镜按需引用素材，保留媒体快照并检测冲突与跨项目引用", async () => {
    const projectId = "director-demand-driven";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "按需素材测试" }) });
    await api(`/director/projects/${projectId}/documents/script`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, content: "## 场 1\n人物停在岔路口，决定沿山路继续前行。" }) });
    const sequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ title: "山路" }) });
    assert.equal(sequence.response.status, 201, JSON.stringify(sequence.body));
    const created = await api(`/director/projects/${projectId}/production-tasks`, userOne, { method: "POST", body: JSON.stringify({ sequenceId: sequence.body.data.id, title: "停步问路", payload: { durationSeconds: 8, dramaticBeat: "从迷路转为找到方向", openingState: "人物走进山路", endingState: "人物指向出口" } }) });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    let segment = created.body.data;
    const imageForm = new FormData();
    imageForm.set("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "board.png");
    const uploaded = await api("/files", userOne, { method: "POST", body: imageForm });
    const videoForm = new FormData();
    videoForm.set("file", new Blob(["test video snapshot"], { type: "video/mp4" }), "video.mp4");
    const video = await api("/files", userOne, { method: "POST", body: videoForm });
    const withMedia = await api(`/director/production-tasks/${segment.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: segment.revision, payload: { storyboardSheet: { ...segment.payload.storyboardSheet, imageFileId: uploaded.body.data.fileId, promptSnapshot: "Saved storyboard prompt" }, videoFileId: video.body.data.fileId, h3PromptSnapshot: { prompt: "Saved video prompt" } } }) });
    assert.equal(withMedia.response.status, 200, JSON.stringify(withMedia.body));
    segment = withMedia.body.data;
    const asset = (await api(`/projects/${projectId}/creative-assets`, userOne, { method: "POST", body: JSON.stringify({ kind: "scene", name: "荒山石道", payload: { description: "当前视频段需要的山路空间" } }) })).body.data;
    segment = (await api(`/director/projects/${projectId}`, userOne)).body.data.videoSegments.find((item: { id: string }) => item.id === segment.id);
    const originalRevision = segment.revision;
    const originalFrames = structuredClone(segment.payload.storyboardSheet.frames);
    const bind = (value: Record<string, unknown>, user = userOne) => api(`/director/production-tasks/${segment.id}/asset-reference`, user, { method: "PUT", body: JSON.stringify({ revision: segment.revision, kind: "scene", assetId: asset.id, ...value }) });
    assert.equal((await bind({}, userTwo)).response.status, 404);
    assert.equal((await bind({ kind: "character" })).response.status, 404);
    assert.equal((await bind({ variantId: "foreign-variant" })).response.status, 400);
    assert.equal((await bind({ replaceAssetId: "not-bound" })).response.status, 409);
    const linked = await bind({});
    assert.equal(linked.response.status, 200, JSON.stringify(linked.body));
    segment = linked.body.data;
    assert.equal(segment.payload.sceneRefs[0].id, asset.id);
    assert.equal(segment.payload.storyboardStale, true);
    assert.equal(segment.payload.videoStale, true);
    assert.deepEqual(segment.payload.storyboardSheet.frames, originalFrames);
    assert.equal(segment.payload.storyboardSheet.promptSnapshot, "Saved storyboard prompt");
    assert.equal(segment.payload.h3PromptSnapshot.prompt, "Saved video prompt");
    assert.ok(segment.payload.videoFileId);
    assert.equal((await bind({ revision: originalRevision })).response.status, 409);
    assert.equal((await bind({ payload: { storyboardSheet: {} } })).response.status, 400, "引用接口拒绝媒体子树覆盖");
    const detail = (await api(`/director/assets/${asset.id}/detail`, userOne)).body.data;
    assert.ok(detail.usages.some((usage: { id: string }) => usage.id === segment.id));
    assert.equal(detail.primaryVisual.outputs.length, 0, "缺主图的素材档案也能登记文字分镜需求");
    const missingPreflight = (await api(`/director/production-tasks/${segment.id}/preflight`, userOne)).body.data;
    assert.deepEqual(missingPreflight.assetBlockedReasons, [], "普通任务只校验显式输入，不以素材主图阻断");
    assert.equal(applyDirectorAssetGeneration(userOne["X-Trim-Userid"], { assetId: asset.id, target: "primary-visual", expectedHash: detail.primaryVisual.hash }, uploaded.body.data.fileId), true);
    const variantFolder = `${detail.folderPath}/variants/var-demand`;
    await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: `${variantFolder}/variant.md`, content: "---\nid: var-demand\nkind: asset-variant\nname: 雨后山路\n---\n地面湿润。\n" }) });
    await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: `${variantFolder}/prompt.md`, content: "保持山路地形，增加雨后积水。" }) });
    let variantDetail = (await api(`/director/assets/${asset.id}/detail`, userOne)).body.data;
    assert.equal(applyDirectorAssetGeneration(userOne["X-Trim-Userid"], { assetId: asset.id, target: "variant-visual", variantId: "var-demand", expectedHash: variantDetail.variants[0].hash }, uploaded.body.data.fileId), true);
    variantDetail = (await api(`/director/assets/${asset.id}/detail`, userOne)).body.data;
    assert.deepEqual(variantDetail.variants.map((item: { variantId: string }) => item.variantId), ["var-demand"], "读取详情不得从镜像媒体重复创建生产变体");
    segment = (await api(`/director/projects/${projectId}`, userOne)).body.data.videoSegments.find((item: { id: string }) => item.id === segment.id);
    const variantLinked = await bind({ variantId: "var-demand" });
    assert.equal(variantLinked.response.status, 200, JSON.stringify(variantLinked.body));
    segment = variantLinked.body.data;
    const variantPreflight = (await api(`/director/production-tasks/${segment.id}/preflight`, userOne)).body.data;
    assert.deepEqual(variantPreflight.selected, [], "只有显式图片路径进入任务输入");
    assert.notEqual(variantDetail.variants[0].outputs[0].fileId, variantDetail.primaryVisual.outputs[0].fileId);

    const edited = await api(`/director/production-tasks/${segment.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: segment.revision, payload: { dramaticBeat: "从停步犹豫转为决定前行", openingState: "停在岔路口", endingState: "选择山路", description: "向前走。" } }) });
    assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
    segment = edited.body.data;
    const archiveResponse = await fetch(`${origin}/director/projects/${projectId}/export`, { headers: userOne });
    const archive = new AdmZip(Buffer.from(await archiveResponse.arrayBuffer()));
    const segmentFile = archive.getEntries().find((entry) => entry.entryName.endsWith("/task.md"))!;
    const content = segmentFile.getData().toString("utf8");
    assert.match(content, /dramaticBeat: 从停步犹豫转为决定前行/);
    assert.match(content, /openingState: 停在岔路口/);
    assert.match(content, /endingState: 选择山路/);
    assert.match(content, /向前走。/);
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: "director-foreign-demand", kind: "director", title: "其他项目" }) });
    const foreign = (await api("/projects/director-foreign-demand/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "scene", name: "其他场景" }) })).body.data;
    assert.equal((await bind({ assetId: foreign.id })).response.status, 404);
    const unlinked = await bind({ remove: true });
    assert.equal(unlinked.response.status, 200, JSON.stringify(unlinked.body));
    assert.deepEqual(unlinked.body.data.payload.sceneRefs, []);
    assert.deepEqual((await api(`/director/production-tasks/${segment.id}/preflight`, userOne)).body.data.assetBlockedReasons, [], "未声明独立素材需求时，不强制建立角色和场景图");
    assert.equal((await api(`/creative-assets/${asset.id}`, userOne)).response.status, 200, "移除段落引用不会删除素材库实体");
});

test("导演素材详情按文件夹聚合主档、基础设计、声音和生产变体", async () => {
    const projectId = "director-asset-workbench";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "素材工作台" }) });
    const timestamp = new Date().toISOString();
    db.prepare("INSERT INTO ai_providers(id,name,type,base_url,encrypted_credentials,enabled,models,concurrency,created_at,updated_at) VALUES(?,?,?,?,?,1,?,2,?,?)")
        .run("director-asset-provider", "导演素材测试渠道", "openai-compatible", "http://127.0.0.1:9/v1", "{}", JSON.stringify([{ id: "image-model", name: "导演素材图片模型", endpoint: "openai-images-generations", output: "image", inputs: ["text", "image"], imageModes: ["generate", "edit"], maxReferenceImages: 6, imagePromptProfile: "gpt-image-2", enabled: true }]), timestamp, timestamp);
    const created = await api(`/projects/${projectId}/creative-assets`, userOne, { method: "POST", body: JSON.stringify({
        kind: "character",
        name: "林夏",
        payload: {
            description: "调查记者",
            visualDescription: "二十八岁短发女性，方脸，深色风衣。",
            mediaDrafts: { image: { model: "director-asset-provider::image-model", prompt: "白底角色综合身份板" }, audio: { prompt: "冷静、低声线、自然停顿", transcript: "我会把真相查清楚。" } },
        },
    }) });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const assetId = created.body.data.id;
    const insertSequence = db.prepare("INSERT INTO director_sequences (id,user_id,project_id,position,title,summary,status,payload,revision,created_at,updated_at) VALUES (?,?,?,?,?,'','draft','{}',1,?,?)");
    insertSequence.run("asset-a-later-sequence", userOne["X-Trim-Userid"], projectId, 1, "次段", timestamp, timestamp);
    insertSequence.run("asset-z-first-sequence", userOne["X-Trim-Userid"], projectId, 0, "首段", timestamp, timestamp);
    const insertSegment = db.prepare("INSERT INTO director_shots (id,user_id,project_id,sequence_id,position,title,status,payload,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft',?,1,?,?)");
    insertSegment.run("asset-segment-later", userOne["X-Trim-Userid"], projectId, "asset-a-later-sequence", 0, "次段镜头", JSON.stringify({ durationSeconds: 6, characterRefs: [{ id: assetId, revision: 1 }] }), timestamp, timestamp);
    insertSegment.run("asset-segment-first-b", userOne["X-Trim-Userid"], projectId, "asset-z-first-sequence", 1, "首段第二镜", JSON.stringify({ durationSeconds: 5, characterRefs: [{ id: assetId, revision: 1 }] }), timestamp, timestamp);
    insertSegment.run("asset-segment-first-a", userOne["X-Trim-Userid"], projectId, "asset-z-first-sequence", 0, "首段第一镜", JSON.stringify({ durationSeconds: 4, characterRefs: [{ id: assetId, revision: 1 }] }), timestamp, timestamp);
    const detail = await api(`/director/assets/${assetId}/detail`, userOne);
    assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
    assert.match(detail.body.data.dossier.path, /assets\/characters\/char-/);
    assert.match(detail.body.data.primaryVisual.promptPath, /identity\/prompt\.md$/);
    assert.equal(detail.body.data.primaryVisual.prompt, "", "素材拆解阶段不得把旧 mediaDraft 提示词冒充为最终 prompt.md");
    assert.match(detail.body.data.sound.promptPath, /voice\/sound\.md$/);
    assert.equal(detail.body.data.sound.prompt, "冷静、低声线、自然停顿");
    assert.equal(detail.body.data.sound.sampleText, "我会把真相查清楚。");
    assert.deepEqual(detail.body.data.usages.map((item: { title: string }) => item.title), ["首段第一镜", "首段第二镜", "次段镜头"], "使用位置必须按剧情段落位置和视频段位置排序，而不是按随机 ID 排序");
    assert.deepEqual(detail.body.data.usages.map((item: { sequencePosition: number; segmentPosition: number }) => [item.sequencePosition, item.segmentPosition]), [[0, 0], [0, 1], [1, 0]]);
    db.prepare("UPDATE creative_assets SET revision=20 WHERE user_id=? AND id=?").run(userOne["X-Trim-Userid"], assetId);
    const indexed = db.prepare("SELECT revision FROM director_file_index WHERE user_id=? AND project_id=? AND entity_id=?").get(userOne["X-Trim-Userid"], projectId, assetId) as { revision: number };
    assert.equal(indexed.revision, 1, "文件索引 revision 应保持独立");
    assert.equal((await api(`/director/assets/${assetId}/detail`, userOne)).body.data.revision, 20, "导演素材必须返回创作资产 revision，不能误用文件索引 revision");
    assert.equal((await api(`/director/assets/${assetId}/detail`, userTwo)).response.status, 404);

    const imageForm = new FormData();
    imageForm.set("file", new Blob(["reference-image"], { type: "image/png" }), "reference.png");
    const image = await api("/files", userOne, { method: "POST", body: imageForm });
    const withImage = await api(`/director/assets/${assetId}/media-inputs`, userOne, { method: "POST", body: JSON.stringify({ fileId: image.body.data.fileId, target: "primary-visual" }) });
    assert.equal(withImage.body.data.primaryVisual.inputs.length, 1);
    const finalPrompt = "生成一张横版角色身份板：同一角色的正面全身、背面全身和正面头肩特写，纯白背景，无文字。";
    const promptDocument = `---\nreferences:\n  - path: ${withImage.body.data.primaryVisual.inputs[0].path}\n    purpose: style_reference\n    label: 统一视觉风格\n---\n${finalPrompt}\n`;
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: withImage.body.data.primaryVisual.promptPath, content: promptDocument, expectedHash: withImage.body.data.primaryVisual.hash }) })).response.status, 200);
    const authored = await api(`/director/assets/${assetId}/detail`, userOne);
    assert.equal(authored.body.data.primaryVisual.prompt, finalPrompt);
    assert.equal(authored.body.data.primaryVisual.inputs[0].mediaRole, "style_reference");
    assert.equal(authored.body.data.primaryVisual.inputs[0].name, "统一视觉风格");
    const generationPreview = await api(`/director/assets/${assetId}/generation-preview`, userOne, { method: "POST", body: JSON.stringify({ target: "primary-visual", expectedHash: authored.body.data.primaryVisual.hash }) });
    assert.equal(generationPreview.response.status, 200, JSON.stringify(generationPreview.body));
    assert.equal(generationPreview.body.data.prompt, finalPrompt, "导演素材 prompt.md 正文必须原样成为送模提示词");
    assert.equal(generationPreview.body.data.references.length, 1);
    assert.equal(generationPreview.body.data.references[0].source, "style");
    assert.equal(generationPreview.body.data.references[0].fileId, authored.body.data.primaryVisual.inputs[0].fileId, "详情页预检必须返回 prompt.md 显式声明的输入图");
    assert.equal(applyDirectorAssetGeneration(userOne["X-Trim-Userid"], { assetId, target: "primary-visual", expectedHash: authored.body.data.primaryVisual.hash }, image.body.data.fileId), true);
    const generatedAsset = (await api(`/creative-assets/${assetId}`, userOne)).body.data as { payload: { primaryImageId: string; variants: Array<{ id: string; label: string }> } };
    assert.equal(generatedAsset.payload.variants.find((item) => item.id === generatedAsset.payload.primaryImageId)?.label, "primary", "主形象生成结果必须成为素材卡主图");

    for (const name of ["voice-a.wav", "voice-b.wav"]) {
        const audioForm = new FormData();
        audioForm.set("file", new Blob([name], { type: "audio/wav" }), name);
        const audio = await api("/files", userOne, { method: "POST", body: audioForm });
        const withAudio = await api(`/director/assets/${assetId}/media-inputs`, userOne, { method: "POST", body: JSON.stringify({ fileId: audio.body.data.fileId, target: "sound" }) });
        assert.equal(withAudio.body.data.sound.input.name, "reference.wav");
    }

    const folderPath = detail.body.data.folderPath;
    const variantPath = `${folderPath}/variants/var-001-raincoat`;
    const variantDocument = `---\nid: var-001-raincoat\nkind: asset-variant\nname: 雨衣造型\n---\n持续雨夜场次使用的防水造型。\n`;
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: `${variantPath}/variant.md`, content: variantDocument }) })).response.status, 200);
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", body: JSON.stringify({ path: `${variantPath}/prompt.md`, content: "保持同一身份，替换为深色防水雨衣。\n" }) })).response.status, 200);
    const withVariant = await api(`/director/assets/${assetId}/detail`, userOne);
    assert.deepEqual(withVariant.body.data.variants.map((item: { variantId: string }) => item.variantId), ["var-001-raincoat"]);
    assert.equal((await api(`/director/assets/${assetId}/generate`, userOne, { method: "POST", body: JSON.stringify({ target: "variant-visual", variantId: "var-001-raincoat", expectedHash: "stale" }) })).response.status, 409);
    const deleted = await api(`/director/assets/${assetId}/variants/var-001-raincoat`, userOne, { method: "DELETE" });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.data.variants.length, 0);
    db.prepare("DELETE FROM ai_providers WHERE id=?").run("director-asset-provider");
});

test("创作资产按项目隔离、保存自然语言描述并检测 revision", async () => {
    const created = await api("/projects/project-1/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "character", name: "林夏", payload: { description: "二十八岁的清瘦调查记者，短发，深色风衣。", mediaDrafts: { audio: { prompt: "冷静、低声线", transcript: "这件事，我会亲自查清楚。" } } } }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.revision, 1);
    assert.equal(created.body.data.status, "draft");
    assert.equal(created.body.data.payload.mediaDrafts.audio.prompt, "冷静、低声线");
    assert.equal(created.body.data.payload.mediaDrafts.audio.transcript, "这件事，我会亲自查清楚。");
    const assetId = created.body.data.id;
    assert.equal((await api(`/creative-assets/${assetId}`, userTwo)).response.status, 404);

    const updated = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "confirmed", payload: { description: "二十八岁的清瘦调查记者，短发，深色风衣与旧相机。" } }) });
    assert.equal(updated.body.data.revision, 2);
    assert.equal(updated.body.data.payload.mediaDrafts.audio.prompt, "冷静、低声线");
    const conflict = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, name: "旧名称" }) });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.details.current.revision, 2);
    const referenceVariant = { id: "reference-audio-1", kind: "audio", fileId: "reference-file-1", label: "参考音频", prompt: "", usage: "reference_input", createdAt: new Date().toISOString() };
    const withReference = await api(`/creative-assets/${assetId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, payload: { variants: [referenceVariant] } }) });
    assert.equal(withReference.response.status, 200);
    const invalidPrimary = await api(`/creative-assets/${assetId}/variants/${referenceVariant.id}/primary`, userOne, { method: "POST", body: JSON.stringify({ revision: 3 }) });
    assert.equal(invalidPrimary.response.status, 400);
    assert.equal(invalidPrimary.body.error.code, "CREATIVE_ASSET_REFERENCE_NOT_PRIMARY");

    assert.equal((await api(`/creative-assets/${assetId}`, userOne, { method: "DELETE" })).response.status, 200);
    const afterDelete = await api("/projects/project-1", userOne);
    assert.equal(afterDelete.body.data.nodes.some((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === assetId), false);
});

test("视觉风格保留默认和隔离，画布放置接口已移除", async () => {
    const projectId = "visual-style-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "风格测试", nodes: [], connections: [] }) });
    const created = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "冷峻悬疑", mode: "custom", description: "低饱和冷灰色调，硬朗侧光。" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.revision, 1);
    assert.equal(created.body.data.status, "draft");
    assert.equal(created.body.data.dna.medium, "");
    const styleId = created.body.data.id;
    assert.equal((await api(`/visual-styles/${styleId}`, userTwo)).response.status, 404);

    const placed = await api(`/visual-styles/${styleId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 100, y: 200 }) });
    assert.equal(placed.response.status, 404);
    assert.equal((await api(`/visual-styles/${styleId}/default`, userOne, { method: "POST" })).response.status, 409);
    const confirmed = await api(`/visual-styles/${styleId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "confirmed" }) });
    assert.equal(confirmed.response.status, 200);
    await api(`/visual-styles/${styleId}/default`, userOne, { method: "POST" });
    const project = await api(`/projects/${projectId}`, userOne);
    assert.equal(project.body.data.defaultVisualStyleId, styleId);
    assert.equal(project.body.data.nodes.some((node: { metadata?: { visualStyleId?: string } }) => node.metadata?.visualStyleId === styleId), false);

    assert.equal((await api(`/visual-styles/${styleId}`, userOne, { method: "DELETE" })).response.status, 200);
    const deleted = await api(`/projects/${projectId}`, userOne);
    assert.equal(deleted.body.data.defaultVisualStyleId, null);
    assert.equal(deleted.body.data.nodes.some((node: { metadata?: { visualStyleId?: string } }) => node.metadata?.visualStyleId === styleId), false);
});

test("内置视觉风格提供原创预览、题材标签和完整 DNA，创建时展开为项目快照", async () => {
    const templates = (await api("/visual-style-templates", userOne)).body.data as Array<{ id: string; category: string; tags: string[]; preview: string; tagline: string; description: string; dna: Record<string, string | string[]> }>;
    assert.equal(templates.length, 94);
    assert.deepEqual(new Set(templates.map((item) => item.category)), new Set(["cinematic", "genre", "eastern", "animation", "handmade", "graphic"]));
    assert.deepEqual(new Set(templates.map((item) => item.dna.mediumFamily)), new Set(["live_action", "animation_2d", "animation_3d", "illustration", "handmade", "graphic"]));
    assert.equal(new Set(templates.map((item) => item.id)).size, templates.length);
    assert.equal(["sixteen-mm-indie", "anime-feature-detailed", "photoreal-cg-film", "classical-oil-painting", "puppet-stop-motion", "art-deco-cinema"].every((templateId) => templates.some((item) => item.id === templateId)), true);
    assert.equal(templates.every((item) => item.preview === `visual-styles/${item.id}.webp` && item.tags.length > 0 && item.tagline && item.description), true);
    assert.equal(templates.every((item) => Object.entries(item.dna).every(([key, value]) => key === "exclusions" ? (value as string[]).length > 0 : String(value).trim().length > 0)), true);

    const projectId = "built-in-style-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "内置风格", nodes: [], connections: [] }) });
    const created = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "未命名风格", mode: "template", templateId: "ink-wash" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.description, templates.find((item) => item.id === "ink-wash")?.description);
    assert.equal(created.body.data.dna.medium, "水墨与淡彩动画");
    assert.equal(created.body.data.dna.exclusions.includes("文字"), true);
    assert.equal(typeof created.body.data.references.board, "string", "应用内置风格时应把单张三元素预览物化为项目风格板");
    assert.deepEqual(Object.keys(created.body.data.references), ["board"], "内置风格不再创建角色、场景、道具三张样图");
    const previewResponse = await fetch(`${origin}/files/${created.body.data.references.board}/content`, { headers: userOne });
    assert.equal(previewResponse.status, 200);
});

test("导演风格修改后参考板待复核但仍可读取", async () => {
    const projectId = "director-style-board-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "导演风格板" }) });
    const templateStyle = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "模板来源", mode: "template", templateId: "ink-wash" }) });
    const boardFileId = String(templateStyle.body.data.references.board);
    const customStyle = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "自定义风格", mode: "custom", description: "冷灰写实电影风格" }) });
    const styleId = String(customStyle.body.data.id);
    const now = new Date().toISOString();
    db.prepare("UPDATE visual_styles SET reference_files=?,revision=2,updated_at=? WHERE id=?").run(JSON.stringify({ board: boardFileId }), now, styleId);
    db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,result,progress,created_at,updated_at) VALUES(?,?,'image','succeeded','test-model',?,?,1,?,?)")
        .run("style-board-generation", userOne["X-Trim-Userid"], JSON.stringify({ params: { __visualStyleBoard: { styleId, styleRevision: 1 } } }), JSON.stringify({ files: [{ fileId: boardFileId }] }), now, now);
    assert.equal((await api(`/visual-styles/${styleId}`, userOne)).body.data.boardStale, false);
    db.prepare("UPDATE visual_styles SET description=?,revision=3,updated_at=? WHERE id=?").run("明亮 Q 版卡通风格", now, styleId);
    const stale = await api(`/visual-styles/${styleId}`, userOne);
    assert.equal(stale.body.data.boardStale, true);
    assert.equal(stale.body.data.referenceFileId, boardFileId, "待复核不应隐藏当前参考板");
});

test("导演风格板在文字和规则修改后保留且支持显式替换", async () => {
    const projectId = "director-file-style-board";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "文件风格板" }) });
    const created = await api(`/projects/${projectId}/visual-styles`, userOne, { method: "POST", body: JSON.stringify({ name: "水墨模板", mode: "template", templateId: "ink-wash" }) });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal((await api(`/visual-styles/${created.body.data.id}/default`, userOne, { method: "POST" })).response.status, 200);

    const styleFile = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent("direction/visual-style.md")}`, userOne);
    assert.match(styleFile.body.data.content, /referenceBoard: direction\/references\/style-board\.webp/);
    const board = await fetch(`${origin}/director/projects/${projectId}/direction/style-board`, { headers: userOne });
    assert.equal(board.status, 200);
    assert.equal(board.headers.get("content-type"), "image/webp");

    const archiveResponse = await fetch(`${origin}/director/projects/${projectId}/export`, { headers: userOne });
    const archive = new AdmZip(Buffer.from(await archiveResponse.arrayBuffer()));
    assert.ok(archive.getEntry("direction/references/style-board.webp"));

    const revised = styleFile.body.data.content.replace("东方水墨动画", "东方水墨喜剧动画");
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", headers: { "If-Match": styleFile.body.data.hash }, body: JSON.stringify({ path: "direction/visual-style.md", content: revised }) })).response.status, 200);
    const revisedFile = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent("direction/visual-style.md")}`, userOne);
    assert.match(revisedFile.body.data.content, /referenceBoard: direction\/references\/style-board\.webp/);
    const retainedBoard = await fetch(`${origin}/director/projects/${projectId}/direction/style-board`, { headers: userOne });
    assert.equal(retainedBoard.status, 200);
    const originalBytes = Buffer.from(await board.arrayBuffer());
    assert.deepEqual(Buffer.from(await retainedBoard.arrayBuffer()), originalBytes);
    const rulesFile = await api(`/director/projects/${projectId}/file?path=${encodeURIComponent("direction/directing-rules.md")}`, userOne);
    assert.equal((await api(`/director/projects/${projectId}/file`, userOne, { method: "PUT", headers: { "If-Match": rulesFile.body.data.hash }, body: JSON.stringify({ path: "direction/directing-rules.md", content: `${rulesFile.body.data.content}\n补充人物冲突与改编边界。\n` }) })).response.status, 200);
    assert.deepEqual(Buffer.from(await (await fetch(`${origin}/director/projects/${projectId}/direction/style-board`, { headers: userOne })).arrayBuffer()), originalBytes);
    const revisedStyle = (await api(`/projects/${projectId}/visual-styles`, userOne)).body.data.find((item: { id: string }) => item.id === created.body.data.id);
    assert.equal(revisedStyle.mode, "custom");
    assert.equal(revisedStyle.templateId, "ink-wash", "本地修改不应丢失内置模板来源");
    const patched = await api(`/visual-styles/${revisedStyle.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: revisedStyle.revision, description: "补充水墨笔触说明" }) });
    assert.equal(patched.response.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.data.references.board, revisedStyle.references.board);
    assert.deepEqual(Buffer.from(await (await fetch(`${origin}/director/projects/${projectId}/direction/style-board`, { headers: userOne })).arrayBuffer()), originalBytes);
    const replaced = await api(`/visual-styles/${revisedStyle.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: patched.body.data.revision, mode: "template", templateId: "clay-stop-motion" }) });
    assert.equal(replaced.response.status, 200, JSON.stringify(replaced.body));
    assert.notDeepEqual(Buffer.from(await (await fetch(`${origin}/director/projects/${projectId}/direction/style-board`, { headers: userOne })).arrayBuffer()), originalBytes);
});

test("Agent 保留通用节点连线并拒绝已移除的业务节点", async () => {
    const projectId = "semantic-port-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "端口测试", nodes: [], connections: [] }) });
    const created = applyCanvasOps(userOne["X-Trim-Userid"], projectId, [
        { type: "add_node", id: "text-source", nodeType: "text" },
        { type: "add_node", id: "image-target", nodeType: "image" },
        { type: "connect_nodes", fromNodeId: "text-source", fromPortId: "output", toNodeId: "image-target", toPortId: "input" },
    ], 1);
    assert.equal(created.revision, 2);
    assert.throws(() => applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "connect_nodes", fromNodeId: "text-source", fromPortId: "output", toNodeId: "image-target", toPortId: "setting" }], 2), /类型不兼容/);
    for (const type of ["character", "scene", "prop", "visual-style"]) {
        assert.throws(() => applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "add_node", nodeType: type }], 2), /通用节点/);
        assert.throws(() => applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "update_node", id: "image-target", patch: { type } }], 2), /通用节点/);
        const saved = await api(`/projects/${projectId}`, userOne, { method: "PUT", body: JSON.stringify({ title: "端口测试", revision: 2, nodes: [{ id: "retired", type }] }) });
        assert.equal(saved.response.status, 400);
    }
    assert.equal((await api("/creative-assets/retired/place", userOne, { method: "POST", body: "{}" })).response.status, 404);
    assert.equal((await api("/visual-styles/retired/place", userOne, { method: "POST", body: "{}" })).response.status, 404);
});

test("Agent 使用通用文本工具将多章节故事保存为一个节点", async () => {
    const projectId = "story-project";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "故事画布", nodes: [], connections: [] }) });
    const markdown = "# 山海回声\n\n## 第一章\n\n潮水退去。\n\n## 第二章\n\n灯塔重新亮起。";

    const created = applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "add_node", nodeType: "text", title: "山海回声", position: { x: 420, y: 0 }, width: 520, height: 680, metadata: { content: markdown, status: "success", fontSize: 15 } }], 1);
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
    assert.throws(() => applyCanvasOps(userOne["X-Trim-Userid"], projectId, [{ type: "add_node", nodeType: "text", metadata: { content: markdown } }], 1), /画布版本已从 1 更新为 2/);
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
            models: [
                { id: "test-text-model", name: "测试文本", endpoint: "openai-chat", enabled: true },
                { id: "cec-image", name: "gpt-image-2", endpoint: "openai-images", enabled: true, imageModes: ["generate", "edit"], maxReferenceImages: 4 },
                { id: "generate-only", name: "仅文生图", endpoint: "openai-images", enabled: true, imageModes: ["generate"] },
            ],
        }) });
        assert.equal(provider.response.status, 201);
        assert.equal(provider.body.data.credentialConfigured, true);
        assert.equal(JSON.stringify(provider.body).includes("provider-secret"), false);
        assert.equal((await api(`/admin/ai/providers/${provider.body.data.id}/test`, userOne, { method: "POST" })).response.status, 200);
        const models = await api("/ai/models", userTwo);
        assert.equal(models.body.data.some((model: { value: string }) => model.value === `${provider.body.data.id}::test-text-model`), true);
        const imageModel = models.body.data.find((model: { value: string }) => model.value === `${provider.body.data.id}::cec-image`);
        assert.deepEqual(imageModel.imageModes, ["generate", "edit"]);
        assert.equal(imageModel.maxReferenceImages, 4);
        const generateOnlyModel = models.body.data.find((model: { value: string }) => model.value === `${provider.body.data.id}::generate-only`);
        assert.deepEqual(generateOnlyModel.imageModes, ["generate"]);
        assert.equal(generateOnlyModel.maxReferenceImages, undefined);
        const imageEditModel = `${provider.body.data.id}::cec-image`;
        assert.equal((await api("/admin/ai/config", userOne, { method: "PUT", body: JSON.stringify({ imageEditModel }) })).body.data.imageEditModel, imageEditModel);
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
    const savedAgentSettings = await api("/admin/ai/agent", userOne, { method: "PUT", body: JSON.stringify({ modelRef, mediaModelRef: modelRef }) });
    assert.equal(savedAgentSettings.response.status, 200);
    assert.equal(savedAgentSettings.body.data.mediaReady, true);
    assert.equal(savedAgentSettings.body.data.mediaModelName, "Agent 测试模型");
    const publicConfig = await api("/agent/config", userTwo);
    assert.deepEqual(publicConfig.body.data, { ready: true, modelName: "Agent 测试模型", providerName: "Agent 测试渠道", protocolVersion: 4, storageVersion: 2 });
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
    const streamAbort = new AbortController();
    const streamResponse = await fetch(`${origin}/agent/projects/project-1/stream?clientId=test-client`, { headers: userOne, signal: streamAbort.signal });
    assert.equal(streamResponse.status, 200);
    const stream = sseEvents(streamResponse);
    assert.equal((await stream.next()).value.type, "snapshot");
    const branch = await api(`/agent/sessions/${heldSession}/fork`, userOne, { method: "POST", body: JSON.stringify({ fromEventSeq: 3 }) });
    assert.equal(branch.response.status, 201);
    const streamedBranch = await nextSseMatching(stream, (event) => event.type === "delta" && event.session?.id === branch.body.data.id);
    assert.equal(streamedBranch.events?.[0]?.payload.forkSourceSeq, 3);
    streamAbort.abort();
    assert.deepEqual(branch.body.data.events.filter((item: { kind: string }) => item.kind === "user_text").map((item: { payload: { text: string } }) => item.payload.text), ["第一条消息"]);
    assert.equal(JSON.stringify(branch.body.data.events).includes("不应进入分支"), false);
    const branchRow = db.prepare("SELECT sdk_session_id, fork_pending, fork_resume_at FROM agent_sessions WHERE id=?").get(branch.body.data.id) as { sdk_session_id: string; fork_pending: number; fork_resume_at: string };
    assert.deepEqual(branchRow, { sdk_session_id: "sdk-session-1", fork_pending: 1, fork_resume_at: "sdk-anchor-1" });
    assert.equal((await api(`/agent/sessions/${heldSession}/fork`, userTwo, { method: "POST", body: JSON.stringify({ fromEventSeq: 3 }) })).response.status, 404);

    const interrupted = await api("/agent/projects/project-1/sessions", userOne, { method: "POST", body: "{}" });
    db.prepare("UPDATE agent_sessions SET status='running', current_run_id='restart-run' WHERE id=?").run(interrupted.body.data.id);
    recoverAgentRuns();
    const recovered = await api(`/agent/projects/project-1/conversation?sessionId=${interrupted.body.data.id}`, userOne);
    assert.equal(recovered.body.data.session.status, "failed");
    assert.equal(recovered.body.data.session.events.some((item: { kind: string; payload: { code?: string } }) => item.kind === "error" && item.payload.code === "SERVICE_RESTART_INTERRUPTED"), true);
    assert.equal(recovered.body.data.session.events.some((item: { kind: string; payload: { state?: string } }) => item.kind === "run_state" && item.payload.state === "failed"), true);

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

    const capabilities = await api("/agent/projects/project-1/capabilities", userOne);
    assert.equal(capabilities.response.status, 200);
    assert.equal(capabilities.body.data.sceneId, "canvas");
    assert.equal(capabilities.body.data.skills.some((skill: { id: string }) => skill.id === "canvas-edit"), true);
    assert.equal(capabilities.body.data.skills.some((skill: { id: string }) => skill.id === "media-understand"), true);
    assert.equal((await api("/agent/projects/project-1/capabilities", userTwo)).response.status, 404);
    const directorCapabilities = await api("/agent/projects/director-project-1/capabilities", userOne);
    assert.equal(directorCapabilities.body.data.sceneId, "director");
    assert.equal(directorCapabilities.body.data.skills.every((skill: { id: string }) => ["media-understand", "media-generation"].includes(skill.id) || skill.id.startsWith("director-")), true);
    assert.equal(directorCapabilities.body.data.skills.some((skill: { id: string }) => skill.id === "media-understand"), true);
    assert.equal(directorCapabilities.body.data.skills.some((skill: { id: string }) => skill.id === "canvas-edit"), false);
    const directorReferences = await api("/agent/projects/director-project-1/references?limit=100", userOne);
    assert.equal(directorReferences.response.status, 200);
    assert.equal(directorReferences.body.data.some((item: { segment: { type: string } }) => item.segment.type === "canvas"), false);
    const directorProjectBefore = JSON.parse((db.prepare("SELECT payload FROM projects WHERE id='director-project-1'").get() as { payload: string }).payload);
    const directorAsset = createAgentCreativeAssetBatch("user-1", "director-project-1", [{ kind: "prop", name: "导演测试道具", payload: { description: "只属于导演资产" } }])[0];
    const directorProjectAfter = JSON.parse((db.prepare("SELECT payload FROM projects WHERE id='director-project-1'").get() as { payload: string }).payload);
    assert.equal(directorAsset.name, "导演测试道具");
    assert.deepEqual(directorProjectAfter, directorProjectBefore);
    const forgedCanvasSkill = await api("/agent/projects/director-project-1/messages", userOne, { method: "POST", body: JSON.stringify({ clientMessageId: "forged-canvas-skill", submissionMode: "direct", content: { version: 1, segments: [{ type: "skill", mentionId: "skill-1", skillId: "canvas-edit" }] } }) });
    assert.equal(forgedCanvasSkill.response.status, 400);
    assert.equal(forgedCanvasSkill.body.error.code, "AGENT_SKILL_NOT_AVAILABLE_IN_SCENE");
    const forgedDirectorReference = await api("/agent/projects/project-1/messages", userOne, { method: "POST", body: JSON.stringify({ clientMessageId: "forged-director-reference", submissionMode: "direct", content: { version: 1, segments: [{ type: "director", mentionId: "reference-1", projectId: "project-1", entityKind: "story", entityId: "story" }] } }) });
    assert.equal(forgedDirectorReference.response.status, 400);
    assert.equal(forgedDirectorReference.body.error.code, "AGENT_REFERENCE_NOT_AVAILABLE_IN_SCENE");
    const forgedCrossProjectReference = await api("/agent/projects/director-project-1/messages", userOne, { method: "POST", body: JSON.stringify({ clientMessageId: "forged-cross-project-reference", submissionMode: "direct", content: { version: 1, segments: [{ type: "asset", mentionId: "reference-2", projectId: "project-1", assetId: "foreign-asset" }] } }) });
    assert.equal(forgedCrossProjectReference.response.status, 400);
    assert.equal(forgedCrossProjectReference.body.error.code, "AGENT_REFERENCE_INVALID");
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
            models: [{ id: "test-image-model", name: "测试图片", endpoint: "openai-images-generations", enabled: true, imageModes: ["generate"] }],
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

        const model = `${provider.body.data.id}::test-image-model`;
        const { buildAgentToolDefinitions } = await import("./agent/mcp/index.js");
        const toolContext = { session: { projectId: "story-project" }, run: { userId: "user-1" }, resolveWorkspacePath: (path: string) => join(testData, "workspace", path), appendEvent() {} } as unknown as Parameters<typeof buildAgentToolDefinitions>[0];
        const tools = buildAgentToolDefinitions(toolContext, agentScenes.canvas);
        const callTool = async (name: string, input: Record<string, unknown>) => {
            const response = await tools.find((item) => item.name === name)!.handler(input);
            assert.equal(response.isError, undefined, JSON.stringify(response));
            return JSON.parse((response.content[0] as { text: string }).text).data;
        };
        const beforeCount = (db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
        const request = { source: "channel", kind: "image", model, prompt: "画布统一接口" };
        assert.equal((await callTool("media_validate_generation", { request })).valid, true);
        assert.equal((db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n, beforeCount);
        const canvasTask = await callTool("media_generate", { request });
        let canvasStatus = canvasTask;
        for (let index = 0; index < 30 && !["succeeded", "failed"].includes(canvasStatus.status); index++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            canvasStatus = await callTool("media_get_generation_status", { generationId: canvasTask.id });
        }
        assert.equal(canvasStatus.status, "succeeded");
        const state = await callTool("canvas_get_state", { view: "summary" });
        assert.equal(state.nodeCount, 1, "生成完成不自动创建节点");
        const adopted = await callTool("canvas_adopt_result", { generationId: canvasTask.id, fileId: canvasStatus.result.files[0].fileId, expectedRevision: state.revision });
        assert.ok(adopted.nodeId);
        assert.equal((await callTool("canvas_get_state", { view: "summary" })).nodeCount, 2);
        const creative = await api("/projects/project-1/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "scene", name: "雨夜车站", payload: { description: "潮湿、冷色调的旧车站", mediaDrafts: { image: { model, prompt: "雨幕中的站台与冷白灯光" } } } }) });
        const generationRequest = { kind: "image", revision: creative.body.data.revision };
        const preview = await api(`/creative-assets/${creative.body.data.id}/generation-preview`, userOne, { method: "POST", body: JSON.stringify(generationRequest) });
        assert.equal(preview.response.status, 200);
        assert.equal(preview.body.data.model.value, model);
        assert.match(preview.body.data.prompt, /雨幕中的站台与冷白灯光/);
        const creativeGeneration = await api(`/creative-assets/${creative.body.data.id}/generations`, userOne, { method: "POST", body: JSON.stringify(generationRequest) });
        let creativeTask = creativeGeneration.body.data;
        for (let index = 0; index < 20 && !["succeeded", "failed"].includes(creativeTask.status); index += 1) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            creativeTask = (await api(`/generations/${creativeGeneration.body.data.id}`, userOne)).body.data;
        }
        const creativeResult = await api(`/creative-assets/${creative.body.data.id}`, userOne);
        assert.equal(creativeTask.status, "succeeded");
        assert.equal(creativeResult.body.data.payload.variants.length, 1);
        assert.equal(creativeResult.body.data.payload.primaryImageId, creativeResult.body.data.payload.variants[0].id);
        assert.equal(creativeTask.request.prompt, preview.body.data.prompt);
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

test("导演原生状态绑定来源并拒绝过期、篡改及跨用户续接", async () => {
    const { resolveDirectorH3Continuation, resolveDirectorH3Cumulative } = await import("./h3-continuation.js");
    const { syncDirectorGeneration } = await import("./director-render.js");
    const { storeLocalFile, getStoredFile } = await import("./file-store.js");
    const projectId = "h3-binding-project", segmentId = "h3-binding-segment", generationId = "h3-binding-generation";
    const userId = userOne["X-Trim-Userid"], now = new Date().toISOString();
    assert.equal((await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "续接绑定测试" }) })).response.status, 201);
    assert.equal((await api(`/director/projects/${projectId}`, userOne)).response.status, 200);
    db.prepare("INSERT INTO director_sequences(id,user_id,project_id,position,title,created_at,updated_at) VALUES(?,?,?,0,'场次',?,?)").run("h3-binding-sequence", userId, projectId, now, now);
    const initialPayload = { durationSeconds: 4, videoGenerationId: generationId, storyboardSheet: { revision: 1, layout: "2x2", frames: Array.from({ length: 4 }, (_, index) => ({ id: `h3-frame-${index}`, position: index, shotNumber: 1, timeSeconds: index * 4 / 3, kind: index === 0 ? "shot-start" : index === 3 ? "shot-end" : "keyframe", description: "静态画面", action: "", cameraAngle: "", cameraMove: "", sound: "" })) } };
    db.prepare("INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,payload,created_at,updated_at) VALUES(?,?,?,'h3-binding-sequence',0,'片段',?,?,?)").run(segmentId, userId, projectId, JSON.stringify(initialPayload), now, now);
    const sourcePath = join(testData, "h3-source.mp4"), statePath = join(testData, "h3-state.safetensors");
    await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24", "-f", "lavfi", "-i", "anullsrc=r=32000:cl=stereo", "-vf", "drawbox=color=white:t=fill:enable='eq(n,106)'", "-frames:v", "107", "-t", String(107 / 24), "-c:v", "libx264", "-c:a", "aac", sourcePath]);
    writeFileSync(statePath, "state transport fixture; tensor validation belongs to the Comfy loader");
    const video = storeLocalFile(userId, sourcePath, "source.mp4", "video/mp4");
    const state = storeLocalFile(userId, statePath, "state.safetensors", "application/octet-stream");
    const cumulativePath = join(testData, "h3-cumulative.mp4");
    await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=24", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=32000", "-frames:v", "107", "-t", String(107 / 24), "-c:v", "libx264", "-c:a", "aac", cumulativePath]);
    const cumulativeSource = storeLocalFile(userId, cumulativePath, "cumulative.mp4", "video/mp4");

    const context = { schemaVersion: 1 as const, fps: 24 as const, modelRevision: "model-sha", videoVaeRevision: "video-vae-sha", audioVaeRevision: "audio-vae-sha", sourceId: "test-source", width: 64, height: 64, frames: 107 };
    const request = { metadata: { directorSegment: { projectId, segmentId, storyboardRevision: 1 } } };
    db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,result,created_at,updated_at) VALUES(?,?,'video','succeeded','minimax-h3-ref2va-local',?,?,?,?)").run(generationId, userId, JSON.stringify(request), JSON.stringify({ files: [video], continuationStates: [state], cumulativeVideos: [cumulativeSource], execution: { context } }), now, now);
    const generation = db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(generationId, userId) as import("./generation-service.js").GenerationRow;
    const readPayload = () => JSON.parse((db.prepare("SELECT payload FROM director_shots WHERE id=? AND user_id=?").get(segmentId, userId) as { payload: string }).payload);
    const writePayload = (payload: unknown) => db.prepare("UPDATE director_shots SET payload=?,revision=revision+1 WHERE id=? AND user_id=?").run(JSON.stringify(payload), segmentId, userId);
    const syncing = syncDirectorGeneration(generation);
    writePayload({ ...initialPayload, description: "解码期间的新编辑" });
    await syncing;
    const adopted = readPayload();
    assert.equal(adopted.description, "解码期间的新编辑", "异步媒体处理不得覆盖用户新编辑");
    const lastFrame = getStoredFile(userId, adopted.actualLastFrameFileId)!;
    const { stdout: lastPixel } = await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-i", lastFrame.path, "-vf", "scale=1:1", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
    assert.ok([...lastPixel].every((channel) => channel > 230), "实际尾帧必须是最后一帧白色，不能是提前0.12秒的蓝色画面");
    const cumulative = await resolveDirectorH3Cumulative(userId, projectId, segmentId);
    assert.equal(cumulative.fileId, cumulativeSource.fileId);
    assert.equal(cumulative.frames, 107);
    assert.equal(cumulative.generationId, generationId);
    const emptyEdit = (await api(`/director/projects/${projectId}`, userOne)).body.data.timeline;
    assert.deepEqual(emptyEdit.payload.videoClips, [], "生成完成不自动选片");
    await api(`/director/projects/${projectId}/timeline`, userOne, { method: "PUT", body: JSON.stringify({ revision: emptyEdit.revision, payload: { videoClips: [{ id: "binding-clip", taskId: segmentId, trimIn: 0, trimOut: 107 / 24, linkedAudio: false }], tracks: [{ id: "model-original", kind: "model-original", clips: [{ id: "binding-audio", taskId: segmentId, start: 0, trimIn: 0, duration: 107 / 24 }] }] } }) });
    const playback = await api(`/director/projects/${projectId}/playback-plan`, userOne);
    assert.equal(playback.response.status, 200);
    assert.equal(playback.body.data.segments[0].fileId, cumulativeSource.fileId);
    assert.equal(playback.body.data.segments[0].duration, 107 / 24);
    assert.equal((await api(`/director/projects/${projectId}/playback-plan`, userTwo)).response.status, 404);

    await assert.rejects(resolveDirectorH3Cumulative(userTwo["X-Trim-Userid"], projectId, segmentId));
    writePayload({ ...adopted, h3CumulativeVideo: { ...adopted.h3CumulativeVideo, frames: 124 } });
    await assert.rejects(resolveDirectorH3Cumulative(userId, projectId, segmentId), /累计音视频/);
    writePayload(adopted);

    const binding = await resolveDirectorH3Continuation(userId, projectId, segmentId, context);
    assert.equal(adopted.durationSeconds, 4, "保留创作计划时长");
    assert.equal(adopted.videoDurationSeconds, 107 / 24, "保留原生媒体时长，不能裁掉状态对应的尾帧");
    const timeline = JSON.parse((db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string }).payload);
    assert.equal(timeline.tracks.find((track: { id: string }) => track.id === "model-original").clips[0].duration, 107 / 24);
    assert.deepEqual(cumulative.chain.map((item) => item.segmentId), [segmentId]);
    db.prepare("UPDATE generations SET request=? WHERE id=?").run(JSON.stringify({ ...request, metadata: { directorSegment: { ...request.metadata.directorSegment, previousState: binding } } }), generationId);
    await assert.rejects(resolveDirectorH3Cumulative(userId, projectId, segmentId), /来源链无效/);
    db.prepare("UPDATE generations SET request=? WHERE id=?").run(JSON.stringify(request), generationId);
    const { createDirectorRender, listDirectorRenders } = await import("./director-render.js");
    const refreshedProject = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(refreshedProject.response.status, 200);
    const refreshedTrack = refreshedProject.body.data.timeline.payload.tracks.find((track: { id: string }) => track.id === "model-original");
    assert.equal(refreshedTrack?.clips.length, 1, "显式编排的模型原声必须在工程刷新后保留");
    const timelineRow = db.prepare("SELECT revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { revision: number };
    const rendering = await createDirectorRender(userId, projectId, { timelineRevision: timelineRow.revision });
    let rendered = rendering;
    for (let attempt = 0; attempt < 100 && !["succeeded", "failed"].includes(rendered.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        rendered = listDirectorRenders(userId, projectId).find((item) => item.id === rendering.id)!;
    }
    assert.equal(rendered.status, "succeeded", rendered.error || "累计媒体合成未完成");
    const { directorProjectRoot, archiveDirectorRender } = await import("./director-workspace.js");
    const archiveRoot = join(directorProjectRoot(userId, projectId), "renders", rendered.id);
    assert.ok(existsSync(join(archiveRoot, "final.mp4")));
    const archiveMetadata = JSON.parse(readFileSync(join(archiveRoot, "render.json"), "utf8"));
    assert.equal(archiveMetadata.renderId, rendered.id);
    assert.deepEqual(archiveMetadata.segmentIds, [segmentId]);
    assert.equal(archiveMetadata.fps, 24);
    assert.match(archiveMetadata.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => archiveDirectorRender(userId, projectId, rendered.id, join(archiveRoot, "final.mp4"), {}), /不能覆盖/);
    const renderZip = new AdmZip(Buffer.from(await (await fetch(`${origin}/director/projects/${projectId}/export`, { headers: userOne })).arrayBuffer()));
    assert.ok(renderZip.getEntry(`renders/${rendered.id}/final.mp4`));
    assert.ok(renderZip.getEntry(`renders/${rendered.id}/render.json`));
    const renderedMedia = getStoredFile(userId, rendered.outputFileId!)!;
    const { stdout: renderedProbe } = await promisify(execFileCallback)("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "json", renderedMedia.path]);
    assert.equal(JSON.parse(renderedProbe).streams[0].nb_read_frames, "107");
    const { stdout: pixel } = await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-i", renderedMedia.path, "-vf", "scale=1:1", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
    assert.ok(pixel[1]! > pixel[0]! + 50 && pixel[1]! > pixel[2]! + 50, "最终画面必须采用绿色累计视频，不能回退蓝色旧预览");
    const { stdout: audioStats } = await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-i", renderedMedia.path, "-vn", "-t", "0.1", "-ac", "1", "-ar", "32000", "-f", "s16le", "pipe:1"], { encoding: "buffer" });
    assert.ok(Array.from({ length: audioStats.length / 2 }, (_, index) => Math.abs(audioStats.readInt16LE(index * 2))).some((sample) => sample > 100), "模型原声必须来自累计视频的正弦音轨，不能沿用静音旧预览");

    const exported = await fetch(`${origin}/director/projects/${projectId}/export`, { headers: userOne });
    assert.equal(exported.status, 200);
    const archive = new AdmZip(Buffer.from(await exported.arrayBuffer()));
    assert.ok(archive.getEntry(".h3/manifest.json"));
    const importZip = (zip: AdmZip) => fetch(`${origin}/director/projects/import`, { method: "POST", headers: { ...userTwo, "Content-Type": "application/zip" }, body: new Uint8Array(zip.toBuffer()) });
    const importedResponse = await importZip(archive);
    assert.equal(importedResponse.status, 201);
    const importedProjectId = (await importedResponse.json()).data.projectId;
    const importedProject = (await api(`/director/projects/${importedProjectId}`, userTwo)).body.data;
    const importedSegment = importedProject.videoSegments[0];
    const importedState = await resolveDirectorH3Continuation(userTwo["X-Trim-Userid"], importedProjectId, importedSegment.id, context);
    assert.notEqual(importedState.fileId, state.fileId);
    assert.notEqual(importedState.generationId, generationId);
    assert.equal(importedState.stateSha256, binding.stateSha256);
    assert.equal(importedState.context.sourceId, context.sourceId, "保留状态中的原始来源标识，不改写 tensor 元数据");
    const importedCumulative = await resolveDirectorH3Cumulative(userTwo["X-Trim-Userid"], importedProjectId, importedSegment.id);
    assert.notEqual(importedCumulative.fileId, cumulativeSource.fileId);
    assert.equal(importedProject.timeline.payload.tracks[0].clips[0].id, "binding-audio");
    assert.equal(importedProject.timeline.payload.tracks[0].clips[0].taskId, importedSegment.id);
    assert.equal((await fetch(`${origin}/files/${importedState.fileId}/content`, { headers: userOne })).status, 404);
    const importedGeneration = db.prepare("SELECT request FROM generations WHERE user_id=? AND id=?").get(userTwo["X-Trim-Userid"], importedState.generationId) as { request: string };
    assert.equal(JSON.parse(importedGeneration.request).metadata.archiveImport.sourceGenerationId, generationId);
    const reexported = await fetch(`${origin}/director/projects/${importedProjectId}/export`, { headers: userTwo });
    assert.equal(reexported.status, 200);
    assert.equal(JSON.parse(new AdmZip(Buffer.from(await reexported.arrayBuffer())).readAsText(".h3/manifest.json")).entries[0].sourceGenerationId, generationId, "反复导入导出保留原始来源生成标识");
    const manifest = JSON.parse(archive.readAsText(".h3/manifest.json"));
    const damaged = new AdmZip(archive.toBuffer());
    damaged.updateFile(manifest.entries[0].state.path, Buffer.from("damaged state"));
    assert.equal((await importZip(damaged)).status, 400, "拒绝状态内容哈希不匹配的导入");
    for (const patch of [{ parentSegmentId: manifest.entries[0].segmentId }, { state: { ...manifest.entries[0].state, path: ".h3/../../app.db" } }]) {
        const invalidArchive = new AdmZip(archive.toBuffer());
        invalidArchive.updateFile(".h3/manifest.json", Buffer.from(JSON.stringify({ ...manifest, entries: [{ ...manifest.entries[0], ...patch }] })));
        assert.equal((await importZip(invalidArchive)).status, 400, "拒绝循环来源或状态路径越界");
    }
    const importedRendering = await createDirectorRender(userTwo["X-Trim-Userid"], importedProjectId, { timelineRevision: importedProject.timeline.revision });
    let importedRendered = importedRendering;
    for (let attempt = 0; attempt < 100 && !["succeeded", "failed"].includes(importedRendered.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        importedRendered = listDirectorRenders(userTwo["X-Trim-Userid"], importedProjectId).find((item) => item.id === importedRendering.id)!;
    }
    assert.equal(importedRendered.status, "succeeded", importedRendered.error || "导入后累计合成未完成");
    const importedOutput = getStoredFile(userTwo["X-Trim-Userid"], importedRendered.outputFileId!)!;
    const { stdout: importedAudio } = await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-i", importedOutput.path, "-vn", "-t", "0.1", "-ac", "1", "-ar", "32000", "-f", "s16le", "pipe:1"], { encoding: "buffer" });
    assert.ok(Array.from({ length: importedAudio.length / 2 }, (_, index) => Math.abs(importedAudio.readInt16LE(index * 2))).some((sample) => sample > 100), "跨项目恢复后仍须采用累计原声，而非静音旧预览");
    const { exportDirectorProjectZip } = await import("./director-workspace.js");
    const exporting = exportDirectorProjectZip(userId, projectId);
    writePayload({ ...readPayload(), description: "导出期间的新编辑" });
    await assert.rejects(exporting, /发生变化/, "不得导出混合版本的来源状态与工程文件");
    writePayload(adopted);

    assert.equal(binding.fileId, state.fileId);
    assert.equal(binding.videoFileId, adopted.videoFileId);
    assert.notEqual(binding.videoFileId, video.fileId, "绑定导演采用的视频，不冒充原始供应商文件");
    const { reconcileDirectorProjectFiles } = await import("./director-workspace.js");
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal((await resolveDirectorH3Continuation(userId, projectId, segmentId, context)).videoSha256, binding.videoSha256, "工程内同内容媒体镜像保持状态来源一致");
    await assert.rejects(resolveDirectorH3Continuation(userTwo["X-Trim-Userid"], projectId, segmentId, context), /不存在|不属于/);
    await assert.rejects(resolveDirectorH3Continuation(userId, "another-project", segmentId, context), /不存在|不属于/);
    await assert.rejects(resolveDirectorH3Continuation(userId, projectId, segmentId, { ...context, modelRevision: "different" }), /不一致/);
    writePayload({ ...adopted, videoFileId: video.fileId });
    await assert.rejects(resolveDirectorH3Continuation(userId, projectId, segmentId, context), /已失效|发生变化/);
    writePayload({ ...adopted, videoGenerationId: "newer-generation" });
    const beforeLateResult = readPayload();
    await syncDirectorGeneration(generation);
    assert.deepEqual(readPayload(), beforeLateResult, "较晚完成的旧生成不得覆盖新任务");
    writePayload(adopted);
    writeFileSync(getStoredFile(userId, cumulativeSource.fileId)!.path, "changed cumulative media bytes");
    await assert.rejects(resolveDirectorH3Cumulative(userId, projectId, segmentId), /累计音视频/);
    writeFileSync(getStoredFile(userId, state.fileId)!.path, "changed state bytes");
    await assert.rejects(resolveDirectorH3Continuation(userId, projectId, segmentId, context), /发生变化/);
});

test("导演显式原声编排保留刷新及混音音量", async () => {
    const { syncDirectorGeneration } = await import("./director-render.js");
    const { storeLocalFile } = await import("./file-store.js");
    const userId = userOne["X-Trim-Userid"], projectId = "native-audio-refresh", now = new Date().toISOString();
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "原声刷新" }) });
    assert.equal((await api(`/director/projects/${projectId}`, userOne)).response.status, 200);
    const path = join(testData, "native-audio-refresh.mp4");
    await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=32000", "-t", "4", "-c:v", "libx264", "-c:a", "aac", path]);
    const video = storeLocalFile(userId, path, "native-audio-refresh.mp4", "video/mp4");
    for (const [position, suffix] of ["z", "a"].entries()) {
        const segmentId = `native-audio-${suffix}`, sequenceId = `native-sequence-${suffix}`, generationId = `native-audio-generation-${suffix}`;
        db.prepare("INSERT INTO director_sequences(id,user_id,project_id,position,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(sequenceId, userId, projectId, position, "场次", now, now);
        db.prepare("INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,payload,created_at,updated_at) VALUES(?,?,?,?,0,'片段',?,?,?)").run(segmentId, userId, projectId, sequenceId, JSON.stringify({ durationSeconds: 4, videoGenerationId: generationId, storyboardSheet: { revision: 1, layout: "2x2", frames: Array.from({ length: 4 }, (_, index) => ({ id: `${segmentId}-frame-${index}`, shotNumber: 1, timeSeconds: index * 4 / 3, kind: index === 0 ? "shot-start" : index === 3 ? "shot-end" : "keyframe", description: "静态画面", action: "", cameraAngle: "", cameraMove: "", sound: "" })) } }), now, now);
        db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,result,created_at,updated_at) VALUES(?,?,'video','succeeded','test',?,?,?,?)").run(generationId, userId, JSON.stringify({ metadata: { directorSegment: { projectId, segmentId } } }), JSON.stringify({ files: [video] }), now, now);
        // These fixtures model production entities, whose files exist before the
        // asynchronous generation callback yields to the workspace watcher.
        const { syncDirectorSequenceFile, syncDirectorVideoSegmentFile } = await import("./director-workspace.js");
        syncDirectorSequenceFile(userId, projectId, sequenceId);
        syncDirectorVideoSegmentFile(userId, projectId, segmentId);
        await syncDirectorGeneration(db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(generationId, userId) as import("./generation-service.js").GenerationRow);
    }
    const beforeEdit = (await api(`/director/projects/${projectId}`, userOne)).body.data;
    assert.deepEqual(beforeEdit.timeline.payload.videoClips, []);
    const ids = ["native-audio-z", "native-audio-a"];
    await api(`/director/projects/${projectId}/timeline`, userOne, { method: "PUT", body: JSON.stringify({ revision: beforeEdit.timeline.revision, payload: { videoClips: ids.map((taskId, index) => ({ id: `video-${index}`, taskId, trimIn: 0, trimOut: 4, linkedAudio: false })), tracks: [{ id: "model-original", kind: "model-original", clips: ids.map((taskId, index) => ({ id: `audio-${index}`, taskId, fileId: beforeEdit.videoSegments.find((task: {id:string}) => task.id === taskId).payload.nativeAudioFileId, start: index * 4, trimIn: 0, duration: 4 })) }] } }) });
    const refreshed = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(refreshed.response.status, 200);
    const clips = refreshed.body.data.timeline.payload.tracks.find((track: { id: string }) => track.id === "model-original").clips;
    const { getStoredFile: readNativeAudio } = await import("./file-store.js");
    const nativeAudio = readNativeAudio(userId, clips[0].fileId)!;
    assert.equal(nativeAudio.mime_type, "audio/wav");
    const audioHeader = readFileSync(nativeAudio.path);
    assert.equal(audioHeader.toString("ascii", 0, 4), "RIFF", "工程WAV不得只是重命名的M4A");
    assert.equal(audioHeader.toString("ascii", 8, 12), "WAVE");
    const { stdout: nativeProbe } = await promisify(execFileCallback)("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:format=format_name", "-of", "json", nativeAudio.path]);
    assert.equal(JSON.parse(nativeProbe).format.format_name, "wav");
    assert.equal(JSON.parse(nativeProbe).streams[0].codec_name, "pcm_s16le");
    assert.deepEqual(clips.map((clip: { taskId: string; start: number }) => [clip.taskId, clip.start]), [["native-audio-z", 0], ["native-audio-a", 4]]);
    const plan = await api(`/director/projects/${projectId}/playback-plan`, userOne);
    assert.deepEqual(plan.body.data.segments.map((segment: { segmentId: string }) => segment.segmentId), ["native-audio-z", "native-audio-a"]);
    clips[1].volume = 0.5;
    clips[1].fadeIn = 1;
    clips[1].fadeOut = 1;
    const timeline = await api(`/director/projects/${projectId}/timeline`, userOne, { method: "PUT", body: JSON.stringify({ revision: refreshed.body.data.timeline.revision, payload: refreshed.body.data.timeline.payload }) });
    const submission = await api(`/director/projects/${projectId}/renders`, userOne, { method: "POST", body: JSON.stringify({ timelineRevision: timeline.body.data.revision }) });
    assert.equal(submission.response.status, 202, JSON.stringify(submission.body));
    let rendered = submission.body.data;
    for (let attempt = 0; attempt < 100 && !["succeeded", "failed"].includes(rendered.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        rendered = (await api(`/director/projects/${projectId}/renders`, userOne)).body.data.find((item: { id: string }) => item.id === rendered.id);
    }
    assert.equal(rendered.status, "succeeded", rendered.error);
    const { getStoredFile } = await import("./file-store.js");
    const rms = async (file: string, start: number) => {
        const { stdout } = await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-ss", String(start), "-i", file, "-vn", "-t", "0.5", "-ac", "2", "-ar", "48000", "-f", "f32le", "pipe:1"], { encoding: "buffer" });
        let squares = 0;
        for (let index = 0; index < stdout.length; index += 4) squares += stdout.readFloatLE(index) ** 2;
        return Math.sqrt(squares / (stdout.length / 4));
    };
    const output = getStoredFile(userId, rendered.outputFileId)!.path;
    const { stdout: mixedProbe } = await promisify(execFileCallback)("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "json", output]);
    assert.equal(JSON.parse(mixedProbe).streams[0].channels, 2, "首段单声道原声不得将最终混音折为单声道");
    const sourceRms = await rms(path, 0.5);
    assert.ok(Math.abs(await rms(output, 0.5) / sourceRms - 1) < 0.05, "首段不得因为后续音轨和静音填充而衰减");
    assert.ok(Math.abs(await rms(output, 5.5) / sourceRms - 0.5) < 0.03, "后段应保留用户设置的半音量");
    for (const start of [4, 7.5]) {
        const ratio = await rms(output, start) / sourceRms;
        assert.ok(Math.abs(ratio - Math.sqrt(1 / 12) * 0.5) < 0.025, `导出必须保留片段相对淡入淡出，${start} 秒的 RMS 比值 ${ratio}`);
    }
    const loudProject = (await api(`/director/projects/${projectId}`, userOne)).body.data;
    const persistedClip = loudProject.timeline.payload.tracks[0].clips[1];
    assert.equal(persistedClip.fadeIn, 1);
    assert.equal(persistedClip.fadeOut, 1);
    loudProject.timeline.payload.tracks[0].clips.forEach((clip: { start: number; volume: number }) => { clip.start = 0; clip.volume = 20; });
    const loudTimeline = await api(`/director/projects/${projectId}/timeline`, userOne, { method: "PUT", body: JSON.stringify({ revision: loudProject.timeline.revision, payload: loudProject.timeline.payload }) });
    let loudRender = (await api(`/director/projects/${projectId}/renders`, userOne, { method: "POST", body: JSON.stringify({ timelineRevision: loudTimeline.body.data.revision }) })).body.data;
    for (let attempt = 0; attempt < 100 && !["succeeded", "failed"].includes(loudRender.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        loudRender = (await api(`/director/projects/${projectId}/renders`, userOne)).body.data.find((item: { id: string }) => item.id === loudRender.id);
    }
    assert.equal(loudRender.status, "succeeded", loudRender.error);
    const { stdout: limited } = await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-ss", "0.5", "-i", getStoredFile(userId, loudRender.outputFileId)!.path, "-vn", "-t", "0.5", "-f", "f32le", "pipe:1"], { encoding: "buffer" });
    let peak = 0;
    for (let index = 0; index < limited.length; index += 4) peak = Math.max(peak, Math.abs(limited.readFloatLE(index)));
    assert.ok(peak > 0.9 && peak < 0.99, `重叠高增益音轨必须限幅，实际 AAC 解码峰值 ${peak}`);
});

test("ComfyUI 原生续接状态与普通媒体输出分离", async () => {
    const { collectComfyOutputs } = await import("./generation-service.js");
    const state = { filename: "state.safetensors", subfolder: "h3-state", type: "output" };
    const video = { filename: "clip.mp4", type: "output" };
    const cumulative = { filename: "cumulative.mp4", type: "output" };
    assert.deepEqual(collectComfyOutputs({ "1": { h3_states: [state] }, "2": { videos: [video] }, h3_cumulative: { images: [cumulative] } }), { files: [video], continuationStates: [state], cumulativeVideos: [cumulative] });
    assert.throws(() => collectComfyOutputs({ h3_cumulative: { images: [state] } }), /累计音视频格式无效/);
    assert.deepEqual(collectComfyOutputs({ "1": { h3_states: [state] } }).files, []);
    assert.throws(() => collectComfyOutputs({ "1": { h3_states: [{ filename: "unsafe.pkl" }] } }), /状态格式无效/);
});

test("固定 ComfyUI 工作流由后端执行并持久化结果", async () => {
    let promptCounter = 0;
    const fakeComfy = createServer((request, response) => {
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname === "/system_stats") return json(response, { system: {} });
        if (url.pathname === "/upload/image") return json(response, { name: "uploaded.png" });
        if (url.pathname === "/prompt") return json(response, { prompt_id: `prompt-${++promptCounter}` });
        if (url.pathname.startsWith("/history/")) {
            const id = url.pathname.split("/").pop() || "";
            return json(response, { [id]: { status: { status_str: "success" }, outputs: { h3_cumulative: { images: [{ filename: "cumulative.mp4", type: "output" }] }, "70": { h3_states: [{ filename: "state.safetensors", subfolder: "h3-state", type: "output" }] }, "11": { images: [{ filename: "result.png", type: "output" }] } } } });
        }
        if (url.pathname === "/view" && url.searchParams.get("filename") === "cumulative.mp4") {
            response.writeHead(200, { "Content-Type": "video/mp4" });
            return response.end(Buffer.from("cumulative-transport-fixture"));
        }
        if (url.pathname === "/view" && url.searchParams.get("filename") === "state.safetensors") {
            response.writeHead(200, { "Content-Type": "application/octet-stream" });
            return response.end(Buffer.from("state-transport-fixture"));
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
        await api("/admin/comfyui/servers", userOne, { method: "POST", body: JSON.stringify({ name: "测试节点", url: `http://127.0.0.1:${address.port}`, enabled: true, models: ["hidream-o1-full-fp8-local", "flux2-dev-fp8-local", "qwen-image-edit-2511-local", "realesrgan-x4-local"] }) });
        const ordinaryModels = await api("/ai/models", userTwo);
        assert.equal(JSON.stringify(ordinaryModels.body).includes(String(address.port)), false);
        assert.equal(ordinaryModels.body.data.some((model: { id: string }) => model.id === "hidream-o1-full-fp8-local"), true);
        assert.deepEqual(ordinaryModels.body.data.find((model: { id: string }) => model.id === "qwen-image-edit-2511-local").imageModes, ["edit"]);
        assert.deepEqual(ordinaryModels.body.data.find((model: { id: string }) => model.id === "flux2-dev-fp8-local").imageModes, ["generate", "edit"]);
        assert.equal(ordinaryModels.body.data.find((model: { id: string }) => model.id === "flux2-dev-fp8-local").maxReferenceImages, 6);
        assert.equal(ordinaryModels.body.data.some((model: { id: string }) => model.id === "realesrgan-x4-local"), false);
        assert.equal((await api("/admin/comfyui/servers", userTwo)).response.status, 403);
        const directWorkflow = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: "comfyui::realesrgan-x4-local", prompt: "不应直接选择" }) });
        assert.equal(directWorkflow.response.status, 400);
        assert.equal(directWorkflow.body.error.code, "AI_MODEL_NOT_SELECTABLE");
        const editAsGeneration = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: "comfyui::qwen-image-edit-2511-local", prompt: "不应作为文生图" }) });
        assert.equal(editAsGeneration.response.status, 400);
        assert.equal(editAsGeneration.body.error.code, "AI_MODEL_MODE_UNSUPPORTED");
        const invalidDefault = await api("/admin/ai/model-defaults", userOne, { method: "PUT", body: JSON.stringify({ text: "", image: "comfyui::realesrgan-x4-local", video: "", audio: "" }) });
        assert.equal(invalidDefault.response.status, 400);
        assert.equal(invalidDefault.body.error.code, "AI_MODEL_NOT_SELECTABLE");
        const created = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: "comfyui::hidream-o1-full-fp8-local", prompt: "测试图片", params: { size: "16:9", count: 1 } }) });
        let generation = created.body.data;
        for (let index = 0; index < 20 && !["succeeded", "failed"].includes(generation.status); index += 1) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            generation = (await api(`/generations/${created.body.data.id}`, userOne)).body.data;
        }
        assert.equal(generation.status, "succeeded");
        assert.equal(generation.result.files.length, 1);
        assert.equal((await api(`/generations/${created.body.data.id}`, userTwo)).response.status, 404);

        const form = new FormData();
        form.set("file", new Blob(["source"], { type: "image/png" }), "source.png");
        const uploaded = await api("/files", userOne, { method: "POST", body: form });
        const configured = await api("/admin/ai/config", userOne, { method: "PUT", body: JSON.stringify({ imageEditModel: "comfyui::qwen-image-edit-2511-local", imageWorkflows: { "image-upscale-faithful": "realesrgan-x4-local" } }) });
        assert.equal(configured.body.data.imageEditModel, "comfyui::qwen-image-edit-2511-local");
        assert.equal(configured.body.data.imageWorkflows["image-upscale-faithful"], "realesrgan-x4-local");
        const removedPurpose = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: configured.body.data.imageEditModel, purpose: "image-edit", prompt: "旧协议", references: [{ fileId: uploaded.body.data.fileId, kind: "image" }] }) });
        assert.equal(removedPurpose.response.status, 400);
        const edit = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: configured.body.data.imageEditModel, prompt: "改成蓝色", references: [{ fileId: uploaded.body.data.fileId, kind: "image" }] }) });
        assert.equal(edit.response.status, 201);
        assert.equal(edit.body.data.modelId, "qwen-image-edit-2511-local");
        const tooManyReferences = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: configured.body.data.imageEditModel, prompt: "参考图过多", references: Array.from({ length: 4 }, () => ({ fileId: uploaded.body.data.fileId, kind: "image" })) }) });
        assert.equal(tooManyReferences.response.status, 400);
        assert.equal(tooManyReferences.body.error.code, "AI_MODEL_REFERENCE_LIMIT");
        const textToImageWithEditModel = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", model: configured.body.data.imageEditModel, prompt: "没有参考图" }) });
        assert.equal(textToImageWithEditModel.response.status, 400);
        assert.equal(textToImageWithEditModel.body.error.code, "AI_MODEL_MODE_UNSUPPORTED");
        const upscale = await api("/generations", userOne, { method: "POST", body: JSON.stringify({ kind: "image", purpose: "image-upscale-faithful", params: { targetLongEdge: 2048, sourceWidth: 800, sourceHeight: 600 }, references: [{ fileId: uploaded.body.data.fileId, kind: "image" }] }) });
        assert.equal(upscale.response.status, 201);
        assert.equal(upscale.body.data.modelId, "realesrgan-x4-local");
        let upscaleGeneration = upscale.body.data;
        for (let index = 0; index < 20 && !["succeeded", "failed"].includes(upscaleGeneration.status); index += 1) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            upscaleGeneration = (await api(`/generations/${upscale.body.data.id}`, userOne)).body.data;
        }
        assert.equal(upscaleGeneration.status, "succeeded");
        assert.equal(upscaleGeneration.result.files.length, 1);
        assert.equal(upscaleGeneration.result.files[0].name, "result.png");
        const cumulativeFile = upscaleGeneration.result.cumulativeVideos[0];
        assert.equal(cumulativeFile.name, "cumulative.mp4");
        assert.equal(await (await fetch(`${origin}/files/${cumulativeFile.fileId}/content`, { headers: userOne })).text(), "cumulative-transport-fixture");
        assert.equal((await fetch(`${origin}/files/${cumulativeFile.fileId}/content`, { headers: userTwo })).status, 404);
        assert.ok(db.prepare("SELECT 1 FROM file_refs WHERE user_id=? AND owner_type='generation' AND owner_id=? AND file_id=?").get(userOne["X-Trim-Userid"], upscaleGeneration.id, cumulativeFile.fileId));
        const stateFile = upscaleGeneration.result.continuationStates[0];
        assert.equal(stateFile.name, "state.safetensors");
        const ownedState = await fetch(`${origin}/files/${stateFile.fileId}/content`, { headers: userOne });
        assert.equal(await ownedState.text(), "state-transport-fixture", "只验证状态传输，不冒充 safetensors 内容校验");
        assert.equal((await fetch(`${origin}/files/${stateFile.fileId}/content`, { headers: userTwo })).status, 404);
        assert.ok(db.prepare("SELECT 1 FROM file_refs WHERE user_id=? AND owner_type='generation' AND owner_id=? AND file_id=?").get(userOne["X-Trim-Userid"], upscaleGeneration.id, stateFile.fileId));
    } finally {
        await new Promise<void>((resolvePromise) => fakeComfy.close(() => resolvePromise()));
    }
});

async function uploadDirectorSource(projectId: string, blob: Blob, name: string) {
    const form = new FormData(); form.set("file", blob, name);
    const uploaded = await api("/files", userOne, { method: "POST", body: form });
    const created = await api(`/director/projects/${projectId}/sources`, userOne, { method: "POST", body: JSON.stringify({ fileId: uploaded.body.data.fileId }) });
    let source = created.body.data;
    for (let index = 0; index < 100 && source.status === "processing"; index += 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
        source = (await api(`/director/projects/${projectId}`, userOne)).body.data.sources.find((item: { id: string }) => item.id === source.id);
    }
    return source;
}

test("导演 HTTP 默认 PDD 和基础重做保存真实配方参数", async () => {
    const settings = await import("./media-executor-settings.js");
    const { storeLocalFile } = await import("./file-store.js");
    const { syncDirectorVideoSegmentFile, ensureDirectorProjectWorkspace, reconcileDirectorProjectFiles, readDirectorVideoPrompt } = await import("./director-workspace.js");
    const { cancelGeneration } = await import("./generation-service.js");
    const original = settings.getMediaExecutorSettings();
    const identity = { ready: true, schemaVersion: 1, modelId: "minimax-h3-ref2va-local", modelRevision: `${"a".repeat(64)}:pipeline:${"b".repeat(64)}`, videoVaeRevision: "c".repeat(64), audioVaeRevision: "d".repeat(64), implementationRevision: "b".repeat(64) };
    let ready = true;
    const executor = createServer(async (request, response) => {
        if (request.url === "/health") json(response, { protocolVersion: "2", models: {}, runtimes: {}, comfyFeatures: { temporalGuides: false, nativeState: true, pddRef8: ready }, h3Runtime: identity, h3PddRuntime: ready ? { ...identity, modelRevision: `${identity.modelRevision}:pdd-ref8:${"e".repeat(64)}` } : null });
        else if (request.url === "/v1/files") { for await (const _chunk of request) { /* consume upload */ } json(response, { id: "uploaded-reference" }); }
        else if (request.url === "/v1/jobs/validate") {
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const value = JSON.parse(Buffer.concat(chunks).toString());
            assert.equal(Object.keys(value.params).some((key) => key.startsWith("__")), false);
            const recipe = value.params.recipe || (ready ? "pdd-ref8" : "base");
            if (!ready && recipe === "pdd-ref8") { response.writeHead(409, { "Content-Type": "application/json" }); response.end(JSON.stringify({ detail: "requested recipe unavailable" })); return; }
            json(response, { valid: true, plan: { capabilityVersion: "1", mode: value.mode, recipe, seed: 42, width: 864, height: 480, outputFrames: 107, outputSeconds: 107 / 24 } });
        }
        else { response.writeHead(503); response.end("No GPU execution in transport fixture"); }
    });
    await new Promise<void>((resolve) => executor.listen(0, "127.0.0.1", resolve));
    try {
        settings.saveMediaExecutorSettings({ url: `http://127.0.0.1:${(executor.address() as { port: number }).port}`, token: "test-token" });
        await settings.refreshMediaExecutorCatalog();
        const projectId = "pdd-http-project", userId = userOne["X-Trim-Userid"];
        const project = await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, kind: "director", title: "配方接口测试" }) });
        assert.equal(project.response.status, 201, JSON.stringify(project.body));
        const initial = await api(`/director/projects/${projectId}`, userOne);
        assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
        const script = initial.body.data.documents.find((document: { kind: string }) => document.kind === "script");
        const savedScript = await api(`/director/projects/${projectId}/documents/script`, userOne, { method: "PUT", body: JSON.stringify({ revision: script.revision, content: "# 静室\n木门缓慢打开，露出空荡房间。" }) });
        assert.equal(savedScript.response.status, 200, JSON.stringify(savedScript.body));
        const breakdown = await api(`/director/projects/${projectId}/screenplay-breakdown`, userOne, { method: "PUT", body: JSON.stringify({ revision: initial.body.data.screenplayBreakdown.revision, scriptRevision: savedScript.body.data.revision, scenes: [{ id: "S1", heading: "内景 静室", title: "静室", location: "房间", timeOfDay: "夜", interiorExterior: "interior", characterNames: [], propNames: [], openingState: "门关闭", endingState: "门打开", dramaticTurn: "显露空房间", requiredDialogue: [], beats: [{ id: "B1", summary: "门缓慢打开", estimatedSeconds: 4 }], estimatedSeconds: 4 }], reviewIssues: [] }) });
        assert.equal(breakdown.response.status, 200, JSON.stringify(breakdown.body));
        const sequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ title: "静室" }) });
        assert.equal(sequence.response.status, 201, JSON.stringify(sequence.body));
        const created = await api(`/director/projects/${projectId}/production-tasks`, userOne, { method: "POST", body: JSON.stringify({ sequenceId: sequence.body.data.id, title: "开门", payload: { durationSeconds: 4, boundary: "cut", sourceSceneId: "S1", sourceBeatIds: ["B1"], sourceDurationSeconds: 4, dramaticBeat: "门缓慢打开", openingState: "门关闭", endingState: "门打开" } }) });
        assert.equal(created.response.status, 201, JSON.stringify(created.body));
        const segment = created.body.data, boardPath = join(testData, "pdd-board.png");
        await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=white:s=64x64", "-frames:v", "1", boardPath]);
        const board = storeLocalFile(userId, boardPath, "board.png", "image/png");
        const payload = { ...segment.payload, referenceImages: [`productions/${segment.id}/storyboard.png`], storyboardSheet: { ...segment.payload.storyboardSheet, imageFileId: board.fileId, frames: segment.payload.storyboardSheet.frames.map((frame: Record<string, unknown>) => ({ ...frame, h3Visual: "A wooden door slowly opens in a quiet room. Fixed camera.", sound: "quiet room tone", dialogues: [] })) } };
        db.prepare("UPDATE director_shots SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify(payload), segment.id, userId);
        syncDirectorVideoSegmentFile(userId, projectId, segment.id);
        const generate = async (recipe?: string) => {
            const row = db.prepare("SELECT revision FROM director_shots WHERE id=? AND user_id=?").get(segment.id, userId) as { revision: number };
            const result = await api(`/director/production-tasks/${segment.id}/generate`, userOne, { method: "POST", body: JSON.stringify({ revision: row.revision, qualityPreset: "preview", recipe }) });
            if (result.body.data?.id) cancelGeneration(userId, result.body.data.id);
            return result;
        };
        const promptFile = join(ensureDirectorProjectWorkspace(userId, projectId), "productions", segment.id, "video-prompt.md");
        const emptySubmission = await generate();
        assert.equal(emptySubmission.response.status, 409, JSON.stringify(emptySubmission.body));
        const finalPrompt = "  subject_definitions:\n<Picture 1> is the storyboard.\n\nsummary:\n[reference generation] A door opens.\n\nretention_analysis:\n<Picture 1>: partially_preserved.\n\ndetailed_description:\n[Shot 1] The door slowly opens. Keep its bottom edge touching the floor throughout.\n\noverall_soundscape:\nQuiet room tone.\n\nnon_diegetic_music:\nN/A\n";
        writeFileSync(promptFile, finalPrompt);
        reconcileDirectorProjectFiles(userId, projectId);
        const promptSource = readDirectorVideoPrompt(userId, projectId, segment.id);
        syncDirectorVideoSegmentFile(userId, projectId, segment.id);
        assert.equal(readFileSync(promptFile, "utf8"), finalPrompt, "同步不能覆盖Agent最终提示");
        const preflight = await api(`/director/production-tasks/${segment.id}/preflight`, userOne);
        assert.equal(preflight.body.data.plan.recipe, "pdd-ref8");
        assert.equal(preflight.body.data.plan.outputFrames, 107);
        const { buildAgentToolDefinitions } = await import("./agent/mcp/index.js");
        const { agentScenes } = await import("./agent/scenes/index.js");
        const context = { session: { projectId }, run: { userId }, appendEvent: () => {} } as unknown as Parameters<typeof buildAgentToolDefinitions>[0];
        const validateTool = buildAgentToolDefinitions(context, agentScenes.director).find((tool) => tool.name === "director_preflight_tasks")!;
        const agentPreflight = async () => {
            const result = await validateTool.handler({ taskPaths: [`productions/${segment.id}/task.md`] });
            assert.equal(result.isError, undefined, JSON.stringify(result));
            return JSON.parse((result.content[0] as { text: string }).text).data[0];
        };
        const accelerated = await agentPreflight();
        assert.equal(accelerated.plan.recipe, "pdd-ref8");
        assert.deepEqual(accelerated.finalPrompt, { path: promptSource.path, hash: promptSource.hash });
        assert.deepEqual(accelerated.plan, preflight.body.data.plan);

        for (const recipe of [undefined, "base"] as const) {
            const result = await generate(recipe);
            assert.equal(result.response.status, 201, JSON.stringify(result.body));
            const params = result.body.data.request.params;
            const { getDirectorGenerationTasks } = await import("./agent/director-tools.js");
            assert.equal((getDirectorGenerationTasks(userId, projectId, { id: result.body.data.id }) as { id: string }).id, result.body.data.id);
            assert.equal(result.body.data.request.prompt, finalPrompt, "官方格式最终稿必须逐字提交而非重新编译");
            assert.equal(result.body.data.request.metadata.directorSegment.promptHash, promptSource.hash);
            assert.equal(result.body.data.request.metadata.directorSegment.promptPath, promptSource.path);
            assert.equal(readFileSync(promptFile, "utf8"), finalPrompt, "生成回写不能清空提示文件");
            assert.equal(params.recipe, recipe || "pdd-ref8");
            assert.equal(params.seed, 42);
            assert.equal(Object.keys(params).some((key) => key.startsWith("__")), false);
            const stored = db.prepare("SELECT request FROM generations WHERE id=? AND user_id=?").get(result.body.data.id, userId) as { request: string };
            assert.deepEqual(JSON.parse(stored.request).params, params);
        }
        ready = false;
        await settings.refreshMediaExecutorCatalog();
        const fallback = await generate();
        assert.equal(fallback.response.status, 201, JSON.stringify(fallback.body));
        assert.equal(fallback.body.data.request.params.recipe, "base");
        const basePreflight = await agentPreflight();
        assert.equal(basePreflight.plan.recipe, "base");
        assert.equal(basePreflight.plan.width, 864);
        const count = () => (db.prepare("SELECT count(*) AS count FROM generations WHERE user_id=?").get(userId) as { count: number }).count;
        const beforeRejected = count();
        assert.equal((await generate("pdd-ref8")).response.status, 409);
        assert.equal(count(), beforeRejected);
    } finally {
        settings.saveMediaExecutorSettings(original);
        await settings.refreshMediaExecutorCatalog();
        await new Promise<void>((resolve) => executor.close(() => resolve()));
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

type TestSseEvent = { type?: string; session?: { id?: string }; events?: Array<{ payload: Record<string, unknown> }> };

async function* sseEvents(response: Response): AsyncGenerator<TestSseEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
            if (data) yield JSON.parse(data) as TestSseEvent;
            boundary = buffer.indexOf("\n\n");
        }
    }
}

async function nextSseMatching(stream: AsyncGenerator<TestSseEvent>, predicate: (event: TestSseEvent) => boolean) {
    let timer: ReturnType<typeof setTimeout>;
    try {
        return await Promise.race([
            (async () => {
                for await (const event of stream) if (predicate(event)) return event;
                throw new Error("SSE 已提前断开");
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("等待 SSE 事件超时")), 1000); }),
        ]);
    } finally {
        clearTimeout(timer!);
    }
}

test("画布与导演支持 Codex 会话，默认内置引擎且不允许跨用户或分叉", async () => {
    const projectId = "codex-engine-test";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "Codex 验收", kind: "director" }) });
    const standard = await api(`/agent/projects/${projectId}/sessions`, userOne, { method: "POST", body: "{}" });
    assert.equal(standard.body.data.engine, "builtin");
    const codex = await api(`/agent/projects/${projectId}/sessions`, userOne, { method: "POST", body: JSON.stringify({ engine: "codex" }) });
    assert.equal(codex.response.status, 201);
    assert.equal(codex.body.data.engine, "codex");
    assert.equal((await api(`/agent/sessions/${codex.body.data.id}/fork`, userOne, { method: "POST", body: "{}" })).response.status, 409);
    assert.equal((await api(`/agent/projects/${projectId}/conversation?sessionId=${codex.body.data.id}`, userTwo)).response.status, 404);
    const canvas = await api("/agent/projects/project-1/sessions", userOne, { method: "POST", body: JSON.stringify({ engine: "codex" }) });
    assert.equal(canvas.response.status, 201);
    assert.equal(canvas.body.data.engine, "codex");
    assert.equal((await api(`/agent/projects/project-1/conversation?sessionId=${canvas.body.data.id}`, userTwo)).response.status, 404);
    const canvasCapabilities = await api("/agent/projects/project-1/capabilities", userOne);
    assert.equal(canvasCapabilities.body.data.sceneId, "canvas");
    assert.ok(canvasCapabilities.body.data.engines.some((item: { id: string }) => item.id === "codex"));
    assert.equal((await api("/admin/ai/codex", userTwo)).response.status, 403);
    const capabilities = await api(`/agent/projects/${projectId}/capabilities`, userOne);
    assert.equal(capabilities.body.data.engines.find((item: { id: string }) => item.id === "codex").ready, false);
    assert.equal(capabilities.body.data.engines.find((item: { id: string }) => item.id === "builtin").ready, true);
});

test("Agent 同步索引早于文件监听时仍通知导演页面，重复读取不反复广播", async () => {
    const projectId = "codex-file-events-test";
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "文件变更", kind: "director" }) });
    const { ensureDirectorProjectWorkspace, reconcileDirectorProjectFiles, setDirectorWorkspaceEmitter } = await import("./director-workspace.js");
    const root = ensureDirectorProjectWorkspace(userOne["X-Trim-Userid"], projectId);
    let notifications = 0;
    setDirectorWorkspaceEmitter((_userId, id) => { if (id === projectId) notifications++; });
    try {
        writeFileSync(join(root, "story", "index.md"), "---\nid: story\nkind: story\nname: 文件变更\n---\n\n# 文件变更验收\n");
        reconcileDirectorProjectFiles(userOne["X-Trim-Userid"], projectId);
        assert.ok(notifications > 0, "主动同步索引也必须发布文件更新");
        const count = notifications;
        reconcileDirectorProjectFiles(userOne["X-Trim-Userid"], projectId);
        assert.equal(notifications, count, "重复读取同一索引不得引起刷新循环");
        const state = await api(`/director/projects/${projectId}`, userOne);
        assert.match(state.body.data.documents.find((item: { kind: string }) => item.kind === "story").content, /文件变更验收/);
        const prop = join(root, "assets", "props", "blue-umbrella");
        mkdirSync(prop, { recursive: true });
        writeFileSync(join(prop, "prop.md"), "---\nid: blue-umbrella\nkind: prop\nname: 蓝伞\n---\n\n# 描述\n蓝色雨伞\n");
        reconcileDirectorProjectFiles(userOne["X-Trim-Userid"], projectId);
        const assets = await api(`/projects/${projectId}/creative-assets`, userOne);
        assert.equal(assets.response.status, 200, "文件新建素材必须满足业务读取结构");
        assert.deepEqual(assets.body.data[0].payload.mediaDrafts.image, { prompt: "", model: null, params: {} });
        assert.equal((await api(`/agent/projects/${projectId}/references`, userOne)).response.status, 200);
    } finally { setDirectorWorkspaceEmitter(() => {}); }
});


test("Skill 文件样例投影来源和 H3 字段，时间线使用相对媒体路径且往返稳定", async () => {
    const { ensureDirectorProjectWorkspace, reconcileDirectorProjectFiles, validateDirectorProject, syncDirectorVideoSegmentFile, syncDirectorTimelineFile } = await import("./director-workspace.js");
    const { parse, stringify } = await import("yaml");
    const { default: matter } = await import("gray-matter");
    const projectId = "director-file-contract-test", userId = userOne["X-Trim-Userid"];
    await api("/projects", userOne, { method: "POST", body: JSON.stringify({ id: projectId, title: "格式样例", kind: "director" }) });
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const skill = (path: string) => new URL(`./agent/scenes/director/skills/${path}`, import.meta.url);
    const sequence = join(root, "storyboards/seq-001-station"), segment = join(root, "productions/task-001");
    mkdirSync(join(sequence, "shot-001"), { recursive: true });
    copyFileSync(skill("director-plan-storyboards/references/examples/shot.md"), join(sequence, "shot-001/shot.md"));
    mkdirSync(segment, { recursive: true });
    copyFileSync(skill("director-plan-storyboards/references/examples/sequence.md"), join(sequence, "sequence.md"));
    for (const file of ["task.md", "storyboard.yaml"]) copyFileSync(skill(`director-plan-storyboards/references/examples/${file}`), join(segment, file));
    copyFileSync(skill("director-breakdown-screenplay/references/scene-example.md"), join(root, "screenplay/breakdown/scene-001.md"));
    writeFileSync(join(root, "screenplay/breakdown/overview.md"), "---\nid: screenplay-breakdown\nkind: screenplay-breakdown\nreviewIssues: []\n---\n测试拆解\n");
    writeFileSync(join(segment, "storyboard-prompt.md"), "A single 2x2 storyboard sheet showing a wooden door opening.");
    const timelineFile = join(root, "timeline/timeline.json");
    const audioPath = join(segment, "model-audio.wav");
    await promisify(execFileCallback)("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", audioPath]);
    const exampleEdit = JSON.parse(readFileSync(skill("director-arrange-timeline/references/timeline.json"), "utf8"));
    exampleEdit.tracks[0].clips[0].path = "productions/task-001/model-audio.wav";
    writeFileSync(timelineFile, JSON.stringify(exampleEdit));
    assert.equal(validateDirectorProject(userId, projectId).valid, true, JSON.stringify(validateDirectorProject(userId, projectId).diagnostics));
    assert.equal(reconcileDirectorProjectFiles(userId, projectId).some((item) => item.severity === "error"), false);
    const readSegment = () => JSON.parse((db.prepare("SELECT payload FROM director_shots WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string }).payload);
    const payload = readSegment();
    assert.deepEqual(payload.shotIds, ["shot-001"]);
    const designs = (await api(`/director/projects/${projectId}/shots`, userOne)).body.data.items;
    assert.equal(designs[0].sourceSceneId, "breakdown-scene-001");
    assert.deepEqual(designs[0].sourceBeatIds, ["beat-001"]);
    assert.equal(payload.storyboardSheet.frames[3].position, 3);
    const timeline = db.prepare("SELECT payload,revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string; revision: number };
    assert.ok(JSON.parse(timeline.payload).tracks[0].clips[0].fileId);
    assert.equal(JSON.parse(timeline.payload).tracks[0].clips[0].path, undefined);
    syncDirectorTimelineFile(userId, projectId, JSON.parse(timeline.payload));
    assert.equal(JSON.parse(readFileSync(timelineFile, "utf8")).tracks[0].clips[0].path, "productions/task-001/model-audio.wav");
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal((db.prepare("SELECT revision FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { revision: number }).revision, timeline.revision);
    syncDirectorVideoSegmentFile(userId, projectId, "task-001");
    assert.deepEqual(matter(readFileSync(join(segment, "task.md"), "utf8")).data.shotIds, ["shot-001"]);
    const zipResponse = await fetch(`${origin}/director/projects/${projectId}/export`, { headers: userOne });
    assert.equal(zipResponse.status, 200);
    const importedResponse = await fetch(`${origin}/director/projects/import`, { method: "POST", headers: { ...userOne, "Content-Type": "application/zip" }, body: new Uint8Array(await zipResponse.arrayBuffer()) });
    const imported = await importedResponse.json() as { data: { projectId: string } };
    assert.equal(importedResponse.status, 201, JSON.stringify(imported));
    const importedState = (await api(`/director/projects/${imported.data.projectId}`, userOne)).body.data;
    assert.equal(importedState.timeline.payload.videoClips[0].taskId, importedState.videoSegments[0].id);
    assert.notEqual(importedState.videoSegments[0].id, "task-001", "同名工程实体必须隔离");
    assert.deepEqual(importedState.videoSegments[0].payload.shotIds, ["shot-001"]);
    assert.equal(importedState.timeline.payload.tracks[0].clips[0].taskId, importedState.videoSegments[0].id);
    assert.notEqual(importedState.timeline.payload.tracks[0].clips[0].fileId, JSON.parse(timeline.payload).tracks[0].clips[0].fileId);
    writeFileSync(join(segment, "storyboard.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZ0AAAAASUVORK5CYII=", "base64"));
    reconcileDirectorProjectFiles(userId, projectId);
    const imageId = readSegment().storyboardSheet.imageFileId;
    const board = parse(readFileSync(join(segment, "storyboard.yaml"), "utf8"));
    board.frames[1].action = "The wooden door begins to swing slowly.";
    writeFileSync(join(segment, "storyboard.yaml"), stringify(board));
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal(readSegment().storyboardStale, true);
    assert.ok(!(await api(`/director/production-tasks/task-001/preflight`, userOne)).body.data.blockedReasons.includes("故事板提示词已经修改，请先重新生成整张故事板"), "可选故事板过期不阻断独立任务输入");
    assert.equal(readSegment().storyboardSheet.imageFileId, imageId, "语义变更保留旧媒体并标记过期");
    const { createHash } = await import("node:crypto");
    const acceptancePath = join(segment, "quality-review.md");
    const acceptCurrent = () => writeFileSync(acceptancePath, matter.stringify("已检查整张图，当前修订仅校正描述，成图仍符合动作与连续性。", { id: "segment-001-review", kind: "media-review", status: "accepted", acceptedInputs: Object.fromEntries(Object.entries({ image: "storyboard.png", storyboard: "storyboard.yaml", prompt: "storyboard-prompt.md", segment: "task.md" }).map(([key, name]) => [key, createHash("sha256").update(readFileSync(join(segment, name))).digest("hex")])) }));
    acceptCurrent();
    const acceptanceDiagnostics = reconcileDirectorProjectFiles(userId, projectId);
    assert.equal(readSegment().storyboardStale, false, JSON.stringify(acceptanceDiagnostics));
    assert.equal(readSegment().storyboardSheet.imageFileId, imageId);
    syncDirectorVideoSegmentFile(userId, projectId, "task-001");
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal(readSegment().storyboardStale, false, "无创作变更的媒体同步不得使采用失效");
    board.frames[1].action = "The door pauses halfway open.";
    writeFileSync(join(segment, "storyboard.yaml"), stringify(board));
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal(readSegment().storyboardStale, true, "后续修改不能复用旧采用记录");
    acceptCurrent();
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal(readSegment().storyboardStale, false);
    writeFileSync(acceptancePath, "---\nid: segment-001-review\nkind: media-review\nstatus: accepted\n---\n未绑定文件的文字不能放行\n");
    reconcileDirectorProjectFiles(userId, projectId);
    assert.equal(readSegment().storyboardStale, true, "删除哈希绑定不能保留放行状态");
    board.frames[2].dialogues = [{ speakerAssetId: "unknown", speakerName: "未知", text: "你好", language: "zh-CN", delivery: "quiet", startSeconds: 4, endSeconds: 9 }];
    writeFileSync(join(segment, "storyboard.yaml"), stringify(board));
    const invalid = validateDirectorProject(userId, projectId);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.diagnostics.some((item) => item.code === "DIALOGUE_WINDOW" && item.path.endsWith("storyboard.yaml")));
    assert.ok(invalid.diagnostics.some((item) => item.code === "DIALOGUE_SPEAKER"));
    reconcileDirectorProjectFiles(userId, projectId);
    assert.deepEqual(readSegment().storyboardSheet.frames[2].dialogues, [], "损坏文件不能覆盖可用投影");
});
