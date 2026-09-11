import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { AgentConversationFlow, AgentUserLocator, AssistantRound, UserMessage } from "./agent-conversation-ui";

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

    it("非图片历史附件在对话内预览并保留下载入口", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const event = { sessionId: "session-1", seq: 8, runId: "run-1", kind: "user_text" as const, payload: { text: "请参考附件", attachments: [{ fileId: "file-1", name: "剧本.pdf", mimeType: "application/pdf", bytes: 2048 }] }, createdAt: new Date().toISOString() };
        await act(async () => root.render(<App><UserMessage event={event} theme={canvasThemes.light} restarting={false} /></App>));
        await act(async () => (holder.querySelector("button[aria-label='预览附件剧本.pdf']") as HTMLButtonElement).click());
        expect(document.body.querySelector("iframe[title='剧本.pdf']")).not.toBeNull();
        expect(document.body.textContent).toContain("下载原文件");
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
        const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="completed" />));
        expect(holder.querySelector(".agent-process-toggle")?.getAttribute("aria-expanded")).toBe("false");
        const copyButton = holder.querySelector("button[aria-label='复制本轮回复内容']");
        expect(copyButton).not.toBeNull();
        expect(copyButton?.className).not.toContain("absolute");
        expect(copyButton?.parentElement?.className).toContain("h-6");
        await act(async () => (copyButton as HTMLButtonElement).click());
        expect(writeText).toHaveBeenCalledWith("阶段性回复");
        await act(async () => root.unmount()); holder.remove();
    });

    it("复制本轮回复包含过程说明但排除思考文本", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        const events = [
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "assistant_text" as const, payload: { text: "我先读取当前剧本。" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 3, runId: "run-1", kind: "assistant_text" as const, payload: { text: "思考：核对角色关系。" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 4, runId: "run-1", kind: "assistant_text" as const, payload: { text: "剧本已经更新。" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 5, runId: "run-1", kind: "run_state" as const, payload: { state: "completed", finalAssistantEventSeq: 4 }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="completed" />));
        await act(async () => (holder.querySelector("button[aria-label='复制本轮回复内容']") as HTMLButtonElement).click());
        expect(writeText).toHaveBeenCalledWith("我先读取当前剧本。\n\n剧本已经更新。");
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

    it("Codex 启动和工具完成后的空档使用通用状态，原生看图时显示真实活动", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const started = { sessionId: "session-1", seq: 2, runId: "run-1", kind: "run_state" as const, payload: { state: "running", content: "Codex 已开始处理" }, createdAt: new Date().toISOString() };
        const tool = { ...started, seq: 3, kind: "tool_call" as const, payload: { toolId: "view-1", toolName: "查看图片", input: "primary.png" } };
        const result = { ...started, seq: 4, kind: "tool_result" as const, payload: { toolId: "view-1", toolName: "查看图片", output: "primary.png" } };
        for (const [events, text] of [
            [[started], "模型正在处理中…"],
            [[started, tool], "查看图片执行中"],
            [[started, { ...tool, result }], "模型正在处理中…"],
        ] as const) {
            await act(async () => root.render(<AssistantRound events={[...events]} theme={canvasThemes.light} status="running" />));
            expect(holder.querySelector(".agent-status-pill")?.textContent).toBe(text);
        }
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

    it("长思考使用可展开胶囊而不是承载全文的黑色 Tooltip", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const longThinking = "正在读取故事、剧本、角色、场景和道具，并检查它们与当前分镜及时间线之间的连续性关系，准备下一步导演方案。";
        const events = [{ sessionId: "session-1", seq: 3, runId: "run-1", kind: "thinking" as const, payload: { text: longThinking }, createdAt: new Date().toISOString() }];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="running" />));
        const button = holder.querySelector("button[aria-label='查看完整思考状态']");
        expect(button).not.toBeNull();
        expect(button?.className).toContain("agent-status-pill-button");
        expect(button?.getAttribute("title")).toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });

    it("工具步骤合并前置思考，耗时只在展开卡片中显示，详情可独立收起", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const base = { sessionId: "session-1", runId: "run-1", createdAt: "2026-09-11T00:00:00.000Z" };
        const result = { ...base, seq: 5, kind: "tool_result" as const, payload: { toolId: "tool-1", output: "读取成功", finishedAt: "2026-09-11T00:00:02.000Z" } };
        const events = [
            { ...base, seq: 2, kind: "thinking" as const, payload: { text: "核对人物" } },
            { ...base, seq: 3, kind: "thinking" as const, payload: { text: "检查参考图" } },
            { ...base, seq: 4, kind: "tool_call" as const, payload: { toolId: "tool-1", toolName: "读取文件", input: { path: "character.md" } }, result },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="completed" />));
        await act(async () => (holder.querySelector(".agent-process-toggle") as HTMLButtonElement).click());
        expect(holder.querySelectorAll(".agent-process-step-toggle")).toHaveLength(1);
        const step = holder.querySelector(".agent-process-step-toggle") as HTMLButtonElement;
        expect(step.textContent).toContain("#1 · 已思考 · 读取文件");
        expect(step.textContent).not.toContain("2秒");
        expect(step.firstElementChild?.tagName.toLowerCase()).toBe("svg");
        await act(async () => step.click());
        expect(holder.textContent).toContain("完成 · 2秒");
        expect(holder.textContent).toContain("输入参数");
        expect(holder.textContent).toContain("输出内容");
        await act(async () => (holder.querySelector('[aria-label="收起工具内容"]') as HTMLButtonElement).click());
        expect(holder.textContent).not.toContain("输入参数");
        expect(step.getAttribute("aria-expanded")).toBe("true");
        await act(async () => root.unmount()); holder.remove();
    });

    it("工具失败时自动展开过程并显示失败数量", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "tool_call" as const, payload: { toolId: "tool-1", toolName: "director_generate_video_segment", input: {} }, result: { sessionId: "session-1", seq: 3, runId: "run-1", kind: "tool_result" as const, payload: { toolId: "tool-1", toolName: "director_generate_video_segment", output: "生成失败", isError: true }, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 4, runId: "run-1", kind: "run_state" as const, payload: { state: "failed" }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="failed" />));
        expect(holder.querySelector(".agent-process-toggle")?.getAttribute("aria-expanded")).toBe("true");
        expect(holder.querySelector(".agent-process-toggle")?.textContent).toContain("1 项失败");
        expect(holder.textContent).toContain("生成失败");
        await act(async () => root.unmount()); holder.remove();
    });

    it("失败过程自动展开后允许用户手动收起", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "tool_call" as const, payload: { toolId: "tool-1", toolName: "director_generate_video_segment", input: {} }, result: { sessionId: "session-1", seq: 3, runId: "run-1", kind: "tool_result" as const, payload: { toolId: "tool-1", toolName: "director_generate_video_segment", output: "生成失败", isError: true }, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 4, runId: "run-1", kind: "run_state" as const, payload: { state: "failed" }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="failed" />));
        const toggle = holder.querySelector(".agent-process-toggle") as HTMLButtonElement;
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        await act(async () => toggle.click());
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(holder.querySelector(".agent-process-content")).toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });

    it("多个工具失败时只自动展开最近一次失败详情", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const failedTool = (seq: number, output: string) => ({ sessionId: "session-1", seq, runId: "run-1", kind: "tool_call" as const, payload: { toolId: `tool-${seq}`, toolName: "director_generate_video_segment", input: {} }, result: { sessionId: "session-1", seq: seq + 1, runId: "run-1", kind: "tool_result" as const, payload: { toolId: `tool-${seq}`, toolName: "director_generate_video_segment", output, isError: true }, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString() });
        const events = [failedTool(2, "第一次失败"), failedTool(4, "第二次失败"), { sessionId: "session-1", seq: 6, runId: "run-1", kind: "run_state" as const, payload: { state: "failed" }, createdAt: new Date().toISOString() }];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="failed" />));
        expect(holder.querySelectorAll(".agent-process-step-toggle[aria-expanded='true']")).toHaveLength(1);
        expect(holder.textContent).not.toContain("第一次失败");
        expect(holder.textContent).toContain("第二次失败");
        await act(async () => root.unmount()); holder.remove();
    });

    it("待回答问题不在正在进行的对话流中重复显示", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const pending = {
            id: "question-1", kind: "question" as const, source: "ask_user" as const, runId: "run-1", content: "需要确认创作方向",
            questions: [{ id: "tone", question: "主角应该呈现怎样的气质？", type: "single_choice" as const, allowCustomInput: false, options: [{ label: "冷峻" }] }],
        };
        const events = [
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "assistant_text" as const, payload: { text: "我需要你补充一个选择。" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 3, runId: "run-1", kind: "question_request" as const, payload: pending, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="waiting_for_user" pendingDecision={pending} />));
        expect(holder.textContent).toContain("我需要你补充一个选择。");
        expect(holder.textContent).not.toContain("主角应该呈现怎样的气质？");
        expect(holder.textContent).not.toContain("需要确认创作方向");
        await act(async () => root.unmount()); holder.remove();
    });

    it("已回答追问按独立历史卡折叠展示", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "question_request" as const, payload: { id: "question-1", kind: "question", content: "确认方向", questions: [{ id: "tone", header: "气质", question: "主角是什么气质？", type: "single_choice", options: [{ label: "冷峻" }] }] }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 3, runId: "run-1", kind: "question_response" as const, payload: { decision: "approved", answers: { tone: "冷峻" } }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 4, runId: "run-1", kind: "run_state" as const, payload: { state: "completed" }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AssistantRound events={events} theme={canvasThemes.light} status="completed" />));
        await act(async () => (holder.querySelector(".agent-process-toggle") as HTMLButtonElement).click());
        const history = holder.querySelector(".agent-question-history-header") as HTMLButtonElement;
        expect(history.textContent).toContain("已完成回答");
        expect(history.textContent).toContain("1 个问题");
        expect(holder.textContent).not.toContain("主角是什么气质？");
        await act(async () => history.click());
        expect(holder.textContent).toContain("主角是什么气质？");
        expect(holder.textContent).toContain("冷峻");
        await act(async () => root.unmount()); holder.remove();
    });

    it("图片产物按文件去重并保持完整比例展示", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const artifact = (seq: number) => ({ sessionId: "session-1", seq, runId: "run-1", kind: "artifact" as const, payload: { fileId: "file-1", title: "故事板", mimeType: "image/png", url: "/files/file-1/content" }, createdAt: new Date().toISOString() });
        await act(async () => root.render(<AssistantRound events={[artifact(2), artifact(3)]} theme={canvasThemes.light} status="completed" />));
        expect(holder.querySelectorAll("img[alt='故事板']")).toHaveLength(1);
        expect(holder.querySelector("img[alt='故事板']")?.getAttribute("src")).toBe("/api/files/file-1/content");
        expect(holder.querySelector("img[alt='故事板']")?.className).toContain("object-contain");
        expect(holder.querySelector("img[alt='故事板']")?.className).not.toContain("object-cover");
        expect(holder.textContent).not.toContain("故事板");
        expect(holder.querySelector("a[download]")).not.toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });
});

describe("Agent 用户轮次定位", () => {
    it("从两条用户消息开始显示上游样式的定位轨道", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const scroll = document.createElement("div"); holder.append(scroll);
        const containerRef = { current: scroll };
        const events = [
            { sessionId: "session-1", seq: 1, runId: "run-1", kind: "user_text" as const, payload: { text: "第一条问题" }, createdAt: new Date().toISOString() },
            { sessionId: "session-1", seq: 2, runId: "run-2", kind: "user_text" as const, payload: { text: "第二条问题" }, createdAt: new Date().toISOString() },
        ];
        await act(async () => root.render(<AgentUserLocator events={events} containerRef={containerRef} theme={canvasThemes.light} />));
        expect(holder.querySelector(".agent-user-locator-dots")?.children).toHaveLength(2);
        expect(holder.querySelector("[aria-label='用户消息快速定位列表']")).not.toBeNull();
        expect(holder.querySelector("button[aria-label='定位到第 2 条用户消息：第二条问题']")).not.toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });
});

describe("Agent 实时回合归属", () => {
    it("新消息已发出但新回合事件未到时，不把运行状态套到上一轮", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const events = [
            { sessionId: "session-1", seq: 1, runId: "run-1", kind: "user_text" as const, payload: { text: "先完成故事" }, createdAt: "2026-08-13T05:00:00.000Z" },
            { sessionId: "session-1", seq: 2, runId: "run-1", kind: "assistant_text" as const, payload: { text: "故事已完成" }, createdAt: "2026-08-13T05:00:01.000Z" },
            { sessionId: "session-1", seq: 3, runId: "run-1", kind: "run_state" as const, payload: { state: "completed", content: "Agent 执行完成", finalAssistantEventSeq: 2 }, createdAt: "2026-08-13T05:00:02.000Z" },
            { sessionId: "session-1", seq: 4, runId: "run-2", kind: "user_text" as const, payload: { text: "继续写剧本" }, createdAt: "2026-08-13T05:01:00.000Z" },
        ];
        await act(async () => root.render(<AgentConversationFlow events={events} loading={false} theme={canvasThemes.light} canLoadEarlier={false} loadingEarlier={false} onLoadEarlier={() => undefined} onSuggestion={() => undefined} status="running" currentRunId="run-2" />));
        expect(holder.textContent).toContain("故事已完成");
        expect(holder.textContent).toContain("继续写剧本");
        expect(holder.textContent).not.toContain("Agent 执行完成");
        expect(holder.querySelectorAll(".agent-status-pill")).toHaveLength(1);
        expect(holder.querySelector(".agent-status-pill")?.textContent).toBe("模型正在处理中…");
        expect(holder.querySelectorAll(".agent-assistant-round")[0].querySelector(".agent-status-pill")).toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });
});


describe("Agent 提交消息即时反馈", () => {
    it("首条消息立即显示发送中，SSE 先确认时去重并切换到真实回合", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const pending = { sessionId: "session-1", seq: -1, runId: null, kind: "user_text" as const, payload: { clientMessageId: "message-1", text: "修订吧" }, createdAt: new Date().toISOString() };
        const props = { loading: false, theme: canvasThemes.light, canLoadEarlier: false, loadingEarlier: false, onLoadEarlier: () => {}, onSuggestion: () => {} };
        await act(async () => root.render(<AgentConversationFlow {...props} events={[]} pendingMessage={pending} status="idle" />));
        expect(holder.querySelectorAll(".agent-user-bubble")).toHaveLength(1);
        expect(holder.querySelector(".agent-status-pill")?.textContent).toBe("正在发送…");
        const accepted = { ...pending, seq: 1, runId: "run-1" };
        await act(async () => root.render(<AgentConversationFlow {...props} events={[accepted]} pendingMessage={pending} status="running" currentRunId="run-1" />));
        expect(holder.querySelectorAll(".agent-user-bubble")).toHaveLength(1);
        expect(holder.querySelectorAll(".agent-status-pill")).toHaveLength(1);
        expect(holder.querySelector(".agent-status-pill")?.textContent).toBe("模型正在处理中…");
        const started = { ...accepted, seq: 2, kind: "run_state" as const, payload: { state: "running", content: "Codex 已开始处理" } };
        await act(async () => root.render(<AgentConversationFlow {...props} events={[accepted, started]} status="running" currentRunId="run-1" />));
        expect(holder.querySelectorAll(".agent-status-pill")).toHaveLength(1);
        await act(async () => root.unmount()); holder.remove();
    });

    it("发送失败撤回临时显示，不把新状态绑定到其他回合", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        const old = { sessionId: "session-1", seq: 1, runId: "run-old", kind: "assistant_text" as const, payload: { text: "上轮结果" }, createdAt: new Date().toISOString() };
        const pending = { ...old, seq: -1, runId: null, kind: "user_text" as const, payload: { clientMessageId: "pending-1", text: "新请求" } };
        const props = { loading: false, theme: canvasThemes.light, canLoadEarlier: false, loadingEarlier: false, onLoadEarlier: () => {}, onSuggestion: () => {} };
        await act(async () => root.render(<AgentConversationFlow {...props} events={[old]} pendingMessage={pending} status="completed" />));
        expect(holder.querySelectorAll(".agent-assistant-round")[0].querySelector(".agent-status-pill")).toBeNull();
        await act(async () => root.render(<AgentConversationFlow {...props} events={[old]} status="completed" />));
        expect(holder.textContent).toContain("上轮结果");
        expect(holder.textContent).not.toContain("新请求");
        expect(holder.querySelector(".agent-status-pill")).toBeNull();
        await act(async () => root.unmount()); holder.remove();
    });
});
