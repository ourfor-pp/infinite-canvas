import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ComponentRef, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Button, Checkbox, Empty, Image, Input, Modal, Popconfirm, Popover, Select, Tooltip } from "antd";
import {
    Archive, ArrowDown, AtSign, Brain, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleSlash2, Download, Eye,
    Clock3, Copy, File, FileAudio, FileText, FileVideo, GitFork, History, ImageIcon, Pencil,
    LoaderCircle, MessageCircleQuestion, Paperclip, Search, Send, ShieldAlert, Sparkles, Square, Trash2, Wrench, X,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { formatAgentToolName } from "./tool-display-name";
import { buildConversationItems, decisionFromRequest, eventText, projectAgentEvents, splitAssistantRoundEvents, type ProjectedAgentEvent as ProjectedEvent } from "./conversation-projection";
import { getVirtualWindow } from "./conversation-virtualizer";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { AgentEntityReference } from "@/stores/use-agent-store";
import type { AgentEvent, AgentPendingDecision, AgentSession, AgentSkill, AgentTurnIndexItem } from "@/services/api/agent";
import { serverApiUrl, type ServerFile } from "@/services/api/server";
import { useCopyText } from "@/hooks/use-copy-text";

export function AgentConversationFlow({
    events,
    loading,
    theme,
    emptyState,
    canLoadEarlier,
    loadingEarlier,
    onLoadEarlier,
    onSuggestion,
    pendingDecision,
    status,
    currentRunId,
    restartingMessageSeq,
    onRestartFromMessage,
    onBeforeProcessAutoCollapse,
}: {
    events: AgentEvent[];
    loading: boolean;
    theme: CanvasTheme;
    emptyState?: { emptyTitle: string; emptyDescription: string; suggestions: string[] };
    canLoadEarlier: boolean;
    loadingEarlier: boolean;
    onLoadEarlier: () => void;
    onSuggestion: (text: string) => void;
    pendingDecision?: AgentPendingDecision | null;
    status?: AgentSession["status"];
    currentRunId?: string | null;
    restartingMessageSeq?: number | null;
    onRestartFromMessage?: (event: ProjectedEvent) => void;
    onBeforeProcessAutoCollapse?: (element: HTMLElement) => void;
}) {
    const items = useMemo(() => buildConversationItems(events), [events]);
    const activeRoundId = useMemo(() => {
        if (!currentRunId) return undefined;
        for (let index = items.length - 1; index >= 0; index -= 1) { const item = items[index]; if (item.type === "round" && item.runId === currentRunId) return item.id; }
        return undefined;
    }, [currentRunId, items]);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [windowState, setWindowState] = useState({ top: 0, height: 640 });
    const [, refreshMeasurements] = useState(0);
    const heightsRef = useRef(new Map<string, number>());
    const estimates = items.map((item) => heightsRef.current.get(item.id) || (item.type === "time" ? 28 : item.type === "user" ? 96 : 180));
    const virtual = getVirtualWindow(estimates, windowState.top, windowState.height, items.length > 80);
    const historyOffset = items.length > 80 && canLoadEarlier ? 40 : 0;
    useEffect(() => {
        const viewport = viewportRef.current?.parentElement; if (!viewport || items.length <= 80) return;
        const update = () => setWindowState({ top: viewport.scrollTop, height: viewport.clientHeight }); update(); viewport.addEventListener("scroll", update, { passive: true }); return () => viewport.removeEventListener("scroll", update);
    }, [items.length]);
    const recordHeight = useCallback((id: string, height: number) => {
        if (Math.abs((heightsRef.current.get(id) || 0) - height) < 1) return;
        heightsRef.current.set(id, height);
        refreshMeasurements((value) => value + 1);
    }, []);
    if (loading) return <div className="grid h-full place-items-center"><LoaderCircle className="size-5 animate-spin opacity-45" /></div>;
    if (!items.length) return <AgentEmpty theme={theme} value={emptyState} onSuggestion={onSuggestion} />;
    return (
        <div ref={viewportRef} className="relative space-y-4" style={items.length > 80 ? { height: virtual.total + historyOffset } : undefined}>
            {canLoadEarlier ? (
                <div className="pb-1 text-center">
                    <Button type="text" size="small" loading={loadingEarlier} onClick={onLoadEarlier}>加载更早消息</Button>
                </div>
            ) : null}
            {(items.length > 80 ? virtual.items.map((virtualItem) => ({ item: items[virtualItem.index], top: virtualItem.top })) : items.map((item) => ({ item, top: undefined }))).map(({ item, top }) => {
                const position = top === undefined ? undefined : { position: "absolute" as const, top: top + historyOffset, left: 0, right: 0 };
                if (item.type === "time") return <div key={item.id} className="agent-time-note"><time>{item.label}</time></div>;
                if (item.type === "user") return <Measured key={item.id} id={item.id} style={position} onHeight={recordHeight}><UserMessage event={item.event} theme={theme} restarting={restartingMessageSeq === item.event.seq} onRestart={onRestartFromMessage} /></Measured>;
                return <Measured key={item.id} id={item.id} className="agent-assistant-round" style={position} onHeight={recordHeight}><AssistantRound events={item.events} theme={theme} status={item.id === activeRoundId ? status : "completed"} pendingDecision={item.id === activeRoundId ? pendingDecision : null} onBeforeProcessAutoCollapse={onBeforeProcessAutoCollapse} /></Measured>;
            })}
        </div>
    );
}

function Measured({ id, className, style, onHeight, children }: { id: string; className?: string; style?: CSSProperties; onHeight: (id: string, height: number) => void; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { const node = ref.current; if (!node) return; const observer = new ResizeObserver(() => onHeight(id, node.offsetHeight + 16)); observer.observe(node); onHeight(id, node.offsetHeight + 16); return () => observer.disconnect(); }, [id, onHeight]);
    return <div ref={ref} className={className} style={{ ...style, contentVisibility: "auto", containIntrinsicSize: "0 112px" }}>{children}</div>;
}

function AgentEmpty({ theme, value, onSuggestion }: { theme: CanvasTheme; value?: { emptyTitle: string; emptyDescription: string; suggestions: string[] }; onSuggestion: (text: string) => void }) {
    const content = value || { emptyTitle: "和画布一起思考", emptyDescription: "Agent 已绑定当前项目，可以理解节点、修改画布并调用生成任务。", suggestions: ["拆解小说中的角色、场景和道具", "根据选中节点继续创作", "检查画布结构并给出建议"] };
    return (
        <div className="flex h-full min-h-[360px] items-center justify-center px-6 text-center">
            <div className="max-w-sm">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl" style={{ background: theme.toolbar.itemHover, color: theme.toolbar.activeText }}><Sparkles className="size-5" /></div>
                <h3 className="mt-4 text-base font-medium">{content.emptyTitle}</h3>
                <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>
                    {content.emptyDescription}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {content.suggestions.map((item) => <button key={item} type="button" onClick={() => onSuggestion(item)} className="rounded-full border bg-white px-3 py-1.5 text-xs transition hover:!border-blue-200 hover:!bg-blue-50 hover:!text-blue-700" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item}</button>)}
                </div>
            </div>
        </div>
    );
}

export const UserMessage = memo(function UserMessage({ event, theme, restarting, onRestart }: { event: ProjectedEvent; theme: CanvasTheme; restarting: boolean; onRestart?: (event: ProjectedEvent) => void }) {
    const text = eventText(event);
    const [expanded, setExpanded] = useState(false);
    const [visibleLimit, setVisibleLimit] = useState(4_000);
    const [previewFile, setPreviewFile] = useState<Record<string, unknown> | null>(null);
    const copyText = useCopyText();
    const long = text.length > 900 || text.split("\n").length > 12;
    const visibleText = text.length > visibleLimit ? `${text.slice(0, visibleLimit)}\n…` : text;
    const attachments = arrayOf<Record<string, unknown>>(event.payload.attachments);
    const references = arrayOf<Record<string, unknown>>(event.payload.references);
    const assetReferences = arrayOf<Record<string, unknown>>(event.payload.assetReferences);
    const styleReferences = arrayOf<Record<string, unknown>>(event.payload.styleReferences);
    const skill = recordOf(event.payload.skill);
    const images = attachments.filter((item) => String(item.mimeType || "").startsWith("image/") && item.fileId);
    const files = attachments.filter((item) => !String(item.mimeType || "").startsWith("image/") || !item.fileId);
    return (
        <div className="flex w-full scroll-mt-4 justify-end pl-10" data-agent-user-seq={event.seq}>
            <article className="group flex min-w-0 max-w-[88%] flex-col items-end">
                <div className="agent-user-bubble w-fit max-w-full rounded-[18px_18px_5px_18px] px-3.5 py-2.5 text-sm leading-6">
                {text ? <div className={`whitespace-pre-wrap break-words ${long && !expanded ? "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]" : ""}`}>{visibleText}</div> : null}
                {long ? <div className="mt-1 flex gap-3 text-xs font-medium opacity-55">{!expanded || text.length > visibleLimit ? <button type="button" className="hover:opacity-80" onClick={() => { setExpanded(true); setVisibleLimit((value) => Math.min(text.length, value + 12_000)); }}>{expanded ? "继续展开" : "展开全文"}</button> : null}{expanded ? <button type="button" className="hover:opacity-80" onClick={() => { setExpanded(false); setVisibleLimit(4_000); }}>收起</button> : null}</div> : null}
                {images.length ? <Image.PreviewGroup><div className="mt-2 grid grid-cols-3 gap-1.5">{images.map((item, index) => <Image key={String(item.fileId || index)} src={fileUrl(String(item.fileId))} alt={String(item.name || "图片附件")} className="!h-20 !w-full rounded-lg object-cover" />)}</div></Image.PreviewGroup> : null}
                {files.length || references.length || assetReferences.length || styleReferences.length || skill ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {skill?.name ? <MetaChip icon={<Sparkles className="size-3" />} text={`/${skill.name}`} /> : null}
                        {references.map((item, index) => <MetaChip key={`r-${index}`} icon={<AtSign className="size-3" />} text={String(item.title || "画布节点")} />)}
                        {assetReferences.map((item, index) => <MetaChip key={`a-${index}`} icon={<Sparkles className="size-3" />} text={String(item.name || "创作设定")} />)}
                        {styleReferences.map((item, index) => <MetaChip key={`s-${index}`} icon={<Sparkles className="size-3" />} text={String(item.name || "视觉风格")} />)}
                        {files.map((item, index) => item.fileId ? <button type="button" key={`f-${index}`} aria-label={`预览附件${String(item.name || "附件")}`} onClick={() => setPreviewFile(item)}><MetaChip icon={fileIcon(String(item.mimeType || ""))} text={String(item.name || "附件")} /></button> : <MetaChip key={`f-${index}`} icon={fileIcon(String(item.mimeType || ""))} text={String(item.name || "附件")} />)}
                    </div>
                ) : null}
                </div>
                {text ? <div className="mt-1.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Tooltip title="复制消息内容"><button type="button" aria-label="复制消息内容" onClick={() => copyText(text, "已复制消息内容")} className="grid size-7 place-items-center rounded-full border transition hover:-translate-y-px" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}><Copy className="size-3.5" /></button></Tooltip>
                    {onRestart ? <Popconfirm title="确认重新开始聊天线程？" description="会新建分支并把这条消息填回输入框；画布和工作目录不会回滚。" okText="确认重新开始" cancelText="取消" onConfirm={() => onRestart(event)}><Tooltip title="从这条消息重新开始"><button type="button" aria-label="从这条消息重新开始" disabled={restarting} className="grid size-7 place-items-center rounded-full border transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-40" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}><Pencil className="size-3.5" /></button></Tooltip></Popconfirm> : null}
                </div> : null}
                <Modal title={previewFile ? String(previewFile.name || "附件") : "附件"} open={Boolean(previewFile)} onCancel={() => setPreviewFile(null)} footer={previewFile?.fileId ? <a href={fileUrl(String(previewFile.fileId))} download className="inline-flex items-center gap-2"><Download className="size-4" />下载原文件</a> : null} width="min(920px, calc(100vw - 32px))" destroyOnHidden>{previewFile?.fileId ? <iframe title={String(previewFile.name || "附件预览")} src={fileUrl(String(previewFile.fileId))} sandbox="allow-same-origin" className="h-[min(70vh,720px)] w-full border-0 bg-white" /> : null}</Modal>
            </article>
        </div>
    );
}, (previous, next) => previous.theme === next.theme && previous.event.seq === next.event.seq && previous.event.payload === next.event.payload && previous.restarting === next.restarting && previous.onRestart === next.onRestart);

export const AssistantRound = memo(function AssistantRound({ events, theme, status, pendingDecision, onBeforeProcessAutoCollapse }: { events: ProjectedEvent[]; theme: CanvasTheme; status?: AgentSession["status"]; pendingDecision?: AgentPendingDecision | null; onBeforeProcessAutoCollapse?: (element: HTMLElement) => void }) {
    const process = events.filter((event) => event.kind === "thinking" || event.kind === "tool_call");
    const { processMessages, answers } = splitAssistantRoundEvents(events);
    const artifacts = events.filter((event) => event.kind === "artifact");
    const errors = events.filter((event) => event.kind === "error");
    const states = events.filter((event) => event.kind === "run_state");
    const requests = events.filter((event) => event.kind === "approval_request" || event.kind === "question_request");
    const responses = events.filter((event) => event.kind === "approval_response" || event.kind === "question_response");
    const decisionHistory = requests.flatMap((event, index) => {
        const request = decisionFromRequest(event);
        if (!request || pendingDecision?.id === request.id) return [];
        const nextRequest = requests[index + 1];
        const response = responses.find((item) => item.runId === event.runId && item.seq > event.seq && (!nextRequest || item.seq < nextRequest.seq));
        return [{ request, event, response }];
    });
    const latestState = states.at(-1);
    const roundCompleted = latestState?.payload.state === "completed" || status === "completed";
    const copyText = [...processMessages, ...answers].map(eventText).map((text) => text.trim()).filter((text) => text && !/^思考[：:]/.test(text)).join("\n\n");
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (!copyText) return;
        await navigator.clipboard.writeText(copyText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
    };
    return (
        <div className="group/round pr-1">
            {process.length || processMessages.length || decisionHistory.length ? <ProcessGroup events={process} processMessages={processMessages} decisions={decisionHistory} roundEvents={events} theme={theme} status={status} onBeforeAutoCollapse={onBeforeProcessAutoCollapse} /> : null}
            <div className="agent-streamdown relative mt-2 text-sm leading-6">
                {answers.map((event) => <Streamdown key={`${event.sessionId}:${event.seq}`} controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }} isAnimating={Boolean(event.payload.delta)}>{eventText(event)}</Streamdown>)}
                {copyText && roundCompleted ? <div className="mt-1 flex h-6 items-center"><Tooltip title={copied ? "已复制" : "复制回复"}><button type="button" aria-label="复制本轮回复内容" onClick={() => void copy()} className="grid size-6 place-items-center rounded-md opacity-0 transition hover:bg-black/5 group-hover/round:opacity-50 focus-visible:opacity-50 dark:hover:bg-white/10">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button></Tooltip></div> : null}
            </div>
            {artifacts.length ? <ArtifactStrip events={artifacts} theme={theme} /> : null}
            {errors.map((event) => <AgentErrorNotice key={event.seq} event={event} />)}
            <RoundStatus events={events} status={status} />
        </div>
    );
});

function AgentErrorNotice({ event }: { event: ProjectedEvent }) {
    const code = String(event.payload.code || "AGENT_RUN_FAILED");
    const raw = eventText(event);
    const known: Record<string, { title: string; message: string }> = {
        AGENT_DECISION_INTERRUPTED: { title: "这次确认已经失效", message: "原任务已经中断，请重新发送刚才的请求。" },
        AGENT_CLIENT_ACTION_TIMEOUT: { title: "页面操作等待超时", message: "请保持项目页面打开后重试。" },
        AGENT_QUEUE_RUNNING: { title: "消息正在发送", message: "这条排队消息已经开始执行，暂时不能删除。" },
        AGENT_RUN_FAILED: { title: "Agent 没有完成这轮任务", message: "可以直接重试；你的项目内容和草稿不会丢失。" },
    };
    const content = known[code] || { title: "Agent 执行遇到问题", message: raw || "请重试当前操作。" };
    return <div className="agent-error-notice"><CircleAlert className="size-4 shrink-0" /><div className="min-w-0"><strong>{content.title}</strong><p>{content.message}</p>{known[code] && raw && raw !== content.message ? <details><summary>查看技术详情</summary><pre>{code} · {raw}</pre></details> : null}</div></div>;
}

function ProcessGroup({ events, processMessages, decisions, roundEvents, theme, status, onBeforeAutoCollapse }: { events: ProjectedEvent[]; processMessages: ProjectedEvent[]; decisions: Array<{ request: AgentPendingDecision; event: ProjectedEvent; response?: ProjectedEvent }>; roundEvents: ProjectedEvent[]; theme: CanvasTheme; status?: AgentSession["status"]; onBeforeAutoCollapse?: (element: HTMLElement) => void }) {
    const groupRef = useRef<HTMLElement>(null);
    const [open, setOpen] = useState(false);
    const [showAllTools, setShowAllTools] = useState(false);
    const wasRunning = useRef(status === "running");
    const [now, setNow] = useState(Date.now());
    const tools = events.filter((event) => event.kind === "tool_call");
    const thinking = events.filter((event) => event.kind === "thinking");
    const terminal = Boolean(status && !["running", "waiting_for_user"].includes(status));
    const running = !terminal && (status === "running" || tools.some((event) => !event.result));
    const failed = tools.some((event) => Boolean(event.result?.payload.isError)) || status === "failed" || status === "canceled";
    const failedTools = tools.filter((event) => Boolean(event.result?.payload.isError)).length;
    const latestFailedToolSeq = [...tools].reverse().find((event) => Boolean(event.result?.payload.isError))?.seq;
    const runningTools = terminal ? 0 : tools.filter((event) => !event.result).length;
    const headerParts = [tools.length ? `${tools.length} 次工具调用` : "", runningTools ? `${runningTools} 项进行中` : "", failedTools ? `${failedTools} 项失败` : "", processMessages.length + decisions.length ? `${processMessages.length + decisions.length} 条过程记录` : "", thinking.length ? `思考 ${thinking.length} 轮` : ""].filter(Boolean);
    const visibleEvents = showAllTools || tools.length <= 6 ? events : events.filter((event) => event.kind === "thinking" || tools.slice(0, 4).includes(event) || tools.slice(-2).includes(event));
    const duration = roundDuration(roundEvents, running, now);
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    useEffect(() => {
        if (wasRunning.current && !running && open && !failed) { if (groupRef.current) onBeforeAutoCollapse?.(groupRef.current); setOpen(false); }
        if (failed) setOpen(true);
        wasRunning.current = running;
    }, [failed, onBeforeAutoCollapse, open, running]);
    return (
        <section ref={groupRef} className="agent-process-group">
            <button type="button" className="agent-process-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <ChevronRight className={`size-3.5 transition ${open ? "rotate-90" : ""}`} />
                <span>{headerParts.join(" · ") || "过程记录"}</span>
                {duration ? <em>本轮耗时 {duration}</em> : null}
            </button>
            {open ? (
                <div className="agent-process-content">
                    {visibleEvents.map((event) => event.kind === "thinking"
                        ? <ThinkingStep key={`${event.seq}`} event={event} theme={theme} />
                        : <ToolStep key={`${event.seq}`} event={event} theme={theme} now={now} terminalStatus={terminal ? status : undefined} autoOpenFailure={event.seq === latestFailedToolSeq} />)}
                    {tools.length > 6 ? <button type="button" className="agent-process-more" onClick={() => setShowAllTools((value) => !value)}>{showAllTools ? "收起工具步骤" : `查看全部 ${tools.length} 个工具步骤`}</button> : null}
                    {processMessages.length ? <div className="agent-process-records">{processMessages.map((event) => <div key={event.seq} className="agent-process-record"><Streamdown controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}>{eventText(event)}</Streamdown></div>)}</div> : null}
                    {decisions.length ? <div className="agent-process-records">{decisions.map(({ request, event, response }) => <DecisionHistory key={event.seq} request={request} response={response} />)}</div> : null}
                </div>
            ) : null}
        </section>
    );
}

function DecisionHistory({ request, response }: { request: AgentPendingDecision; response?: ProjectedEvent }) {
    const [open, setOpen] = useState(false);
    const answers = recordOf(response?.payload.answers);
    const approved = String(response?.payload.decision || "") === "approved";
    if (request.kind === "question") {
        const state = !response ? "waiting" : approved ? "answered" : "canceled";
        const questions = request.questions || [];
        return <div className="agent-question-history">
            <button type="button" className="agent-question-history-header" aria-expanded={open} aria-label={open ? "收起问答详情" : "展开问答详情"} onClick={() => setOpen((value) => !value)}>
                <span className={`agent-question-history-state is-${state}`}>{state === "canceled" ? <CircleSlash2 className="size-4" /> : state === "answered" ? <CircleCheck className="size-4" /> : <MessageCircleQuestion className="size-4" />}</span>
                <span className="agent-question-history-summary"><strong>{state === "canceled" ? "已取消回答" : state === "answered" ? "已完成回答" : "等待回答"}</strong><span>· {questions.length} 个问题</span></span>
                <ChevronDown className={`agent-question-history-chevron size-4 ${open ? "is-open" : ""}`} />
            </button>
            {open ? <div className="agent-question-history-content">{questions.map((question, index) => {
                const answer = String(answers?.[question.id] || "").trim();
                return <div className="agent-question-history-item" key={question.id}><span>{question.header || `问题 ${index + 1}`}</span><strong>{question.question}</strong><p>{answer || (state === "canceled" ? "未回答" : "已跳过")}</p></div>;
            })}</div> : null}
        </div>;
    }
    return <div className="agent-process-record flex items-start gap-2"><ShieldAlert className="mt-1 size-3.5 shrink-0" /><span className="min-w-0"><strong className="block font-medium text-current">操作确认</strong><span className="block break-words">{request.content}</span><em className="mt-0.5 block text-[10px] not-italic opacity-60">{response ? approved ? "已允许" : "已取消" : "已结束"}</em></span></div>;
}

function ThinkingStep({ event, theme }: { event: ProjectedEvent; theme: CanvasTheme }) {
    const [open, setOpen] = useState(false);
    const text = eventText(event).replace(/^思考[：:]\s*/i, "");
    return (
        <div className="agent-process-step">
            <button type="button" onClick={() => setOpen((value) => !value)} className="agent-process-step-toggle" aria-expanded={open} aria-label={open ? "收起详情" : "展开详情"}>
                <Brain className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{text || "思考过程"}</span><ChevronDown className={`size-3 transition ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? <div className="agent-process-thinking">{text}</div> : null}
        </div>
    );
}

function ToolStep({ event, theme, now, terminalStatus, autoOpenFailure }: { event: ProjectedEvent; theme: CanvasTheme; now: number; terminalStatus?: AgentSession["status"]; autoOpenFailure?: boolean }) {
    const failed = Boolean(event.result?.payload.isError);
    const [open, setOpen] = useState(Boolean(failed && autoOpenFailure));
    const name = formatAgentToolName(String(event.payload.toolName || "工具"));
    const target = toolTarget(event.payload.input);
    const duration = toolDuration(event, now);
    const settled = Boolean(event.result || terminalStatus);
    const settledFailed = failed || terminalStatus === "failed" || terminalStatus === "canceled";
    useEffect(() => { if (failed && autoOpenFailure) setOpen(true); }, [autoOpenFailure, failed]);
    return (
        <div className="agent-process-step">
            <button type="button" onClick={() => setOpen((value) => !value)} className="agent-process-step-toggle" aria-expanded={open} aria-label={open ? "收起详情" : "展开详情"}>
                <Wrench className="size-3.5 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate font-medium">{name}{target ? <span className="font-normal opacity-45"> · {target}</span> : null}</span>
                {duration ? <span className="tabular-nums opacity-40">{duration}</span> : null}
                {settled ? settledFailed ? <CircleAlert className="size-3.5 text-red-500" /> : <Check className="size-3.5 text-emerald-500" /> : <LoaderCircle className="size-3.5 animate-spin opacity-45" />}
                <ChevronDown className={`size-3 opacity-40 transition ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? <div className="mt-2 space-y-2 pl-5"><CodeBlock label="输入" value={event.payload.input} theme={theme} />{event.result ? <CodeBlock label={failed ? "错误" : "结果"} value={event.result.payload.output} theme={theme} /> : null}</div> : null}
        </div>
    );
}

function CodeBlock({ label, value, theme }: { label: string; value: unknown; theme: CanvasTheme }) {
    const [copied, setCopied] = useState(false);
    const text = formatUnknown(value);
    return <div><div className="mb-1 flex items-center justify-between text-[10px] font-medium opacity-40"><span>{label}</span><button type="button" className="flex items-center gap-1 hover:opacity-80" onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); })}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制"}</button></div><pre className="thin-scrollbar max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg p-2 text-[11px] leading-5" style={{ background: theme.toolbar.itemHover }}>{text}</pre></div>;
}

function ArtifactStrip({ events, theme }: { events: ProjectedEvent[]; theme: CanvasTheme }) {
    const [preview, setPreview] = useState<ProjectedEvent | null>(null);
    const unique = events.filter((event, index) => events.findIndex((candidate) => artifactKey(candidate) === artifactKey(event)) === index);
    const images = unique.filter((event) => String(event.payload.mimeType || "").startsWith("image/"));
    const files = unique.filter((event) => !String(event.payload.mimeType || "").startsWith("image/"));
    return (
        <div className="mt-4 space-y-2">
            {images.length ? <Image.PreviewGroup><div className={`grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>{images.map((event) => <div key={event.seq} className="group/artifact relative grid place-items-center overflow-hidden rounded-xl border bg-white" style={{ borderColor: theme.node.stroke }}><Image preview src={String(event.payload.url)} alt={String(event.payload.title || "Agent 产物")} rootClassName="!grid !w-full place-items-center" className={`!block !h-auto !w-full object-contain ${images.length === 1 ? "!max-h-[520px]" : "!max-h-60"}`} /><span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/45 px-2 py-1 text-[11px] text-white">{String(event.payload.title || event.payload.name || "图片产物")}</span><a href={String(event.payload.url || "#")} download className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg bg-black/45 text-white opacity-0 transition group-hover/artifact:opacity-100" title="下载产物"><Download className="size-3.5" /></a></div>)}</div></Image.PreviewGroup> : null}
            {files.map((event) => <div key={event.seq} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: theme.node.stroke, color: theme.node.text }}><span className="grid size-9 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}>{artifactIcon(String(event.payload.mimeType || ""))}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{String(event.payload.title || event.payload.name || "Agent 产物")}</span><span className="text-xs opacity-45">{artifactKind(String(event.payload.mimeType || ""))}{Number(event.payload.bytes) ? ` · ${formatBytes(Number(event.payload.bytes))}` : ""}</span></span><Tooltip title="预览"><button type="button" className="grid size-8 place-items-center rounded-lg hover:bg-black/5" onClick={() => setPreview(event)}><Eye className="size-3.5" /></button></Tooltip><Tooltip title="下载"><a href={String(event.payload.url || "#")} download className="grid size-8 place-items-center rounded-lg hover:bg-black/5"><Download className="size-3.5" /></a></Tooltip></div>)}
            <Modal title={preview ? String(preview.payload.title || preview.payload.name || "Agent 产物") : "Agent 产物"} open={Boolean(preview)} onCancel={() => setPreview(null)} footer={preview ? <a href={String(preview.payload.url || "#")} download className="inline-flex items-center gap-2"><Download className="size-4" />下载原文件</a> : null} width="min(920px, calc(100vw - 32px))" destroyOnHidden>{preview ? <iframe title="Agent 产物预览" src={String(preview.payload.url || "about:blank")} sandbox="allow-same-origin" className="h-[min(70vh,720px)] w-full border-0 bg-white" /> : null}</Modal>
        </div>
    );
}

function artifactKey(event: ProjectedEvent) { return String(event.payload.fileId || event.payload.url || (event.payload.name || event.payload.title ? `${event.payload.name || event.payload.title}:${event.payload.mimeType || ""}` : event.seq)); }

function artifactIcon(mimeType: string) { if (mimeType.startsWith("audio/")) return <FileAudio className="size-4" />; if (mimeType.startsWith("video/")) return <FileVideo className="size-4" />; if (mimeType.includes("pdf") || mimeType.startsWith("text/")) return <FileText className="size-4" />; return <Archive className="size-4" />; }
function artifactKind(mimeType: string) { if (mimeType.startsWith("audio/")) return "音频"; if (mimeType.startsWith("video/")) return "视频"; if (mimeType.includes("pdf")) return "PDF"; if (mimeType.includes("markdown")) return "Markdown"; if (mimeType.startsWith("text/")) return "文本文档"; return "文件"; }

function RoundStatus({ events, status }: { events: ProjectedEvent[]; status?: AgentSession["status"] }) {
    const forkBoundary = [...events].reverse().find((event) => event.kind === "run_state" && Number(event.payload.forkSourceSeq) > 0);
    if (forkBoundary) return <div className="agent-meta-note">从这里重新开始</div>;
    if (status === "completed") return null;
    if (status === "failed") return <StatusPill state="failed" text="Agent 执行失败" />;
    if (status === "canceled") return <StatusPill state="canceled" text="任务已取消" />;
    const activity = [...events].reverse().find((event) => {
        if (event.kind === "thinking") return Boolean(eventText(event).trim());
        if (event.kind === "tool_call") return !event.result;
        if (event.kind !== "run_state") return false;
        const text = eventText(event).trim();
        return Boolean(text && !["Agent 已开始处理", "Agent 开始执行"].includes(text));
    });
    const text = activity?.kind === "thinking"
        ? `思考：${eventText(activity).replace(/^思考[：:]\s*/i, "").trim()}`
        : activity?.kind === "tool_call"
            ? `${formatAgentToolName(String(activity.payload.toolName || "工具"))}执行中`
            : activity ? eventText(activity) : "模型正在处理中…";
    return status === "running" || status === "waiting_for_user" ? <StatusPill state="running" text={text} /> : null;
}

function StatusPill({ state, text }: { state: "idle" | "running" | "failed" | "canceled"; text: string }) {
    const singleLine = text.replace(/\s+/g, " ").trim();
    const icon = state === "running" ? <i aria-hidden="true" /> : state === "failed" ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" />;
    const pill = <button type="button" className={`agent-status-pill agent-status-pill-button is-${state}`} aria-label="查看完整思考状态">{icon}<span>{singleLine}</span></button>;
    if (!text.includes("\n") && singleLine.length <= 40) return <div className="agent-status-row"><span className={`agent-status-pill is-${state}`}>{icon}<span>{singleLine}</span></span></div>;
    return <div className="agent-status-row"><Popover content={text.trim()} placement="top" trigger={["hover", "click"]} mouseEnterDelay={0.12} mouseLeaveDelay={0.12} autoAdjustOverflow arrow classNames={{ root: "agent-status-popover", content: "agent-status-popover-content" }} styles={{ root: { maxWidth: "min(560px, calc(100vw - 24px))" }, container: { padding: 0, border: "1px solid #e2e8f0", borderRadius: 12, background: "#ffffff", color: "#334155", boxShadow: "0 10px 24px rgba(15, 23, 42, 0.14)" }, content: { maxHeight: "min(280px, calc(100vh - 48px))", overflow: "auto", padding: "10px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.55 } }}>{pill}</Popover></div>;
}

export function AgentDecisionCard({ pending, theme, busy, onDecide }: {
    pending: AgentPendingDecision;
    theme: CanvasTheme;
    busy: boolean;
    onDecide: (decision: "approved" | "rejected", scope?: "once" | "session" | "project", proposalEdits?: unknown) => void;
}) {
    const director = pending.toolName === "director_create_assets";
    const proposal = ["creative_assets_create_batch", "director_create_assets"].includes(pending.toolName || "");
    return (
        <section className="mx-3 mb-2 overflow-hidden rounded-2xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <div className="flex gap-3 p-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}><ShieldAlert className="size-4" /></span>
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{proposal ? "检查素材拆解清单" : "Agent 请求确认"}</div><p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{pending.content}</p>{pending.toolName ? <div className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: theme.node.stroke }}><Wrench className="size-3" />{formatAgentToolName(pending.toolName)}</div> : null}</div>
            </div>
            {proposal ? <CreativeAssetProposal pending={pending} theme={theme} busy={busy} director={director} onReject={() => onDecide("rejected")} onConfirm={(items) => onDecide("approved", "once", items)} /> : null}
        </section>
    );
}

type ProposalItem = { included: boolean; kind: "character" | "scene" | "prop"; name: string; status: "draft"; payload: { description: string; narrativeDescription: string; visualDescription: string; mediaDrafts: { image: { prompt: string; model: null; params: Record<string, unknown> }; audio: { prompt: string; model: null; params: Record<string, unknown>; audioMode: "speech" | "ambient" | "sfx"; transcript: string } }; [key: string]: unknown } };
function CreativeAssetProposal({ pending, theme, busy, director, onReject, onConfirm }: { pending: AgentPendingDecision; theme: CanvasTheme; busy: boolean; director: boolean; onReject: () => void; onConfirm: (items: unknown[]) => void }) {
    const source = recordOf(pending.toolInput) || {};
    const [items, setItems] = useState<ProposalItem[]>(() => arrayOf<Record<string, unknown>>(source.items).map(normalizeProposalItem));
    useEffect(() => setItems(arrayOf<Record<string, unknown>>((recordOf(pending.toolInput) || {}).items).map(normalizeProposalItem)), [pending.id, pending.toolInput]);
    const selected = items.filter((item) => item.included);
    const ready = selected.every((item) => item.kind !== "character" || (item.payload.mediaDrafts.audio.prompt.trim() && item.payload.mediaDrafts.audio.transcript.trim()));
    const update = (index: number, patch: Partial<ProposalItem>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    const mergePrevious = (index: number) => setItems((current) => {
        const item = current[index];
        let targetIndex = index - 1;
        while (targetIndex >= 0 && current[targetIndex].kind !== item.kind) targetIndex -= 1;
        if (targetIndex < 0) return current;
        return current.map((value, itemIndex) => itemIndex === targetIndex ? { ...value, payload: { ...value.payload, description: [value.payload.description, item.payload.description].filter(Boolean).join("；"), narrativeDescription: [value.payload.narrativeDescription, item.payload.narrativeDescription].filter(Boolean).join("；"), visualDescription: [value.payload.visualDescription, item.payload.visualDescription].filter(Boolean).join("；") } } : value).filter((_value, itemIndex) => itemIndex !== index);
    });
    return <div className="border-t" style={{ borderColor: theme.node.stroke }}>
        <div className="max-h-[48vh] space-y-4 overflow-y-auto px-3.5 py-3 thin-scrollbar">
            {(["character", "scene", "prop"] as const).map((kind) => {
                const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind);
                if (!rows.length) return null;
                return <section key={kind}><div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold opacity-55"><span>{kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}</span><span>{rows.filter(({ item }) => item.included).length}/{rows.length}</span></div><div className="space-y-2">{rows.map(({ item, index }) => <div key={`${kind}-${index}`} className="rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>
                    <div className="flex items-center gap-2"><Checkbox checked={item.included} onChange={(event) => update(index, { included: event.target.checked })} /><Input size="small" value={item.name} onChange={(event) => update(index, { name: event.target.value })} /><Select size="small" value={item.kind} className="w-20" onChange={(value) => update(index, { kind: value })} options={[{ value: "character", label: "角色" }, { value: "scene", label: "场景" }, { value: "prop", label: "道具" }]} /></div>
                    <Input.TextArea className="mt-2" value={item.payload.description} onChange={(event) => update(index, { payload: { ...item.payload, description: event.target.value } })} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={item.kind === "character" ? "角色卡摘要" : "完整视觉描述"} />
                    {item.kind === "character" ? <><Input.TextArea className="mt-2" value={item.payload.narrativeDescription} onChange={(event) => update(index, { payload: { ...item.payload, narrativeDescription: event.target.value } })} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="剧情身份、关系、人物弧光和剧情用途（不用于生图）" /><Input.TextArea className="mt-2" value={item.payload.visualDescription} onChange={(event) => update(index, { payload: { ...item.payload, visualDescription: event.target.value } })} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="纯视觉设定：年龄感、体态、五官、发型、基础服装和识别特征" /><Input.TextArea className="mt-2" value={item.payload.mediaDrafts.audio.prompt} onChange={(event) => update(index, { payload: { ...item.payload, mediaDrafts: { ...item.payload.mediaDrafts, audio: { ...item.payload.mediaDrafts.audio, prompt: event.target.value } } } })} autoSize={{ minRows: 1, maxRows: 3 }} placeholder="音色、语速、口音和情绪质感" /><Input className="mt-2" size="small" value={item.payload.mediaDrafts.audio.transcript} onChange={(event) => update(index, { payload: { ...item.payload, mediaDrafts: { ...item.payload.mediaDrafts, audio: { ...item.payload.mediaDrafts.audio, transcript: event.target.value } } } })} placeholder="一句符合角色身份的试听台词" /></> : null}
                    <button type="button" className="mt-1.5 text-[10px] opacity-45 hover:opacity-80" onClick={() => mergePrevious(index)}>合并到上一项同类设定</button>
                </div>)}</div></section>;
            })}
        </div>
        <div className="flex items-center border-t px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}><span className="text-xs opacity-45">{ready ? `将在${director ? "导演项目" : "画布"}创建 ${selected.length} 张独立素材卡` : "角色需要音色设计和试听台词"}</span><Button className="ml-auto" type="text" size="small" disabled={busy} onClick={onReject}>取消</Button><Button type="primary" size="small" disabled={!selected.length || !ready || busy} onClick={() => onConfirm(selected.map(({ included: _included, ...item }) => item))}>创建素材</Button></div>
    </div>;
}

function normalizeProposalItem(value: Record<string, unknown>): ProposalItem {
    const payload = recordOf(value.payload) || {};
    const kind = value.kind === "scene" || value.kind === "prop" ? value.kind : "character";
    const drafts = recordOf(payload.mediaDrafts) || {};
    const image = recordOf(drafts.image) || {};
    const audio = recordOf(drafts.audio) || {};
    return { included: true, kind, name: String(value.name || "未命名设定"), status: "draft", payload: { ...payload, description: String(payload.description || ""), narrativeDescription: String(payload.narrativeDescription || ""), visualDescription: String(payload.visualDescription || ""), mediaDrafts: { image: { prompt: String(image.prompt || ""), model: null, params: recordOf(image.params) || {} }, audio: { prompt: String(audio.prompt || ""), model: null, params: recordOf(audio.params) || {}, audioMode: kind === "character" ? "speech" : kind === "scene" ? "ambient" : "sfx", transcript: String(audio.transcript || "") } } } };
}

export function AgentComposer({
    value, theme, ready, busy, sending, uploading, focusRequest, skills, nodes, skill, references, entityReferences, attachments,
    onChange, onSend, onCancel, onUpload, onSkill, onReference, onRemoveReference, onRemoveEntityReference, onRemoveAttachment,
}: {
    value: string;
    theme: CanvasTheme;
    ready: boolean;
    busy: boolean;
    sending: boolean;
    uploading: boolean;
    focusRequest?: number;
    skills: AgentSkill[];
    nodes: CanvasResourceReference[];
    skill: AgentSkill | null;
    references: CanvasResourceReference[];
    entityReferences: AgentEntityReference[];
    attachments: ServerFile[];
    onChange: (value: string) => void;
    onSend: () => void;
    onCancel: () => void;
    onUpload: (files: File[]) => void;
    onSkill: (skill: AgentSkill | null) => void;
    onReference: (reference: CanvasResourceReference) => void;
    onRemoveReference: (id: string) => void;
    onRemoveEntityReference: (reference: AgentEntityReference) => void;
    onRemoveAttachment: (id: string) => void;
}) {
    const inputRef = useRef<ComponentRef<typeof Input.TextArea> | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const dragDepthRef = useRef(0);
    const composingRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    const [filePickerOpening, setFilePickerOpening] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [cursor, setCursor] = useState(value.length);
    const [suggestionsOpen, setSuggestionsOpen] = useState(true);
    const suggestion = useMemo(() => suggestionsOpen ? resolveSuggestion(value, cursor, skills, nodes, references) : null, [value, cursor, skills, nodes, references, suggestionsOpen]);
    useEffect(() => setActiveIndex(0), [suggestion?.query, suggestion?.kind]);
    useEffect(() => setCursor((current) => Math.min(current, value.length)), [value]);
    useEffect(() => { if (focusRequest) requestAnimationFrame(() => inputRef.current?.focus()); }, [focusRequest]);
    const textarea = () => inputRef.current?.resizableTextArea?.textArea || null;
    const focusAt = (offset: number) => requestAnimationFrame(() => { const node = textarea(); inputRef.current?.focus(); node?.setSelectionRange(offset, offset); setCursor(offset); });
    const pick = (item: AgentSkill | CanvasResourceReference) => {
        if (!suggestion) return;
        const next = `${value.slice(0, suggestion.start)}${value.slice(suggestion.end)}`;
        const offset = suggestion.start;
        onChange(next);
        if (suggestion.kind === "skill") onSkill(item as AgentSkill);
        else onReference(item as CanvasResourceReference);
        setSuggestionsOpen(false);
        focusAt(offset);
    };
    const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || composingRef.current) return;
        if (suggestion?.items.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : suggestion.items.length - 1)) % suggestion.items.length); return; }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); pick(suggestion.items[activeIndex]); return; }
            if (event.key === "Escape") { event.preventDefault(); setSuggestionsOpen(false); return; }
        }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
    };
    const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); onUpload(files); }
    };
    const drop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault(); dragDepthRef.current = 0; setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onUpload(files);
    };
    const insertTrigger = (trigger: "/" | "@") => {
        const at = textarea()?.selectionStart ?? cursor;
        const prefix = value.slice(0, at);
        const insert = `${prefix && !/\s$/.test(prefix) ? " " : ""}${trigger}`;
        const next = `${prefix}${insert}${value.slice(at)}`;
        const offset = at + insert.length;
        onChange(next);
        setSuggestionsOpen(true);
        focusAt(offset);
    };
    const canSend = ready && !busy && Boolean(value.trim() || skill || attachments.length || references.length || entityReferences.length);
    return (
        <div className="shrink-0 px-3 pb-3 pt-2">
            {busy ? <div className="mb-2 flex items-center gap-2 px-1 text-xs" style={{ color: theme.node.muted }}><LoaderCircle className="size-3.5 animate-spin" />Agent 正在处理，可以停止后调整任务</div> : null}
            <div className={`relative rounded-2xl border transition ${dragging ? "ring-2 ring-blue-500/35" : ""}`} style={{ borderColor: theme.node.stroke, background: theme.node.panel }} onDragEnter={(event) => { event.preventDefault(); dragDepthRef.current += 1; setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragging(false); }} onDrop={drop}>
                {skill || references.length || entityReferences.length || attachments.length ? <ComposerContext skill={skill} references={references} entityReferences={entityReferences} attachments={attachments} theme={theme} onSkill={onSkill} onRemoveReference={onRemoveReference} onRemoveEntityReference={onRemoveEntityReference} onRemoveAttachment={onRemoveAttachment} /> : null}
                {suggestion ? <SuggestionMenu suggestion={suggestion} activeIndex={activeIndex} theme={theme} onPick={pick} /> : null}
                <Input.TextArea ref={inputRef} value={value} onChange={(event) => { onChange(event.target.value); setCursor(event.target.selectionStart); setSuggestionsOpen(true); }} onSelect={(event) => setCursor(event.currentTarget.selectionStart)} onClick={(event) => { setCursor(event.currentTarget.selectionStart); setSuggestionsOpen(true); }} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={(event) => { composingRef.current = false; setCursor(event.currentTarget.selectionStart); }} onKeyDown={keyDown} onPaste={paste} autoSize={{ minRows: 2, maxRows: 12 }} variant="borderless" placeholder={ready ? "描述任务，输入 / 调用 Skill，@ 引用节点…" : "管理员配置 Agent 模型后即可使用"} disabled={!ready || busy} className="!max-h-72 !px-3 !pt-3 thin-scrollbar" />
                <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    <div className="flex items-center gap-0.5">
                        <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => { onUpload(Array.from(event.target.files || [])); event.currentTarget.value = ""; setFilePickerOpening(false); }} />
                        <Tooltip title="添加附件，也可以粘贴或拖入"><Button type="text" shape="circle" loading={uploading || filePickerOpening} icon={<Paperclip className="size-4" />} onClick={() => { if (filePickerOpening) return; setFilePickerOpening(true); fileRef.current?.click(); window.setTimeout(() => setFilePickerOpening(false), 800); }} /></Tooltip>
                        <Tooltip title="引用画布节点"><Button type="text" shape="circle" disabled={!nodes.length} icon={<AtSign className="size-4" />} onClick={() => insertTrigger("@")} /></Tooltip>
                        <Tooltip title="调用 Skill"><Button type="text" shape="circle" icon={<Sparkles className="size-4" />} onClick={() => insertTrigger("/")} /></Tooltip>
                    </div>
                    {busy ? <Tooltip title="停止当前任务"><Button type="text" shape="circle" danger icon={<Square className="size-3.5 fill-current" />} onClick={onCancel} /></Tooltip> : <Tooltip title="发送"><Button type="primary" shape="circle" loading={sending} disabled={!canSend} icon={<Send className="size-3.5" />} onClick={onSend} /></Tooltip>}
                </div>
                {dragging ? <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-blue-500/10 text-sm font-medium">松开以添加附件</div> : null}
            </div>
            <div className="mt-1.5 text-center text-[10px]" style={{ color: theme.node.muted }}>Enter 发送 · Shift + Enter 换行 · Agent 可能出错，请确认重要修改</div>
        </div>
    );
}

function ComposerContext({ skill, references, entityReferences, attachments, theme, onSkill, onRemoveReference, onRemoveEntityReference, onRemoveAttachment }: {
    skill: AgentSkill | null; references: CanvasResourceReference[]; entityReferences: AgentEntityReference[]; attachments: ServerFile[]; theme: CanvasTheme;
    onSkill: (skill: AgentSkill | null) => void; onRemoveReference: (id: string) => void; onRemoveEntityReference: (reference: AgentEntityReference) => void; onRemoveAttachment: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const all = (skill ? 1 : 0) + references.length + entityReferences.length + attachments.length;
    const compact = all > 3 && !expanded;
    return <div className="flex gap-2 overflow-x-auto px-3 pt-3">
        {skill ? <ContextCard icon={<Sparkles className="size-3.5" />} title={`/${skill.name}`} subtitle="Skill" onRemove={() => onSkill(null)} theme={theme} /> : null}
        {entityReferences.slice(0, compact ? Math.max(0, 2 - (skill ? 1 : 0)) : undefined).map((item) => <ContextCard key={`${item.kind}:${item.kind === "asset" ? item.assetId : item.kind === "style" ? item.styleId : `${item.entityKind}:${item.entityId}`}`} icon={<Sparkles className="size-3.5" />} title={item.title} subtitle={item.subtitle} onRemove={() => onRemoveEntityReference(item)} theme={theme} />)}
        {references.slice(0, compact ? Math.max(0, 2 - (skill ? 1 : 0)) : undefined).map((item) => <ContextCard key={item.nodeId} icon={<AtSign className="size-3.5" />} title={item.title} subtitle="画布节点" onRemove={() => onRemoveReference(item.nodeId)} theme={theme} />)}
        {attachments.slice(0, compact ? Math.max(0, 2 - (skill ? 1 : 0) - Math.min(references.length, 2)) : undefined).map((file) => <ContextCard key={file.id} icon={fileIcon(file.mimeType)} title={file.name} subtitle={formatBytes(file.bytes)} image={file.mimeType.startsWith("image/") ? fileUrl(file.id) : undefined} href={fileUrl(file.id)} onRemove={() => onRemoveAttachment(file.id)} theme={theme} />)}
        {all > 3 ? <button type="button" className="h-12 shrink-0 rounded-xl border px-3 text-xs opacity-60 hover:opacity-90" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起附件" : `查看全部 ${all} 项`}</button> : null}
    </div>;
}

function ContextCard({ icon, title, subtitle, image, href, onRemove, theme }: { icon: ReactNode; title: string; subtitle: string; image?: string; href?: string; onRemove: () => void; theme: CanvasTheme }) {
    return <div className="group relative flex h-12 min-w-0 shrink-0 items-center gap-2 rounded-xl border px-2 pr-7" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>{image ? <Image preview src={image} alt={title} className="!size-8 rounded-lg object-cover" /> : href ? <a href={href} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg opacity-60">{icon}</a> : <span className="grid size-8 place-items-center rounded-lg opacity-60">{icon}</span>}<span className="min-w-0 max-w-28"><span className="block truncate text-xs font-medium">{title}</span><span className="block truncate text-[10px] opacity-45">{subtitle}</span></span><button type="button" aria-label={`移除${title}`} onClick={onRemove} className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-md opacity-45 hover:bg-black/10 hover:opacity-80 dark:hover:bg-white/10"><X className="size-3" /></button></div>;
}

type Suggestion = { kind: "skill"; start: number; end: number; query: string; items: AgentSkill[] } | { kind: "reference"; start: number; end: number; query: string; items: CanvasResourceReference[] };
function SuggestionMenu({ suggestion, activeIndex, theme, onPick }: { suggestion: Suggestion; activeIndex: number; theme: CanvasTheme; onPick: (item: AgentSkill | CanvasResourceReference) => void }) {
    return <div role="listbox" aria-label={suggestion.kind === "skill" ? "Skill 候选" : "画布节点候选"} className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border p-1.5 shadow-xl" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
        <div className="px-2 py-1 text-[10px] font-medium opacity-40">{suggestion.kind === "skill" ? "选择 Skill" : "引用画布节点"}</div>
        {suggestion.items.length ? suggestion.items.map((item, index) => {
            const skill = suggestion.kind === "skill" ? item as AgentSkill : null;
            const node = suggestion.kind === "reference" ? item as CanvasResourceReference : null;
            return <button key={skill?.id || node?.nodeId} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(item)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left" style={{ background: index === activeIndex ? theme.toolbar.itemHover : undefined }}><span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}>{skill ? <Sparkles className="size-3.5" /> : <AtSign className="size-3.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{skill ? `/${skill.name}` : node?.title}</span><span className="block truncate text-[11px] opacity-45">{skill ? skill.description : node?.kind}</span></span></button>;
        }) : <div className="px-3 py-5 text-center text-xs opacity-45">没有匹配项</div>}
    </div>;
}

export function AgentHistoryList({ sessions, activeId, unread, query, theme, onQuery, onActivate, onDelete, onFork }: {
    sessions: AgentSession[]; activeId?: string; unread?: Record<string, number>; query: string; theme: CanvasTheme;
    onQuery: (value: string) => void; onActivate: (id: string) => void; onDelete: (id: string) => void; onFork: (id: string) => void;
}) {
    const filtered = sessions.filter((session) => session.title.toLowerCase().includes(query.trim().toLowerCase()));
    return <div><Input prefix={<Search className="size-3.5 opacity-45" />} value={query} onChange={(event) => onQuery(event.target.value)} allowClear placeholder="搜索历史会话" /><div className="mt-3 space-y-1">{filtered.map((session) => <div key={session.id} role="button" tabIndex={0} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 dark:hover:bg-white/5" style={{ background: session.id === activeId ? theme.toolbar.itemHover : undefined }} onClick={() => onActivate(session.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(session.id); } }}><span className="relative grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}><History className="size-3.5 opacity-55" /><i className={`absolute bottom-0.5 right-0.5 size-1.5 rounded-full ${statusDot(session.status)}`} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="block min-w-0 flex-1 truncate text-sm font-medium">{session.title || "新会话"}</span>{unread?.[session.id] ? <span className="rounded-full bg-blue-500 px-1.5 text-[10px] text-white">{unread[session.id]}</span> : null}</span><span className="mt-0.5 flex items-center gap-1 text-[11px] opacity-45"><Clock3 className="size-3" />{formatRelativeTime(session.updatedAt)} · {statusText(session.status)}</span></span><span className="flex opacity-0 transition group-hover:opacity-60 group-focus-visible:opacity-60"><Tooltip title="从这里分叉"><button type="button" className="grid size-7 place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/10" onClick={(event) => { event.stopPropagation(); onFork(session.id); }}><GitFork className="size-3.5" /></button></Tooltip>{session.id !== activeId && !["running", "waiting_for_user"].includes(session.status) ? <Popconfirm title="删除这段会话？" onConfirm={() => onDelete(session.id)}><button type="button" className="grid size-7 place-items-center rounded-md hover:bg-red-500/10 hover:text-red-500" onClick={(event) => event.stopPropagation()}><Trash2 className="size-3.5" /></button></Popconfirm> : null}</span></div>)}{!filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "没有匹配的会话" : "暂无历史会话"} /> : null}</div></div>;
}

export function AgentSkillList({ skills, query, theme, onQuery, onSelect }: { skills: AgentSkill[]; query: string; theme: CanvasTheme; onQuery: (value: string) => void; onSelect: (skill: AgentSkill) => void }) {
    const normalized = query.trim().toLowerCase();
    const filtered = skills.filter((skill) => !normalized || `${skill.name} ${skill.description}`.toLowerCase().includes(normalized));
    return <div><Input prefix={<Search className="size-3.5 opacity-45" />} value={query} onChange={(event) => onQuery(event.target.value)} allowClear placeholder="搜索 Skill" /><div className="mt-3 space-y-2">{filtered.map((skill) => <button key={skill.id} type="button" className="w-full rounded-xl border p-3 text-left transition hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: theme.node.stroke }} onClick={() => onSelect(skill)}><div className="flex items-center gap-2 font-medium"><Sparkles className="size-4" />/{skill.name}</div><p className="mt-1.5 text-sm leading-5 opacity-55">{skill.description}</p><div className="mt-2 text-[11px] opacity-35">点击后加入下一条消息</div></button>)}{!filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可用 Skill" /> : null}</div></div>;
}

export function ScrollToBottomButton({ visible, unread, bottom, onClick }: { visible: boolean; unread: number; bottom?: number; onClick: () => void }) {
    if (!visible) return null;
    return <button type="button" className="agent-scroll-bottom" style={{ bottom: bottom ?? 144 }} onClick={onClick} aria-label={unread ? `${unread} 条新消息` : "回到底部"}><ArrowDown className="size-4" />{unread ? <span>{unread > 99 ? "99+" : unread}</span> : null}</button>;
}

export function AgentUserLocator({ events, turnIndex, containerRef, theme, onLocate }: { events: AgentEvent[]; turnIndex?: AgentTurnIndexItem[]; containerRef: RefObject<HTMLDivElement | null>; theme: CanvasTheme; onLocate?: (seq: number) => void }) {
    const loadedUsers = useMemo(() => projectAgentEvents(events).filter((event) => event.kind === "user_text"), [events]);
    const users = useMemo(() => turnIndex?.length ? turnIndex.map((item) => ({ ...loadedUsers.find((event) => event.seq === item.seq), sessionId: "", seq: item.seq, runId: item.runId, kind: "user_text" as const, payload: { text: item.text }, createdAt: item.createdAt })) : loadedUsers, [loadedUsers, turnIndex]);
    const [activeSeq, setActiveSeq] = useState(0);
    useEffect(() => {
        const container = containerRef.current;
        if (!container || users.length < 2) return;
        const update = () => {
            const top = container.getBoundingClientRect().top + 80;
            let active = users[0]?.seq || 0;
            container.querySelectorAll<HTMLElement>("[data-agent-user-seq]").forEach((node) => {
                if (node.getBoundingClientRect().top <= top) active = Number(node.dataset.agentUserSeq) || active;
            });
            setActiveSeq(active);
        };
        update();
        container.addEventListener("scroll", update, { passive: true });
        return () => container.removeEventListener("scroll", update);
    }, [containerRef, users]);
    if (users.length < 2) return null;
    const activeIndex = Math.max(0, users.findIndex((event) => event.seq === activeSeq));
    const start = Math.max(0, Math.min(activeIndex - 10, users.length - 21));
    const visible = users.slice(start, start + 21);
    const jump = (seq: number) => { const node = containerRef.current?.querySelector<HTMLElement>(`[data-agent-user-seq='${seq}']`); if (node) node.scrollIntoView({ behavior: "smooth", block: "start" }); else onLocate?.(seq); };
    return <nav className="agent-user-locator" aria-label="用户消息快速定位">
        <div className="agent-user-locator-inner">
            <div className="agent-user-locator-dots" aria-hidden="true">{visible.map((event) => <span key={event.seq} className={event.seq === activeSeq ? "is-active" : ""} />)}</div>
            <div className="agent-user-locator-panel" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}><div className="thin-scrollbar agent-user-locator-list" aria-label="用户消息快速定位列表">{users.map((event, index) => <button key={event.seq} type="button" aria-current={event.seq === activeSeq ? "true" : undefined} aria-label={`定位到第 ${index + 1} 条用户消息：${eventText(event) || "空消息"}`} title={eventText(event) || "空消息"} onClick={(clickEvent) => { jump(event.seq); if (clickEvent.detail > 0) clickEvent.currentTarget.blur(); }}><span>{eventText(event) || "空消息"}</span></button>)}</div></div>
        </div>
    </nav>;
}

function resolveSuggestion(value: string, cursor: number, skills: AgentSkill[], nodes: CanvasResourceReference[], selected: CanvasResourceReference[]): Suggestion | null {
    const before = value.slice(0, cursor);
    const match = before.match(/(?:^|\s)([/@])([^\s/@]*)$/);
    if (!match) return null;
    const trigger = match[1];
    const query = match[2].toLowerCase();
    const start = cursor - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
    if (trigger === "/") return { kind: "skill", start, end: cursor, query, items: skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query)).slice(0, 8) };
    const chosen = new Set(selected.map((item) => item.nodeId));
    return { kind: "reference", start, end: cursor, query, items: nodes.filter((node) => !chosen.has(node.nodeId) && `${node.title} ${node.kind}`.toLowerCase().includes(query)).slice(0, 8) };
}

function arrayOf<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function recordOf(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function fileUrl(id: string) { return serverApiUrl(`/files/${encodeURIComponent(id)}/content`); }
function MetaChip({ icon, text }: { icon: ReactNode; text: string }) { return <span className="agent-user-meta-chip inline-flex max-w-44 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px]">{icon}<span className="truncate">{text}</span></span>; }
function formatUnknown(value: unknown) { if (typeof value === "string") return value; return JSON.stringify(value, null, 2) ?? String(value ?? ""); }
function formatBytes(bytes: number) { if (!bytes) return "文件"; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function fileIcon(mime: string) { if (mime.startsWith("image/")) return <ImageIcon className="size-3.5" />; if (mime.startsWith("video/")) return <FileVideo className="size-3.5" />; if (mime.startsWith("audio/")) return <FileAudio className="size-3.5" />; if (mime.includes("pdf") || mime.startsWith("text/")) return <FileText className="size-3.5" />; return <File className="size-3.5" />; }
function toolDuration(event: ProjectedEvent, now: number) { const start = Date.parse(String(event.payload.startedAt || event.createdAt)); const end = event.result ? Date.parse(String(event.result.payload.finishedAt || event.result.createdAt)) : now; if (!Number.isFinite(start) || !Number.isFinite(end)) return ""; return formatDuration(end - start); }
function roundDuration(events: ProjectedEvent[], running: boolean, now: number) { if (!events.length) return ""; const starts = events.map((event) => Date.parse(event.createdAt)).filter(Number.isFinite); const ends = events.map((event) => event.result ? Date.parse(event.result.createdAt) : Date.parse(event.createdAt)).filter(Number.isFinite); if (!starts.length) return ""; return formatDuration((running ? now : Math.max(...ends)) - Math.min(...starts)); }
function formatDuration(ms: number) { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`; }
function formatRelativeTime(value: string) { const delta = Date.now() - Date.parse(value); if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return new Date(value).toLocaleDateString("zh-CN"); }
function statusText(status: AgentSession["status"]) { return ({ idle: "空闲", running: "运行中", waiting_for_user: "等待确认", completed: "已完成", failed: "失败", canceled: "已取消" } as const)[status]; }
function statusDot(status: AgentSession["status"]) { return status === "running" ? "bg-blue-500" : status === "waiting_for_user" ? "bg-amber-500" : status === "failed" ? "bg-red-500" : status === "completed" ? "bg-emerald-500" : "bg-zinc-400"; }
function toolTarget(value: unknown) { const input = recordOf(value); if (!input) return ""; const candidate = input.title || input.name || input.path || input.nodeId || input.projectId || (Array.isArray(input.ids) ? `${input.ids.length} 个对象` : ""); return String(candidate || "").slice(0, 48); }
export { projectAgentEvents };
