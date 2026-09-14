import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { createSdkMcpServer, query, tool, type Options, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "../config.js";
import { db, parseJson } from "../database.js";
import { getStoredFile } from "../file-store.js";
import { decryptCredentials, getProviderRow, resolveAgentModel, resolveMediaUnderstandingModel, type AiModelDefinition } from "../provider-service.js";
import { registerAgentProviderProxy } from "./provider-proxy.js";
import { buildAgentMcpServer, buildAgentToolDefinitions } from "./mcp/index.js";
import { getBuiltInAgentSkill, listBuiltInAgentSkills, syncBuiltInAgentSkills, validateBuiltInAgentSkills, type BuiltInAgentSkill } from "./skill-registry.js";
import { getCanvasState, listAgentCreativeAssets, listAgentVisualStyles } from "./canvas-tools.js";
import { agentScenes, resolveAgentScene, sceneAutoAllowedTools, sceneHasReference, sceneHasSkill, sceneRegisteredTools, sceneSkillIds, validateAgentScenes, type AgentSceneDefinition } from "./scenes/index.js";
import { creativeAssetInputSchema, getCreativeAsset } from "../creative-assets.js";
import { getVisualStyle } from "../visual-styles.js";
import { getDirectorAgentOverview, getDirectorState } from "../director.js";
import { ensureDirectorProjectWorkspace, getDirectorAssetDetail, reconcileDirectorProjectFiles } from "../director-workspace.js";
import type { AgentComposerDocument, AgentEngine, AgentEvent, AgentEventKind, AgentMessageInput, AgentPendingDecision, AgentQueuedMessage, AgentSession, AgentSessionStatus, AgentStreamEvent } from "./types.js";
import { SdkInputChannel } from "./sdk-input-channel.js";
import { CodexRuntime } from "./codex/runtime.js";
import { registerCodexImage } from "./codex/images.js";
import { codexOptionsSchema, listCodexModels, resolveCodexOptions, type CodexOptions, assertCodexReady, codexPublicStatus, getCodexSettings, readCodexStatus } from "./codex/settings.js";

type SessionRow = {
    id: string; user_id: string; project_id: string; engine: AgentEngine; codex_thread_id: string | null; codex_options: string; sdk_session_id: string | null; title: string;
    status: AgentSessionStatus; event_seq: number; current_run_id: string | null; pending_decision: string | null; fork_pending: number; fork_resume_at: string | null;
    last_error: string | null; last_error_code: string | null; created_at: string; updated_at: string;
};
type RunRow = { id: string; session_id: string; user_id: string; status: string; model_ref: string; usage: string | null; error: string | null; error_code: string | null; tool_search_mode: string; tool_search_call_count: number; started_at: string; finished_at: string | null };
type QueueRow = { codex_options: string | null; id: string; user_id: string; project_id: string; session_id: string; wait_for_run_id: string | null; accepted_run_id: string | null; client_message_id: string; content: string; attachment_file_ids: string; display_text: string; status: string; error: string | null; created_at: string; updated_at: string };
type AgentSettings = { modelRef: string; modelName?: string; providerName?: string; mediaModelRef: string; mediaModelName?: string; mediaProviderName?: string; mediaReady: boolean; toolSearchMode: string; ready: boolean };
type DecisionResult = { approved: boolean; scope: "once" | "session" | "project"; comment?: string; answers?: Record<string, string>; proposalEdits?: unknown };
class RetriableAgentDiagnosticError extends Error { code = "AGENT_RETRIABLE_DIAGNOSTIC"; }

type ConversationListener = { clientId: string; send: (event: AgentStreamEvent) => void };
const conversationListeners = new Map<string, Set<ConversationListener>>();
const running = new Map<string, { controller: AbortController; query?: Query; input?: SdkInputChannel; codex?: CodexRuntime; projectKey: string; run: RunRow }>();
const decisions = new Map<string, { sessionId: string; resolve: (result: DecisionResult) => void }>();
const clientActions = new Map<string, { sessionId: string; resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void }>();
const sdkToolCalls = new Map<string, string>();
const workspaceWrites = new Map<string, Promise<void>>();
let pumpScheduled = false;

validateAgentScenes();
Object.values(agentScenes).forEach((scene) => validateBuiltInAgentSkills(sceneSkillIds(scene), sceneAutoAllowedTools(scene)));

export function recoverAgentRuns() {
    const now = new Date().toISOString();
    const interrupted = db.prepare("SELECT id, current_run_id FROM agent_sessions WHERE status IN ('running','waiting_for_user')").all() as Array<{ id: string; current_run_id: string | null }>;
    db.transaction(() => {
        db.prepare("UPDATE agent_sessions SET status='failed', current_run_id=NULL, pending_decision=NULL, last_error=?, last_error_code='SERVICE_RESTART_INTERRUPTED', updated_at=? WHERE status IN ('running','waiting_for_user')")
            .run("服务重启中断，当前任务无法安全恢复", now);
        db.prepare("UPDATE agent_runs SET status='failed', error=?, error_code='SERVICE_RESTART_INTERRUPTED', finished_at=? WHERE status IN ('queued','running','waiting_for_user')")
            .run("服务重启中断，当前任务无法安全恢复", now);
        db.prepare("UPDATE agent_queued_messages SET status='held', error='服务重启后等待确认', updated_at=? WHERE status IN ('queued','dispatching','running')").run(now);
        db.prepare("DELETE FROM agent_message_receipts WHERE client_message_id IN (SELECT client_message_id FROM agent_queued_messages WHERE status='held')").run();
    })();
    interrupted.forEach((session) => {
        appendEvent(session.id, session.current_run_id, "error", { code: "SERVICE_RESTART_INTERRUPTED", message: "服务重启中断，当前任务无法安全恢复" });
        appendEvent(session.id, session.current_run_id, "run_state", { state: "failed", content: "服务重启中断，当前任务无法安全恢复" });
    });
}

export function getAgentSettings(): AgentSettings {
    const row = db.prepare("SELECT model_ref,media_model_ref FROM agent_settings WHERE id=1").get() as { model_ref: string; media_model_ref: string } | undefined;
    const modelRef = row?.model_ref || "";
    const mediaModelRef = row?.media_model_ref || "";
    let modelName = "";
    let providerName = "";
    let toolSearchMode = "false";
    let ready = false;
    let mediaModelName = "";
    let mediaProviderName = "";
    let mediaReady = false;
    if (modelRef) {
        try {
            const selection = resolveAgentModel(modelRef);
            modelName = selection.model.name;
            providerName = selection.provider.name;
            toolSearchMode = resolveAgentToolSearchMode(selection.model.endpoint, process.env.AGENT_ENABLE_TOOL_SEARCH);
            ready = true;
        } catch { /* Invalid admin configuration is represented as not ready. */ }
    }
    if (mediaModelRef) {
        try {
            const selection = resolveMediaUnderstandingModel(mediaModelRef);
            mediaModelName = selection.model.name;
            mediaProviderName = selection.provider.name;
            mediaReady = selection.model.inputs.includes("image");
        } catch { /* Invalid media configuration is represented as not ready. */ }
    }
    return { modelRef, modelName, providerName, mediaModelRef, mediaModelName, mediaProviderName, mediaReady, toolSearchMode, ready };
}

export function saveAgentSettings(input: { modelRef: string; mediaModelRef?: string }) {
    const value = z.object({ modelRef: z.string().trim().min(1), mediaModelRef: z.string().trim().default("") }).parse(input);
    resolveAgentModel(value.modelRef);
    if (value.mediaModelRef) {
        resolveMediaUnderstandingModel(value.mediaModelRef);
    }
    db.prepare("INSERT INTO agent_settings(id, model_ref, media_model_ref, updated_at) VALUES(1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET model_ref=excluded.model_ref, media_model_ref=excluded.media_model_ref, updated_at=excluded.updated_at")
        .run(value.modelRef, value.mediaModelRef, new Date().toISOString());
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
    const prompt = runtime.toolSearchEnabled
        ? "请先使用 ToolSearch 找到 health_check，再调用 health_check，最后只回复 OK。"
        : "请先调用 health_check 工具，再只回复 OK。";
    const runner = query({
        prompt,
        options: { model: selection.model.id, maxTurns: 3, tools: runtime.toolSearchEnabled ? ["ToolSearch"] : [], mcpServers: { agent_test: testMcp }, allowedTools: [...(runtime.toolSearchEnabled ? ["ToolSearch"] : []), "mcp__agent_test__health_check"], env: runtime.env, cwd: resolve(config.agentRoot, "runtime-test"), includePartialMessages: false, abortController: controller },
    });
    const timer = setTimeout(() => { controller.abort(); void runner.interrupt(); }, 30_000);
    try {
        for await (const message of runner) {
            if (message.type === "result" && message.subtype !== "success") throw new Error((message.errors || []).join("\n") || "Agent 模型测试失败");
        }
        if (!toolCalled) throw agentError(502, "AGENT_TOOL_TEST_FAILED", "模型可以回复文本，但没有完成工具调用测试");
        return { available: true, model: selection.model.name, provider: selection.provider.name, toolSearchMode: runtime.toolSearchMode };
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
    return { projectId, sessions: sessions.map((row) => sessionResponse(row, false)), session: selected ? sessionResponse(selected, true) : null, queuedMessages: selected ? queueMessages(selected.id) : [] };
}

export function createSession(userId: string, projectId: string, title = "新对话", engine: AgentEngine = "builtin") {
    assertProject(userId, projectId);
    z.enum(["builtin", "codex"]).parse(engine);
    if (engine === "codex" && resolveAgentScene(userId, projectId).id !== "director") throw agentError(400, "CODEX_DIRECTOR_ONLY", "Codex 仅支持导演项目");
    const session = createSessionRecord(userId, projectId, title, engine);
    publishProjectSnapshot(userId, projectId);
    return session;
}

function createSessionRecord(userId: string, projectId: string, title: string, engine: AgentEngine = "builtin") {
    const now = new Date().toISOString();
    const id = nanoid();
    db.prepare("INSERT INTO agent_sessions(id, user_id, project_id, title, engine, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 'idle', ?, ?)").run(id, userId, projectId, title.trim() || "新对话", engine, now, now);
    return sessionResponse(getSessionRow(userId, id)!, true);
}

export function forkSession(userId: string, sessionId: string, fromEventSeq?: number) {
    const source = requireSession(userId, sessionId);
    if (source.engine === "codex") throw agentError(409, "CODEX_FORK_UNSUPPORTED", "Codex 第一版暂不支持会话分叉，请新建对话");
    if (["running", "waiting_for_user"].includes(source.status)) throw agentError(409, "AGENT_SESSION_BUSY", "运行中的会话不能分叉");
    const sourceMessage = fromEventSeq === undefined ? null : db.prepare("SELECT kind, payload FROM agent_events WHERE session_id=? AND seq=?").get(source.id, fromEventSeq) as { kind: AgentEventKind; payload: string } | undefined;
    if (fromEventSeq !== undefined && sourceMessage?.kind !== "user_text") throw agentError(404, "AGENT_FORK_MESSAGE_NOT_FOUND", "只能从当前会话中的用户消息创建分支");
    const anchor = fromEventSeq === undefined ? null : db.prepare("SELECT payload FROM agent_events WHERE session_id=? AND seq<? AND kind='assistant_text' ORDER BY seq DESC LIMIT 1").get(source.id, fromEventSeq) as { payload: string } | undefined;
    const resumeAt = String(parseJson<Record<string, unknown>>(anchor?.payload || "{}", {}).sdkMessageUuid || "").trim();
    if (fromEventSeq !== undefined && fromEventSeq > 1 && source.sdk_session_id && !resumeAt) throw agentError(409, "AGENT_FORK_ANCHOR_MISSING", "这段旧会话没有可安全截断的 SDK 上下文，请从第一条消息重新开始或新建会话");
    const next = createSessionRecord(userId, source.project_id, `${source.title} · 分支`);
    db.transaction(() => {
        if (fromEventSeq === undefined) db.prepare("INSERT INTO agent_events(session_id, seq, run_id, kind, payload, created_at) SELECT ?, seq, run_id, kind, payload, created_at FROM agent_events WHERE session_id=? AND kind<>'client_action'").run(next.id, source.id);
        else db.prepare("INSERT INTO agent_events(session_id, seq, run_id, kind, payload, created_at) SELECT ?, seq, run_id, kind, payload, created_at FROM agent_events WHERE session_id=? AND seq<? AND kind<>'client_action'").run(next.id, source.id, fromEventSeq);
        const eventSeq = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_events WHERE session_id=?").get(next.id) as { seq: number }).seq;
        const canResume = Boolean(source.sdk_session_id && (fromEventSeq === undefined || resumeAt));
        db.prepare("UPDATE agent_sessions SET sdk_session_id=?, fork_pending=?, fork_resume_at=?, event_seq=? WHERE id=? AND user_id=?")
            .run(canResume ? source.sdk_session_id : null, Number(canResume), fromEventSeq === undefined ? null : resumeAt || null, eventSeq, next.id, userId);
    })();
    appendEvent(next.id, null, "run_state", { state: "idle", content: fromEventSeq === undefined ? `从“${source.title}”创建分支` : "从这里重新开始", ...(fromEventSeq === undefined ? {} : { forkSourceSeq: fromEventSeq }) });
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
    rmSync(legacyAgentProjectWorkspace(userId, projectId), { recursive: true, force: true });
}

export async function getSessionCodexModels(userId: string, sessionId: string) {
    const session = requireSession(userId, sessionId);
    if (session.engine !== "codex") throw agentError(400, "AGENT_ENGINE_MISMATCH", "当前会话不是 Codex");
    return listCodexModels();
}

export async function updateSessionCodexOptions(userId: string, sessionId: string, input: unknown) {
    const catalog = await getSessionCodexModels(userId, sessionId);
    const value = codexOptionsSchema.parse(input);
    resolveCodexOptions(value, catalog);
    const session = requireSession(userId, sessionId);
    db.prepare("UPDATE agent_sessions SET codex_options=?,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(value), new Date().toISOString(), sessionId, userId);
    publishProjectSnapshot(userId, session.project_id);
    return sessionResponse(requireSession(userId, sessionId), false);
}

export async function sendMessage(userId: string, projectId: string, input: AgentMessageInput) {
    assertProject(userId, projectId);
    const normalized = validateMessageInput(input);
    const receipt = db.prepare("SELECT session_id FROM agent_message_receipts WHERE user_id=? AND client_message_id=?").get(userId, normalized.clientMessageId) as { session_id: string } | undefined;
    if (receipt) return getConversation(userId, projectId, receipt.session_id);
    const queuedReceipt = db.prepare("SELECT session_id FROM agent_queued_messages WHERE user_id=? AND client_message_id=?").get(userId, normalized.clientMessageId) as { session_id: string } | undefined;
    if (queuedReceipt) return getConversation(userId, projectId, queuedReceipt.session_id);
    let session = normalized.preferredSessionId ? requireSession(userId, normalized.preferredSessionId) : latestSession(userId, projectId);
    if (session && session.project_id !== projectId) throw agentError(409, "AGENT_SESSION_PROJECT_MISMATCH", "会话不属于当前画布");
    if (!session) session = getSessionRow(userId, createSession(userId, projectId).id)!;
    if (session.engine === "codex") normalized.codexOptions = resolveCodexOptions(normalized.codexOptions || parseJson(session.codex_options, {}), await listCodexModels());
    const busy = ["running", "waiting_for_user"].includes(session.status);
    if (normalized.submissionMode === "queue" && busy) {
        enqueueMessage(userId, session, normalized);
        return getConversation(userId, projectId, session.id);
    }
    if (normalized.submissionMode === "steer") {
        if (session.status === "waiting_for_user") throw agentError(409, "AGENT_DECISION_REQUIRED", "请先处理当前审批或追问，也可以选择稍后发送");
        if (session.status !== "running") throw agentError(409, "AGENT_SESSION_NOT_RUNNING", "当前会话没有可调整的运行任务");
        const active = running.get(session.id);
        if (session.engine === "codex" && session.current_run_id) {
            const runId = session.current_run_id;
            const prepared = prepareMessage(userId, projectId, normalized.content, normalized.attachmentFileIds);
            const workspace = projectWorkspace(userId, projectId);
            const prompt = buildPrompt(session, { ...prepared.context, attachments: stageAttachments(workspace, prepared.context.attachments || []).map((file) => ({ ...file, path: `/workspace/${relative(workspace, file.path)}` })) }, prepared.skills[0] || null);
            const accepted = await active?.codex?.steer(prompt, () => db.transaction(() => {
                appendUserMessage(session!.id, runId, normalized, prepared, "steer");
                db.prepare("INSERT INTO agent_message_receipts(user_id,client_message_id,session_id,run_id,created_at) VALUES(?,?,?,?,?)").run(userId, normalized.clientMessageId, session!.id, runId, new Date().toISOString());
            })());
            if (!accepted) { enqueueMessage(userId, session, normalized); drainQueuedMessages(session.id); }
            return getConversation(userId, projectId, session.id);
        }
        if (!active?.input || !session.current_run_id) throw agentError(409, "AGENT_INPUT_CHANNEL_NOT_READY", "Agent 输入通道尚未就绪，请稍后重试或选择稍后发送");
        const prepared = prepareMessage(userId, projectId, normalized.content, normalized.attachmentFileIds);
        const prompt = buildPrompt(session, prepared.context, prepared.skills[0] || null);
        const appended = await active.input.append(singleUserInput(prompt, "now"), () => db.transaction(() => {
            appendUserMessage(session!.id, session!.current_run_id!, normalized, prepared, "steer");
            db.prepare("INSERT INTO agent_message_receipts(user_id, client_message_id, session_id, run_id, created_at) VALUES(?, ?, ?, ?, ?)").run(userId, normalized.clientMessageId, session!.id, session!.current_run_id, new Date().toISOString());
        })());
        if (!appended) throw agentError(409, "AGENT_INPUT_CHANNEL_CLOSED", "当前 Agent 回合已经结束");
        return getConversation(userId, projectId, session.id);
    }
    if (busy) throw agentError(409, "AGENT_SESSION_BUSY", "当前会话仍在运行");
    return startDirectMessage(userId, session, normalized);
}

function startDirectMessage(userId: string, session: SessionRow, normalized: ReturnType<typeof validateMessageInput>, queueId?: string) {
    const settings = getAgentSettings();
    if (session.engine === "codex") assertCodexReady();
    else if (!settings.ready) throw agentError(503, "AGENT_NOT_CONFIGURED", "管理员尚未配置可用的 Agent 模型");
    const prepared = prepareMessage(userId, session.project_id, normalized.content, normalized.attachmentFileIds);
    const runId = nanoid();
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("INSERT INTO agent_runs(id, session_id, user_id, status, model_ref, started_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(runId, session!.id, userId, session.engine === "codex" ? `codex::${normalized.codexOptions?.model || getCodexSettings().model || "default"}` : settings.modelRef, now);
        db.prepare("UPDATE agent_sessions SET status='running', current_run_id=?, last_error=NULL, last_error_code=NULL, title=CASE WHEN title='新对话' THEN ? ELSE title END, updated_at=? WHERE id=? AND user_id=?")
            .run(runId, prepared.displayText.slice(0, 80), now, session!.id, userId);
        appendUserMessage(session.id, runId, normalized, prepared, queueId ? "queue" : "direct");
        const addFileRef = db.prepare("INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id) SELECT id, user_id, 'agent_project', ? FROM stored_files WHERE id=? AND user_id=?");
        normalized.attachmentFileIds.forEach((fileId) => addFileRef.run(session.project_id, fileId, userId));
        db.prepare("UPDATE agent_runs SET usage=? WHERE id=?").run(JSON.stringify({ ...prepared.context, ...(session.engine === "codex" ? { codexOptions: normalized.codexOptions } : {}) }), runId);
        db.prepare("INSERT INTO agent_message_receipts(user_id, client_message_id, session_id, run_id, created_at) VALUES(?, ?, ?, ?, ?)").run(userId, normalized.clientMessageId, session.id, runId, now);
        if (queueId) db.prepare("UPDATE agent_queued_messages SET status='running', accepted_run_id=?, updated_at=? WHERE id=?").run(runId, now, queueId);
    })();
    schedulePump();
    publishQueue(session);
    return getConversation(userId, session.project_id, session.id);
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
        db.prepare("UPDATE agent_queued_messages SET status='held', error='当前任务已取消，等待确认', updated_at=? WHERE session_id=? AND status IN ('queued','dispatching','running')").run(now, sessionId);
    })();
    if (active) {
        active.controller.abort();
        settleSessionWaiters(sessionId, "任务已取消");
        await active.query?.interrupt().catch(() => undefined);
    }
    publishQueue(row);
    return sessionResponse(requireSession(userId, sessionId), true);
}

export function listQueuedMessages(userId: string, sessionId: string) {
    requireSession(userId, sessionId);
    return queueMessages(sessionId);
}

export function getTurnIndex(userId: string, sessionId: string) {
    requireSession(userId, sessionId);
    return (db.prepare("SELECT seq, run_id, payload, created_at FROM agent_events WHERE session_id=? AND kind='user_text' ORDER BY seq").all(sessionId) as Array<{ seq: number; run_id: string | null; payload: string; created_at: string }>).map((row) => ({
        seq: row.seq, runId: row.run_id, text: String(parseJson<Record<string, unknown>>(row.payload, {}).text || ""), createdAt: row.created_at,
    }));
}

export function retryQueuedMessage(userId: string, sessionId: string, messageId: string) {
    const session = requireSession(userId, sessionId);
    const row = requireQueue(userId, sessionId, messageId);
    if (!["held", "failed"].includes(row.status)) throw agentError(409, "AGENT_QUEUE_NOT_RETRYABLE", "只有等待确认或失败的消息可以重试");
    db.transaction(() => {
        db.prepare("DELETE FROM agent_message_receipts WHERE user_id=? AND client_message_id=?").run(userId, row.client_message_id);
        db.prepare("UPDATE agent_queued_messages SET status='queued', accepted_run_id=NULL, error=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    })();
    publishQueue(session);
    drainQueuedMessages(session.id);
    return queueMessages(session.id);
}

export async function steerQueuedMessage(userId: string, sessionId: string, messageId: string) {
    const session = requireSession(userId, sessionId);
    const row = requireQueue(userId, sessionId, messageId);
    if (["dispatching", "running"].includes(row.status)) throw agentError(409, "AGENT_QUEUE_ALREADY_RUNNING", "排队消息已经开始执行");
    const input = queuedInput(row, session.status === "running" ? "steer" : "direct");
    db.transaction(() => {
        db.prepare("DELETE FROM agent_message_receipts WHERE user_id=? AND client_message_id=?").run(userId, row.client_message_id);
        db.prepare("DELETE FROM agent_queued_messages WHERE id=?").run(row.id);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='agent_queue' AND owner_id=?").run(userId, row.id);
    })();
    publishQueue(session);
    try { return await sendMessage(userId, session.project_id, input); }
    catch (error) {
        db.prepare("INSERT INTO agent_queued_messages(id,user_id,project_id,session_id,wait_for_run_id,accepted_run_id,client_message_id,content,attachment_file_ids,display_text,status,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(row.id, row.user_id, row.project_id, row.session_id, row.wait_for_run_id, null, row.client_message_id, row.content, row.attachment_file_ids, row.display_text, "held", sanitizeError(error instanceof Error ? error.message : "发送失败"), row.created_at, new Date().toISOString());
        const add = db.prepare("INSERT OR IGNORE INTO file_refs(file_id,user_id,owner_type,owner_id) SELECT id,user_id,'agent_queue',? FROM stored_files WHERE id=? AND user_id=?");
        parseJson<string[]>(row.attachment_file_ids, []).forEach((fileId) => add.run(row.id, fileId, userId));
        publishQueue(session);
        throw error;
    }
}

export function deleteQueuedMessage(userId: string, sessionId: string, messageId: string) {
    const session = requireSession(userId, sessionId);
    const row = requireQueue(userId, sessionId, messageId);
    if (["dispatching", "running"].includes(row.status)) throw agentError(409, "AGENT_QUEUE_RUNNING", "正在执行的排队消息不能删除");
    db.transaction(() => {
        db.prepare("DELETE FROM agent_queued_messages WHERE id=?").run(row.id);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='agent_queue' AND owner_id=?").run(userId, row.id);
    })();
    publishQueue(session);
    return { id: row.id };
}

export function respondDecision(userId: string, sessionId: string, input: { decision: "approved" | "rejected"; scope?: "once" | "session" | "project"; comment?: string; answers?: Record<string, string>; proposalEdits?: unknown }) {
    const row = requireSession(userId, sessionId);
    const pending = parseJson<AgentPendingDecision | null>(row.pending_decision, null);
    if (!pending) throw agentError(409, "AGENT_DECISION_NOT_PENDING", "当前没有待处理的 Agent 请求");
    const waiter = decisions.get(pending.id);
    if (!waiter || waiter.sessionId !== sessionId) throw agentError(409, "AGENT_DECISION_INTERRUPTED", "审批对应的任务已经中断，请重新发起任务");
    const scope = input.scope || "once";
    if (pending.scopes?.length && !pending.scopes.includes(scope)) throw agentError(400, "AGENT_DECISION_SCOPE_INVALID", "当前操作不支持该授权范围");
    const proposalEdits = ["creative_assets_create_batch", "director_create_assets"].includes(pending.toolName || "") && input.proposalEdits !== undefined
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

export function subscribeConversation(userId: string, projectId: string, clientId: string, listener: (event: AgentStreamEvent) => void, resume?: { sessionId: string; seq: number }) {
    assertProject(userId, projectId);
    const key = conversationKey(userId, projectId);
    const set = conversationListeners.get(key) || new Set();
    const subscriber = { clientId, send: listener };
    set.add(subscriber);
    conversationListeners.set(key, set);
    listener(projectSnapshot(userId, projectId));
    if (resume?.sessionId && resume.seq >= 0) {
        const session = getSessionRow(userId, resume.sessionId);
        if (session?.project_id === projectId && session.event_seq > resume.seq && session.event_seq - resume.seq <= 1_000) {
            const rows = db.prepare("SELECT * FROM agent_events WHERE session_id=? AND seq>? ORDER BY seq LIMIT 1000").all(session.id, resume.seq) as Array<{ session_id: string; seq: number; run_id: string | null; kind: AgentEventKind; payload: string; created_at: string }>;
            const events = compactStreamEvents(rows);
            if (events.length) listener({ type: "delta", cursor: events.at(-1)!.seq, session: sessionResponse(session, false), events });
        }
    }
    return () => {
        set.delete(subscriber);
        if (!set.size) conversationListeners.delete(key);
    };
}

export function getSessionEvents(userId: string, sessionId: string, beforeSeq?: number, limit?: number) {
    requireSession(userId, sessionId);
    return sessionEvents(sessionId, beforeSeq, limit);
}

export async function getAgentCapabilities(userId: string, projectId: string) {
    const scene = resolveAgentScene(userId, projectId);
    if (scene.id === "director" && getCodexSettings().enabled) await readCodexStatus();
    return { engines: [{ id: "builtin", ready: getAgentSettings().ready, reason: getAgentSettings().ready ? "" : "管理员尚未配置内置 Agent" }, ...(scene.id === "director" ? [{ id: "codex", ...codexPublicStatus() }] : [])], sceneId: scene.id, skills: listBuiltInAgentSkills(sceneSkillIds(scene)), referenceKinds: scene.referenceKinds, composer: { ...scene.composer, suggestions: [...scene.composer.suggestions] } };
}

export function listAgentReferences(userId: string, projectId: string, query: { q?: string; limit?: number } = {}) {
    const scene = resolveAgentScene(userId, projectId);
    const q = String(query.q || "").trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const items: Array<{ key: string; label: string; detail: string; segment: Record<string, unknown> }> = [];
    if (sceneHasReference(scene, "canvas")) {
        for (const node of getCanvasState(userId, projectId).nodes) items.push({ key: `canvas:${node.id}`, label: String(node.title || "画布节点"), detail: String(node.type || "节点"), segment: { type: "canvas", mentionId: nanoid(), projectId, nodeId: node.id } });
    }
    if (sceneHasReference(scene, "director")) {
        reconcileDirectorProjectFiles(userId, projectId);
        const state = getDirectorAgentOverview(userId, projectId);
        state.documents.forEach((document) => items.push({ key: `director:${document.kind}`, label: document.kind === "story" ? "故事" : "剧本", detail: `REV ${document.revision}`, segment: { type: "director", mentionId: nanoid(), projectId, entityKind: document.kind, entityId: document.kind } }));
        items.push({ key: "director:directing-plan", label: "导演方案", detail: `REV ${state.workspace.revision}`, segment: { type: "director", mentionId: nanoid(), projectId, entityKind: "directing-plan", entityId: "directing-plan" } });
        state.sequences.forEach((sequence) => items.push({ key: `director:sequence:${sequence.id}`, label: sequence.title, detail: "剧情段落", segment: { type: "director", mentionId: nanoid(), projectId, entityKind: "sequence", entityId: sequence.id } }));
        const tasks = db.prepare("SELECT id,title FROM director_shots WHERE user_id=? AND project_id=? AND instr(lower(title),?)>0 ORDER BY position,id LIMIT ?").all(userId, projectId, q, limit) as Array<{ id: string; title: string }>;
        tasks.forEach((task) => items.push({ key: `director:production-task:${task.id}`, label: task.title, detail: "制作任务", segment: { type: "director", mentionId: nanoid(), projectId, entityKind: "production-task", entityId: task.id } }));
        const shots = db.prepare("SELECT entity_id,metadata FROM director_file_index WHERE user_id=? AND project_id=? AND kind='shot-design' AND instr(lower(json_extract(metadata,'$.name')),?)>0 ORDER BY json_extract(metadata,'$.order'),path LIMIT ?").all(userId, projectId, q, limit) as Array<{ entity_id: string; metadata: string }>;
        shots.forEach((shot) => items.push({ key: `director:shot-design:${shot.entity_id}`, label: String(parseJson<Record<string, unknown>>(shot.metadata, {}).name), detail: "镜头设计", segment: { type: "director", mentionId: nanoid(), projectId, entityKind: "shot-design", entityId: shot.entity_id } }));
        items.push({ key: "director:timeline", label: "时间线", detail: `REV ${state.timeline.revision}`, segment: { type: "director", mentionId: nanoid(), projectId, entityKind: "timeline", entityId: "timeline" } });
    }
    if (sceneHasReference(scene, "asset")) listAgentCreativeAssets(userId, projectId).forEach((asset) => items.push({ key: `asset:${asset.id}`, label: asset.name, detail: asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具", segment: { type: "asset", mentionId: nanoid(), projectId, assetId: asset.id } }));
    if (sceneHasReference(scene, "style")) listAgentVisualStyles(userId, projectId).forEach((style) => items.push({ key: `style:${style.id}`, label: style.name, detail: "视觉风格", segment: { type: "style", mentionId: nanoid(), projectId, styleId: style.id } }));
    return items.filter((item) => !q || `${item.label} ${item.detail}`.toLowerCase().includes(q)).slice(0, limit);
}

export function listAdminRuns() {
    return (db.prepare("SELECT r.*, u.username FROM agent_runs r JOIN users u ON u.id=r.user_id ORDER BY r.started_at DESC LIMIT 200").all() as Array<RunRow & { username: string }>).map((row) => ({
        id: row.id, sessionId: row.session_id, status: row.status, modelRef: row.model_ref, error: row.error, errorCode: row.error_code,
        toolSearchMode: row.tool_search_mode, toolSearchCallCount: row.tool_search_call_count,
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
        const run = rows.find((candidate) => {
            const session = requireSession(candidate.user_id, candidate.session_id);
            const projectKey = conversationKey(candidate.user_id, session.project_id);
            return !Array.from(running.values()).some((item) => item.projectKey === projectKey) && Array.from(running.values()).filter((item) => item.run.user_id === candidate.user_id).length < config.agentUserConcurrency;
        });
        if (!run) return;
        const controller = new AbortController();
        running.set(run.session_id, { controller, run, projectKey: conversationKey(run.user_id, requireSession(run.user_id, run.session_id).project_id) });
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
        const scene = resolveAgentScene(run.user_id, session.project_id);
        const context = parseJson<{ codexOptions?: CodexOptions; input?: string; attachments?: Array<{ fileId: string; name: string; mimeType: string; path: string }>; references?: Array<{ projectId: string; nodeId: string; node: unknown }>; assetReferences?: Array<{ projectId: string; assetId: string; nodeId?: string; asset: unknown }>; styleReferences?: Array<{ projectId: string; styleId: string; nodeId?: string; style: unknown }>; skillIds?: string[] }>(run.usage, {});
        const skill = context.skillIds?.[0] ? getEnabledSkill(context.skillIds[0], scene) : null;
        const workspace = projectWorkspace(run.user_id, session.project_id);
        mkdirSync(workspace, { recursive: true });
        validateBuiltInAgentSkills(sceneSkillIds(scene), sceneAutoAllowedTools(scene));
        const syncedSkills = syncBuiltInAgentSkills(workspace, sceneSkillIds(scene), session.engine);
        const attachments = stageAttachments(workspace, context.attachments || []).map((file) => ({ ...file, path: session.engine === "codex" ? `/workspace/${relative(workspace, file.path)}` : file.path }));
        const prompt = buildPrompt(session, { ...context, attachments }, skill);
        const mcpContext: Parameters<typeof buildAgentMcpServer>[0] = {
            session: { id: session.id, projectId: session.project_id },
            run: { userId: run.user_id, mediaModelRef: getAgentSettings().mediaModelRef },
            appendEvent: (kind, payload) => appendEvent(session.id, run.id, kind, payload),
            requireDecision: (toolName, input, kind) => requireBusinessDecision(session, run, toolName, input, kind),
            requestClientAction: (name, input) => requestClientAction(session, run, name, input),
            resolveWorkspacePath: (path) => safeWorkspacePath(workspace, path),
            writeWorkspaceText: (path, content) => writeWorkspaceText(workspace, path, content),
            waitForWorkspacePath: (path) => waitForWorkspacePath(safeWorkspacePath(workspace, path)),
        };
        if (session.engine === "codex") {
            const runtime = new CodexRuntime({
                sessionId: session.id, runId: run.id, workspace, threadId: session.codex_thread_id, prompt, options: context.codexOptions,
                instructions: scene.systemPrompt(session.project_id, "codex"), signal: controller.signal,
                tools: buildAgentToolDefinitions(mcpContext, scene, "codex"),
                image: (path) => registerCodexImage(session.user_id, session.project_id, workspace, path),
                bindThread: (id) => { db.prepare("UPDATE agent_sessions SET codex_thread_id=? WHERE id=?").run(id, session.id); },
                bindTurn: (id) => { db.prepare("UPDATE agent_runs SET codex_turn_id=? WHERE id=?").run(id, run.id); },
                append: (kind, payload) => { appendEvent(session.id, run.id, kind, payload); },
                ask: (input) => requireBusinessDecision(session, run, "ask_user", input, "question"),
            });
            const active = running.get(session.id); if (active) active.codex = runtime;
            appendEvent(session.id, run.id, "run_state", { state: "running", content: "Codex 已开始处理" });
            await runtime.run();
        } else {
        const selection = resolveAgentModel(run.model_ref);
        const runtime = runtimeEnv(selection.provider, selection.provider.credentials, selection.model, resolve(workspace, ".claude"));
        db.prepare("UPDATE agent_runs SET tool_search_mode=? WHERE id=?").run(runtime.toolSearchMode, run.id);
        const mcp = buildAgentMcpServer(mcpContext, scene);
        const streamState = { turn: 0 };
        const nativeTools = resolveAgentNativeTools(runtime.toolSearchEnabled, scene.id);
        appendEvent(session.id, run.id, "run_state", { state: "running", content: "Agent 已开始处理" });
        let input = new SdkInputChannel([sdkUserMessage(prompt)]);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const latestSession = getSessionRow(run.user_id, session.id) || session;
            const runner = query({ prompt: input, options: {
                cwd: workspace,
                abortController: controller,
                model: selection.model.id,
                persistSession: true,
                resume: latestSession.sdk_session_id || undefined,
                forkSession: Boolean(latestSession.sdk_session_id && latestSession.fork_pending),
                resumeSessionAt: latestSession.fork_resume_at || undefined,
                settingSources: ["project"],
                skills: syncedSkills.skills,
                tools: nativeTools.tools,
                settings: nativeTools.settings,
                mcpServers: { infinite_canvas: mcp },
                allowedTools: mergeAllowedTools([...sceneRegisteredTools(scene), ...nativeTools.allowedTools], syncedSkills.allowedTools),
                disallowedTools: nativeTools.disallowedTools,
                permissionMode: "auto",
                canUseTool: (toolName, input, options) => nativeTools.autoAllowedTools.includes(toolName)
                    ? Promise.resolve({ behavior: "allow", updatedInput: input })
                    : requestPolicyDecision(session, run, toolName, input, options),
                includePartialMessages: true,
                env: runtime.env,
                hooks: workspaceReadHooks(workspace),
                systemPrompt: { type: "preset", preset: "claude_code", append: scene.systemPrompt(session.project_id) },
            } });
            const active = running.get(session.id);
            if (active) { active.query = runner; active.input = input; }
            try {
                for await (const message of runner) {
                    if (controller.signal.aborted) throw Object.assign(new Error("用户已取消任务"), { code: "AGENT_CANCELED" });
                    await consumeSdkMessage(session.id, run.id, message, streamState);
                    if (message.type === "result") input.close();
                }
                break;
            } catch (error) {
                input.close();
                if (!(error instanceof RetriableAgentDiagnosticError) || attempt === 1 || controller.signal.aborted) throw error;
                appendEvent(session.id, run.id, "run_state", { state: "running", content: "收到补充消息后上游回合提前结束，正在自动续接" });
                await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
                input = new SdkInputChannel([sdkUserMessage(retryAgentPrompt(session.id, run.id))]);
            }
        }
        }
        const now = new Date().toISOString();
        db.transaction(() => {
            const finalAssistant = db.prepare("SELECT seq FROM agent_events WHERE session_id=? AND run_id=? AND kind='assistant_text' ORDER BY seq DESC LIMIT 1").get(session.id, run.id) as { seq: number } | undefined;
            db.prepare("UPDATE agent_sessions SET status='completed', current_run_id=NULL, pending_decision=NULL, updated_at=? WHERE id=? AND user_id=?").run(now, session.id, run.user_id);
            db.prepare("UPDATE agent_runs SET status='completed', finished_at=? WHERE id=?").run(now, run.id);
            appendEvent(session.id, run.id, "run_state", { state: "completed", content: "Agent 执行完成", ...(finalAssistant ? { finalAssistantEventSeq: finalAssistant.seq } : {}) });
            const accepted = db.prepare("SELECT id FROM agent_queued_messages WHERE session_id=? AND accepted_run_id=?").all(session.id, run.id) as Array<{ id: string }>;
            accepted.forEach(({ id }) => db.prepare("DELETE FROM file_refs WHERE owner_type='agent_queue' AND owner_id=?").run(id));
            db.prepare("DELETE FROM agent_queued_messages WHERE session_id=? AND accepted_run_id=?").run(session.id, run.id);
        })();
        publishQueue(session);
        drainQueuedMessages(session.id);
    } catch (error) {
        const current = getSessionRow(run.user_id, session.id);
        if (current?.status === "canceled") return;
        const diagnostic = error instanceof RetriableAgentDiagnosticError;
        const message = diagnostic ? "上游连续返回空回合，补充消息已经保存，可以直接重试继续" : sanitizeError(error instanceof Error ? error.message : "Agent 执行失败");
        const code = diagnostic ? "AGENT_EMPTY_RESPONSE" : String((error as { code?: string }).code || "AGENT_RUN_FAILED");
        const now = new Date().toISOString();
        db.transaction(() => {
            db.prepare("UPDATE agent_sessions SET status='failed', current_run_id=NULL, pending_decision=NULL, last_error=?, last_error_code=?, updated_at=? WHERE id=? AND user_id=?").run(message, code, now, session.id, run.user_id);
            db.prepare("UPDATE agent_runs SET status='failed', error=?, error_code=?, finished_at=? WHERE id=?").run(message, code, now, run.id);
            appendEvent(session.id, run.id, "error", { code, content: message });
            appendEvent(session.id, run.id, "run_state", { state: "failed", content: "Agent 执行失败" });
            db.prepare("UPDATE agent_queued_messages SET status='held', error='上一轮执行失败，等待确认', updated_at=? WHERE session_id=? AND status IN ('queued','dispatching','running')").run(now, session.id);
        })();
        publishQueue(session);
    } finally {
        const project = db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(session.project_id, run.user_id) as { kind: string } | undefined;
        if (project?.kind === "director") {
            try { reconcileDirectorProjectFiles(run.user_id, session.project_id); publishProjectSnapshot(run.user_id, session.project_id); } catch { /* validation is surfaced in the workbench */ }
        }
        running.get(session.id)?.input?.close();
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

async function requireBusinessDecision(session: SessionRow, run: RunRow, toolName: string, input: unknown, kind: "approval" | "question" | "proposal" = "approval") {
    const id = nanoid();
    const questionInput = input as { summary?: string; questions?: AgentPendingDecision["questions"] };
    const pending: AgentPendingDecision = {
        id,
        kind,
        source: kind === "question" ? "ask_user" : kind === "proposal" ? "proposal" : "business",
        runId: run.id,
        content: kind === "question" ? String(questionInput.summary || "Agent 需要你补充信息") : kind === "proposal" ? "请检查 Agent 拆解出的角色、场景和道具，确认后将创建为独立业务卡片" : `Agent 请求执行：${toolName}`,
        toolName,
        toolInput: input,
        ...(kind === "question" ? { questions: questionInput.questions || [] } : {}),
    };
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

async function consumeSdkMessage(sessionId: string, runId: string, message: SDKMessage, streamed: { turn: number }) {
    const sdkSessionId = String((message as { session_id?: string }).session_id || "").trim();
    if (sdkSessionId) db.prepare("UPDATE agent_sessions SET sdk_session_id=?, fork_pending=0, fork_resume_at=NULL WHERE id=?").run(sdkSessionId, sessionId);
    if (message.type === "system" && message.subtype === "permission_denied") {
        appendEvent(sessionId, runId, "run_state", { state: "running", content: `SDK 自动审核未允许 ${message.tool_name.replace(/^mcp__infinite_canvas__/, "")}，该工具已结束`, reason: message.decision_reason || "未通过自动安全审核" });
        return;
    }
    if (message.type === "stream_event") {
        // Partial SDK tokens are transport details. Persisting each one makes a single
        // long turn produce tens of thousands of authoritative events; the following
        // assistant message already contains the complete text/thinking blocks.
        return;
    }
    if (message.type === "assistant") {
        for (const block of Array.isArray(message.message.content) ? message.message.content : []) {
            const sdkMessageUuid = String((message as { uuid?: string }).uuid || "").trim();
            if (block.type === "text" && block.text.trim()) appendEvent(sessionId, runId, "assistant_text", { text: block.text.trim(), streamId: `${runId}:${streamed.turn}:text`, ...(sdkMessageUuid ? { sdkMessageUuid } : {}) });
            if (block.type === "thinking" && block.thinking.trim()) appendEvent(sessionId, runId, "thinking", { text: block.thinking.trim(), streamId: `${runId}:${streamed.turn}:thinking`, ...(sdkMessageUuid ? { sdkMessageUuid } : {}) });
            if (block.type === "tool_use" && (block.name === "Read" || block.name === "ToolSearch" || block.name === "Skill")) {
                sdkToolCalls.set(`${sessionId}:${block.id}`, block.name);
                appendEvent(sessionId, runId, "tool_call", { toolId: block.id, toolName: block.name, input: block.input, startedAt: new Date().toISOString(), ...(sdkMessageUuid ? { sdkMessageUuid } : {}) });
                if (block.name === "ToolSearch") db.prepare("UPDATE agent_runs SET tool_search_call_count=tool_search_call_count+1 WHERE id=?").run(runId);
            }
        }
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
    if (message.type === "tool_progress") {
        const current = db.prepare("SELECT status FROM agent_sessions WHERE id=?").get(sessionId) as { status: string } | undefined;
        if (current?.status !== "waiting_for_user") appendEvent(sessionId, runId, "run_state", { state: "running", content: `${message.tool_name.replace(/^mcp__infinite_canvas__/, "")} 执行中（${Math.floor(message.elapsed_time_seconds || 0)}s）` });
    }
    if (message.type === "result") {
        if (message.subtype !== "success") {
            const error = (message.errors || []).join("\n") || "Agent 执行失败";
            if (isRetriableAgentDiagnostic(error)) throw new RetriableAgentDiagnosticError(error);
            throw Object.assign(new Error(error), { code: "AGENT_RESULT_ERROR" });
        }
        db.prepare("UPDATE agent_runs SET usage=? WHERE id=?").run(JSON.stringify((message as unknown as { usage?: unknown }).usage || {}), runId);
    }
}

export function isRetriableAgentDiagnostic(message: string) {
    const value = message.toLowerCase();
    if (!value.includes("[ede_diagnostic]")) return false;
    const emptyAssistant = value.includes("result_type=assistant") && value.includes("last_content_type=none");
    const interruptedByUserInput = value.includes("result_type=user") && value.includes("last_content_type=n/a") && (value.includes("stop_reason=tool_use") || value.includes("stop_reason=null"));
    return emptyAssistant || interruptedByUserInput;
}

function retryAgentPrompt(sessionId: string, runId: string) {
    const row = db.prepare("SELECT payload FROM agent_events WHERE session_id=? AND run_id=? AND kind='user_text' ORDER BY seq DESC LIMIT 1").get(sessionId, runId) as { payload: string } | undefined;
    const latest = parseJson<{ text?: string; submissionMode?: string }>(row?.payload || "{}", {});
    return latest.submissionMode === "steer" && latest.text?.trim()
        ? `继续当前任务，并优先落实用户刚刚补充的要求：${latest.text.trim()}。不要重复已经完成的工作或再次询问同一事项。`
        : "继续完成当前任务。不要重复已经完成的工作；如果上一回合已经调用工具，从工具之后继续。";
}

function runtimeEnv(row: ProviderNonNull, credentials: ReturnType<typeof decryptCredentials>, model: AiModelDefinition, claudeDir: string) {
    const home = resolve(claudeDir, "home");
    const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        LANG: process.env.LANG || "C.UTF-8",
        LC_ALL: process.env.LC_ALL,
        HOME: home,
        CLAUDE_AGENT_SDK_CLIENT_APP: "infinite-canvas/0.18.0",
    };
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(home, { recursive: true });
    env.CLAUDE_CONFIG_DIR = claudeDir;
    const toolSearchMode = resolveAgentToolSearchMode(model.endpoint, process.env.AGENT_ENABLE_TOOL_SEARCH);
    env.ENABLE_TOOL_SEARCH = toolSearchMode;
    if (model.endpoint === "anthropic-messages") {
        env.ANTHROPIC_BASE_URL = row.base_url.replace(/\/v1\/?$/, "");
        env.ANTHROPIC_API_KEY = credentials.apiKey || "";
        if (credentials.authToken) env.ANTHROPIC_AUTH_TOKEN = credentials.authToken;
    } else {
        const proxy = registerAgentProviderProxy(row, credentials, model.id);
        env.ANTHROPIC_BASE_URL = proxy.baseUrl;
        env.ANTHROPIC_API_KEY = proxy.apiKey;
    }
    return { env, toolSearchMode, toolSearchEnabled: toolSearchMode !== "false" };
}

export function resolveAgentToolSearchMode(endpoint: AiModelDefinition["endpoint"], override?: string) {
    const value = String(override || "").trim();
    if (/^(?:true|false|auto|auto:(?:100|[1-9]?\d))$/.test(value)) return value;
    return endpoint === "anthropic-messages" ? "true" : "false";
}

const agentNativeAlwaysDisallowedTools = ["Bash", "PowerShell", "WebFetch", "WebSearch", "Task", "Agent", "TaskOutput", "AskUserQuestion", "NotebookEdit", "CronCreate", "CronEdit", "CronDelete", "CronList"];
const directorFileTools = ["Write", "Edit", "Glob", "Grep", "LS"];

export function resolveAgentNativeTools(toolSearchEnabled: boolean, sceneId: "canvas" | "director" = "canvas") {
    const fileTools = sceneId === "director" ? directorFileTools : [];
    const allowedTools = ["Read", ...fileTools, ...(toolSearchEnabled ? ["ToolSearch"] : [])];
    const autoAllowedTools = ["Skill", ...allowedTools];
    return {
        tools: { type: "preset" as const, preset: "claude_code" as const },
        allowedTools,
        autoAllowedTools,
        settings: { permissions: { allow: autoAllowedTools } },
        disallowedTools: [...agentNativeAlwaysDisallowedTools, ...(sceneId === "director" ? [] : directorFileTools), ...(toolSearchEnabled ? [] : ["ToolSearch"])],
    };
}

function mergeAllowedTools(...lists: string[][]) {
    const safe = new Set([...lists[0], "ToolSearch"]);
    return Array.from(new Set(lists.flat())).filter((name) => safe.has(name));
}

type ProviderNonNull = NonNullable<ReturnType<typeof getProviderRow>>;

function buildPrompt(session: SessionRow, context: { input?: string; attachments?: Array<{ fileId: string; name: string; mimeType: string; path: string }>; references?: Array<{ projectId: string; nodeId: string; node: unknown }>; assetReferences?: Array<{ projectId: string; assetId: string; nodeId?: string; path?: string; asset: unknown }>; styleReferences?: Array<{ projectId: string; styleId: string; nodeId?: string; style: unknown }>; directorReferences?: Array<{ projectId: string; entityKind: string; entityId: string; entity: unknown }> }, skill: BuiltInAgentSkill | null) {
    const sections = [context.input || "请处理本次请求。"];
    if (skill && session.engine === "codex") sections.unshift(`读取并遵循 .agents/skills/${skill.id}/SKILL.md（${skill.name}）完成本次请求。`);
    else if (skill) sections.unshift(`使用原生 Skill 工具加载并遵循“${skill.id}”（${skill.name}）完成本次请求。Skill 已同步到当前会话，不要使用 Read 查找服务端 Skill 源文件。`);
    if (context.references?.length) sections.push(`## 本次画布引用\n${JSON.stringify(context.references, null, 2)}`);
    if (context.assetReferences?.length) sections.push(`## 本次创作资产引用\n${JSON.stringify(context.assetReferences, null, 2)}\n修改前读取最新 revision；不要把新增媒体静默设为主版本。`);
    if (context.styleReferences?.length) sections.push(`## 本次视觉风格引用\n${JSON.stringify(context.styleReferences, null, 2)}\n修改前读取最新 revision；资产生成时优先沿用这个风格。`);
    if (context.directorReferences?.length) sections.push(`## 本次导演台引用\n${JSON.stringify(context.directorReferences, null, 2)}\n修改前读取最新 revision；交给 Agent 只表示把引用放入本次输入，不代表用户已经确认修改。`);
    const readableAttachments = context.attachments?.filter((file) => isAgentContextFile(file.mimeType)) || [];
    const savedOnlyAttachments = context.attachments?.filter((file) => !isAgentContextFile(file.mimeType)) || [];
    if (readableAttachments.length) sections.push(`## 本次附件\n${readableAttachments.map((file) => `- ${file.name}（fileId=${file.fileId}，${file.mimeType}）：${file.path}`).join("\n")}\n只允许通过受控上下文使用这些文件。`);
    if (savedOnlyAttachments.length) sections.push(`## 本次媒体附件\n${savedOnlyAttachments.map((file) => `- ${file.name}（fileId=${file.fileId}，${file.mimeType}）`).join("\n")}\n图片和声音使用媒体理解工具；视频先生成联系表或抽帧。不要用 Read 读取二进制文件。`);
    sections.push(`当前项目 projectId：${session.project_id}。操作前先读取最新 revision。`);
    return sections.join("\n\n");
}

function projectWorkspace(userId: string, projectId: string) {
    const project = db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { kind: string } | undefined;
    if (project?.kind === "director") return ensureDirectorProjectWorkspace(userId, projectId);
    return legacyAgentProjectWorkspace(userId, projectId);
}

function legacyAgentProjectWorkspace(userId: string, projectId: string) {
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
    assertNoWorkspaceSymlink(workspace, target);
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
        const event = value && typeof value === "object" ? value as { tool_name?: string; tool_input?: Record<string, unknown> } : {};
        if (!["Read", "Write", "Edit", "Glob", "Grep", "LS"].includes(String(event.tool_name))) return {};
        try {
            const candidate = String(event.tool_input?.file_path || event.tool_input?.path || event.tool_input?.directory || ".");
            safeWorkspaceReadPath(workspace, candidate);
            return {};
        } catch (error) {
            return { continue: true, suppressOutput: false, decision: "approve", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: error instanceof Error ? error.message : "禁止访问当前导演工程外的文件" } };
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
    assertNoWorkspaceSymlink(workspace, target);
    return target;
}

function assertNoWorkspaceSymlink(workspace: string, target: string) {
    let cursor = target;
    while (cursor !== workspace && cursor.startsWith(`${workspace}${sep}`)) {
        if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw agentError(403, "AGENT_PATH_FORBIDDEN", "禁止通过符号链接访问导演工程外文件");
        cursor = dirname(cursor);
    }
}

function isAgentContextFile(mimeType: string) {
    return mimeType.startsWith("text/") || mimeType === "application/pdf" || ["application/json", "application/xml"].includes(mimeType);
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
    const mention = { mentionId: z.string().trim().min(1).max(128), projectId: z.string().trim().min(1).max(128) };
    return z.object({
        preferredSessionId: z.string().max(128).optional(),
        codexOptions: codexOptionsSchema.optional(),
        clientMessageId: z.string().trim().min(1).max(128),
        submissionMode: z.enum(["direct", "steer", "queue"]),
        content: z.object({ version: z.literal(1), segments: z.array(z.discriminatedUnion("type", [
            z.object({ type: z.literal("text"), text: z.string().max(200_000) }),
            z.object({ type: z.literal("skill"), mentionId: mention.mentionId, skillId: z.string().trim().min(1).max(128) }),
            z.object({ type: z.literal("canvas"), ...mention, nodeId: z.string().trim().min(1).max(128) }),
            z.object({ type: z.literal("asset"), ...mention, assetId: z.string().trim().min(1).max(128), nodeId: z.string().trim().min(1).max(128).optional(), path: z.string().trim().max(500).optional() }),
            z.object({ type: z.literal("style"), ...mention, styleId: z.string().trim().min(1).max(128), nodeId: z.string().trim().min(1).max(128).optional() }),
            z.object({ type: z.literal("director"), ...mention, entityKind: z.enum(["story", "script", "directing-plan", "sequence", "shot-design", "production-task", "video-segment", "timeline"]), entityId: z.string().trim().min(1).max(128) }),
        ])).min(1).max(200) }),
        attachmentFileIds: z.array(z.string().max(128)).max(20).optional().default([]),
    }).superRefine((value, issue) => {
        if (!composerText(value.content).trim() && !value.attachmentFileIds.length && !value.content.segments.some((segment) => segment.type !== "text")) issue.addIssue({ code: "custom", path: ["content"], message: "消息、附件或引用至少需要一项" });
    }).parse(input);
}

function prepareMessage(userId: string, projectId: string, document: AgentComposerDocument, attachmentFileIds: string[]) {
    const scene = resolveAgentScene(userId, projectId);
    const attachments = attachmentFileIds.map((id) => {
        const file = getStoredFile(userId, id);
        if (!file) throw agentError(404, "AGENT_ATTACHMENT_NOT_FOUND", "附件不存在或无权访问");
        return { fileId: id, name: file.original_name, mimeType: file.mime_type, path: file.path };
    });
    const references: Array<{ projectId: string; nodeId: string; node: unknown }> = [];
    const assetReferences: Array<{ projectId: string; assetId: string; nodeId?: string; path?: string; asset: unknown }> = [];
    const styleReferences: Array<{ projectId: string; styleId: string; nodeId?: string; style: unknown }> = [];
    const directorReferences: Array<{ projectId: string; entityKind: string; entityId: string; entity: unknown }> = [];
    const skills: BuiltInAgentSkill[] = [];
    const displayParts: string[] = [];
    const displaySegments: Array<Record<string, unknown>> = [];
    for (const segment of document.segments) {
        if (segment.type === "text") { displayParts.push(segment.text); displaySegments.push(segment); continue; }
        if (segment.type === "skill") {
            const skill = getEnabledSkill(segment.skillId, scene); skills.push(skill); displayParts.push(`/${skill.name}`); displaySegments.push({ ...segment, label: skill.name }); continue;
        }
        if (!sceneHasReference(scene, segment.type)) throw agentError(400, "AGENT_REFERENCE_NOT_AVAILABLE_IN_SCENE", "当前 Agent 场景不支持这种引用");
        if (segment.projectId !== projectId) throw agentError(400, "AGENT_REFERENCE_INVALID", "引用必须属于当前项目");
        if (segment.type === "canvas") {
            const node = getCanvasState(userId, projectId).nodes.find((item) => item.id === segment.nodeId);
            if (!node) throw agentError(404, "AGENT_REFERENCE_NOT_FOUND", `引用节点 ${segment.nodeId} 不存在`);
            references.push({ projectId, nodeId: segment.nodeId, node }); displayParts.push(`@${node.title || "画布节点"}`); displaySegments.push({ ...segment, label: node.title || "画布节点" });
        } else if (segment.type === "asset") {
            const asset = getCreativeAsset(userId, segment.assetId);
            if (asset.projectId !== projectId) throw agentError(404, "AGENT_ASSET_REFERENCE_NOT_FOUND", "创作资产不存在或不属于当前项目");
            let path = segment.path;
            if (path && scene.id === "director") {
                const detail = getDirectorAssetDetail(userId, segment.assetId);
                if (path !== detail.folderPath && !path.startsWith(`${detail.folderPath}/`)) throw agentError(400, "AGENT_ASSET_PATH_INVALID", "素材引用路径不属于当前素材文件夹");
            } else path = undefined;
            assetReferences.push({ projectId, assetId: segment.assetId, nodeId: segment.nodeId, path, asset }); displayParts.push(`@${asset.name}`); displaySegments.push({ ...segment, path, label: asset.name });
        } else if (segment.type === "style") {
            const style = getVisualStyle(userId, segment.styleId);
            if (style.projectId !== projectId) throw agentError(404, "AGENT_STYLE_REFERENCE_NOT_FOUND", "视觉风格不存在或不属于当前项目");
            styleReferences.push({ projectId, styleId: segment.styleId, nodeId: segment.nodeId, style }); displayParts.push(`@${style.name}`); displaySegments.push({ ...segment, label: style.name });
        } else {
            const state = getDirectorState(userId, projectId);
            const entity = segment.entityKind === "story" || segment.entityKind === "script"
                ? state.documents.find((item) => item.kind === segment.entityKind)
                : segment.entityKind === "directing-plan" ? { workspace: state.workspace, activeStyleId: state.activeStyleId }
                : segment.entityKind === "sequence" ? state.sequences.find((item) => item.id === segment.entityId)
                : segment.entityKind === "shot-design" ? (() => { const row = db.prepare("SELECT path,sha256 FROM director_file_index WHERE user_id=? AND project_id=? AND kind='shot-design' AND entity_id=?").get(userId, projectId, segment.entityId) as { path: string; sha256: string } | undefined; return row ? { id: segment.entityId, path: row.path, hash: row.sha256 } : undefined; })()
                : segment.entityKind === "video-segment" || segment.entityKind === "production-task" ? state.videoSegments.find((item) => item.id === segment.entityId)
                : state.timeline;
            if (!entity) throw agentError(404, "AGENT_DIRECTOR_REFERENCE_NOT_FOUND", "导演台引用不存在或不属于当前项目");
            const label = segment.entityKind === "story" ? "故事" : segment.entityKind === "script" ? "剧本" : segment.entityKind === "directing-plan" ? "导演方案" : segment.entityKind === "timeline" ? "时间线" : "title" in entity ? String(entity.title) : segment.entityId;
            directorReferences.push({ projectId, entityKind: segment.entityKind, entityId: segment.entityId, entity }); displayParts.push(`@${label}`); displaySegments.push({ ...segment, label });
        }
    }
    const displayText = displayParts.join("").trim() || (attachments.length ? `发送了 ${attachments.length} 个附件` : "引用了项目内容");
    return { displayText, displaySegments, attachments, references, assetReferences, styleReferences, directorReferences, skills, context: { input: composerText(document), attachments, references, assetReferences, styleReferences, directorReferences, skillIds: skills.map((skill) => skill.id) } };
}

function appendUserMessage(sessionId: string, runId: string, input: ReturnType<typeof validateMessageInput>, prepared: ReturnType<typeof prepareMessage>, submissionMode: "direct" | "steer" | "queue") {
    appendEvent(sessionId, runId, "user_text", {
        text: prepared.displayText, content: { version: 1, segments: prepared.displaySegments }, clientMessageId: input.clientMessageId, submissionMode,
        attachments: prepared.attachments.map(({ path: _path, ...item }) => item),
        ...(input.codexOptions && submissionMode !== "steer" ? { codexOptions: input.codexOptions } : {}),
    });
}

function enqueueMessage(userId: string, session: SessionRow, input: ReturnType<typeof validateMessageInput>) {
    const prepared = prepareMessage(userId, session.project_id, input.content, input.attachmentFileIds);
    const id = nanoid(); const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("INSERT INTO agent_queued_messages(id,user_id,project_id,session_id,wait_for_run_id,client_message_id,content,attachment_file_ids,display_text,codex_options,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?)")
            .run(id, userId, session.project_id, session.id, session.current_run_id, input.clientMessageId, JSON.stringify(input.content), JSON.stringify(input.attachmentFileIds), prepared.displayText, input.codexOptions ? JSON.stringify(input.codexOptions) : null, now, now);
        const add = db.prepare("INSERT OR IGNORE INTO file_refs(file_id,user_id,owner_type,owner_id) SELECT id,user_id,'agent_queue',? FROM stored_files WHERE id=? AND user_id=?");
        input.attachmentFileIds.forEach((fileId) => add.run(id, fileId, userId));
    })();
    publishQueue(session);
}

function composerText(document: AgentComposerDocument) { return document.segments.filter((segment): segment is Extract<typeof segment, { type: "text" }> => segment.type === "text").map((segment) => segment.text).join(""); }
function sdkUserMessage(text: string, priority?: SDKUserMessage["priority"]): SDKUserMessage { return { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text }] }, ...(priority ? { priority } : {}), timestamp: new Date().toISOString() } as SDKUserMessage; }
function singleUserInput(text: string, priority?: SDKUserMessage["priority"]): AsyncIterable<SDKUserMessage> { return (async function* () { yield sdkUserMessage(text, priority); })(); }

function queueMessages(sessionId: string): AgentQueuedMessage[] {
    return (db.prepare("SELECT * FROM agent_queued_messages WHERE session_id=? ORDER BY created_at").all(sessionId) as QueueRow[]).map(queueResponse);
}
function queueResponse(row: QueueRow): AgentQueuedMessage {
    const files = parseJson<string[]>(row.attachment_file_ids, []).map((id) => getStoredFile(row.user_id, id)?.original_name).filter((name): name is string => Boolean(name));
    return { id: row.id, sessionId: row.session_id, clientMessageId: row.client_message_id, displayText: row.display_text, attachmentNames: files, status: row.status as AgentQueuedMessage["status"], acceptedRunId: row.accepted_run_id, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
}
function requireQueue(userId: string, sessionId: string, messageId: string) {
    const row = db.prepare("SELECT * FROM agent_queued_messages WHERE id=? AND session_id=? AND user_id=?").get(messageId, sessionId, userId) as QueueRow | undefined;
    if (!row) throw agentError(404, "AGENT_QUEUE_NOT_FOUND", "排队消息不存在"); return row;
}
function queuedInput(row: QueueRow, mode: "direct" | "steer"): AgentMessageInput { return { ...(row.codex_options ? { codexOptions: codexOptionsSchema.parse(JSON.parse(row.codex_options)) } : {}), preferredSessionId: row.session_id, clientMessageId: row.client_message_id, submissionMode: mode, content: parseJson(row.content, { version: 1, segments: [{ type: "text", text: row.display_text }] }), attachmentFileIds: parseJson(row.attachment_file_ids, []) }; }
function publishQueue(session: SessionRow) {
    const listeners = conversationListeners.get(conversationKey(session.user_id, session.project_id));
    const event: AgentStreamEvent = { type: "queue.updated", cursor: session.event_seq, sessionId: session.id, queuedMessages: queueMessages(session.id) };
    listeners?.forEach((listener) => listener.send(event));
}
function drainQueuedMessages(sessionId: string) {
    queueMicrotask(() => {
        const session = db.prepare("SELECT * FROM agent_sessions WHERE id=?").get(sessionId) as SessionRow | undefined;
        if (!session || ["running", "waiting_for_user"].includes(session.status)) return;
        const row = db.prepare("SELECT * FROM agent_queued_messages WHERE session_id=? AND status='queued' ORDER BY created_at LIMIT 1").get(sessionId) as QueueRow | undefined;
        if (!row) return;
        db.prepare("UPDATE agent_queued_messages SET status='dispatching', updated_at=? WHERE id=?").run(new Date().toISOString(), row.id); publishQueue(session);
        try { startDirectMessage(row.user_id, session, validateMessageInput(queuedInput(row, "direct")), row.id); }
        catch (error) { db.prepare("UPDATE agent_queued_messages SET status='failed', error=?, updated_at=? WHERE id=?").run(sanitizeError(error instanceof Error ? error.message : "排队发送失败"), new Date().toISOString(), row.id); publishQueue(session); }
    });
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

function sessionEvents(sessionId: string, beforeSeq = Number.MAX_SAFE_INTEGER, limit?: number) {
    const rows = limit === undefined
        ? db.prepare("SELECT * FROM agent_events WHERE session_id=? AND seq<? ORDER BY seq").all(sessionId, beforeSeq)
        : db.prepare("SELECT * FROM (SELECT * FROM agent_events WHERE session_id=? AND seq<? ORDER BY seq DESC LIMIT ?) ORDER BY seq").all(sessionId, beforeSeq, Math.min(Math.max(limit, 1), 1000));
    return compactStreamEvents(rows as Array<{ session_id: string; seq: number; run_id: string | null; kind: AgentEventKind; payload: string; created_at: string }>);
}

function compactStreamEvents(rows: Array<{ session_id: string; seq: number; run_id: string | null; kind: AgentEventKind; payload: string; created_at: string }>) {
    const events: AgentEvent[] = [];
    const streams = new Map<string, AgentEvent>();
    for (const row of rows) {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        const event = { sessionId: row.session_id, seq: row.seq, runId: row.run_id, kind: row.kind, payload, createdAt: row.created_at } satisfies AgentEvent;
        const streamId = (row.kind === "assistant_text" || row.kind === "thinking") ? String(payload.streamId || "") : "";
        if (!streamId) { events.push(event); continue; }
        const key = `${row.kind}:${streamId}`;
        const current = streams.get(key);
        if (!current) { streams.set(key, event); events.push(event); continue; }
        if (payload.delta) current.payload = { ...current.payload, text: `${String(current.payload.text || "")}${String(payload.text || "")}` };
        else {
            current.seq = event.seq;
            current.runId = event.runId;
            current.createdAt = event.createdAt;
            current.payload = { ...payload, delta: false };
        }
    }
    return events;
}

function publishProjectSnapshot(userId: string, projectId: string) {
    const event = projectSnapshot(userId, projectId);
    conversationListeners.get(conversationKey(userId, projectId))?.forEach((listener) => listener.send(event));
}

function projectSnapshot(userId: string, projectId: string): AgentStreamEvent {
    const rows = db.prepare("SELECT * FROM agent_sessions WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 50").all(userId, projectId) as SessionRow[];
    return { type: "snapshot", cursor: Math.max(0, ...rows.map((row) => row.event_seq)), sessions: rows.map((row) => sessionResponse(row, false)), queuedMessages: Object.fromEntries(rows.map((row) => [row.id, queueMessages(row.id)])) };
}

function conversationKey(userId: string, projectId: string) {
    return `${userId}\u0000${projectId}`;
}

function sessionResponse(row: SessionRow, includeEvents: boolean): AgentSession {
    return { id: row.id, engine: row.engine, ...(row.engine === "codex" ? { codexOptions: codexOptionsSchema.parse(parseJson(row.codex_options, {})) } : {}), projectId: row.project_id, sdkSessionId: row.sdk_session_id, title: row.title, status: row.status, eventSeq: row.event_seq, currentRunId: row.current_run_id, pendingDecision: parseJson(row.pending_decision, null), lastError: row.last_error, lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at, ...(includeEvents ? { events: sessionEvents(row.id) } : {}) };
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

function getEnabledSkill(id: string, scene: AgentSceneDefinition) {
    if (!sceneHasSkill(scene, id)) throw agentError(400, "AGENT_SKILL_NOT_AVAILABLE_IN_SCENE", "当前 Agent 场景不提供这个 Skill");
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
