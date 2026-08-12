import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/services/api/agent";
import { mergeEvents } from "./local-agent-panel";

const event = (sessionId: string, seq: number, kind: AgentEvent["kind"]): AgentEvent => ({ sessionId, seq, runId: null, kind, payload: {}, createdAt: new Date().toISOString() });

describe("Agent 会话事件合并", () => {
    it("不会把旧线程的同序号事件合入当前分支", () => {
        const branch = event("branch", 3, "run_state");
        const sourceUser = event("source", 3, "user_text");
        const sourceCanceled = event("source", 4, "run_state");

        expect(mergeEvents([branch], [sourceUser, sourceCanceled])).toEqual([branch]);
    });
});
