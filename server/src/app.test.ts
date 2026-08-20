import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import PDFDocument from "pdfkit";
import AdmZip from "adm-zip";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-server-"));
process.env.DATA_DIR = testData;
process.env.AUTH_MODE = "fnos";
process.env.APP_SECRET = "test-secret";

const [{ app }, { db }, { parseGatewayUser }, { applyCanvasOps, createAgentCreativeAssetBatch, createTextNodes }, { isRetriableAgentDiagnostic, recoverAgentRuns, resolveAgentNativeTools, resolveAgentToolSearchMode }, { parseSkillAllowedTools, syncBuiltInAgentSkills }, { providerInputSchema }, { agentScenes }, { updateDirectorStoryboardPrompts }, { listDirectorVideoSegments }] = await Promise.all([import("./app.js"), import("./database.js"), import("./auth.js"), import("./agent/canvas-tools.js"), import("./agent/service.js"), import("./agent/skill-registry.js"), import("./provider-service.js"), import("./agent/scenes/index.js"), import("./director-render.js"), import("./director.js")]);
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
    assert.equal(agentScenes.director.skillIds.length, 15);
    assert.equal(agentScenes.director.skillIds.includes("director-write-story"), true);
    assert.equal(agentScenes.canvas.skillIds.includes("director-write-story"), false);
    assert.equal(agentScenes.canvas.tools.some((item) => item.id.startsWith("director_")), false);
    assert.equal(agentScenes.director.tools.some((item) => item.id.startsWith("canvas_") || item.id.startsWith("creative_asset") || item.id.startsWith("visual_style") || String(item.id) === "site_navigate"), false);
    assert.equal(agentScenes.director.tools.map((item) => String(item.id)).some((id) => id === "director_list_video_segments" || id === "director_update_video_segment"), false, "导演内容读写应使用受控文件工具，不再暴露语义 CRUD");
    assert.equal(agentScenes.director.tools.some((item) => item.id === "director_generate_video_segment"), true);
});

test("项目工作区只同步当前 Agent 场景 Skills 并清理旧场景", () => {
    const workspace = mkdtempSync(join(testData, "scene-skills-"));
    syncBuiltInAgentSkills(workspace, agentScenes.canvas.skillIds);
    assert.deepEqual(readdirSync(join(workspace, ".claude", "skills")).filter((name) => !name.startsWith(".")).sort(), [...agentScenes.canvas.skillIds].sort());
    syncBuiltInAgentSkills(workspace, agentScenes.director.skillIds);
    const directorSkills = readdirSync(join(workspace, ".claude", "skills")).filter((name) => !name.startsWith(".")).sort();
    assert.deepEqual(directorSkills, [...agentScenes.director.skillIds].sort());
    assert.equal(directorSkills.includes("write-story"), false);
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
    assert.deepEqual(initial.body.data.workspace.directingRules, { photography: "", performance: "", pacing: "", sound: "", prohibitions: "" });
    const directingPlan = await api(`/director/projects/${projectId}/workspace`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, directingRules: { photography: "稳定观察人物与空间", performance: "克制生活化", pacing: "完整动作优先", sound: "环境声维持空间连续", prohibitions: "禁止无意义慢动作" } }) });
    assert.equal(directingPlan.response.status, 200);
    assert.equal(directingPlan.body.data.revision, 2);
    assert.equal(directingPlan.body.data.directingRules.performance, "克制生活化");

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
    const segment = await api(`/director/projects/${projectId}/video-segments`, userOne, { method: "POST", body: JSON.stringify({ sequenceId: sequence.body.data.id, title: "车站全景", payload: { durationSeconds: 8, boundary: "cut", characterRefs: [{ id: "character-stable-id", revision: 3 }] } }) });
    assert.equal(segment.response.status, 201);
    assert.equal(segment.body.data.payload.storyboardFrameCount, 6);
    assert.equal(segment.body.data.payload.storyboardSheet.layout, "3x2");
    assert.equal(segment.body.data.payload.storyboardSheet.frames.length, 6);
    const laterSequence = await api(`/director/projects/${projectId}/sequences`, userOne, { method: "POST", body: JSON.stringify({ id: "a-later-sequence", position: 1, title: "清晨离站" }) });
    await api(`/director/projects/${projectId}/video-segments`, userOne, { method: "POST", body: JSON.stringify({ id: "a-later-segment", sequenceId: laterSequence.body.data.id, position: 0, title: "清晨站台", payload: { durationSeconds: 4, sourceSceneId: "S002", sourceBeatIds: ["S002-B01"], sourceDurationSeconds: 4, dramaticBeat: "林夏决定离开车站", openingState: "林夏停在空荡站台", endingState: "林夏提起行李走向出口" } }) });
    const orderedState = await api(`/director/projects/${projectId}`, userOne);
    assert.deepEqual(orderedState.body.data.videoSegments.map((item: { title: string }) => item.title), ["车站全景", "清晨站台"], "视频段必须按剧情段落位置和段内位置排序，而不是按随机 ID 排序");
    const promptSegment = orderedState.body.data.videoSegments[1];
    const originalSheet = { ...promptSegment.payload.storyboardSheet, imageFileId: "existing-sheet", generationId: "existing-generation", promptSnapshot: "old prompt", frames: promptSegment.payload.storyboardSheet.frames.map((frame: Record<string, unknown>, index: number) => ({ ...frame, croppedFileId: `crop-${index}` })) };
    db.prepare("UPDATE director_shots SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...promptSegment.payload, storyboardSheet: originalSheet, videoFileId: "existing-video" }), promptSegment.id, userOne["X-Trim-Userid"]);
    const promptUpdate = updateDirectorStoryboardPrompts(userOne["X-Trim-Userid"], projectId, { items: [{ segmentId: promptSegment.id, revision: 1, frames: originalSheet.frames.map((frame: Record<string, unknown>, index: number) => ({ id: frame.id, shotNumber: Number(frame.shotNumber || 1), timeSeconds: Number(frame.timeSeconds || 0), kind: String(frame.kind || "keyframe"), description: `画格 ${index + 1} 的明确画面`, action: "人物沿站台向前行走", cameraAngle: "平视中景", cameraMove: "缓慢跟拍", h3Visual: "A medium tracking shot follows the person walking forward along the wet platform.", dialogues: [], sound: "rainfall and synchronized footsteps" })) }] });
    assert.equal(promptUpdate.updated, 1);
    const updatedPromptSegment = (await api(`/director/projects/${projectId}`, userOne)).body.data.videoSegments[1];
    assert.equal(updatedPromptSegment.payload.storyboardSheet.imageFileId, "existing-sheet", "安全提示词更新必须保留故事板媒体");
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
    const storyboardWithoutStyle = await api(`/director/video-segments/${segment.body.data.id}/storyboard/generate`, userOne, { method: "POST", body: JSON.stringify({ revision: 1 }) });
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
    const lockedShot = await api(`/director/video-segments/${segment.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "locked" }) });
    assert.equal(lockedShot.response.status, 200);
    const rejectedLockedEdit = await api(`/director/video-segments/${segment.body.data.id}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, title: "未经审批的改名" }) });
    assert.equal(rejectedLockedEdit.response.status, 423);
    await api(`/director/projects/${projectId}/documents/story`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, content: "# 故事\n林夏在雪夜追查旧怀表。" }) });
    const stale = await api(`/director/projects/${projectId}`, userOne);
    assert.equal(stale.body.data.sequences[0].payload.needsReview, true);
    assert.equal(stale.body.data.videoSegments[0].payload.needsReview, true);
    const revisedDirection = await api(`/director/projects/${projectId}/workspace`, userOne, { method: "PUT", body: JSON.stringify({ revision: 2, directingRules: { pacing: "关键反应后保留停顿" } }) });
    assert.equal(revisedDirection.response.status, 200);
    assert.equal(revisedDirection.body.data.directingRules.photography, "稳定观察人物与空间", "局部更新导演规则必须保留其他字段");
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
    const validation = await api(`/director/projects/${projectId}/validate`, userOne, { method: "POST", body: JSON.stringify({}) });
    assert.equal(validation.body.data.valid, true);

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

    const malicious = new AdmZip();
    malicious.addFile("/escape.txt", Buffer.from("escape"));
    const rejected = await fetch(`${origin}/director/projects/import`, { method: "POST", headers: { ...userOne, "Content-Type": "application/zip" }, body: new Uint8Array(malicious.toBuffer()) });
    assert.equal(rejected.status, 400);
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

    const firstView = await api(`/creative-assets/${assetId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 120, y: 160 }) });
    const secondView = await api(`/creative-assets/${assetId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 520, y: 160 }) });
    assert.notEqual(firstView.body.data.nodeId, secondView.body.data.nodeId);
    const project = await api("/projects/project-1", userOne);
    assert.equal(project.body.data.nodes.filter((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === assetId).length, 2);
    assert.equal(project.body.data.nodes.some((node: { type: string; title: string }) => node.type === "group" && node.title === "角色设定"), false);
    const businessNode = project.body.data.nodes.find((node: { id: string }) => node.id === firstView.body.data.nodeId);
    assert.deepEqual({ type: businessNode.type, width: businessNode.width, height: businessNode.height }, { type: "character", width: 420, height: 540 });

    const disposable = await api("/projects/project-1/creative-assets", userOne, { method: "POST", body: JSON.stringify({ kind: "character", name: "删除即消失", payload: { description: "临时角色" } }) });
    const disposableId = disposable.body.data.id;
    const disposableViewA = await api(`/creative-assets/${disposableId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 80, y: 900 }) });
    await api(`/creative-assets/${disposableId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 520, y: 900 }) });
    const beforeNodeDelete = await api("/projects/project-1", userOne);
    const nodeDelete = await api("/projects/project-1/nodes", userOne, { method: "DELETE", body: JSON.stringify({ ids: [disposableViewA.body.data.nodeId], revision: beforeNodeDelete.body.data.revision }) });
    assert.equal(nodeDelete.response.status, 200);
    assert.equal(nodeDelete.body.data.nodes.some((node: { metadata?: { assetId?: string } }) => node.metadata?.assetId === disposableId), false);
    assert.equal((await api(`/creative-assets/${disposableId}`, userOne)).response.status, 404);

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
    assert.equal(created.body.data.status, "draft");
    assert.equal(created.body.data.dna.medium, "");
    const styleId = created.body.data.id;
    assert.equal((await api(`/visual-styles/${styleId}`, userTwo)).response.status, 404);

    const placed = await api(`/visual-styles/${styleId}/place`, userOne, { method: "POST", body: JSON.stringify({ x: 100, y: 200 }) });
    assert.equal(placed.response.status, 201);
    assert.equal((await api(`/visual-styles/${styleId}/default`, userOne, { method: "POST" })).response.status, 409);
    const confirmed = await api(`/visual-styles/${styleId}`, userOne, { method: "PUT", body: JSON.stringify({ revision: 1, status: "confirmed" }) });
    assert.equal(confirmed.response.status, 200);
    await api(`/visual-styles/${styleId}/default`, userOne, { method: "POST" });
    const project = await api(`/projects/${projectId}`, userOne);
    assert.equal(project.body.data.defaultVisualStyleId, styleId);
    assert.equal(project.body.data.nodes.some((node: { metadata?: { visualStyleId?: string } }) => node.metadata?.visualStyleId === styleId), true);

    assert.equal((await api(`/visual-styles/${styleId}`, userOne, { method: "DELETE" })).response.status, 200);
    const deleted = await api(`/projects/${projectId}`, userOne);
    assert.equal(deleted.body.data.defaultVisualStyleId, null);
    assert.equal(deleted.body.data.nodes.some((node: { metadata?: { visualStyleId?: string } }) => node.metadata?.visualStyleId === styleId), false);
});

test("内置视觉风格提供原创预览和完整 DNA，创建时展开为项目快照", async () => {
    const templates = (await api("/visual-style-templates", userOne)).body.data as Array<{ id: string; category: string; preview: string; tagline: string; description: string; dna: Record<string, string | string[]> }>;
    assert.equal(templates.length, 25);
    assert.deepEqual(new Set(templates.map((item) => item.category)), new Set(["cinematic", "genre", "eastern", "animation", "handmade", "graphic"]));
    assert.equal(templates.every((item) => item.preview === `visual-styles/${item.id}.webp` && item.tagline && item.description), true);
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

test("导演风格修改后旧统一风格板会标记过期", async () => {
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
    assert.equal(stale.body.data.referenceFileId, null, "旧风格板不得继续作为当前风格参考");
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
    assert.equal(capabilities.body.data.skills.some((skill: { id: string }) => skill.id === "write-story"), true);
    assert.equal(capabilities.body.data.skills.some((skill: { id: string }) => skill.id === "media-understand"), true);
    assert.equal((await api("/agent/projects/project-1/capabilities", userTwo)).response.status, 404);
    const directorCapabilities = await api("/agent/projects/director-project-1/capabilities", userOne);
    assert.equal(directorCapabilities.body.data.sceneId, "director");
    assert.equal(directorCapabilities.body.data.skills.every((skill: { id: string }) => skill.id === "media-understand" || skill.id.startsWith("director-")), true);
    assert.equal(directorCapabilities.body.data.skills.some((skill: { id: string }) => skill.id === "media-understand"), true);
    assert.equal(directorCapabilities.body.data.skills.some((skill: { id: string }) => skill.id === "write-story"), false);
    const directorReferences = await api("/agent/projects/director-project-1/references?limit=100", userOne);
    assert.equal(directorReferences.response.status, 200);
    assert.equal(directorReferences.body.data.some((item: { segment: { type: string } }) => item.segment.type === "canvas"), false);
    const directorProjectBefore = JSON.parse((db.prepare("SELECT payload FROM projects WHERE id='director-project-1'").get() as { payload: string }).payload);
    const directorAsset = createAgentCreativeAssetBatch("user-1", "director-project-1", [{ kind: "prop", name: "导演测试道具", payload: { description: "只属于导演资产" } }], undefined, false)[0];
    const directorProjectAfter = JSON.parse((db.prepare("SELECT payload FROM projects WHERE id='director-project-1'").get() as { payload: string }).payload);
    assert.equal(directorAsset.name, "导演测试道具");
    assert.deepEqual(directorProjectAfter, directorProjectBefore);
    const forgedCanvasSkill = await api("/agent/projects/director-project-1/messages", userOne, { method: "POST", body: JSON.stringify({ clientMessageId: "forged-canvas-skill", submissionMode: "direct", content: { version: 1, segments: [{ type: "skill", mentionId: "skill-1", skillId: "write-story" }] } }) });
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

test("固定 ComfyUI 工作流由后端执行并持久化结果", async () => {
    let promptCounter = 0;
    const fakeComfy = createServer((request, response) => {
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname === "/system_stats") return json(response, { system: {} });
        if (url.pathname === "/upload/image") return json(response, { name: "uploaded.png" });
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
        await api("/admin/comfyui/servers", userOne, { method: "POST", body: JSON.stringify({ name: "测试节点", url: `http://127.0.0.1:${address.port}`, enabled: true, models: ["hidream-o1-full-fp8-local", "qwen-image-edit-2511-local", "realesrgan-x4-local"] }) });
        const ordinaryModels = await api("/ai/models", userTwo);
        assert.equal(JSON.stringify(ordinaryModels.body).includes(String(address.port)), false);
        assert.equal(ordinaryModels.body.data.some((model: { id: string }) => model.id === "hidream-o1-full-fp8-local"), true);
        assert.deepEqual(ordinaryModels.body.data.find((model: { id: string }) => model.id === "qwen-image-edit-2511-local").imageModes, ["edit"]);
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
