import { serverApiUrl, serverRequest } from "./server";

export type AgentStatus = "idle" | "running" | "waiting_for_user" | "completed" | "failed" | "canceled";
export type AgentEventKind = "user_text" | "assistant_text" | "thinking" | "tool_call" | "tool_result" | "approval_request" | "approval_response" | "question_request" | "question_response" | "client_action" | "artifact" | "run_state" | "error";
export type AgentEvent = { sessionId: string; seq: number; runId: string | null; kind: AgentEventKind; payload: Record<string, unknown>; createdAt: string };
export type AgentDecisionQuestion = { id: string; question: string; header?: string; type: "text" | "single_choice" | "multiple_choice"; allowCustomInput: boolean; customInputPlaceholder?: string; options: Array<{ label: string; description?: string }> };
export type AgentPendingDecision = { id: string; kind: "approval" | "question" | "proposal"; source: "policy" | "business" | "ask_user" | "proposal"; runId: string; content: string; toolName?: string; toolInput?: unknown; scopes?: Array<"once" | "session" | "project">; rulePreview?: string[]; questions?: AgentDecisionQuestion[] };
export type AgentSession = { id: string; projectId: string; sdkSessionId: string | null; title: string; status: AgentStatus; eventSeq: number; currentRunId: string | null; pendingDecision: AgentPendingDecision | null; lastError: string | null; lastErrorCode: string | null; createdAt: string; updatedAt: string; events?: AgentEvent[] };
export type AgentComposerSegment =
    | { type: "text"; text: string }
    | { type: "skill"; mentionId: string; skillId: string; label?: string }
    | { type: "canvas"; mentionId: string; projectId: string; nodeId: string; label?: string }
    | { type: "asset"; mentionId: string; projectId: string; assetId: string; nodeId?: string; path?: string; label?: string }
    | { type: "style"; mentionId: string; projectId: string; styleId: string; nodeId?: string; label?: string }
    | { type: "director"; mentionId: string; projectId: string; entityKind: "story" | "script" | "directing-plan" | "sequence" | "video-segment" | "timeline"; entityId: string; label?: string };
export type AgentComposerDocument = { version: 1; segments: AgentComposerSegment[] };
export type AgentQueuedMessage = { id: string; sessionId: string; clientMessageId: string; displayText: string; attachmentNames: string[]; status: "queued" | "dispatching" | "running" | "held" | "failed"; acceptedRunId: string | null; error: string | null; createdAt: string; updatedAt: string };
export type AgentTurnIndexItem = { seq: number; runId: string | null; text: string; createdAt: string };
export type AgentConversation = { projectId: string; sessions: AgentSession[]; session: AgentSession | null; queuedMessages: AgentQueuedMessage[] };
export type AgentSkill = { id: string; name: string; description: string };
export type AgentSceneCapabilities = { sceneId: "canvas" | "director"; skills: AgentSkill[]; referenceKinds: Array<"canvas" | "asset" | "style" | "director">; composer: { placeholder: string; referenceLabel: string; emptyTitle: string; emptyDescription: string; suggestions: string[] } };
export type AgentReferenceCandidate = { key: string; label: string; detail: string; segment: Exclude<AgentComposerSegment, { type: "text" } | { type: "skill" }> };
export type AgentSettings = { modelRef: string; modelName?: string; providerName?: string; mediaModelRef: string; mediaModelName?: string; mediaProviderName?: string; mediaReady: boolean; toolSearchMode: string; ready: boolean };
export type AdminAgentRun = { id: string; sessionId: string; status: string; modelRef: string; error: string | null; errorCode: string | null; toolSearchMode: string; toolSearchCallCount: number; startedAt: string; finishedAt: string | null; user: { id: string; username: string } };
export type AgentStreamEvent = { type: "snapshot"; cursor: number; sessions: AgentSession[]; queuedMessages: Record<string, AgentQueuedMessage[]> } | { type: "delta"; cursor: number; session: AgentSession; events: AgentEvent[] } | { type: "queue.updated"; cursor: number; sessionId: string; queuedMessages: AgentQueuedMessage[] };
export const agentClientId = globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const agentStreamCursors = new Map<string, string>();

export const agentApi = {
    config: () => serverRequest<{ ready: boolean; modelName: string; providerName: string; protocolVersion: number; storageVersion: number }>("/agent/config"),
    capabilities: (projectId: string) => serverRequest<AgentSceneCapabilities>(`/agent/projects/${encodeURIComponent(projectId)}/capabilities`),
    references: (projectId: string, q = "", limit = 100) => serverRequest<AgentReferenceCandidate[]>(`/agent/projects/${encodeURIComponent(projectId)}/references?q=${encodeURIComponent(q)}&limit=${limit}`),
    conversation: (projectId: string, sessionId?: string) => serverRequest<AgentConversation>(`/agent/projects/${encodeURIComponent(projectId)}/conversation${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
    events: (id: string, beforeSeq: number, limit = 500) => serverRequest<AgentEvent[]>(`/agent/sessions/${encodeURIComponent(id)}/events?beforeSeq=${beforeSeq}&limit=${limit}`),
    turnIndex: (id: string) => serverRequest<AgentTurnIndexItem[]>(`/agent/sessions/${encodeURIComponent(id)}/turn-index`),
    queued: (id: string) => serverRequest<AgentQueuedMessage[]>(`/agent/sessions/${encodeURIComponent(id)}/queued-messages`),
    createSession: (projectId: string) => serverRequest<AgentSession>(`/agent/projects/${encodeURIComponent(projectId)}/sessions`, { method: "POST", body: JSON.stringify({}) }),
    send: (projectId: string, input: Record<string, unknown>) => serverRequest<AgentConversation>(`/agent/projects/${encodeURIComponent(projectId)}/messages`, { method: "POST", body: JSON.stringify(input) }),
    steerQueued: (sessionId: string, messageId: string) => serverRequest<AgentConversation>(`/agent/sessions/${encodeURIComponent(sessionId)}/queued-messages/${encodeURIComponent(messageId)}/steer`, { method: "POST" }),
    retryQueued: (sessionId: string, messageId: string) => serverRequest<AgentQueuedMessage[]>(`/agent/sessions/${encodeURIComponent(sessionId)}/queued-messages/${encodeURIComponent(messageId)}/retry`, { method: "POST" }),
    deleteQueued: (sessionId: string, messageId: string) => serverRequest(`/agent/sessions/${encodeURIComponent(sessionId)}/queued-messages/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
    fork: (id: string, fromEventSeq?: number) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/fork`, { method: "POST", body: JSON.stringify(fromEventSeq === undefined ? {} : { fromEventSeq }) }),
    remove: (id: string) => serverRequest(`/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    cancel: (id: string) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    decide: (id: string, input: Record<string, unknown>) => serverRequest<AgentSession>(`/agent/sessions/${encodeURIComponent(id)}/approval`, { method: "POST", body: JSON.stringify(input) }),
    clientResult: (id: string, input: Record<string, unknown>) => serverRequest(`/agent/sessions/${encodeURIComponent(id)}/client-result`, { method: "POST", body: JSON.stringify(input) }),
    adminSettings: () => serverRequest<AgentSettings>("/admin/ai/agent"),
    saveAdminSettings: (input: Record<string, unknown>) => serverRequest<AgentSettings>("/admin/ai/agent", { method: "PUT", body: JSON.stringify(input) }),
    testAdminSettings: (input?: Record<string, unknown>) => serverRequest<{ available: boolean; model: string; provider: string; toolSearchMode: string }>("/admin/ai/agent/test", { method: "POST", body: JSON.stringify(input || {}) }),
    adminRuns: () => serverRequest<AdminAgentRun[]>("/admin/agent/runs"),
    cancelAdminRun: (id: string) => serverRequest(`/admin/agent/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};

export function subscribeAgent(projectId: string, onEvent: (event: AgentStreamEvent) => void, onConnection?: (connected: boolean) => void) {
    const cursor = agentStreamCursors.get(projectId);
    const source = new EventSource(serverApiUrl(`/agent/projects/${encodeURIComponent(projectId)}/stream?clientId=${encodeURIComponent(agentClientId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    const receive = (event: MessageEvent<string>) => {
        let parsed: AgentStreamEvent;
        try { parsed = JSON.parse(event.data) as AgentStreamEvent; } catch { return; }
        if (event.lastEventId) agentStreamCursors.set(projectId, event.lastEventId);
        onEvent(parsed);
    };
    source.addEventListener("open", () => onConnection?.(true));
    source.addEventListener("error", () => onConnection?.(false));
    source.addEventListener("snapshot", receive as EventListener);
    source.addEventListener("delta", receive as EventListener);
    source.addEventListener("queue.updated", receive as EventListener);
    return () => source.close();
}
