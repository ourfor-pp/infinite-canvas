import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { AgentComposer } from "@/components/agent/agent-composer";
import { AgentConversationFlow } from "@/components/agent/agent-conversation-ui";
import { AgentApprovalBar, AgentQuestionComposer } from "@/components/agent/agent-decision-dock";
import { EMPTY_COMPOSER_DOCUMENT } from "@/components/agent/agent-composer-model";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentComposerDocument, AgentEvent } from "@/services/api/agent";
import "@/styles/globals.css";

const events: AgentEvent[] = [
    { sessionId: "s", runId: "done", seq: 1, kind: "user_text", payload: { text: "请分析当前画布" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 2, kind: "assistant_text", payload: { text: "我先读取画布最新状态。" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 3, kind: "thinking", payload: { text: "先读取故事和创作资产" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 4, kind: "tool_call", payload: { toolId: "t", toolName: "canvas_read", input: {} }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 5, kind: "tool_result", payload: { toolId: "t", output: "ok" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 6, kind: "assistant_text", payload: { text: "## 画布结构\n\n画布结构已经读取完成。" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 7, kind: "run_state", payload: { state: "completed", content: "Agent 执行完成", finalAssistantEventSeq: 6 }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "running", seq: 8, kind: "user_text", payload: { text: "继续完善" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "running", seq: 9, kind: "run_state", payload: { state: "running", content: "Agent 已开始处理" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "running", seq: 10, kind: "thinking", payload: { text: "正在读取故事、剧本、角色、场景和道具，并检查它们与当前分镜及时间线之间的连续性关系，准备下一步导演方案。" }, createdAt: new Date().toISOString() },
];

function Page() {
    const [document, setDocument] = useState<AgentComposerDocument>(EMPTY_COMPOSER_DOCUMENT); const [sent, setSent] = useState(0); const [mode, setMode] = useState<"steer" | "queue">("steer");
    const state = new URLSearchParams(location.search).get("state");
    const decide = async () => undefined;
    return <ConfigProvider><main className="agent-panel-shell mx-auto flex h-screen w-[460px] flex-col overflow-hidden"><div className="min-h-0 flex-1 overflow-y-auto p-4"><AgentConversationFlow events={events} loading={false} theme={canvasThemes.light} canLoadEarlier={false} loadingEarlier={false} onLoadEarlier={() => undefined} onSuggestion={() => undefined} status="running" currentRunId="running" /></div>{state === "question" ? <AgentQuestionComposer busy={false} onDecide={decide} pending={{ id: "q", kind: "question", source: "ask_user", runId: "running", content: "需要确认关键创作方向", questions: [{ id: "tone", question: "主角第一次出场应呈现怎样的气质？", type: "single_choice", allowCustomInput: true, options: [{ label: "清醒坚韧 (Recommended)", description: "与当前剧本的成长线最一致" }, { label: "冷峻疏离", description: "强化距离感和神秘感" }, { label: "外柔内刚", description: "前后反差更明显" }] }] }} /> : state === "approval" ? <><AgentApprovalBar busy={false} onDecide={decide} pending={{ id: "a", kind: "approval", source: "policy", runId: "running", content: "允许 Agent 写入项目工作区", scopes: ["once", "session"] }} /><AgentComposer document={document} ready busy waiting sending={false} uploading={false} attachments={[]} skills={[]} references={[]} focusRequest={0} followUpMode="queue" onDocumentChange={setDocument} onFollowUpModeChange={setMode} onSend={() => undefined} onCancel={() => undefined} onUpload={() => undefined} onRemoveAttachment={() => undefined} /></> : <AgentComposer document={document} ready busy waiting={false} sending={false} uploading={false} attachments={[]} skills={[{ id: "story", name: "写故事", description: "创建完整故事" }]} references={[{ key: "canvas:n", label: "故事", detail: "文本", segment: { type: "canvas", mentionId: "n", projectId: "p", nodeId: "n" } }]} focusRequest={0} followUpMode={mode} onDocumentChange={setDocument} onFollowUpModeChange={setMode} onSend={() => setSent((value) => value + 1)} onCancel={() => undefined} onUpload={() => undefined} onRemoveAttachment={() => undefined} />}<output data-testid="sent">{sent}</output></main></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Page />);
