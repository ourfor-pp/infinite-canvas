import { describe, expect, it } from "vitest";
import { buildConversationItems, projectAgentEvents, splitAssistantRoundEvents } from "./conversation-projection";
import type { AgentEvent } from "@/services/api/agent";

const event = (seq: number, kind: AgentEvent["kind"], payload: Record<string, unknown>, runId: string | null = "run-1"): AgentEvent => ({ sessionId: "s", seq, runId, kind, payload, createdAt: new Date(seq * 1000).toISOString() });

describe("conversation projection", () => {
    it("merges streaming text and tool results", () => {
        const result = projectAgentEvents([event(1, "assistant_text", { streamId: "a", delta: true, text: "你" }), event(2, "assistant_text", { streamId: "a", delta: true, text: "好" }), event(3, "assistant_text", { streamId: "a", text: "你好" }), event(4, "tool_call", { toolId: "t", toolName: "Read" }), event(5, "tool_result", { toolId: "t", output: "ok" })]);
        expect(result).toHaveLength(2); expect(result[0].text).toBe("你好"); expect(result[0].seq).toBe(3); expect(result[1].result?.seq).toBe(5);
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
    it("keeps the final streamed reply when a stale snapshot points at a missing sequence", () => {
        const result = splitAssistantRoundEvents(projectAgentEvents([
            event(1, "assistant_text", { streamId: "reply", delta: true, text: "最终" }),
            event(2, "assistant_text", { streamId: "reply", delta: true, text: "正文" }),
            event(3, "run_state", { state: "completed", finalAssistantEventSeq: 9 }),
        ]));
        expect(result.answers).toHaveLength(1);
        expect(result.answers[0].text).toBe("最终正文");
    });
    it("does not add a new timeline marker for a restart boundary", () => {
        const result = buildConversationItems([
            { ...event(1, "assistant_text", { text: "此前回复" }), createdAt: "2026-08-12T07:00:00.000Z" },
            { ...event(2, "run_state", { state: "idle", content: "从这里重新开始", forkSourceSeq: 2 }, null), createdAt: "2026-08-12T08:00:00.000Z" },
        ]);
        expect(result.filter((item) => item.type === "time")).toHaveLength(1);
        expect(result.at(-1)).toMatchObject({ type: "round", events: [expect.objectContaining({ payload: expect.objectContaining({ forkSourceSeq: 2 }) })] });
    });
    it("gives steer-separated rounds in the same run unique identities", () => {
        const result = buildConversationItems([
            event(1, "user_text", { text: "原请求", submissionMode: "direct" }),
            event(2, "run_state", { state: "running", content: "Agent 已开始处理" }),
            event(3, "user_text", { text: "补充要求", submissionMode: "steer" }),
            event(4, "run_state", { state: "running", content: "正在自动续接" }),
            event(5, "assistant_text", { text: "已按补充要求继续" }),
        ]);
        const rounds = result.filter((item) => item.type === "round");
        expect(rounds).toHaveLength(2);
        expect(new Set(rounds.map((item) => item.id)).size).toBe(2);
        expect(rounds.map((item) => item.runId)).toEqual(["run-1", "run-1"]);
        expect(rounds.at(-1)?.events.map((item) => item.seq)).toEqual([4, 5]);
    });
});
