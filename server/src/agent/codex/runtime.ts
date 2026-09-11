import type { ThreadStartParams } from "./protocol/v2/ThreadStartParams.js";
import type { TurnStartParams } from "./protocol/v2/TurnStartParams.js";
import type { TurnSteerParams } from "./protocol/v2/TurnSteerParams.js";
import type { AgentEventKind } from "../types.js";
import type { AgentToolDefinition } from "../mcp/index.js";
import { serveDirectorMcp } from "./mcp.js";
import { codexHome, codexPolicyDir, getCodexSettings, readCodexStatus, assertCodexReady } from "./settings.js";
import { startCodexProcess, type CodexRpc, type RpcMessage } from "./process.js";

type RuntimeContext = {
    sessionId: string; runId: string; workspace: string; threadId: string | null; prompt: string; instructions: string;
    options?: { model: string; effort: string };
    tools: AgentToolDefinition[]; signal: AbortSignal;
    bindThread: (id: string) => void; bindTurn: (id: string) => void;
    append: (kind: AgentEventKind, payload: Record<string, unknown>) => void;
    ask: (input: unknown) => Promise<{ answers?: Record<string, string> }>;
    image?: (savedPath: string) => Record<string, unknown>;
};

type CodexItem = { id: string; type: string; text?: string; summary?: string[]; command?: string; aggregatedOutput?: string; exitCode?: number; status?: string; changes?: unknown; query?: string; savedPath?: string; path?: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const runtimeServices = {
    ready: async () => { await readCodexStatus(); assertCodexReady(); },
    settings: getCodexSettings, bridge: serveDirectorMcp, start: startCodexProcess,
};

export class CodexRuntime {
    private rpc?: CodexRpc;
    private turnId?: string;
    private threadId?: string;
    private finished = false;
    private turnSubmitted = false;
    private steers = new Set<Promise<unknown>>();
    constructor(private context: RuntimeContext, private services = runtimeServices) {}
    async steer(prompt: string, accepted: () => void): Promise<boolean> {
        if (!this.rpc || !this.threadId || !this.turnId || this.finished) return false;
        const operation = this.rpc.request("turn/steer", { threadId: this.threadId, expectedTurnId: this.turnId, input: [{ type: "text", text: prompt, text_elements: [] }] } satisfies TurnSteerParams).then(() => { accepted(); return true; });
        this.steers.add(operation);
        try { return await operation; }
        catch (error) { if (this.finished || /no active|not.*progress|turn.*(mismatch|ended)|expected.*turn/i.test(String(error))) return false; throw error; }
        finally { this.steers.delete(operation); }
    }
    async run() {
        for (let attempt = 0; ; attempt++) {
            try { return await this.runAttempt(); }
            catch (error) {
                if (attempt || this.turnSubmitted || this.context.signal.aborted || object(error).code !== "CODEX_CONNECTION_CLOSED") throw error;
                this.finished = false; this.turnId = undefined;
            }
        }
    }
    private async runAttempt() {
        const context = this.context;
        await this.services.ready();
        if (context.signal.aborted) throw new Error("任务已取消");
        const bridge = await this.services.bridge(context.sessionId, context.runId, context.tools);
        const settings = this.services.settings();
        let rpc: CodexRpc;
        try { rpc = this.services.start(context.workspace, codexHome, codexPolicyDir, settings.binary, {
            "features.default_mode_request_user_input": true,
            "mcp_servers.infinite_canvas": { url: bridge.url, http_headers: { Authorization: `Bearer ${bridge.token}` }, enabled_tools: context.tools.map((tool) => tool.name), default_tools_approval_mode: "approve", tool_timeout_sec: 3600 },
        }); } catch (error) { bridge.close(); throw error; }
        this.rpc = rpc;
        const texts = new Map<string, { kind: "assistant_text" | "thinking"; text: string; dirty: boolean }>();
        const completedImages = new Set<string>();
        const flush = () => {
            for (const [id, item] of texts) if (item.dirty && item.text.trim()) {
                item.dirty = false; context.append(item.kind, { itemId: id, streamId: `${context.runId}:${id}`, text: item.text, delta: false });
            }
        };
        const timer = setInterval(flush, 750); timer.unref();
        let finish: (error?: Error) => void = () => {};
        const done = new Promise<void>((resolve, reject) => { finish = (error) => { if (this.finished) return; this.finished = true; error ? reject(error) : resolve(); }; });
        void done.catch(() => {});
        const aborted = () => {
            if (this.threadId && this.turnId) void rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }, 3000).catch(() => {});
            finish(Object.assign(new Error("用户已取消任务"), { code: "AGENT_CANCELED" }));
        };
        context.signal.addEventListener("abort", aborted, { once: true });
        const unsubscribe = rpc.listen((message) => {
            if (this.finished) return;
            const params = message.params || {};
            if (params.threadId && this.threadId && params.threadId !== this.threadId) return;
            if (params.turnId && this.turnId && params.turnId !== this.turnId) return;
            if (message.method === "connection/closed") { finish(new Error(String(params.message || "Codex 连接中断"))); return; }
            if (message.id !== undefined && message.method) { void this.handleRequest(message).catch((error) => finish(error)); return; }
            if (message.method === "turn/started") {
                this.turnId = String(object(params.turn).id); context.bindTurn(this.turnId); return;
            }
            if (params.turnId && this.turnId && params.turnId !== this.turnId) return;
            if (message.method === "item/reasoning/summaryPartAdded") {
                const previous = texts.get(String(params.itemId));
                if (previous?.text && !previous.text.endsWith("\n")) { previous.text += "\n"; previous.dirty = true; }
                return;
            }
            if (message.method === "item/agentMessage/delta" || message.method === "item/reasoning/summaryTextDelta") {
                const id = String(params.itemId); const kind = message.method.includes("reasoning") ? "thinking" : "assistant_text";
                const previous = texts.get(id); texts.set(id, { kind, text: (previous?.text || "") + String(params.delta || ""), dirty: true }); return;
            }
            if (message.method === "item/started" || message.method === "item/completed") {
                const item = params.item as CodexItem; if (!item?.id) return;
                const completed = message.method === "item/completed";
                if (item.type === "imageGeneration") {
                    if (completedImages.has(item.id)) return;
                    if (!completed) context.append("tool_call", { toolId: item.id, itemId: item.id, toolName: "Codex 原生生图", input: {}, startedAt: new Date().toISOString() });
                    else {
                        completedImages.add(item.id);
                        let error = item.status !== "completed" ? `Codex 生图${item.status === "failed" ? "失败" : "未完成"}` : "";
                        try {
                            if (!error) {
                                if (!item.savedPath || !context.image) throw new Error("Codex 未返回可登记的图片路径");
                                context.append("artifact", { ...context.image(item.savedPath), itemId: item.id });
                            }
                        } catch (failure) { error = failure instanceof Error ? failure.message : "图片登记失败"; }
                        context.append("tool_result", { toolId: item.id, itemId: item.id, toolName: "Codex 原生生图", output: error || "图片已生成，请按工程约定保存到目标目录", isError: Boolean(error), finishedAt: new Date().toISOString() });
                    }
                    return;
                }
                if (completed && (item.type === "agentMessage" || item.type === "reasoning" || item.type === "plan")) {
                    const kind = item.type === "reasoning" ? "thinking" : "assistant_text";
                    texts.set(item.id, { kind, text: item.text || item.summary?.join("\n") || texts.get(item.id)?.text || "", dirty: true }); flush(); return;
                }
                // MCP handlers own their business events. Native execution has no such handler.
                if (["commandExecution", "fileChange", "webSearch", "imageView", "contextCompaction"].includes(item.type)) {
                    const toolName = ({ commandExecution: "执行命令", fileChange: "修改文件", webSearch: "搜索资料", imageView: "查看图片", contextCompaction: "整理上下文" } as Record<string, string>)[item.type];
                    context.append(completed ? "tool_result" : "tool_call", { itemId: item.id, toolId: item.id, toolName,
                        ...(completed ? { output: item.aggregatedOutput || item.changes || item.query || item.path || (item.type === "contextCompaction" ? "上下文整理完成" : item.status), isError: item.status === "failed" || Boolean(item.exitCode), finishedAt: new Date().toISOString() }
                            : { input: item.command || item.changes || item.query || item.path || {}, startedAt: new Date().toISOString() }) });
                }
            }
            if (message.method === "turn/completed") {
                flush(); const turn = object(params.turn); const error = object(turn.error);
                finish(turn.status === "completed" ? undefined : new Error(String(error.message || (turn.status === "interrupted" ? "Codex 回合已中断" : "Codex 执行失败"))));
            }
        });
        try {
            await rpc.initialize();
            const params: ThreadStartParams = { cwd: "/workspace", approvalPolicy: "never", developerInstructions: context.instructions, ...((context.options?.model || settings.model) ? { model: context.options?.model || settings.model } : {}) };
            let response: { thread: { id: string } };
            const threadId = this.threadId || context.threadId;
            try { response = await rpc.request(threadId ? "thread/resume" : "thread/start", { ...params, ...(threadId ? { threadId } : {}) }); }
            catch (error) { if (object(error).code === "CODEX_CONNECTION_CLOSED") throw error; if (threadId) throw Object.assign(new Error(`Codex 原生会话无法恢复，请新建对话：${String(error)}`), { code: "CODEX_RESUME_FAILED" }); throw error; }
            this.threadId = response.thread.id; context.bindThread(this.threadId);
            if (context.signal.aborted) throw new Error("任务已取消");
            this.turnSubmitted = true;
            const result = await rpc.request<{ turn: { id: string } }>("turn/start", { threadId: this.threadId, summary: "concise", input: [{ type: "text", text: context.prompt, text_elements: [] }], ...(context.options ? { model: context.options.model, effort: context.options.effort || null } : {}) } satisfies TurnStartParams);
            this.turnId = result.turn.id; context.bindTurn(this.turnId);
            await done;
            await Promise.allSettled([...this.steers]);
        } finally {
            this.finished = true; clearInterval(timer); flush(); unsubscribe(); context.signal.removeEventListener("abort", aborted); bridge.close(); rpc.close(); this.rpc = undefined;
        }
    }
    private async handleRequest(message: RpcMessage) {
        const rpc = this.rpc!; const params = message.params || {};
        if (message.method === "item/tool/requestUserInput") {
            const questions = Array.isArray(params.questions) ? params.questions.map((value) => {
                const question = object(value);
                return { id: String(question.id), question: String(question.question), header: String(question.header || ""), type: Array.isArray(question.options) && question.options.length ? "single_choice" : "text", allowCustomInput: true, options: question.options || [] };
            }) : [];
            const result = await this.context.ask({ summary: "Codex 需要你补充信息", questions });
            rpc.reply(message.id!, { answers: Object.fromEntries(questions.map((question) => [question.id, { answers: [result.answers?.[question.id] || ""] }])) });
        } else if (message.method === "item/permissions/requestApproval") rpc.reply(message.id!, { permissions: {}, scope: "turn" });
        else rpc.reply(message.id!, { decision: "decline" });
    }
}
