import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { AssistantRound, UserMessage } from "./agent-conversation-ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;

describe("Agent 用户消息气泡", () => {
    it("提供复制和从消息创建分支操作", async () => {
        const restart = vi.fn();
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<App><UserMessage event={{ sessionId: "session-1", seq: 7, runId: "run-1", kind: "user_text", payload: { text: "请把故事写得更克制", content: { version: 1, segments: [{ type: "text", text: "请把故事写得更克制" }] } }, createdAt: new Date().toISOString() }} theme={canvasThemes.light} restarting={false} onRestart={restart} /></App>));

        expect(holder.querySelector("button[aria-label='复制消息内容']")).not.toBeNull();
        const bubble = holder.querySelector("article > div");
        expect(bubble?.className).toContain("agent-user-bubble");
        expect(bubble?.className).toContain("rounded-[18px_18px_5px_18px]");
        expect(bubble?.className).toContain("px-3.5");
        expect(bubble?.parentElement?.className).toContain("max-w-[88%]");
        await act(async () => (holder.querySelector("button[aria-label='从这条消息重新开始']") as HTMLButtonElement).click());
        expect(document.body.textContent).toContain("会新建分支并把这条消息填回输入框；画布和工作目录不会回滚。");
        const confirm = Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "确认重新开始");
        await act(async () => confirm?.click());
        expect(restart).toHaveBeenCalledWith(expect.objectContaining({ seq: 7, kind: "user_text" }));
        await act(async () => root.unmount()); holder.remove();
    });
});

describe("Agent 助手回合", () => {
    const processEvents = [
        { sessionId: "session-1", seq: 2, runId: "run-1", kind: "thinking" as const, payload: { text: "正在规划" }, createdAt: new Date().toISOString() },
        { sessionId: "session-1", seq: 3, runId: "run-1", kind: "assistant_text" as const, payload: { text: "阶段性回复" }, createdAt: new Date().toISOString() },
    ];

    it("运行中的过程默认折叠且不显示复制", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<AssistantRound events={processEvents} theme={canvasThemes.light} status="running" />));
        expect(holder.querySelector(".agent-process-toggle")?.getAttribute("aria-expanded")).toBe("false");
        expect(holder.querySelector(".agent-process-toggle")?.textContent).toContain("思考 1 轮");
        expect(holder.querySelector(".agent-process-toggle")?.textContent).not.toContain("正在执行");
        expect(holder.querySelector("button[aria-label='复制本轮回复内容']")).toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });

    it("完成后才提供整轮复制", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [...processEvents, { sessionId: "session-1", seq: 4, runId: "run-1", kind: "run_state" as const, payload: { state: "completed", finalAssistantEventSeq: 3 }, createdAt: new Date().toISOString() }];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="completed" />));
        expect(holder.querySelector(".agent-process-toggle")?.getAttribute("aria-expanded")).toBe("false");
        const copyButton = holder.querySelector("button[aria-label='复制本轮回复内容']");
        expect(copyButton).not.toBeNull();
        expect(copyButton?.className).not.toContain("absolute");
        expect(copyButton?.parentElement?.className).toContain("h-6");
        await act(async () => root.unmount()); holder.remove();
    });

    it("完成后隐藏终态胶囊，并把已处理审批收进折叠过程", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [
            ...processEvents,
            { sessionId: "session-1", seq: 4, runId: "run-1", kind: "approval_request" as const, payload: { id: "approval-1", kind: "approval", content: "确认创建角色" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 5, runId: "run-1", kind: "approval_response" as const, payload: { decision: "approved" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 6, runId: "run-1", kind: "run_state" as const, payload: { state: "completed", finalAssistantEventSeq: 3 }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="completed" />));
        expect(holder.querySelector(".agent-status-pill")).toBeNull();
        expect(holder.textContent).not.toContain("确认创建角色");
        await act(async () => (holder.querySelector(".agent-process-toggle") as HTMLButtonElement).click());
        expect(holder.textContent).toContain("确认创建角色");
        expect(holder.textContent).toContain("已允许");
        await act(async () => root.unmount()); holder.remove();
    });

    it("将旧分支状态文案统一显示为重新开始边界", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [{ sessionId: "branch-1", seq: 3, runId: null, kind: "run_state" as const, payload: { state: "idle", content: "从历史消息创建新分支", forkSourceSeq: 3 }, createdAt: new Date().toISOString() }];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="idle" />));
        expect(holder.textContent).toContain("从这里重新开始");
        expect(holder.textContent).not.toContain("从历史消息创建新分支");
        expect(holder.querySelector(".agent-meta-note")).not.toBeNull();
        expect(holder.querySelector(".agent-status-pill")).toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });

    it("服务端会话已失败时不再显示残留的运行中状态", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [{ sessionId: "session-1", seq: 2, runId: "run-1", kind: "run_state" as const, payload: { state: "running", content: "Agent 已开始处理" }, createdAt: new Date().toISOString() }];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="failed" />));
        expect(holder.textContent).toContain("Agent 执行失败");
        expect(holder.textContent).not.toContain("Agent 已开始处理");
        await act(async () => root.unmount()); holder.remove();
    });

    it("运行中用最近思考替代瞬时启动状态", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "run_state" as const, payload: { state: "running", content: "Agent 已开始处理" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 3, runId: "run-1", kind: "thinking" as const, payload: { text: "正在核对场景和道具资产" }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="running" />));
        expect(holder.querySelector(".agent-status-pill")?.textContent).toBe("思考：正在核对场景和道具资产");
        expect(holder.textContent).not.toContain("Agent 已开始处理");
        await act(async () => root.unmount()); holder.remove();
    });
});
