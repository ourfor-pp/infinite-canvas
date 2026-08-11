export type AgentOwnerType = "project" | "workspace";
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
    kind: "approval" | "question";
    runId: string;
    content: string;
    toolName?: string;
    toolInput?: unknown;
    scopes?: Array<"once" | "session" | "permanent">;
};

export type AgentSession = {
    id: string;
    ownerType: AgentOwnerType;
    ownerId: string;
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
    preferredSessionId?: string;
    attachmentFileIds?: string[];
    canvasReferences?: Array<{ projectId: string; nodeId: string }>;
    skillId?: string;
};

export type AgentStreamEvent =
    | { type: "snapshot"; cursor: number; session: AgentSession; events: AgentEvent[] }
    | { type: "delta"; cursor: number; sessionPatch: Partial<AgentSession>; events: AgentEvent[] };
