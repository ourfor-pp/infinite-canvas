import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/services/api/agent";
import { mergeEvents } from "./local-agent-panel";

const event = (sessionId: string, seq: number, kind: AgentEvent["kind"]): AgentEvent => ({ sessionId, seq, runId: null, kind, payload: {}, createdAt: new Date().toISOString() });
const streamEvent = (seq: number, text: string, delta = true): AgentEvent => ({ ...event("branch", seq, "thinking"), payload: { streamId: "thinking-1", text, delta } });

describe("Agent 会话事件合并", () => {
    it("不会把旧线程的同序号事件合入当前分支", () => {
        const branch = event("branch", 3, "run_state");
        const sourceUser = event("source", 3, "user_text");
        const sourceCanceled = event("source", 4, "run_state");

        expect(mergeEvents([branch], [sourceUser, sourceCanceled])).toEqual([branch]);
    });

    it("较旧的接口快照不会删掉已经收到的流式增量", () => {
        const user = event("branch", 4, "user_text");
        const streamed = event("branch", 5, "thinking");

        expect(mergeEvents([user, streamed], [user])).toEqual([user, streamed]);
    });

    it("实时压缩同一思考流，避免长任务堆积数万条 React 事件", () => {
        const merged = Array.from({ length: 30_000 }, (_, index) => streamEvent(index + 1, "字"))
            .reduce<AgentEvent[]>((current, incoming) => mergeEvents(current, [incoming]), []);

        expect(merged).toHaveLength(1);
        expect(merged[0].seq).toBe(30_000);
        expect(merged[0].payload.text).toHaveLength(30_000);
    });

    it("以服务端最终快照替换实时拼接内容且不重复追加", () => {
        const live = mergeEvents([streamEvent(1, "前")], [streamEvent(2, "后")]);
        const snapshot = streamEvent(2, "前后", false);

        expect(mergeEvents(live, [snapshot])).toEqual([snapshot]);
    });
});
