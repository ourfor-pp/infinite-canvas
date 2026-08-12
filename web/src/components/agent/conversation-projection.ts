import type { AgentEvent, AgentPendingDecision } from "@/services/api/agent";

export type ProjectedAgentEvent = AgentEvent & { text?: string; result?: AgentEvent };
export type AgentConversationItem =
    | { type: "time"; id: string; label: string }
    | { type: "user"; id: string; event: ProjectedAgentEvent }
    | { type: "round"; id: string; runId: string | null; events: ProjectedAgentEvent[] };

export function projectAgentEvents(events: AgentEvent[]) {
    const projected: ProjectedAgentEvent[] = [];
    const streams = new Map<string, ProjectedAgentEvent>();
    const tools = new Map<string, ProjectedAgentEvent>();
    for (const event of events) {
        if (event.kind === "assistant_text" || event.kind === "thinking") {
            const streamId = String(event.payload.streamId || "");
            if (event.payload.delta && streamId) {
                const key = `${event.kind}:${streamId}`;
                const current = streams.get(key);
                if (current) current.text = `${current.text || ""}${String(event.payload.text || "")}`;
                else { const next = { ...event, text: String(event.payload.text || "") }; streams.set(key, next); projected.push(next); }
                continue;
            }
            const streamed = streams.get(`${event.kind}:${streamId}`);
            if (streamed) { streamed.text = eventText(event); streamed.payload = { ...event.payload, delta: false }; continue; }
        }
        if (event.kind === "tool_call") {
            const key = String(event.payload.toolId || event.seq);
            const current = tools.get(key);
            if (current) current.payload = { ...current.payload, ...event.payload };
            else { const next = { ...event }; tools.set(key, next); projected.push(next); }
            continue;
        }
        if (event.kind === "tool_result") {
            const target = tools.get(String(event.payload.toolId || ""));
            if (target) target.result = event;
            else projected.push({ ...event, kind: "tool_call", payload: { toolId: event.payload.toolId, toolName: event.payload.toolName, input: null }, result: event });
            continue;
        }
        if (event.kind === "client_action") continue;
        projected.push({ ...event });
    }
    return projected;
}

export function buildConversationItems(events: AgentEvent[]): AgentConversationItem[] {
    const items: AgentConversationItem[] = [];
    let round: ProjectedAgentEvent[] = [];
    let roundRunId: string | null = null;
    let lastTime = 0;
    const flush = () => {
        if (round.length) items.push({ type: "round", id: `round-${roundRunId || round[0].seq}`, runId: roundRunId, events: round });
        round = []; roundRunId = null;
    };
    for (const event of projectAgentEvents(events)) {
        const timestamp = Date.parse(event.createdAt);
        const showTime = Number.isFinite(timestamp) && (!lastTime || timestamp - lastTime >= 5 * 60_000);
        if (event.kind === "user_text") {
            flush();
            if (showTime) items.push({ type: "time", id: `time-${event.seq}`, label: formatTime(timestamp) });
            items.push({ type: "user", id: `user-${event.seq}`, event });
        } else {
            if (round.length && roundRunId !== event.runId) flush();
            if (showTime) { flush(); items.push({ type: "time", id: `time-${event.seq}`, label: formatTime(timestamp) }); }
            roundRunId = event.runId; round.push(event);
        }
        if (Number.isFinite(timestamp)) lastTime = timestamp;
    }
    flush();
    return items;
}

export function decisionFromRequest(event: ProjectedAgentEvent): AgentPendingDecision | null {
    if (event.kind !== "approval_request" && event.kind !== "question_request") return null;
    return event.payload as unknown as AgentPendingDecision;
}

export function splitAssistantRoundEvents(events: ProjectedAgentEvent[]) {
    const completed = [...events].reverse().find((event) => event.kind === "run_state" && event.payload.state === "completed");
    const assistants = events.filter((event) => event.kind === "assistant_text");
    if (!completed) return { processMessages: [] as ProjectedAgentEvent[], answers: assistants };
    const explicitSeq = Number(completed.payload.finalAssistantEventSeq);
    const final = Number.isFinite(explicitSeq) ? assistants.find((event) => event.seq === explicitSeq) : [...assistants].reverse().find((event) => !completed.runId || !event.runId || event.runId === completed.runId);
    return { processMessages: assistants.filter((event) => event !== final), answers: final ? [final] : [] };
}

export function eventText(event: ProjectedAgentEvent) { return event.text || String(event.payload.text || event.payload.content || ""); }

function formatTime(timestamp: number) {
    const date = new Date(timestamp); const now = new Date();
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) return time;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    return date.toDateString() === yesterday.toDateString() ? `昨天 ${time}` : `${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })} ${time}`;
}
