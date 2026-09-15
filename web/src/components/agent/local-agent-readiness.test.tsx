import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "antd";
import { expect, it, vi } from "vitest";
import { LocalAgentPanel } from "./local-agent-panel";
import { agentApi } from "@/services/api/agent";

vi.mock("@/services/api/agent", async (original) => ({ ...await original<object>(), subscribeAgent: () => () => {} }));
vi.mock("./codex-model-picker", () => ({ CodexModelPicker: () => null }));
vi.mock("./agent-draft-storage", () => ({ agentDraftStorage: { get: async () => ({ version: 1, document: { version: 1, segments: [{ type: "text", text: "尚未发送的草稿" }] }, attachments: [], followUpMode: "steer" }), set: async () => {}, remove: async () => {} } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("画布 Codex 会话重新检查就绪状态，恢复发送按钮并保留草稿", async () => {
    const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const capabilities = { sceneId: "canvas", engines: [{ id: "codex", ready: false, reason: "尚未验证运行环境" }], skills: [], referenceKinds: [], composer: { placeholder: "描述任务", referenceLabel: "引用", emptyTitle: "开始", emptyDescription: "", suggestions: [] } } as Awaited<ReturnType<typeof agentApi.capabilities>>;
    const ready = { ...capabilities, engines: [{ id: "codex" as const, ready: true, reason: "" }] };
    let finish!: (value: typeof capabilities) => void;
    vi.spyOn(agentApi, "capabilities").mockResolvedValueOnce(capabilities).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(ready);
    vi.spyOn(agentApi, "config").mockResolvedValue({ ready: true, protocolVersion: 4, storageVersion: 2 } as Awaited<ReturnType<typeof agentApi.config>>);
    vi.spyOn(agentApi, "references").mockResolvedValue([]);
    vi.spyOn(agentApi, "turnIndex").mockResolvedValue([]);
    const session = { id: "codex-readiness", projectId: "canvas-readiness", engine: "codex", title: "Codex", status: "idle", eventSeq: 0, pendingDecision: null, events: [] } as unknown as Awaited<ReturnType<typeof agentApi.conversation>>["session"];
    vi.spyOn(agentApi, "conversation").mockResolvedValue({ projectId: "canvas-readiness", session, sessions: [session!], queuedMessages: [] });
    const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
    try {
        await act(async () => root.render(<MemoryRouter><App><LocalAgentPanel projectId="canvas-readiness" /></App></MemoryRouter>));
        expect(holder.querySelector<HTMLButtonElement>("[aria-label='发送']")?.disabled).toBe(true);
        expect(finish).toBeTypeOf("function");
        await act(async () => finish(ready));
        expect(holder.querySelector<HTMLButtonElement>("[aria-label='发送']")?.disabled).toBe(false);
        expect(holder.querySelector("[role='textbox']")?.textContent).toBe("尚未发送的草稿");
    } finally { await act(async () => root.unmount()); holder.remove(); vi.unstubAllGlobals(); if (scrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollTo); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); }
});
