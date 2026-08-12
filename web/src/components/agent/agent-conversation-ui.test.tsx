import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { UserMessage } from "./agent-conversation-ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;

describe("Agent 用户消息气泡", () => {
    it("提供复制和从消息创建分支操作", async () => {
        const restart = vi.fn();
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<App><UserMessage event={{ sessionId: "session-1", seq: 7, runId: "run-1", kind: "user_text", payload: { text: "请把故事写得更克制", content: { version: 1, segments: [{ type: "text", text: "请把故事写得更克制" }] } }, createdAt: new Date().toISOString() }} theme={canvasThemes.light} restarting={false} onRestart={restart} /></App>));

        expect(holder.querySelector("button[aria-label='复制消息内容']")).not.toBeNull();
        await act(async () => (holder.querySelector("button[aria-label='从这条消息重新开始']") as HTMLButtonElement).click());
        expect(document.body.textContent).toContain("会新建分支并把这条消息填回输入框；画布和工作目录不会回滚。");
        const confirm = Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "确认重新开始");
        await act(async () => confirm?.click());
        expect(restart).toHaveBeenCalledWith(expect.objectContaining({ seq: 7, kind: "user_text" }));
        await act(async () => root.unmount()); holder.remove();
    });
});
