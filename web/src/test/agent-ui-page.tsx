import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { AgentComposer } from "@/components/agent/agent-composer";
import { AgentConversationFlow } from "@/components/agent/agent-conversation-ui";
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
    { sessionId: "s", runId: "done", seq: 6, kind: "assistant_text", payload: { text: "画布结构已经读取完成。" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "done", seq: 7, kind: "run_state", payload: { state: "completed", content: "Agent 执行完成", finalAssistantEventSeq: 6 }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "running", seq: 8, kind: "user_text", payload: { text: "继续完善" }, createdAt: new Date().toISOString() },
    { sessionId: "s", runId: "running", seq: 9, kind: "run_state", payload: { state: "running", content: "Agent 已开始处理" }, createdAt: new Date().toISOString() },
];

function Page() {
    const [document, setDocument] = useState<AgentComposerDocument>(EMPTY_COMPOSER_DOCUMENT); const [sent, setSent] = useState(0); const [mode, setMode] = useState<"steer" | "queue">("steer");
    return <ConfigProvider><main className="agent-panel-shell mx-auto flex h-screen w-[460px] flex-col overflow-hidden"><div className="min-h-0 flex-1 overflow-y-auto p-4"><AgentConversationFlow events={events} loading={false} theme={canvasThemes.light} canLoadEarlier={false} loadingEarlier={false} onLoadEarlier={() => undefined} onSuggestion={() => undefined} status="running" /></div><AgentComposer document={document} projectId="p" ready busy waiting={false} sending={false} uploading={false} attachments={[]} skills={[{ id: "story", name: "写故事", description: "创建完整故事" }]} nodes={[{ id: "n", nodeId: "n", kind: "text", label: "T1", title: "故事", active: true }]} focusRequest={0} followUpMode={mode} onDocumentChange={setDocument} onFollowUpModeChange={setMode} onSend={() => setSent((value) => value + 1)} onCancel={() => undefined} onUpload={() => undefined} onRemoveAttachment={() => undefined} /><output data-testid="sent">{sent}</output></main></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Page />);
