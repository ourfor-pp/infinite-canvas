export type AgentSessionStatus = "idle" | "running" | "waiting_for_user" | "completed" | "failed" | "canceled";
export type AgentEventKind =
    | "user_text"
    | "assistant_text"
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "approval_request"
    | "approval_response"
    | "question_request"
    | "question_response"
    | "client_action"
    | "artifact"
    | "run_state"
    | "error";

export type AgentEvent = {
    sessionId: string;
    seq: number;
    runId: string | null;
    kind: AgentEventKind;
    payload: Record<string, unknown>;
    createdAt: string;
};

export type AgentPendingDecision = {
    id: string;
    kind: "approval" | "question" | "proposal";
    source: "policy" | "ask_user" | "proposal";
    runId: string;
    content: string;
    toolName?: string;
    toolInput?: unknown;
    scopes?: Array<"once" | "session" | "project">;
    permissionSuggestions?: unknown;
    rulePreview?: string[];
};

export type AgentSession = {
    id: string;
    projectId: string;
    sdkSessionId: string | null;
    title: string;
    status: AgentSessionStatus;
    eventSeq: number;
    currentRunId: string | null;
    pendingDecision: AgentPendingDecision | null;
    lastError: string | null;
    lastErrorCode: string | null;
    createdAt: string;
    updatedAt: string;
    events?: AgentEvent[];
};

export type AgentMessageInput = {
    text?: string;
    sessionId?: string;
    attachmentFileIds?: string[];
    canvasReferences?: Array<{ projectId: string; nodeId: string }>;
    assetReferences?: Array<{ projectId: string; assetId: string; nodeId?: string }>;
    skillId?: string;
};

export type AgentStreamEvent =
    | { type: "snapshot"; cursor: number; sessions: AgentSession[] }
    | { type: "delta"; cursor: number; session: AgentSession; events: AgentEvent[] };
