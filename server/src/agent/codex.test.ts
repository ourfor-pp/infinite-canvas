import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { z } from "zod";
import { CodexRpc, sandboxArguments } from "./codex/process.js";
const root = mkdtempSync(join(tmpdir(), "director-codex-test-"));
process.env.DATA_DIR = root;
const [{ db }, { serveDirectorMcp }, { CodexRuntime }, { syncBuiltInAgentSkills }, { agentScenes }] = await Promise.all([
    import("../database.js"), import("./codex/mcp.js"), import("./codex/runtime.js"), import("./skill-registry.js"), import("./scenes/index.js"),
]);
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
function fakeRpc(mode = "complete", capturePath = "") {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { createInterface } from 'node:readline';
        import { appendFileSync } from 'node:fs';
        const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
        createInterface({input:process.stdin}).on('line', line => {
            const m=JSON.parse(line); if (!m.id) return;
            if (m.id === 'question-1' && m.result) {
                if (m.result.answers.choice.answers[0] !== '继续') process.exit(2);
                send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:'已收到回答'}}});
                send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}}); return;
            }
            if (${JSON.stringify(capturePath)}) appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify(m) + "\\n");
            if (m.method === 'thread/resume' && ${JSON.stringify(mode)} === 'disconnect') { process.exit(0); return; }
            if (m.method === 'turn/start' && ${JSON.stringify(mode)} === 'disconnect-after-submit') { process.exit(0); return; }
            if (m.method === 'thread/resume' && ${JSON.stringify(mode)} === 'missing') { send({id:m.id,error:{message:'thread not found'}}); return; }
            if (m.method === 'hang') return;
            send({id:m.id,result:m.method.startsWith('thread/') ? {thread:{id:'thread-1'}} : m.method==='turn/start' ? {turn:{id:'turn-1'}} : {}});
            if (m.method==='turn/start') {
                if (${JSON.stringify(mode)} === 'question') { send({id:'question-1',method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',questions:[{id:'choice',header:'验收',question:'继续吗？',options:[{label:'继续',description:'继续验收'},{label:'停止',description:'结束验收'}]}]}}); return; }
                send({method:'turn/started',params:{threadId:'thread-1',turn:{id:'turn-1'}}});
                send({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'old-turn',itemId:'wrong',delta:'串回合'}});
                for (const delta of ['正文','草稿']) send({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'answer',delta}});
                send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'mcp-1',type:'mcpToolCall'}}});
                if (${JSON.stringify(mode)} === 'image') {
                    send({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'image-1',type:'imageGeneration',status:'in_progress'}}});
                    for(let i=0;i<2;i++) send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'image-1',type:'imageGeneration',status:'completed',savedPath:'/codex-home/generated_images/test.png',result:'base64-must-not-be-persisted'}}});
                }
                if (${JSON.stringify(mode)} === 'activity') {
                    if (m.params.summary !== 'concise') process.exit(2);
                    send({method:'item/reasoning/summaryTextDelta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'reason-1',summaryIndex:0,delta:'检查素材'}});
                    send({method:'item/reasoning/summaryPartAdded',params:{threadId:'thread-1',turnId:'turn-1',itemId:'reason-1',summaryIndex:1}});
                    send({method:'item/reasoning/summaryTextDelta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'reason-1',summaryIndex:1,delta:'核对风格'}});
                    send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'reason-1',type:'reasoning',summary:['检查素材','核对风格']}}});
                    send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'reason-empty',type:'reasoning',summary:[]}}});
                    for (const type of ['imageView','contextCompaction']) for (const phase of ['started','completed']) send({method:'item/'+phase,params:{threadId:'thread-1',turnId:'turn-1',item:{id:type,type,path:type==='imageView'?'assets/primary.png':undefined}}});
                }
                send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:'正文草稿'}}});
                setTimeout(()=>send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}}),30);
            }
        });
    `], { stdio: "pipe", env: { PATH: "/usr/bin:/bin" } });
    child.stderr.on("data", (data) => process.stderr.write(data));
    return new CodexRpc(child);
}
test("RPC 请求超时不污染后续响应，关闭会拒绝挂起请求", async () => {
    const rpc = fakeRpc();
    try {
        await rpc.initialize();
        await assert.rejects(rpc.request("hang", {}, 10), /超时/);
        assert.deepEqual(await rpc.request("echo"), {});
        const pending = rpc.request("hang"); rpc.close();
        await assert.rejects(pending, /关闭/);
    } finally { rpc.close(); }
});
function runtime(mode: string, events: Array<{ kind: string; payload: Record<string, unknown> }>, released: () => void) {
    return new CodexRuntime({ sessionId: "s", runId: "r", workspace: root, threadId: mode === "missing" ? "missing" : null, prompt: "写草稿", instructions: "导演", tools: [], signal: new AbortController().signal,
        bindThread: (id) => assert.equal(id, "thread-1"), bindTurn: (id) => assert.equal(id, "turn-1"), append: (kind, payload) => events.push({ kind, payload }), ask: async () => ({}), image: (path) => ({ fileId: "native-image", path }) },
    { ready: async () => {}, settings: () => ({ enabled: true, binary: "/usr/bin/codex", model: "" }), bridge: async () => ({ url: "http://127.0.0.1/mcp", token: "test", close: released }), start: () => fakeRpc(mode) });
}
test("Codex 事件按原生 item 聚合，忽略旧回合和重复 MCP 卡片", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    let released = false;
    const runner = runtime("complete", events, () => { released = true; });
    await runner.run();
    assert.equal(released, true);
    assert.deepEqual(events, [{ kind: "assistant_text", payload: { itemId: "answer", streamId: "r:answer", text: "正文草稿", delta: false } }]);
    assert.equal(await runner.steer("补充", () => assert.fail("已结束的回合不能接收补充")), false);
});
test("原生历史缺失明确失败并释放 MCP", async () => {
    let released = false;
    await assert.rejects(runtime("missing", [], () => { released = true; }).run(), /原生会话无法恢复，请新建对话/);
    assert.equal(released, true);
});
test("隔离挂载不接受用户目录程序；Codex Skills 不携带 Claude 权限元数据", () => {
    const script = join(root, "codex"); writeFileSync(script, "test");
    assert.throws(() => sandboxArguments(root, root, root, script), /必须安装在 \/usr/);
    syncBuiltInAgentSkills(root, agentScenes.director.skillIds, "codex");
    for (const id of agentScenes.director.skillIds) assert.doesNotMatch(readFileSync(join(root, ".agents", "skills", id, "SKILL.md"), "utf8"), /allowed-tools:/);
});
test("导演沙箱可实际生成并探测 PCM 音频，系统依赖仍只读", {
    skip: process.platform !== "linux" || !["/usr/bin/bwrap", "/usr/bin/ffmpeg", "/usr/bin/ffprobe", "/etc/alternatives"].every(existsSync),
}, () => {
    const workspace = join(root, "audio-workspace"), home = join(root, "audio-home"), policy = join(root, "audio-policy");
    for (const path of [workspace, home, policy, join(workspace, ".cache/codex-images")]) mkdirSync(path, { recursive: true });
    const run = (binary: string, args: string[]) => {
        const result = spawnSync("/usr/bin/bwrap", [...sandboxArguments(workspace, home, policy, binary), "--", binary, ...args], { encoding: "utf8", timeout: 30_000, env: { PATH: "/usr/bin:/bin" } });
        assert.equal(result.status, 0, result.stderr || String(result.error));
        return result.stdout;
    };
    run("/usr/bin/ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", "-ac", "2", "-ar", "32000", "/workspace/test.wav"]);
    const metadata = JSON.parse(run("/usr/bin/ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "json", "/workspace/test.wav"]));
    assert.deepEqual(metadata.streams, [{ codec_name: "pcm_s16le", sample_rate: "32000", channels: 2 }]);
    run("/usr/bin/sh", ["-c", "test ! -e /home/cec && test -d /etc/alternatives && ! touch /etc/alternatives/director-write-test"]);
});
test("标准 MCP 校验凭据、当前 run，并对生成重试只提交一次", async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users VALUES('u','test',0,?,?)").run(now, now);
    db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,created_at,updated_at) VALUES('p','u','director','test','{}',?,?)").run(now, now);
    db.prepare("INSERT INTO agent_sessions(id,user_id,project_id,title,status,current_run_id,engine,created_at,updated_at) VALUES('s','u','p','test','running','r','codex',?,?)").run(now, now);
    db.prepare("INSERT INTO agent_runs(id,session_id,user_id,status,model_ref,started_at) VALUES('r','s','u','running','test',?)").run(now);
    let calls = 0;
    const bridge = await serveDirectorMcp("s", "r", [{ name: "director_generate_asset", description: "test", inputSchema: { id: z.string() }, handler: async () => {
        calls++; await new Promise((resolve) => setTimeout(resolve, 30)); return { content: [{ type: "text", text: "task-1" }] };
    } }]);
    const request = (id: number, token = bridge.token, origin?: string) => fetch(bridge.url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...(origin ? { origin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "director_generate_asset", arguments: { id: "asset" } } }) });
    try {
        assert.equal((await request(1, "forged")).status, 403);
        assert.equal((await request(1, bridge.token, "https://evil.example")).status, 403);
        for (const response of await Promise.all([request(10), request(11)])) { assert.equal(response.status, 200); assert.equal((await response.json()).result.content[0].text, "task-1"); }
        assert.equal(calls, 1);
        assert.equal((await request(12)).status, 200); assert.equal(calls, 1);
        let attempts = 0;
        const retryBridge = await serveDirectorMcp("s", "r", [{ name: "director_generate_music", description: "test", inputSchema: {}, handler: async () => {
            attempts++;
            return attempts === 1 ? { isError: true, _meta: { directorRetrySafe: true }, content: [{ type: "text", text: "请先完成剧本" }] } : { content: [{ type: "text", text: "music-task" }] };
        } }]);
        try {
            for (const id of [20, 21, 22]) {
                const response = await fetch(retryBridge.url, { method: "POST", headers: { authorization: `Bearer ${retryBridge.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "director_generate_music", arguments: {} } }) });
                assert.equal((await response.json()).result.content[0].text, id === 20 ? "请先完成剧本" : "music-task");
            }
            assert.equal(attempts, 2, "前置条件拒绝可重试，成功后仍只提交一次");
        } finally { retryBridge.close(); }
        db.prepare("UPDATE agent_sessions SET current_run_id=NULL WHERE id='s'").run();
        assert.equal((await request(13)).status, 410);
    } finally { bridge.close(); }
});

test("导演素材、故事板与视频任务按当前项目查询，拒绝跨项目读取", async () => {
    const { generationStatus } = await import("./canvas-tools.js");
    const now = new Date().toISOString();
    for (const key of ["__creativeAsset", "__directorSegment", "__directorStoryboardSheet"]) {
        db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,created_at,updated_at) VALUES(?,'u','image','failed','test',?,?,?)").run(key, JSON.stringify({ params: { [key]: { projectId: "p" } } }), now, now);
        assert.equal((generationStatus("u", { id: key }, "p") as { id: string }).id, key);
        assert.throws(() => generationStatus("u", { id: key }, "other"), /不属于当前项目/);
        assert.throws(() => generationStatus("other-user", { id: key }, "p"), /不存在/);
    }
});

test("原生生图复用工具卡片与图片预览，完成通知重放不会重复登记或保存 base64", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    await runtime("image", events, () => {}).run();
    assert.equal(events.filter((item) => item.kind === "artifact").length, 1);
    assert.equal(events.filter((item) => item.kind === "tool_result" && item.payload.toolName === "Codex 原生生图").length, 1);
    assert.doesNotMatch(JSON.stringify(events), /base64-must-not-be-persisted/);
});

test("原生图片登记只读取当前作品图片缓存，拒绝认证路径和越界链接", async () => {
    const { registerCodexImage } = await import("./codex/images.js");
    const cache = join(root, ".cache/codex-images"); mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=", "base64"));
    const image = registerCodexImage("u", "p", root, "/codex-home/generated_images/image.png");
    assert.equal(image.mimeType, "image/png"); assert.ok(image.fileId); assert.equal(image.url, `/api/files/${image.fileId}/content`);
    assert.ok(db.prepare("SELECT 1 FROM file_refs WHERE file_id=? AND owner_type='agent_project' AND owner_id='p'").get(image.fileId));
    assert.throws(() => registerCodexImage("u", "p", root, "/codex-home/auth.json"), /图片目录/);
    symlinkSync(join(root, "app.db"), join(cache, "outside.png"));
    assert.throws(() => registerCodexImage("u", "p", root, "/codex-home/generated_images/outside.png"), /越界/);
});

test("Codex 场景只保留声音 MCP 生成，内置 Agent 继续保留图片工具", async () => {
    const { buildAgentToolDefinitions } = await import("./mcp/index.js");
    const context = { session: { projectId: "p" }, run: { userId: "u" } } as Parameters<typeof buildAgentToolDefinitions>[0];
    const native = buildAgentToolDefinitions(context, agentScenes.director, "codex");
    assert.ok(!native.some((tool) => ["director_generate_look_frame", "director_generate_style_references"].includes(tool.name)));
    const sound = z.object(native.find((tool) => tool.name === "director_generate_sound")!.inputSchema).strict();
    assert.equal(sound.safeParse({ assetPath: "assets/props/prop-1", expectedHash: "hash" }).success, true);
    assert.equal(sound.safeParse({ assetPath: "assets/props/prop-1", expectedHash: "hash", target: "primary-visual" }).success, false);
    const builtin = buildAgentToolDefinitions(context, agentScenes.director);
    assert.ok(builtin.some((tool) => tool.name === "director_generate_look_frame"));
});


test("Codex resume 连接失效时关闭旧进程并恢复同一 thread，最多重试一次", async () => {
    for (const mode of ["recover", "always-disconnect", "submitted"] as const) {
        let starts = 0, releases = 0;
        const runner = new CodexRuntime({ sessionId: "s", runId: "r", workspace: root, threadId: "thread-1", prompt: "继续草稿", instructions: "导演", tools: [], signal: new AbortController().signal,
            bindThread: (id) => assert.equal(id, "thread-1"), bindTurn: () => {}, append: () => {}, ask: async () => ({}) },
        { ready: async () => {}, settings: () => ({ enabled: true, binary: "/usr/bin/codex", model: "" }), bridge: async () => ({ url: "http://127.0.0.1/mcp", token: "test", close: () => { releases++; } }), start: () => {
            starts++;
            return fakeRpc(mode === "submitted" ? "disconnect-after-submit" : starts === 1 || mode === "always-disconnect" ? "disconnect" : "complete");
        } });
        if (mode === "recover") await runner.run();
        else await assert.rejects(runner.run(), /进程已退出/);
        assert.equal(starts, mode === "submitted" ? 1 : 2, "提交后断线不能盲目重放任务，启动阶段只重试一次");
        assert.equal(releases, starts);
    }
});


test("模型默认值按目录解析，拒绝失效模型和不支持的思考强度", async () => {
    const { resolveCodexOptions } = await import("./codex/settings.js");
    const catalog = { defaultModel: "a", models: [{ id: "a", name: "A", description: "", isDefault: true, defaultEffort: "medium", efforts: [{ id: "medium", description: "" }, { id: "high", description: "" }] }] };
    assert.deepEqual(resolveCodexOptions({}, catalog), { model: "a", effort: "medium" });
    assert.deepEqual(resolveCodexOptions({ model: "a", effort: "high" }, catalog), { model: "a", effort: "high" });
    assert.throws(() => resolveCodexOptions({ model: "removed" }, catalog), /已不可用/);
    assert.throws(() => resolveCodexOptions({ effort: "ultra" }, catalog), /不支持/);
});

test("续聊保持原 thread 并更新场景提示、模型与思考强度", async () => {
    const capture = join(root, "model-requests.jsonl");
    const instructions = agentScenes.canvas.systemPrompt("p", "codex");
    const runner = new CodexRuntime({ sessionId: "s", runId: "r", workspace: root, threadId: "thread-1", prompt: "继续", instructions, tools: [], options: { model: "chosen-model", effort: "high" }, signal: new AbortController().signal,
        bindThread: (id) => assert.equal(id, "thread-1"), bindTurn: () => {}, append: () => {}, ask: async () => ({}) },
    { ready: async () => {}, settings: () => ({ enabled: true, binary: "/usr/bin/codex", model: "admin-default" }), bridge: async () => ({ url: "http://127.0.0.1/mcp", token: "test", close: () => {} }), start: () => fakeRpc("complete", capture) });
    await runner.run();
    const requests = readFileSync(capture, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(requests.find((item) => item.method === "thread/resume").params.model, "chosen-model");
    assert.equal(requests.find((item) => item.method === "thread/resume").params.developerInstructions, instructions);
    const turn = requests.find((item) => item.method === "turn/start").params;
    assert.equal(turn.threadId, "thread-1"); assert.equal(turn.model, "chosen-model"); assert.equal(turn.effort, "high");
});


test("Codex 移除四项重复 MCP，内置 Agent 保留；同步 Skill 只引用原生看图与提问", async () => {
    const { buildAgentToolDefinitions } = await import("./mcp/index.js");
    const { sceneSkillIds } = await import("./scenes/index.js");
    const context = { session: { projectId: "p" }, run: { userId: "u" } } as Parameters<typeof buildAgentToolDefinitions>[0];
    const native = buildAgentToolDefinitions(context, agentScenes.director, "codex").map((tool) => tool.name);
    const builtin = buildAgentToolDefinitions(context, agentScenes.director).map((tool) => tool.name);
    for (const id of ["director_analyze_style", "director_navigate", "ask_user"]) {
        assert.ok(!native.includes(id)); assert.ok(builtin.includes(id));
    }
    assert.equal(new Set(native).size, native.length);
    for (const id of ["media_list_capabilities", "media_validate_generation", "media_generate", "media_get_generation_status", "media_save_result"]) assert.ok(native.includes(id));
    assert.ok(native.includes("director_generate_music"));
    assert.ok(native.includes("media_sample_video"));
    assert.ok(!native.includes("media_prepare_video_overview"));
    assert.ok(!native.includes("media_sample_video_frames"));
    for (const id of ["director_start_render", "director_cancel_render", "director_retry_render", "director_list_renders"]) assert.ok(native.includes(id));
    syncBuiltInAgentSkills(root, sceneSkillIds(agentScenes.director), "codex");
    for (const scene of [agentScenes.canvas, agentScenes.director]) {
        assert.equal(sceneSkillIds(scene).filter((id) => id === "media-generation").length, 1);
        assert.ok(!sceneSkillIds(scene).some((id) => id.startsWith("minimax-")));
    }
    const mediaSkill = join(root, ".agents", "skills", "media-generation");
    for (const reference of ["h3.md", "music3.md", "official-h3-prompt.md"]) assert.ok(existsSync(join(mediaSkill, "references", reference)));
    assert.match(readFileSync(join(mediaSkill, "SKILL.md"), "utf8"), /media_list_capabilities/);

    for (const id of sceneSkillIds(agentScenes.director)) {
        const content = readFileSync(join(root, ".agents", "skills", id, "SKILL.md"), "utf8");
        assert.doesNotMatch(content, /director_analyze_style|media_understand_images|director_navigate|ask_user/);
        assert.doesNotMatch(content, /## Codex 引擎媒体调用规则/);
    }
    assert.doesNotMatch(agentScenes.director.systemPrompt("p", "codex"), /ask_user|媒体理解和专用/);
    assert.match(agentScenes.director.systemPrompt("p", "builtin"), /ask_user/);
});

test("原生提问等待应用回答并回传 Codex 后完成同一回合", async () => {
    let asked = false;
    const events: string[] = [];
    const runner = new CodexRuntime({ sessionId: "s", runId: "r", workspace: root, threadId: "thread-1", prompt: "提问", instructions: "导演", tools: [], signal: new AbortController().signal,
        bindThread: () => {}, bindTurn: () => {}, append: (_kind, payload) => { if (payload.text) events.push(String(payload.text)); }, ask: async (input) => {
            const value = input as { questions: Array<{ id: string; type: string; allowCustomInput: boolean }> };
            assert.equal(value.questions[0].id, "choice"); assert.equal(value.questions[0].type, "single_choice"); assert.equal(value.questions[0].allowCustomInput, true);
            await new Promise((resolve) => setTimeout(resolve, 20)); assert.deepEqual(events, []); asked = true; return { answers: { choice: "继续" } };
        } },
    { ready: async () => {}, settings: () => ({ enabled: true, binary: "/usr/bin/codex", model: "" }), bridge: async () => ({ url: "http://127.0.0.1/mcp", token: "test", close: () => {} }), start: (_workspace, _home, _policy, _binary, overrides) => { assert.equal(overrides?.["features.default_mode_request_user_input"], true); return fakeRpc("question"); } });
    await runner.run(); assert.equal(asked, true); assert.deepEqual(events, ["已收到回答"]);
});


test("Codex 请求可读摘要并登记原生看图和上下文整理，空摘要不伪造思考", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    await runtime("activity", events, () => {}).run();
    assert.deepEqual(events.filter((event) => event.kind === "thinking").map((event) => event.payload.text), ["检查素材\n核对风格"]);
    for (const [id, name] of [["imageView", "查看图片"], ["contextCompaction", "整理上下文"]]) {
        const lifecycle = events.filter((event) => event.payload.toolId === id);
        assert.deepEqual(lifecycle.map((event) => event.kind), ["tool_call", "tool_result"]);
        assert.ok(lifecycle.every((event) => event.payload.toolName === name));
    }
});

test("画布 Codex 使用原生看图，保留其他画布工具与 fileId 媒体接口", async () => {
    const { buildAgentToolDefinitions } = await import("./mcp/index.js");
    const context = { session: { projectId: "p" }, run: { userId: "u" } } as Parameters<typeof buildAgentToolDefinitions>[0];
    const tools = buildAgentToolDefinitions(context, agentScenes.canvas, "codex");
    assert.deepEqual(tools.map((tool) => tool.name).sort(), agentScenes.canvas.tools.filter((tool) => !["media_understand_images", "workspace_write_text", "ask_user"].includes(tool.id)).map((tool) => tool.id).sort());
    assert.ok(!buildAgentToolDefinitions(context, agentScenes.canvas).some((tool) => tool.name === "media_understand_images"));
    const { sceneSkillIds } = await import("./scenes/index.js");
    const workspace = join(root, "canvas-native-images");
    syncBuiltInAgentSkills(workspace, sceneSkillIds(agentScenes.canvas), "codex");
    const skill = readFileSync(join(workspace, ".agents/skills/media-understand/SKILL.md"), "utf8");
    assert.match(skill, /使用原生看图/);
    assert.doesNotMatch(skill, /media_understand_images/);
    assert.ok(!tools.some((tool) => tool.name.startsWith("director_")));
    const audio = z.object(tools.find((tool) => tool.name === "media_understand_audios")!.inputSchema).strict();
    assert.equal(audio.safeParse({ items: [{ fileId: "audio-file" }] }).success, true);
    assert.equal(audio.safeParse({ items: [{ path: "audio.wav" }] }).success, false);
    const generate = z.object(tools.find((tool) => tool.name === "media_generate")!.inputSchema);
    assert.equal(generate.safeParse({ request: { source: "channel", kind: "image", model: "test", prompt: "test" } }).success, false);
    for (const engine of ["builtin", "codex"] as const) {
        const definitions = buildAgentToolDefinitions(context, agentScenes.canvas, engine);
        for (const name of ["media_generate", "media_validate_generation"]) {
            const definition = definitions.find((item) => item.name === name)!;
            const schema = z.object(definition.inputSchema);
            assert.equal(schema.safeParse({ request: { source: "channel", kind: "image", model: "test", prompt: "test" } }).success, engine === "builtin");
            assert.equal(schema.safeParse({ request: { source: "channel", kind: "video", model: "test", prompt: "test" } }).success, true);
            if (engine === "codex") assert.throws(() => definition.handler({ request: { source: "channel", kind: "image", model: "test", prompt: "test" } }));
        }
    }
    assert.match(agentScenes.canvas.systemPrompt("p", "codex"), /图片生成与编辑只使用原生生图/);
    assert.match(agentScenes.canvas.systemPrompt("p", "codex"), /服务端数据库为准/);
});

test("画布两种引擎均移除业务节点工具和 Skill，导演能力保留", async () => {
    const { buildAgentToolDefinitions } = await import("./mcp/index.js");
    const { sceneSkillIds } = await import("./scenes/index.js");
    const context = { session: { projectId: "p" }, run: { userId: "u" } } as Parameters<typeof buildAgentToolDefinitions>[0];
    for (const engine of ["builtin", "codex"] as const) {
        const names = buildAgentToolDefinitions(context, agentScenes.canvas, engine).map((tool) => tool.name);
        assert.ok(!names.some((name) => /^(creative_asset|visual_style)/.test(name)));
        for (const name of ["canvas_adopt_result", "canvas_apply_ops", "media_generate"]) assert.ok(names.includes(name));
        const workspace = join(root, `canvas-skills-${engine}`);
        syncBuiltInAgentSkills(workspace, sceneSkillIds(agentScenes.canvas), engine);
        const directory = join(workspace, engine === "codex" ? ".agents" : ".claude", "skills");
        assert.ok(!existsSync(join(directory, "design-character")));
        assert.ok(existsSync(join(directory, "canvas-edit", "SKILL.md")));
    }
    assert.deepEqual(sceneSkillIds(agentScenes.canvas), ["media-understand", "media-generation", "canvas-edit"]);
    assert.deepEqual(agentScenes.canvas.referenceKinds, ["canvas"]);
    assert.ok(sceneSkillIds(agentScenes.director).includes("director-design-character"));
    assert.ok(buildAgentToolDefinitions(context, agentScenes.director).some((tool) => tool.name === "director_generate_asset"));
});


test("画布 Codex 可原生获取并处理参考视频，业务写入仍经 MCP，内置权限独立", () => {
    const codex = agentScenes.canvas.systemPrompt("p", "codex");
    assert.doesNotMatch(codex, /你只使用 canvas|禁止 Shell/);
    assert.match(codex, /原生命令、文件、看图和联网能力/);
    assert.match(codex, /不得未经尝试就断言不能访问链接/);
    assert.match(codex, /未取得参考内容时不得凭标题或分享文案编造故事/);
    assert.match(codex, /必须通过画布 MCP 工具读取和修改/);
    assert.match(codex, /不得访问宿主配置、渠道凭据或管理员接口/);
    const builtin = agentScenes.canvas.systemPrompt("p", "builtin");
    assert.match(builtin, /禁止 Shell/);
    assert.doesNotMatch(builtin, /可自主使用原生命令/);
});
