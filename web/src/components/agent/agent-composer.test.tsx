import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { AgentComposer } from "./agent-composer";
import { EMPTY_COMPOSER_DOCUMENT } from "./agent-composer-model";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Agent 输入框", () => {
    it("发送成功后即使仍有焦点也会清空正文", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const props = {
            ready: true, busy: false, waiting: false, sending: false, uploading: false,
            attachments: [], skills: [], references: [], focusRequest: 0, followUpMode: "steer" as const,
            onDocumentChange: vi.fn(), onFollowUpModeChange: vi.fn(), onSend: vi.fn(), onCancel: vi.fn(), onUpload: vi.fn(), onRemoveAttachment: vi.fn(),
        };
        await act(async () => root.render(<AgentComposer {...props} document={{ version: 1, segments: [{ type: "text", text: "重新发送这条消息" }] }} />));
        const editor = holder.querySelector<HTMLElement>("[role='textbox']")!;
        editor.focus();
        expect(editor.textContent).toBe("重新发送这条消息");

        await act(async () => root.render(<AgentComposer {...props} document={EMPTY_COMPOSER_DOCUMENT} />));
        expect(editor.textContent).toBe("");

        await act(async () => root.unmount()); holder.remove();
    });

    it("引擎不可用时仍能编辑已有引用草稿，Enter 不发送且故障原因可见", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const onSend = vi.fn(), onDocumentChange = vi.fn();
        await act(async () => root.render(<AgentComposer document={{ version: 1, segments: [{ type: "text", text: "保留草稿" }] }} ready={false} unavailableReason="连接恢复中" busy={false} waiting={false} sending={false} uploading={false} attachments={[]} skills={[]} references={[]} focusRequest={0} followUpMode="steer" onDocumentChange={onDocumentChange} onFollowUpModeChange={vi.fn()} onSend={onSend} onCancel={vi.fn()} onUpload={vi.fn()} onRemoveAttachment={vi.fn()} />));
        const editor = holder.querySelector<HTMLElement>("[role='textbox']")!;
        expect(editor.getAttribute("contenteditable")).toBe("true");
        expect(holder.querySelector("[role='status']")?.textContent).toBe("连接恢复中");
        editor.textContent = "仍可输入";
        await act(async () => editor.dispatchEvent(new Event("input", { bubbles: true })));
        expect(onDocumentChange).toHaveBeenCalledWith({ version: 1, segments: [{ type: "text", text: "仍可输入" }] });
        await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
        expect(onSend).not.toHaveBeenCalled();
        expect(holder.querySelector<HTMLButtonElement>("[aria-label='发送']")?.disabled).toBe(true);
        await act(async () => root.unmount()); holder.remove();
    });

    it("超过三个附件时折叠为待发送附件摘要", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const attachments = Array.from({ length: 4 }, (_, index) => ({ id: `file-${index}`, fileId: `file-${index}`, name: `参考${index + 1}.png`, mimeType: "image/png", bytes: 1024, url: "", metadata: {}, createdAt: "2026-08-15T00:00:00.000Z" }));
        await act(async () => root.render(<AgentComposer document={EMPTY_COMPOSER_DOCUMENT} ready busy={false} waiting={false} sending={false} uploading={false} attachments={attachments} skills={[]} references={[]} focusRequest={0} followUpMode="steer" onDocumentChange={vi.fn()} onFollowUpModeChange={vi.fn()} onSend={vi.fn()} onCancel={vi.fn()} onUpload={vi.fn()} onRemoveAttachment={vi.fn()} />));
        const summary = holder.querySelector<HTMLButtonElement>("button[aria-label='查看 4 个待发送附件']");
        expect(summary).not.toBeNull();
        expect(holder.textContent).not.toContain("参考1.png");
        await act(async () => summary?.click());
        expect(holder.textContent).toContain("参考1.png");
        expect(summary?.getAttribute("aria-expanded")).toBe("true");
        await act(async () => root.unmount()); holder.remove();
    });
});
