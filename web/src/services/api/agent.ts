import { serverApiUrl, serverRequest } from "./server";

export type AgentOwnerType = "project" | "workspace";
export type AgentStatus = "idle" | "running" | "waiting_for_user" | "completed" | "failed" | "canceled";
export type AgentEventKind = "user_text" | "assistant_text" | "thinking" | "tool_call" | "tool_result" | "approval_request" | "approval_response" | "question_request" | "question_response" | "client_action" | "artifact" | "run_state" | "error";
export type AgentEvent = { sessionId: string; seq: number; runId: string | null; kind: AgentEventKind; payload: Record<string, unknown>; createdAt: string };
export type AgentPendingDecision = { id: string; kind: "approval" | "question"; runId: string; content: string; toolName?: string; toolInput?: unknown; scopes?: Array<"once" | "session" | "permanent"> };
export type AgentSession = { id: string; ownerType: AgentOwnerType; ownerId: string; sdkSessionId: string | null; title: string; status: AgentStatus; eventSeq: number; currentRunId: string | null; pendingDecision: AgentPendingDecision | null; lastError: string | null; lastErrorCode: string | null; createdAt: string; updatedAt: string; events?: AgentEvent[] };
export type AgentConversation = { owner: { type: AgentOwnerType; id: string }; sessions: AgentSession[]; session: AgentSession | null };
export type AgentSkill = { id: string; name: string; description: string };
export type AgentSettings = { modelRef: string; modelName?: string; providerName?: string; ready: boolean };
export type AdminAgentRun = { id: string; sessionId: string; status: string; modelRef: string; error: string | null; errorCode: string | null; startedAt: string; finishedAt: string | null; user: { id: string; username: string } };
export type AgentStreamEvent = { type: "snapshot"; cursor: number; session: AgentSession; events: AgentEvent[] } | { type: "delta"; cursor: number; sessionPatch: Partial<AgentSession>; events: AgentEvent[] };
export const agentClientId = globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const agentApi = {
    config: () => serverRequest<{ ready: boolean; modelName: string; providerName: string; protocolVersion: number; storageVersion: number }>("/agent/config"),
    skills: () => serverRequest<AgentSkill[]>("/agent/skills"),
    conversation: (ownerType: AgentOwnerType, ownerId: string) => serverRequest<AgentConversation>(`/agent/conversations/${ownerType}/${encodeURIComponent(ownerId)}`),
    events: (id: string, beforeSeq: number, limit = 500) => serverRequest<AgentEvent[]>(`/agent/sessions/${encodeURIComponent(id)}/events?beforeSeq=${beforeSeq}&limit=${limit}`),
    createSession: (ownerType: AgentOwnerType, ownerId: string) => serverRequest<AgentSession>(`/agent/conversations/${ownerType}/${encodeURIComponent(ownerId)}/sessions`, { method: "POST", body: JSON.stringify({}) }),
    send: (ownerType: AgentOwnerType, ownerId: string, input: Record<string, unknown>) => serverRequest<AgentConversation>(`/agent/conversations/${ownerType}/${encodeURIComponent(ownerId)}/messages`, { method: "POST", body: JSON.stringify(input) }),
    activate: (id: string) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/activate`, { method: "POST" }),
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

export function subscribeAgent(ownerType: AgentOwnerType, ownerId: string, onEvent: (event: AgentStreamEvent) => void) {
    const source = new EventSource(serverApiUrl(`/agent/conversations/${ownerType}/${encodeURIComponent(ownerId)}/stream?clientId=${encodeURIComponent(agentClientId)}`));
    const receive = (event: MessageEvent<string>) => {
        try { onEvent(JSON.parse(event.data) as AgentStreamEvent); } catch { /* Ignore malformed stream events. */ }
    };
    source.addEventListener("snapshot", receive as EventListener);
    source.addEventListener("delta", receive as EventListener);
    return () => source.close();
}
