import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import type { AgentPendingDecision } from "@/services/api/agent";
import { AgentApprovalBar, AgentQuestionComposer } from "./agent-decision-dock";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;

const question: AgentPendingDecision = {
    id: "decision-1", kind: "question", source: "ask_user", runId: "run-1", content: "需要确认创作方向",
    questions: [{ id: "tone", question: "主角的气质偏向哪一种？", type: "single_choice", allowCustomInput: true, options: [{ label: "冷峻克制" }, { label: "清醒坚韧 (Recommended)", description: "更符合当前剧本" }] }],
};

describe("Agent 决策输入区", () => {
    it("结构化提问把推荐项排在前面并提交答案", async () => {
        vi.useFakeTimers();
        const decide = vi.fn(async () => undefined);
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<App><AgentQuestionComposer pending={question} busy={false} onDecide={decide} /></App>));
        const labels = Array.from(holder.querySelectorAll(".agent-question-option-title")).map((node) => node.textContent);
        expect(labels[0]).toContain("清醒坚韧推荐");
        const recommended = Array.from(holder.querySelectorAll("label")).find((node) => node.textContent?.includes("清醒坚韧"));
        await act(async () => { (recommended as HTMLElement).click(); vi.advanceTimersByTime(200); });
        expect(decide).toHaveBeenCalledWith("approved", "once", undefined, { tone: "清醒坚韧 (Recommended)" });
        await act(async () => root.unmount()); holder.remove(); vi.useRealTimers();
    });

    it("审批使用独立固定栏而不是提问卡", async () => {
        const decide = vi.fn(async () => undefined);
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<App><AgentApprovalBar pending={{ id: "a", kind: "approval", source: "policy", runId: "r", content: "允许执行文件写入", scopes: ["once", "session"] }} busy={false} onDecide={decide} /></App>));
        expect(holder.querySelector(".agent-approval-bar")).not.toBeNull();
        expect(holder.querySelector(".agent-question-card")).toBeNull();
        expect(holder.textContent).toContain("允许一次");
        expect(holder.textContent).toContain("本会话记住");
        await act(async () => root.unmount()); holder.remove();
    });

    it("带选项的开放题同时显示选项、自定义答案和跳过操作", async () => {
        const decide = vi.fn(async () => undefined);
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<App><AgentQuestionComposer pending={{
            id: "mixed", kind: "question", source: "ask_user", runId: "run", content: "补充画面信息",
            questions: [{ id: "size", question: "画面使用什么比例？", type: "text", allowCustomInput: true, options: [{ label: "16:9", description: "横版视频" }, { label: "9:16", description: "竖版视频" }] }],
        }} busy={false} onDecide={decide} /></App>));
        expect(holder.querySelectorAll("input[type='radio']")).toHaveLength(2);
        expect(holder.querySelector("input[aria-label='其他答案']")).not.toBeNull();
        expect(holder.textContent?.replace(/\s/g, "")).toContain("跳过");
        const skip = Array.from(holder.querySelectorAll("button")).find((button) => button.textContent?.replace(/\s/g, "").includes("跳过"));
        expect(skip).toBeTruthy();
        await act(async () => skip?.click());
        expect(decide).toHaveBeenCalledWith("approved", "once", undefined, {});
        await act(async () => root.unmount()); holder.remove();
    });

    it("纯文本题使用输入区且提交失败时保留草稿", async () => {
        const decide = vi.fn(async () => { throw new Error("network"); });
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<App><AgentQuestionComposer pending={{
            id: "text", kind: "question", source: "ask_user", runId: "run", content: "补充信息",
            questions: [{ id: "detail", question: "请补充动作细节", type: "text", allowCustomInput: true, options: [] }],
        }} busy={false} onDecide={decide} /></App>));
        const input = holder.querySelector("textarea[aria-label='请补充动作细节']") as HTMLTextAreaElement;
        await act(async () => { input.value = "人物转身后停顿"; input.dispatchEvent(new Event("input", { bubbles: true })); });
        const submit = Array.from(holder.querySelectorAll("button")).find((button) => button.textContent?.replace(/\s/g, "").includes("提交"));
        await act(async () => submit?.click());
        expect(input.value).toBe("人物转身后停顿");
        await act(async () => root.unmount()); holder.remove();
    });
});
