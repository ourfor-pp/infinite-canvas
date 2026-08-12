import { describe, expect, it } from "vitest";
import { buildConversationItems, projectAgentEvents, splitAssistantRoundEvents } from "./conversation-projection";
import type { AgentEvent } from "@/services/api/agent";

const event = (seq: number, kind: AgentEvent["kind"], payload: Record<string, unknown>, runId = "run-1"): AgentEvent => ({ sessionId: "s", seq, runId, kind, payload, createdAt: new Date(seq * 1000).toISOString() });

describe("conversation projection", () => {
    it("merges streaming text and tool results", () => {
        const result = projectAgentEvents([event(1, "assistant_text", { streamId: "a", delta: true, text: "你" }), event(2, "assistant_text", { streamId: "a", delta: true, text: "好" }), event(3, "assistant_text", { streamId: "a", text: "你好" }), event(4, "tool_call", { toolId: "t", toolName: "Read" }), event(5, "tool_result", { toolId: "t", output: "ok" })]);
        expect(result).toHaveLength(2); expect(result[0].text).toBe("你好"); expect(result[1].result?.seq).toBe(5);
    });
    it("keeps approvals and questions inside their round", () => {
        const items = buildConversationItems([event(1, "user_text", { text: "开始" }), event(2, "approval_request", { id: "d" }), event(3, "approval_response", { decision: "approved" })]);
        expect(items).toHaveLength(3); expect(items[2].type === "round" && items[2].events.map((item) => item.kind)).toEqual(["approval_request", "approval_response"]);
    });
    it("moves non-final assistant text into process records after completion", () => {
        const projected = projectAgentEvents([event(1, "assistant_text", { text: "正在读取资料" }), event(2, "tool_call", { toolId: "t", toolName: "Read" }), event(3, "tool_result", { toolId: "t", output: "ok" }), event(4, "assistant_text", { text: "资料已齐全" }), event(5, "assistant_text", { text: "最终总结" }), event(6, "run_state", { state: "completed", finalAssistantEventSeq: 5 })]);
        const result = splitAssistantRoundEvents(projected);
        expect(result.answers.map((item) => item.seq)).toEqual([5]);
        expect(result.processMessages.map((item) => item.seq)).toEqual([1, 4]);
    });
    it("falls back to the last assistant text for legacy completed rounds", () => {
        const result = splitAssistantRoundEvents(projectAgentEvents([event(1, "assistant_text", { text: "过程" }), event(2, "assistant_text", { text: "最终" }), event(3, "run_state", { state: "completed" })]));
        expect(result.answers.map((item) => item.seq)).toEqual([2]); expect(result.processMessages.map((item) => item.seq)).toEqual([1]);
    });
});
