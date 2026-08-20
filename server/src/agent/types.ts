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
    source: "policy" | "business" | "ask_user" | "proposal";
    runId: string;
    content: string;
    toolName?: string;
    toolInput?: unknown;
    scopes?: Array<"once" | "session" | "project">;
    permissionSuggestions?: unknown;
    rulePreview?: string[];
    questions?: AgentDecisionQuestion[];
};

export type AgentDecisionQuestion = {
    id: string;
    question: string;
    header?: string;
    type: "text" | "single_choice" | "multiple_choice";
    allowCustomInput: boolean;
    customInputPlaceholder?: string;
    options: Array<{ label: string; description?: string }>;
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
    preferredSessionId?: string;
    clientMessageId: string;
    submissionMode: "direct" | "steer" | "queue";
    content: AgentComposerDocument;
    attachmentFileIds?: string[];
};

export type AgentComposerSegment =
    | { type: "text"; text: string }
    | { type: "skill"; mentionId: string; skillId: string }
    | { type: "canvas"; mentionId: string; projectId: string; nodeId: string }
    | { type: "asset"; mentionId: string; projectId: string; assetId: string; nodeId?: string }
    | { type: "style"; mentionId: string; projectId: string; styleId: string; nodeId?: string }
    | { type: "director"; mentionId: string; projectId: string; entityKind: "story" | "script" | "directing-plan" | "sequence" | "video-segment" | "timeline"; entityId: string };

export type AgentComposerDocument = { version: 1; segments: AgentComposerSegment[] };
export type AgentQueuedMessageStatus = "queued" | "dispatching" | "running" | "held" | "failed";
export type AgentQueuedMessage = {
    id: string; sessionId: string; clientMessageId: string; displayText: string; attachmentNames: string[];
    status: AgentQueuedMessageStatus; acceptedRunId: string | null; error: string | null; createdAt: string; updatedAt: string;
};
export type AgentTurnIndexItem = { seq: number; runId: string | null; text: string; createdAt: string };

export type AgentStreamEvent =
    | { type: "snapshot"; cursor: number; sessions: AgentSession[]; queuedMessages: Record<string, AgentQueuedMessage[]> }
    | { type: "delta"; cursor: number; session: AgentSession; events: AgentEvent[] }
    | { type: "queue.updated"; cursor: number; sessionId: string; queuedMessages: AgentQueuedMessage[] };
