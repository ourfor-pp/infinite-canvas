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
});
