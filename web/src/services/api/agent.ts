import { serverApiUrl, serverRequest } from "./server";

export type AgentStatus = "idle" | "running" | "waiting_for_user" | "completed" | "failed" | "canceled";
export type AgentEventKind = "user_text" | "assistant_text" | "thinking" | "tool_call" | "tool_result" | "approval_request" | "approval_response" | "question_request" | "question_response" | "client_action" | "artifact" | "run_state" | "error";
export type AgentEvent = { sessionId: string; seq: number; runId: string | null; kind: AgentEventKind; payload: Record<string, unknown>; createdAt: string };
export type AgentPendingDecision = { id: string; kind: "approval" | "question" | "proposal"; source: "policy" | "ask_user" | "proposal"; runId: string; content: string; toolName?: string; toolInput?: unknown; scopes?: Array<"once" | "session" | "project">; rulePreview?: string[] };
export type AgentSession = { id: string; projectId: string; sdkSessionId: string | null; title: string; status: AgentStatus; eventSeq: number; currentRunId: string | null; pendingDecision: AgentPendingDecision | null; lastError: string | null; lastErrorCode: string | null; createdAt: string; updatedAt: string; events?: AgentEvent[] };
export type AgentConversation = { projectId: string; sessions: AgentSession[]; session: AgentSession | null };
export type AgentSkill = { id: string; name: string; description: string };
export type AgentSettings = { modelRef: string; modelName?: string; providerName?: string; ready: boolean };
export type AdminAgentRun = { id: string; sessionId: string; status: string; modelRef: string; error: string | null; errorCode: string | null; startedAt: string; finishedAt: string | null; user: { id: string; username: string } };
export type AgentStreamEvent = { type: "snapshot"; cursor: number; sessions: AgentSession[] } | { type: "delta"; cursor: number; session: AgentSession; events: AgentEvent[] };
export const agentClientId = globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const agentApi = {
    config: () => serverRequest<{ ready: boolean; modelName: string; providerName: string; protocolVersion: number; storageVersion: number }>("/agent/config"),
    skills: () => serverRequest<AgentSkill[]>("/agent/skills"),
    conversation: (projectId: string, sessionId?: string) => serverRequest<AgentConversation>(`/agent/projects/${encodeURIComponent(projectId)}/conversation${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
    events: (id: string, beforeSeq: number, limit = 500) => serverRequest<AgentEvent[]>(`/agent/sessions/${encodeURIComponent(id)}/events?beforeSeq=${beforeSeq}&limit=${limit}`),
    createSession: (projectId: string) => serverRequest<AgentSession>(`/agent/projects/${encodeURIComponent(projectId)}/sessions`, { method: "POST", body: JSON.stringify({}) }),
    send: (projectId: string, input: Record<string, unknown>) => serverRequest<AgentConversation>(`/agent/projects/${encodeURIComponent(projectId)}/messages`, { method: "POST", body: JSON.stringify(input) }),
    fork: (id: string) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/fork`, { method: "POST" }),
    remove: (id: string) => serverRequest(`/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    cancel: (id: string) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    decide: (id: string, input: Record<string, unknown>) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/approval`, { method: "POST", body: JSON.stringify(input) }),
    clientResult: (id: string, input: Record<string, unknown>) => serverRequest(`/agent/sessions/${encodeURIComponent(id)}/client-result`, { method: "POST", body: JSON.stringify(input) }),
    adminSettings: () => serverRequest<AgentSettings>("/admin/ai/agent"),
    saveAdminSettings: (input: Record<string, unknown>) => serverRequest<AgentSettings>("/admin/ai/agent", { method: "PUT", body: JSON.stringify(input) }),
    testAdminSettings: (input?: Record<string, unknown>) => serverRequest<{ available: boolean; model: string; provider: string }>("/admin/ai/agent/test", { method: "POST", body: JSON.stringify(input || {}) }),
    adminRuns: () => serverRequest<AdminAgentRun[]>("/admin/agent/runs"),
    cancelAdminRun: (id: string) => serverRequest(`/admin/agent/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};

export function subscribeAgent(projectId: string, onEvent: (event: AgentStreamEvent) => void) {
    const source = new EventSource(serverApiUrl(`/agent/projects/${encodeURIComponent(projectId)}/stream?clientId=${encodeURIComponent(agentClientId)}`));
    const receive = (event: MessageEvent<string>) => {
        try { onEvent(JSON.parse(event.data) as AgentStreamEvent); } catch { /* Ignore malformed stream events. */ }
    };
    source.addEventListener("snapshot", receive as EventListener);
    source.addEventListener("delta", receive as EventListener);
    return () => source.close();
}
