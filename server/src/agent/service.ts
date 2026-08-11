import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { createSdkMcpServer, query, tool, type Options, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "../config.js";
import { db, parseJson } from "../database.js";
import { getStoredFile } from "../file-store.js";
import { decryptCredentials, getProviderRow, resolveAgentModel, type AiModelDefinition } from "../provider-service.js";
import { registerAgentProviderProxy } from "./provider-proxy.js";
import { agentAutoAllowedTools, buildAgentMcpServer } from "./mcp/index.js";
import { getBuiltInAgentSkill, listBuiltInAgentSkills, syncBuiltInAgentSkills, type BuiltInAgentSkill } from "./skill-registry.js";
import { getCanvasState } from "./canvas-tools.js";
import { creativeAssetInputSchema, getCreativeAsset } from "../creative-assets.js";
import type { AgentEvent, AgentEventKind, AgentMessageInput, AgentPendingDecision, AgentSession, AgentSessionStatus, AgentStreamEvent } from "./types.js";

type SessionRow = {
    id: string; user_id: string; project_id: string; sdk_session_id: string | null; title: string;
    status: AgentSessionStatus; event_seq: number; current_run_id: string | null; pending_decision: string | null; fork_pending: number;
    last_error: string | null; last_error_code: string | null; created_at: string; updated_at: string;
};
type RunRow = { id: string; session_id: string; user_id: string; status: string; model_ref: string; usage: string | null; error: string | null; error_code: string | null; started_at: string; finished_at: string | null };
type AgentSettings = { modelRef: string; modelName?: string; providerName?: string; ready: boolean };
type DecisionResult = { approved: boolean; scope: "once" | "session" | "project"; comment?: string; answers?: Record<string, string>; proposalEdits?: unknown };

type ConversationListener = { clientId: string; send: (event: AgentStreamEvent) => void };
const conversationListeners = new Map<string, Set<ConversationListener>>();
const running = new Map<string, { controller: AbortController; query?: Query; run: RunRow }>();
const decisions = new Map<string, { sessionId: string; resolve: (result: DecisionResult) => void }>();
const clientActions = new Map<string, { sessionId: string; resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void }>();
const sdkToolCalls = new Map<string, string>();
const workspaceWrites = new Map<string, Promise<void>>();
let pumpScheduled = false;

export function recoverAgentRuns() {
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("UPDATE agent_sessions SET status='failed', current_run_id=NULL, pending_decision=NULL, last_error=?, last_error_code='SERVICE_RESTART_INTERRUPTED', updated_at=? WHERE status IN ('running','waiting_for_user')")
            .run("服务重启中断，当前任务无法安全恢复", now);
        db.prepare("UPDATE agent_runs SET status='failed', error=?, error_code='SERVICE_RESTART_INTERRUPTED', finished_at=? WHERE status IN ('queued','running','waiting_for_user')")
            .run("服务重启中断，当前任务无法安全恢复", now);
    })();
}

export function getAgentSettings(): AgentSettings {
    const row = db.prepare("SELECT model_ref FROM agent_settings WHERE id=1").get() as { model_ref: string } | undefined;
    const modelRef = row?.model_ref || "";
    let modelName = "";
    let providerName = "";
    let ready = false;
    if (modelRef) {
        try {
            const selection = resolveAgentModel(modelRef);
            modelName = selection.model.name;
            providerName = selection.provider.name;
            ready = true;
        } catch { /* Invalid admin configuration is represented as not ready. */ }
    }
    return { modelRef, modelName, providerName, ready };
}

export function saveAgentSettings(input: { modelRef: string }) {
    const value = z.object({ modelRef: z.string().trim().min(1) }).parse(input);
    resolveAgentModel(value.modelRef);
    db.prepare("INSERT INTO agent_settings(id, model_ref, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET model_ref=excluded.model_ref, updated_at=excluded.updated_at")
        .run(value.modelRef, new Date().toISOString());
    return getAgentSettings();
}

export async function testAgentSettings(input?: { modelRef?: string }) {
    const modelRef = input?.modelRef?.trim() || getAgentSettings().modelRef;
    const selection = resolveAgentModel(modelRef);
    const controller = new AbortController();
    const runtime = runtimeEnv(selection.provider, selection.provider.credentials, selection.model, resolve(config.agentRoot, "runtime-test"));
    let toolCalled = false;
    const testMcp = createSdkMcpServer({ name: "agent_test", tools: [tool("health_check", "Agent 管理员连接测试。", {}, async () => {
        toolCalled = true;
        return { content: [{ type: "text", text: "ok" }] };
    })] });
    const runner = query({
        prompt: "请先调用 health_check 工具，再只回复 OK。",
        options: { model: selection.model.id, maxTurns: 2, tools: [], mcpServers: { agent_test: testMcp }, allowedTools: ["mcp__agent_test__health_check"], env: runtime.env, cwd: resolve(config.agentRoot, "runtime-test"), includePartialMessages: false, abortController: controller },
    });
    const timer = setTimeout(() => { controller.abort(); void runner.interrupt(); }, 30_000);
    try {
        for await (const message of runner) {
            if (message.type === "result" && message.subtype !== "success") throw new Error((message.errors || []).join("\n") || "Agent 模型测试失败");
        }
        if (!toolCalled) throw agentError(502, "AGENT_TOOL_TEST_FAILED", "模型可以回复文本，但没有完成工具调用测试");
        return { available: true, model: selection.model.name, provider: selection.provider.name };
    } finally {
        clearTimeout(timer);
        await runner.close();
    }
}

export function assertProject(userId: string, projectId: string) {
    if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=?").get(projectId, userId)) throw agentError(404, "AGENT_PROJECT_NOT_FOUND", "画布不存在或无权访问");
}

export function getConversation(userId: string, projectId: string, sessionId?: string) {
    assertProject(userId, projectId);
    const sessions = db.prepare("SELECT * FROM agent_sessions WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 50").all(userId, projectId) as SessionRow[];
    const selected = sessionId ? sessions.find((row) => row.id === sessionId) : sessions[0];
    if (sessionId && !selected) throw agentError(404, "AGENT_SESSION_NOT_FOUND", "Agent 会话不存在或不属于当前画布");
    return { projectId, sessions: sessions.map((row) => sessionResponse(row, false)), session: selected ? sessionResponse(selected, true) : null };
}

export function createSession(userId: string, projectId: string, title = "新对话") {
    assertProject(userId, projectId);
    const now = new Date().toISOString();
    const id = nanoid();
    db.prepare("INSERT INTO agent_sessions(id, user_id, project_id, title, status, created_at, updated_at) VALUES(?, ?, ?, ?, 'idle', ?, ?)").run(id, userId, projectId, title.trim() || "新对话", now, now);
    const session = sessionResponse(getSessionRow(userId, id)!, true);
    publishProjectSnapshot(userId, projectId);
    return session;
}

export function forkSession(userId: string, sessionId: string) {
    const source = requireSession(userId, sessionId);
    if (["running", "waiting_for_user"].includes(source.status)) throw agentError(409, "AGENT_SESSION_BUSY", "运行中的会话不能分叉");
    const next = createSession(userId, source.project_id, `${source.title} · 分支`);
    db.transaction(() => {
        db.prepare("INSERT INTO agent_events(session_id, seq, run_id, kind, payload, created_at) SELECT ?, seq, run_id, kind, payload, created_at FROM agent_events WHERE session_id=? AND kind<>'client_action'").run(next.id, source.id);
        db.prepare("UPDATE agent_sessions SET sdk_session_id=?, fork_pending=?, event_seq=? WHERE id=? AND user_id=?").run(source.sdk_session_id, Number(Boolean(source.sdk_session_id)), source.event_seq, next.id, userId);
    })();
    appendEvent(next.id, null, "run_state", { state: "idle", content: `从“${source.title}”创建分支` });
    publishProjectSnapshot(userId, source.project_id);
    return sessionResponse(requireSession(userId, next.id), true);
}

export function deleteSession(userId: string, sessionId: string) {
    const row = requireSession(userId, sessionId);
    if (["running", "waiting_for_user"].includes(row.status)) throw agentError(409, "AGENT_SESSION_BUSY", "运行中的会话不能删除");
    db.prepare("DELETE FROM agent_sessions WHERE id=? AND user_id=?").run(sessionId, userId);
    publishProjectSnapshot(userId, row.project_id);
    return { id: sessionId };
}

export function removeAgentProjectWorkspace(userId: string, projectId: string) {
    rmSync(projectWorkspace(userId, projectId), { recursive: true, force: true });
}

export function sendMessage(userId: string, projectId: string, input: AgentMessageInput) {
    assertProject(userId, projectId);
    const normalized = validateMessageInput(input);
    let session = normalized.sessionId ? requireSession(userId, normalized.sessionId) : latestSession(userId, projectId);
    if (session && session.project_id !== projectId) throw agentError(409, "AGENT_SESSION_PROJECT_MISMATCH", "会话不属于当前画布");
    if (!session) session = getSessionRow(userId, createSession(userId, projectId).id)!;
    if (["running", "waiting_for_user"].includes(session.status)) throw agentError(409, "AGENT_SESSION_BUSY", "当前会话仍在运行");
    const settings = getAgentSettings();
    if (!settings.ready) throw agentError(503, "AGENT_NOT_CONFIGURED", "管理员尚未配置可用的 Agent 模型");
    const attachments = normalized.attachmentFileIds.map((id) => {
        const file = getStoredFile(userId, id);
        if (!file) throw agentError(404, "AGENT_ATTACHMENT_NOT_FOUND", "附件不存在或无权访问");
        return { fileId: id, name: file.original_name, mimeType: file.mime_type, path: file.path };
    });
    const references = normalized.canvasReferences.map((reference) => {
        if (reference.projectId !== projectId) throw agentError(400, "AGENT_REFERENCE_INVALID", "画布引用必须属于当前项目");
        const state = getCanvasState(userId, reference.projectId);
        const node = state.nodes.find((item) => item.id === reference.nodeId);
        if (!node) throw agentError(404, "AGENT_REFERENCE_NOT_FOUND", `引用节点 ${reference.nodeId} 不存在`);
        return { projectId: reference.projectId, nodeId: reference.nodeId, node };
    });
    const assetReferences = normalized.assetReferences.map((reference) => {
        if (reference.projectId !== projectId) throw agentError(400, "AGENT_ASSET_REFERENCE_INVALID", "创作资产引用必须属于当前项目");
        const asset = getCreativeAsset(userId, reference.assetId);
        if (asset.projectId !== reference.projectId) throw agentError(404, "AGENT_ASSET_REFERENCE_NOT_FOUND", "创作资产不存在或不属于当前项目");
        if (reference.nodeId) {
            const state = getCanvasState(userId, reference.projectId);
            const node = state.nodes.find((item) => item.id === reference.nodeId && item.metadata?.assetId === reference.assetId);
            if (!node) throw agentError(404, "AGENT_ASSET_NODE_NOT_FOUND", "创作资产节点不存在");
        }
        return { ...reference, asset };
    });
    const skill = normalized.skillId ? getEnabledSkill(normalized.skillId) : null;
    const runId = nanoid();
    const now = new Date().toISOString();
    const displayText = normalized.text || (attachments.length ? `发送了 ${attachments.length} 个附件` : assetReferences.length ? `引用了 ${assetReferences.length} 个创作资产` : `引用了 ${references.length} 个画布节点`);
    db.transaction(() => {
        db.prepare("INSERT INTO agent_runs(id, session_id, user_id, status, model_ref, started_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(runId, session!.id, userId, settings.modelRef, now);
        db.prepare("UPDATE agent_sessions SET status='running', current_run_id=?, last_error=NULL, last_error_code=NULL, title=CASE WHEN title='新对话' THEN ? ELSE title END, updated_at=? WHERE id=? AND user_id=?")
            .run(runId, displayText.slice(0, 80), now, session!.id, userId);
        appendEvent(session!.id, runId, "user_text", { text: displayText, attachments: attachments.map(({ path: _path, ...item }) => item), references: references.map(({ node, ...item }) => ({ ...item, title: node.title, type: node.type })), assetReferences: assetReferences.map(({ asset, ...item }) => ({ ...item, name: asset.name, kind: asset.kind })), skill: skill ? { id: skill.id, name: skill.name } : null });
        const addFileRef = db.prepare("INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id) SELECT id, user_id, 'agent_project', ? FROM stored_files WHERE id=? AND user_id=?");
        normalized.attachmentFileIds.forEach((fileId) => addFileRef.run(projectId, fileId, userId));
        db.prepare("UPDATE agent_runs SET usage=? WHERE id=?").run(JSON.stringify({ input: normalized.text, attachments, references, assetReferences, skillId: skill?.id || null }), runId);
    })();
    schedulePump();
    return getConversation(userId, projectId, session.id);
}

export async function cancelSession(userId: string, sessionId: string) {
    const row = requireSession(userId, sessionId);
    if (!["running", "waiting_for_user"].includes(row.status)) return sessionResponse(row, true);
    const active = running.get(sessionId);
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("UPDATE agent_sessions SET status='canceled', current_run_id=NULL, pending_decision=NULL, updated_at=? WHERE id=? AND user_id=?").run(now, sessionId, userId);
        if (row.current_run_id) db.prepare("UPDATE agent_runs SET status='canceled', error='用户已取消任务', error_code='AGENT_CANCELED', finished_at=? WHERE id=? AND user_id=?").run(now, row.current_run_id, userId);
        appendEvent(sessionId, row.current_run_id, "run_state", { state: "canceled", content: "任务已取消" });
    })();
    if (active) {
        active.controller.abort();
        settleSessionWaiters(sessionId, "任务已取消");
        await active.query?.interrupt().catch(() => undefined);
    }
    return sessionResponse(requireSession(userId, sessionId), true);
}

export function respondDecision(userId: string, sessionId: string, input: { decision: "approved" | "rejected"; scope?: "once" | "session" | "project"; comment?: string; answers?: Record<string, string>; proposalEdits?: unknown }) {
    const row = requireSession(userId, sessionId);
    const pending = parseJson<AgentPendingDecision | null>(row.pending_decision, null);
    if (!pending) throw agentError(409, "AGENT_DECISION_NOT_PENDING", "当前没有待处理的 Agent 请求");
    const waiter = decisions.get(pending.id);
    if (!waiter || waiter.sessionId !== sessionId) throw agentError(409, "AGENT_DECISION_INTERRUPTED", "审批对应的任务已经中断，请重新发起任务");
    const scope = input.scope || "once";
    if (pending.scopes?.length && !pending.scopes.includes(scope)) throw agentError(400, "AGENT_DECISION_SCOPE_INVALID", "当前操作不支持该授权范围");
    const proposalEdits = pending.toolName === "creative_assets_create_batch" && input.proposalEdits !== undefined
        ? z.array(creativeAssetInputSchema).min(1).max(200).parse(input.proposalEdits)
        : undefined;
    db.prepare("UPDATE agent_sessions SET status='running', pending_decision=NULL, updated_at=? WHERE id=? AND user_id=?").run(new Date().toISOString(), sessionId, userId);
    appendEvent(sessionId, pending.runId, pending.kind === "question" ? "question_response" : "approval_response", { decision: input.decision, scope, comment: input.comment || "", answers: input.answers || {}, ...(proposalEdits ? { proposalEdits } : {}) });
    decisions.delete(pending.id);
    waiter.resolve({ approved: input.decision === "approved", scope, comment: input.comment, answers: input.answers, proposalEdits });
    return sessionResponse(requireSession(userId, sessionId), true);
}

export function respondClientAction(userId: string, sessionId: string, input: { actionId: string; ok: boolean; data?: unknown; error?: string }) {
    requireSession(userId, sessionId);
    const waiter = clientActions.get(input.actionId);
    if (!waiter || waiter.sessionId !== sessionId) throw agentError(409, "AGENT_CLIENT_ACTION_EXPIRED", "客户端操作已完成或过期");
    clientActions.delete(input.actionId);
    waiter.resolve({ ok: input.ok, data: input.data, error: input.error });
    return { accepted: true };
}

export function subscribeConversation(userId: string, projectId: string, clientId: string, listener: (event: AgentStreamEvent) => void) {
    assertProject(userId, projectId);
    const key = conversationKey(userId, projectId);
    const set = conversationListeners.get(key) || new Set();
    const subscriber = { clientId, send: listener };
    set.add(subscriber);
    conversationListeners.set(key, set);
    listener(projectSnapshot(userId, projectId));
    return () => {
        set.delete(subscriber);
        if (!set.size) conversationListeners.delete(key);
    };
}

export function getSessionEvents(userId: string, sessionId: string, beforeSeq?: number, limit?: number) {
    requireSession(userId, sessionId);
    return sessionEvents(sessionId, beforeSeq, limit);
}

export function listSkills() {
    return listBuiltInAgentSkills();
}

export function listAdminRuns() {
    return (db.prepare("SELECT r.*, u.username FROM agent_runs r JOIN users u ON u.id=r.user_id ORDER BY r.started_at DESC LIMIT 200").all() as Array<RunRow & { username: string }>).map((row) => ({
        id: row.id, sessionId: row.session_id, status: row.status, modelRef: row.model_ref, error: row.error, errorCode: row.error_code,
        startedAt: row.started_at, finishedAt: row.finished_at, user: { id: row.user_id, username: row.username },
    }));
}

export async function cancelRunByAdmin(id: string) {
    const row = db.prepare("SELECT * FROM agent_runs WHERE id=?").get(id) as RunRow | undefined;
    if (!row) throw agentError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
    if (!["queued", "running", "waiting_for_user"].includes(row.status)) throw agentError(409, "AGENT_RUN_FINISHED", "Agent 任务已经结束");
    return cancelSession(row.user_id, row.session_id);
}

function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
        pumpScheduled = false;
        pumpQueue();
    });
}

function pumpQueue() {
    while (running.size < config.agentMaxConcurrency) {
        const rows = db.prepare("SELECT * FROM agent_runs WHERE status='queued' ORDER BY started_at LIMIT 100").all() as RunRow[];
        const run = rows.find((candidate) => Array.from(running.values()).filter((item) => item.run.user_id === candidate.user_id).length < config.agentUserConcurrency);
        if (!run) return;
        const controller = new AbortController();
        running.set(run.session_id, { controller, run });
        db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(run.id);
        void executeRun(run, controller).finally(() => {
            running.delete(run.session_id);
            schedulePump();
        });
    }
}

async function executeRun(run: RunRow, controller: AbortController) {
    const session = requireSession(run.user_id, run.session_id);
    try {
        const selection = resolveAgentModel(run.model_ref);
        const context = parseJson<{ input?: string; attachments?: Array<{ fileId: string; name: string; mimeType: string; path: string }>; references?: Array<{ projectId: string; nodeId: string; node: unknown }>; assetReferences?: Array<{ projectId: string; assetId: string; nodeId?: string; asset: unknown }>; skillId?: string }>(run.usage, {});
        const skill = context.skillId ? getEnabledSkill(context.skillId) : null;
        const workspace = projectWorkspace(run.user_id, session.project_id);
        mkdirSync(workspace, { recursive: true });
        syncBuiltInAgentSkills(workspace);
        const prompt = buildPrompt(session, { ...context, attachments: stageAttachments(workspace, context.attachments || []) }, skill);
        const runtime = runtimeEnv(selection.provider, selection.provider.credentials, selection.model, resolve(workspace, ".claude"));
        const mcp = buildAgentMcpServer({
            session: { id: session.id, projectId: session.project_id },
            run: { userId: run.user_id },
            appendEvent: (kind, payload) => appendEvent(session.id, run.id, kind, payload),
            requireDecision: (toolName, input, kind) => requireBusinessDecision(session, run, toolName, input, kind),
            requestClientAction: (name, input) => requestClientAction(session, run, name, input),
            resolveWorkspacePath: (path) => safeWorkspacePath(workspace, path),
            writeWorkspaceText: (path, content) => writeWorkspaceText(workspace, path, content),
            waitForWorkspacePath: (path) => waitForWorkspacePath(safeWorkspacePath(workspace, path)),
        });
        const streamState = { text: "", thinking: "", turn: 0 };
        appendEvent(session.id, run.id, "run_state", { state: "running", content: "Agent 已开始处理" });
        const runner = query({
            prompt,
            options: {
                cwd: workspace,
                abortController: controller,
                model: selection.model.id,
                persistSession: true,
                resume: session.sdk_session_id || undefined,
                forkSession: Boolean(session.sdk_session_id && session.fork_pending),
                settingSources: ["project"],
                skills: "all",
                tools: ["Read"],
                mcpServers: { infinite_canvas: mcp },
                allowedTools: agentAutoAllowedTools,
                disallowedTools: ["Bash", "PowerShell", "WebFetch", "WebSearch", "Task", "CronCreate", "CronEdit", "CronDelete", "CronList"],
                permissionMode: "auto",
                canUseTool: (toolName, input, options) => requestPolicyDecision(session, run, toolName, input, options),
                includePartialMessages: true,
                env: runtime.env,
                hooks: workspaceReadHooks(workspace),
                systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt(session) },
            },
        });
        const active = running.get(session.id);
        if (active) active.query = runner;
        for await (const message of runner) {
            if (controller.signal.aborted) throw Object.assign(new Error("用户已取消任务"), { code: "AGENT_CANCELED" });
            await consumeSdkMessage(session.id, run.id, message, streamState);
        }
        const now = new Date().toISOString();
        db.transaction(() => {
            db.prepare("UPDATE agent_sessions SET status='completed', current_run_id=NULL, pending_decision=NULL, updated_at=? WHERE id=? AND user_id=?").run(now, session.id, run.user_id);
            db.prepare("UPDATE agent_runs SET status='completed', finished_at=? WHERE id=?").run(now, run.id);
            appendEvent(session.id, run.id, "run_state", { state: "completed", content: "Agent 执行完成" });
        })();
    } catch (error) {
        const current = getSessionRow(run.user_id, session.id);
        if (current?.status === "canceled") return;
        const message = sanitizeError(error instanceof Error ? error.message : "Agent 执行失败");
        const code = String((error as { code?: string }).code || "AGENT_RUN_FAILED");
        const now = new Date().toISOString();
        db.transaction(() => {
            db.prepare("UPDATE agent_sessions SET status='failed', current_run_id=NULL, pending_decision=NULL, last_error=?, last_error_code=?, updated_at=? WHERE id=? AND user_id=?").run(message, code, now, session.id, run.user_id);
            db.prepare("UPDATE agent_runs SET status='failed', error=?, error_code=?, finished_at=? WHERE id=?").run(message, code, now, run.id);
            appendEvent(session.id, run.id, "error", { code, content: message });
            appendEvent(session.id, run.id, "run_state", { state: "failed", content: "Agent 执行失败" });
        })();
    } finally {
        settleSessionWaiters(session.id, "Agent 任务已经结束");
    }
}

async function requestClientAction(session: SessionRow, run: RunRow, name: string, input: unknown) {
    const subscribers = conversationListeners.get(conversationKey(run.user_id, session.project_id));
    const targetClientId = Array.from(subscribers || []).find((subscriber) => subscriber.clientId)?.clientId;
    if (!targetClientId) throw agentError(409, "CLIENT_REQUIRED", "需要打开并保持登录的应用页面才能执行此操作");
    const actionId = nanoid();
    appendEvent(session.id, run.id, "client_action", { actionId, targetClientId, name, input });
    const result = await new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolvePromise, reject) => {
        clientActions.set(actionId, { sessionId: session.id, resolve: resolvePromise });
        setTimeout(() => {
            if (!clientActions.delete(actionId)) return;
            reject(agentError(408, "CLIENT_ACTION_TIMEOUT", "页面未及时完成客户端操作"));
        }, 60_000).unref();
    });
    if (!result.ok) throw agentError(409, "CLIENT_ACTION_FAILED", result.error || "客户端操作失败");
    return result.data || { completed: true };
}

async function requireBusinessDecision(session: SessionRow, run: RunRow, toolName: string, input: unknown, kind: "question" | "proposal" = "question") {
    const id = nanoid();
    const pending: AgentPendingDecision = { id, kind, source: kind === "question" ? "ask_user" : "proposal", runId: run.id, content: kind === "question" ? String((input as { question?: string }).question || "Agent 正在等待回答") : "请检查 Agent 拆解出的角色、场景和道具，确认后将创建为独立业务卡片", toolName, toolInput: input };
    db.prepare("UPDATE agent_sessions SET status='waiting_for_user', pending_decision=?, updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(pending), new Date().toISOString(), session.id, run.user_id);
    db.prepare("UPDATE agent_runs SET status='waiting_for_user' WHERE id=?").run(run.id);
    appendEvent(session.id, run.id, kind === "question" ? "question_request" : "approval_request", pending as unknown as Record<string, unknown>);
    const result = await new Promise<DecisionResult>((resolvePromise) => decisions.set(id, { sessionId: session.id, resolve: resolvePromise }));
    db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(run.id);
    if (!result.approved) throw agentError(403, "AGENT_TOOL_REJECTED", "用户拒绝了工具操作");
    return result;
}

async function requestPolicyDecision(session: SessionRow, run: RunRow, toolName: string, input: Record<string, unknown>, options: { suggestions?: PermissionUpdate[]; decisionReason?: string; title?: string }): Promise<PermissionResult> {
    const suggestions = (options.suggestions || []).filter((item) => item.type === "addRules" && item.rules.every((rule) => rule.toolName === toolName));
    const id = nanoid();
    const pending: AgentPendingDecision = {
        id,
        kind: "approval",
        source: "policy",
        runId: run.id,
        content: options.title || `Agent 请求执行：${toolName}`,
        toolName,
        toolInput: input,
        scopes: suggestions.length ? ["once", "session", "project"] : ["once"],
        permissionSuggestions: suggestions,
        rulePreview: suggestions.flatMap((item) => item.type === "addRules" ? item.rules.map((rule) => rule.ruleContent || rule.toolName) : []),
    };
    db.prepare("UPDATE agent_sessions SET status='waiting_for_user', pending_decision=?, updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(pending), new Date().toISOString(), session.id, run.user_id);
    db.prepare("UPDATE agent_runs SET status='waiting_for_user' WHERE id=?").run(run.id);
    appendEvent(session.id, run.id, "approval_request", pending as unknown as Record<string, unknown>);
    const result = await new Promise<DecisionResult>((resolvePromise) => decisions.set(id, { sessionId: session.id, resolve: resolvePromise }));
    db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(run.id);
    if (!result.approved) return { behavior: "deny", message: result.comment || options.decisionReason || "用户拒绝了此操作", decisionClassification: "user_reject" };
    const destination = result.scope === "project" ? "localSettings" : "session";
    const updatedPermissions = suggestions.map((item) => ({ ...item, destination }) as PermissionUpdate);
    return {
        behavior: "allow",
        updatedInput: input,
        decisionClassification: result.scope === "once" ? "user_temporary" : "user_permanent",
        ...(result.scope === "once" ? {} : { updatedPermissions }),
    };
}

async function consumeSdkMessage(sessionId: string, runId: string, message: SDKMessage, streamed: { text: string; thinking: string; turn: number }) {
    const sdkSessionId = String((message as { session_id?: string }).session_id || "").trim();
    if (sdkSessionId) db.prepare("UPDATE agent_sessions SET sdk_session_id=?, fork_pending=0 WHERE id=?").run(sdkSessionId, sessionId);
    if (message.type === "system" && message.subtype === "permission_denied") {
        appendEvent(sessionId, runId, "run_state", { state: "running", content: `SDK 自动审核未允许 ${message.tool_name.replace(/^mcp__infinite_canvas__/, "")}，该工具已结束`, reason: message.decision_reason || "未通过自动安全审核" });
        return;
    }
    if (message.type === "stream_event") {
        const event = (message as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event;
        const delta = event?.delta;
        if (event?.type === "content_block_delta" && delta?.type === "text_delta" && delta.text) {
            streamed.text += delta.text;
            appendEvent(sessionId, runId, "assistant_text", { text: delta.text, delta: true, streamId: `${runId}:${streamed.turn}:text` });
        }
        if (event?.type === "content_block_delta" && delta?.type === "thinking_delta" && delta.thinking) {
            streamed.thinking += delta.thinking;
            appendEvent(sessionId, runId, "thinking", { text: delta.thinking, delta: true, streamId: `${runId}:${streamed.turn}:thinking` });
        }
        return;
    }
    if (message.type === "assistant") {
        for (const block of Array.isArray(message.message.content) ? message.message.content : []) {
            if (block.type === "text" && block.text.trim()) appendEvent(sessionId, runId, "assistant_text", { text: block.text.trim(), streamId: `${runId}:${streamed.turn}:text` });
            if (block.type === "thinking" && block.thinking.trim()) appendEvent(sessionId, runId, "thinking", { text: block.thinking.trim(), streamId: `${runId}:${streamed.turn}:thinking` });
            if (block.type === "tool_use" && block.name === "Read") {
                sdkToolCalls.set(`${sessionId}:${block.id}`, block.name);
                appendEvent(sessionId, runId, "tool_call", { toolId: block.id, toolName: block.name, input: block.input, startedAt: new Date().toISOString() });
            }
        }
        streamed.text = "";
        streamed.thinking = "";
        streamed.turn += 1;
        return;
    }
    if (message.type === "user") {
        const content = (message as unknown as { message?: { content?: unknown } }).message?.content;
        if (!Array.isArray(content)) return;
        content.forEach((block) => {
            if (!block || typeof block !== "object" || (block as { type?: string }).type !== "tool_result") return;
            const toolId = String((block as { tool_use_id?: string }).tool_use_id || "");
            const toolName = sdkToolCalls.get(`${sessionId}:${toolId}`);
            if (!toolName) return;
            sdkToolCalls.delete(`${sessionId}:${toolId}`);
            const isError = Boolean((block as { is_error?: boolean }).is_error);
            appendEvent(sessionId, runId, "tool_result", { toolId, toolName, output: (block as { content?: unknown }).content, isError, finishedAt: new Date().toISOString() });
        });
        return;
    }
    if (message.type === "tool_progress") appendEvent(sessionId, runId, "run_state", { state: "running", content: `${message.tool_name} 执行中（${Math.floor(message.elapsed_time_seconds || 0)}s）` });
    if (message.type === "result") {
        if (message.subtype !== "success") throw Object.assign(new Error((message.errors || []).join("\n") || "Agent 执行失败"), { code: "AGENT_RESULT_ERROR" });
        db.prepare("UPDATE agent_runs SET usage=? WHERE id=?").run(JSON.stringify((message as unknown as { usage?: unknown }).usage || {}), runId);
    }
}

function runtimeEnv(row: ProviderNonNull, credentials: ReturnType<typeof decryptCredentials>, model: AiModelDefinition, claudeDir: string) {
    const home = resolve(claudeDir, "home");
    const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        LANG: process.env.LANG || "C.UTF-8",
        LC_ALL: process.env.LC_ALL,
        HOME: home,
    };
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(home, { recursive: true });
    env.CLAUDE_CONFIG_DIR = claudeDir;
    if (model.endpoint === "anthropic-messages") {
        env.ANTHROPIC_BASE_URL = row.base_url.replace(/\/v1\/?$/, "");
        env.ANTHROPIC_API_KEY = credentials.apiKey || "";
        if (credentials.authToken) env.ANTHROPIC_AUTH_TOKEN = credentials.authToken;
    } else {
        const proxy = registerAgentProviderProxy(row, credentials, model.id);
        env.ANTHROPIC_BASE_URL = proxy.baseUrl;
        env.ANTHROPIC_API_KEY = proxy.apiKey;
    }
    return { env };
}

type ProviderNonNull = NonNullable<ReturnType<typeof getProviderRow>>;

function buildPrompt(session: SessionRow, context: { input?: string; attachments?: Array<{ name: string; mimeType: string; path: string }>; references?: Array<{ projectId: string; nodeId: string; node: unknown }>; assetReferences?: Array<{ projectId: string; assetId: string; nodeId?: string; asset: unknown }> }, skill: BuiltInAgentSkill | null) {
    const sections = [context.input || "请处理本次请求。"];
    if (skill) sections.unshift(`请调用并遵循内置 Skill“${skill.id}”（${skill.name}）完成本次请求。`);
    if (context.references?.length) sections.push(`## 本次画布引用\n${JSON.stringify(context.references, null, 2)}`);
    if (context.assetReferences?.length) sections.push(`## 本次创作资产引用\n${JSON.stringify(context.assetReferences, null, 2)}\n修改前读取最新 revision；不要把新增媒体静默设为主版本。`);
    const readableAttachments = context.attachments?.filter((file) => isAgentContextFile(file.mimeType)) || [];
    const savedOnlyAttachments = context.attachments?.filter((file) => !isAgentContextFile(file.mimeType)) || [];
    if (readableAttachments.length) sections.push(`## 本次附件\n${readableAttachments.map((file) => `- ${file.name} (${file.mimeType})：${file.path}`).join("\n")}\n只允许通过受控上下文使用这些文件。`);
    if (savedOnlyAttachments.length) sections.push(`以下附件仅保存和展示，不进入本次模型上下文：${savedOnlyAttachments.map((file) => file.name).join("、")}`);
    sections.push(`当前画布 projectId：${session.project_id}。操作前先读取画布最新 revision。`);
    return sections.join("\n\n");
}

function systemPrompt(session: SessionRow) {
    return `你是 Infinite Canvas 画布项目内置 Agent。你只能使用 infinite_canvas MCP 工具操作当前项目的数据。优先理解用户目标并直接完成任务；修改画布或创作资产前先读取最新 revision；小说拆解应先调用 creative_assets_create_batch 提交角色、场景、道具候选清单供用户确认，单项角色也使用规范字段；工具成功返回即代表创建完成，后续回复不得再声称仍在等待确认；新增媒体只追加变体，不擅自替换主版本；不要编造工具结果。删除和受保护设定修改由 SDK 自动审核，升级人工时等待确认。禁止尝试 Shell、宿主文件系统、管理员接口、渠道凭据和任意外部 URL。当前会话绑定项目 ${session.project_id}。`;
}

function projectWorkspace(userId: string, projectId: string) {
    return resolve(config.agentRoot, "users", createHash("sha256").update(userId).digest("hex"), "projects", createHash("sha256").update(projectId).digest("hex"));
}

function stageAttachments(workspace: string, attachments: Array<{ fileId: string; name: string; mimeType: string; path: string }>) {
    if (!attachments.length) return [];
    const directory = resolve(workspace, "attachments");
    mkdirSync(directory, { recursive: true });
    return attachments.map((file) => {
        const safeName = basename(file.name).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-120) || "file";
        const path = resolve(directory, `${file.fileId}-${safeName}`);
        if (!existsSync(path)) copyFileSync(file.path, path);
        return { ...file, path };
    });
}

function safeWorkspacePath(workspace: string, value: string) {
    if (!value || value.includes("\0")) throw agentError(400, "AGENT_PATH_INVALID", "产物路径无效");
    const target = resolve(workspace, value);
    if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) throw agentError(403, "AGENT_PATH_FORBIDDEN", "不能访问会话沙箱外的文件");
    const local = relative(workspace, target);
    if (local === ".claude" || local.startsWith(`.claude${sep}`)) throw agentError(403, "AGENT_PATH_FORBIDDEN", "不能访问 Agent 的内部配置目录");
    return target;
}

function writeWorkspaceText(workspace: string, path: string, content: string) {
    const target = safeWorkspacePath(workspace, path);
    return serializeWorkspacePath(target, async () => {
        mkdirSync(resolve(target, ".."), { recursive: true });
        const temporary = `${target}.agent-tmp-${nanoid()}`;
        try {
            writeFileSync(temporary, content, "utf8");
            renameSync(temporary, target);
        } finally {
            rmSync(temporary, { force: true });
        }
    }).then(() => ({ path }));
}

function waitForWorkspacePath(target: string) {
    return workspaceWrites.get(target) || Promise.resolve();
}

function serializeWorkspacePath<T>(target: string, action: () => Promise<T>) {
    const previous = workspaceWrites.get(target) || Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    const marker = current.then(() => undefined, () => undefined);
    workspaceWrites.set(target, marker);
    void marker.finally(() => {
        if (workspaceWrites.get(target) === marker) workspaceWrites.delete(target);
    });
    return current;
}

function workspaceReadHooks(workspace: string): NonNullable<Options["hooks"]> {
    return { PreToolUse: [{ hooks: [async (value: unknown) => {
        const event = value && typeof value === "object" ? value as { tool_name?: string; tool_input?: { file_path?: string } } : {};
        if (event.tool_name !== "Read") return {};
        try {
            safeWorkspaceReadPath(workspace, String(event.tool_input?.file_path || ""));
            return {};
        } catch (error) {
            return { continue: true, suppressOutput: false, decision: "approve", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: error instanceof Error ? error.message : "禁止读取会话沙箱外的文件" } };
        }
    }] }] };
}

function safeWorkspaceReadPath(workspace: string, value: string) {
    if (!value || value.includes("\0")) throw agentError(400, "AGENT_PATH_INVALID", "读取路径无效");
    const target = resolve(workspace, value);
    if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) throw agentError(403, "AGENT_PATH_FORBIDDEN", "不能读取会话沙箱外的文件");
    const local = relative(workspace, target);
    if ((local === ".claude" || local.startsWith(`.claude${sep}`)) && local !== `.claude${sep}skills` && !local.startsWith(`.claude${sep}skills${sep}`)) {
        throw agentError(403, "AGENT_PATH_FORBIDDEN", "不能读取 Agent 的内部配置目录");
    }
    return target;
}

function isAgentContextFile(mimeType: string) {
    return mimeType.startsWith("image/") || mimeType.startsWith("text/") || mimeType === "application/pdf" || ["application/json", "application/xml"].includes(mimeType);
}

function settleSessionWaiters(sessionId: string, error: string) {
    decisions.forEach((waiter, id) => {
        if (waiter.sessionId !== sessionId) return;
        decisions.delete(id);
        waiter.resolve({ approved: false, scope: "once", comment: error });
    });
    clientActions.forEach((waiter, id) => {
        if (waiter.sessionId !== sessionId) return;
        clientActions.delete(id);
        waiter.resolve({ ok: false, error });
    });
    Array.from(sdkToolCalls.keys()).filter((key) => key.startsWith(`${sessionId}:`)).forEach((key) => sdkToolCalls.delete(key));
}

function validateMessageInput(input: AgentMessageInput) {
    return z.object({
        text: z.string().max(200_000).optional().default(""),
        sessionId: z.string().max(128).optional(),
        attachmentFileIds: z.array(z.string().max(128)).max(20).optional().default([]),
        canvasReferences: z.array(z.object({ projectId: z.string().max(128), nodeId: z.string().max(128) })).max(50).optional().default([]),
        assetReferences: z.array(z.object({ projectId: z.string().max(128), assetId: z.string().max(128), nodeId: z.string().max(128).optional() })).max(50).optional().default([]),
        skillId: z.string().max(128).optional(),
    }).superRefine((value, issue) => {
        if (!value.text.trim() && !value.attachmentFileIds.length && !value.canvasReferences.length && !value.assetReferences.length) issue.addIssue({ code: "custom", path: ["text"], message: "消息、附件、画布引用或创作资产引用至少需要一项" });
    }).parse(input);
}

function appendEvent(sessionId: string, runId: string | null, kind: AgentEventKind, payload: Record<string, unknown>) {
    const now = new Date().toISOString();
    const event = db.transaction(() => {
        const row = db.prepare("SELECT event_seq FROM agent_sessions WHERE id=?").get(sessionId) as { event_seq: number };
        const seq = row.event_seq + 1;
        db.prepare("INSERT INTO agent_events(session_id, seq, run_id, kind, payload, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(sessionId, seq, runId, kind, JSON.stringify(payload), now);
        db.prepare("UPDATE agent_sessions SET event_seq=?, updated_at=? WHERE id=?").run(seq, now, sessionId);
        return { sessionId, seq, runId, kind, payload, createdAt: now } satisfies AgentEvent;
    })();
    const session = db.prepare("SELECT * FROM agent_sessions WHERE id=?").get(sessionId) as SessionRow;
    const streamEvent: AgentStreamEvent = { type: "delta", cursor: event.seq, session: sessionResponse(session, false), events: [event] };
    conversationListeners.get(conversationKey(session.user_id, session.project_id))?.forEach((listener) => listener.send(streamEvent));
    return event;
}

function sessionEvents(sessionId: string, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 500) {
    const rows = db.prepare("SELECT * FROM (SELECT * FROM agent_events WHERE session_id=? AND seq<? ORDER BY seq DESC LIMIT ?) ORDER BY seq")
        .all(sessionId, beforeSeq, Math.min(Math.max(limit, 1), 1000)) as Array<{ session_id: string; seq: number; run_id: string | null; kind: AgentEventKind; payload: string; created_at: string }>;
    return rows.map((row) => ({ sessionId: row.session_id, seq: row.seq, runId: row.run_id, kind: row.kind, payload: parseJson(row.payload, {}), createdAt: row.created_at }));
}

function publishProjectSnapshot(userId: string, projectId: string) {
    const event = projectSnapshot(userId, projectId);
    conversationListeners.get(conversationKey(userId, projectId))?.forEach((listener) => listener.send(event));
}

function projectSnapshot(userId: string, projectId: string): AgentStreamEvent {
    const rows = db.prepare("SELECT * FROM agent_sessions WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 50").all(userId, projectId) as SessionRow[];
    return { type: "snapshot", cursor: Math.max(0, ...rows.map((row) => row.event_seq)), sessions: rows.map((row) => sessionResponse(row, false)) };
}

function conversationKey(userId: string, projectId: string) {
    return `${userId}\u0000${projectId}`;
}

function sessionResponse(row: SessionRow, includeEvents: boolean): AgentSession {
    return { id: row.id, projectId: row.project_id, sdkSessionId: row.sdk_session_id, title: row.title, status: row.status, eventSeq: row.event_seq, currentRunId: row.current_run_id, pendingDecision: parseJson(row.pending_decision, null), lastError: row.last_error, lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at, ...(includeEvents ? { events: sessionEvents(row.id) } : {}) };
}

function getSessionRow(userId: string, sessionId: string) {
    return db.prepare("SELECT * FROM agent_sessions WHERE id=? AND user_id=?").get(sessionId, userId) as SessionRow | undefined;
}

function requireSession(userId: string, sessionId: string) {
    const row = getSessionRow(userId, sessionId);
    if (!row) throw agentError(404, "AGENT_SESSION_NOT_FOUND", "Agent 会话不存在");
    return row;
}

function latestSession(userId: string, projectId: string) {
    return db.prepare("SELECT * FROM agent_sessions WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1").get(userId, projectId) as SessionRow | undefined;
}

function getEnabledSkill(id: string) {
    const skill = getBuiltInAgentSkill(id);
    if (!skill) throw agentError(404, "AGENT_SKILL_NOT_FOUND", "内置 Skill 不存在");
    return skill;
}

function sanitizeError(value: string) {
    return value.replace(/https?:\/\/\S+/gi, "[URL]").replace(/(?:sk|key|token|bearer)[-_\s:=]+[A-Za-z0-9._-]{8,}/gi, "[凭据已隐藏]").slice(0, 1200);
}

function agentError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}
