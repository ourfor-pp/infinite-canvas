import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Tooltip } from "antd";
import { Bot, GitFork, History, Plus, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { buildCanvasResourceReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { agentApi, agentClientId, subscribeAgent, type AgentConversation, type AgentEvent, type AgentSession, type AgentSkill } from "@/services/api/agent";
import { uploadServerFile, type ServerFile } from "@/services/api/server";
import { useAgentStore, type AgentCanvasContext } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    AgentComposer,
    AgentConversationFlow,
    AgentDecisionCard,
    AgentHistoryList,
    AgentSkillList,
    AgentUserLocator,
    ScrollToBottomButton,
} from "./agent-conversation-ui";

export function LocalAgentPanel({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const closePanel = useAgentStore((state) => state.closePanel);
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const draft = useAgentStore((state) => state.drafts[projectId] || "");
    const savedSessionId = useAgentStore((state) => state.currentSessionIds[projectId]);
    const setDraft = useAgentStore((state) => state.setDraft);
    const setCurrentSession = useAgentStore((state) => state.setCurrentSession);
    const markSessionSeen = useAgentStore((state) => state.markSessionSeen);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const [conversation, setConversation] = useState<AgentConversation | null>(null);
    const [session, setSession] = useState<AgentSession | null>(null);
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const [skills, setSkills] = useState<AgentSkill[]>([]);
    const [model, setModel] = useState({ ready: false, modelName: "", providerName: "", protocolVersion: 1, storageVersion: 1 });
    const [selectedSkill, setSelectedSkill] = useState<AgentSkill | null>(null);
    const [references, setReferences] = useState<CanvasResourceReference[]>([]);
    const [attachments, setAttachments] = useState<ServerFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [olderLoading, setOlderLoading] = useState(false);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [backgroundUnread, setBackgroundUnread] = useState<Record<string, number>>({});
    const [historyOpen, setHistoryOpen] = useState(false);
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [historyQuery, setHistoryQuery] = useState("");
    const [skillQuery, setSkillQuery] = useState("");
    const [answer, setAnswer] = useState("");
    const [decisionBusy, setDecisionBusy] = useState(false);
    const [streamVersion, setStreamVersion] = useState(0);
    const [composerFocusRequest, setComposerFocusRequest] = useState(0);
    const [inputDockHeight, setInputDockHeight] = useState(144);
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const inputDockRef = useRef<HTMLDivElement>(null);
    const olderLoadingRef = useRef(false);
    const atBottomRef = useRef(true);
    const handledClientActionsRef = useRef(new Set<string>());
    const backgroundEventsRef = useRef(new Map<string, AgentEvent[]>());

    const nodes = useMemo(() => canvasContext ? buildCanvasResourceReferences(canvasContext.snapshot.nodes) : [], [canvasContext]);
    const busy = session?.status === "running" || session?.status === "waiting_for_user";

    useEffect(() => {
        let active = true;
        setLoading(true);
        setConversation(null);
        setSession(null);
        setEvents([]);
        setSelectedSkill(null);
        setReferences([]);
        setAttachments([]);
        setAnswer("");
        handledClientActionsRef.current.clear();
        atBottomRef.current = true;
        setShowScrollBottom(false);
        setUnreadCount(0);
        Promise.all([agentApi.config(), agentApi.skills(), agentApi.conversation(projectId, savedSessionId).catch(() => agentApi.conversation(projectId))])
            .then(async ([config, nextSkills, nextConversation]) => {
                if (config.protocolVersion !== 2) throw new Error(`不支持的 Agent 通信协议版本：${config.protocolVersion}`);
                if (config.storageVersion !== 2) throw new Error(`不支持的 Agent 存储版本：${config.storageVersion}`);
                if (!nextConversation.session) {
                    const created = await agentApi.createSession(projectId);
                    nextConversation = { ...nextConversation, sessions: [created, ...nextConversation.sessions], session: created };
                }
                if (!active) return;
                setModel(config);
                setSkills(nextSkills);
                applyConversation(nextConversation);
                if (nextConversation.session) {
                    setCurrentSession(projectId, nextConversation.session.id);
                    markSessionSeen(nextConversation.session.id, nextConversation.session.eventSeq);
                }
                const seen = useAgentStore.getState().seenEventSeqs;
                setBackgroundUnread(Object.fromEntries(nextConversation.sessions.filter((item) => item.id !== nextConversation.session?.id && item.eventSeq > (seen[item.id] || 0)).map((item) => [item.id, Math.min(99, item.eventSeq - (seen[item.id] || 0))])));
                setAgentState({ connected: true, enabled: true, activity: config.ready ? config.modelName : "等待管理员配置" });
                setStreamVersion((value) => value + 1);
            })
            .catch((error) => {
                if (!active) return;
                setAgentState({ connected: false, enabled: true, activity: "服务不可用" });
                message.error(error instanceof Error ? error.message : "Agent 服务不可用");
            })
            .finally(() => active && setLoading(false));
        return () => { active = false; };
    }, [projectId]);

    useEffect(() => {
        if (!session?.id) return;
        return subscribeAgent(projectId, (event) => {
            if (event.type === "snapshot") {
                setConversation((current) => current ? { ...current, sessions: event.sessions } : current);
                setSession((current) => current ? event.sessions.find((item) => item.id === current.id) || current : current);
                const seen = useAgentStore.getState().seenEventSeqs;
                setBackgroundUnread(Object.fromEntries(event.sessions.filter((item) => item.id !== session.id && item.eventSeq > (seen[item.id] || 0)).map((item) => [item.id, Math.min(99, item.eventSeq - (seen[item.id] || 0))])));
                const selected = event.sessions.find((item) => item.id === session.id);
                if (selected && selected.eventSeq > session.eventSeq) void agentApi.conversation(projectId, session.id).then((next) => {
                    applyConversation(next);
                    if (next.session) markSessionSeen(next.session.id, next.session.eventSeq);
                }).catch(() => undefined);
                setAgentState({ connected: true, activity: "已同步" });
                return;
            }
            event.events.filter((item) => item.kind === "client_action").forEach((item) => void runClientAction(event.session.id, item));
            setConversation((current) => current ? { ...current, sessions: upsertSession(current.sessions, event.session), ...(current.session?.id === event.session.id ? { session: event.session } : {}) } : current);
            if (event.session.id === session.id) {
                if (!atBottomRef.current && event.events.some((item) => item.kind === "artifact" || item.kind === "error" || item.kind === "user_text" || (item.kind === "assistant_text" && !item.payload.delta) || (item.kind === "run_state" && item.payload.state !== "running"))) setUnreadCount((count) => Math.min(100, count + 1));
                setSession(event.session);
                setEvents((current) => mergeEvents(current, event.events));
                markSessionSeen(event.session.id, event.session.eventSeq);
            } else if (event.events.length) {
                backgroundEventsRef.current.set(event.session.id, mergeEvents(backgroundEventsRef.current.get(event.session.id) || [], event.events));
                setBackgroundUnread((current) => ({ ...current, [event.session.id]: Math.min(99, (current[event.session.id] || 0) + 1) }));
            }
            setAgentState({ connected: true, activity: statusLabel(event.session.status) });
        });
    }, [projectId, session?.id, streamVersion]);

    const runClientAction = async (sessionId: string, event: AgentEvent) => {
        const actionId = String(event.payload.actionId || "");
        if (!actionId || event.payload.targetClientId !== agentClientId || handledClientActionsRef.current.has(actionId)) return;
        handledClientActionsRef.current.add(actionId);
        const name = String(event.payload.name || "");
        const input = (event.payload.input || {}) as { path?: string; ids?: string[] };
        try {
            if (name === "site_navigate" && input.path) navigate(input.path);
            else if (name === "canvas_select_nodes") {
                if (!canvasContext) throw new Error("当前页面没有打开画布");
                canvasContext.applyOps([{ type: "select_nodes", ids: input.ids || [] }]);
            } else if (name === "canvas_focus_nodes") focusCanvasNodes(canvasContext, input.ids || []);
            else throw new Error("当前页面不支持这个客户端操作");
            await agentApi.clientResult(sessionId, { actionId, ok: true });
        } catch (error) {
            await agentApi.clientResult(sessionId, { actionId, ok: false, error: error instanceof Error ? error.message : "客户端操作失败" }).catch(() => undefined);
        }
    };

    useEffect(() => {
        if (!atBottomRef.current) return;
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
    }, [events.length, events.at(-1)?.seq]);

    useEffect(() => {
        const content = contentRef.current;
        const dock = inputDockRef.current;
        if (!content || !dock) return;
        const contentObserver = new ResizeObserver(() => {
            if (atBottomRef.current) requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
        });
        const dockObserver = new ResizeObserver(() => setInputDockHeight(dock.offsetHeight));
        contentObserver.observe(content);
        dockObserver.observe(dock);
        setInputDockHeight(dock.offsetHeight);
        return () => { contentObserver.disconnect(); dockObserver.disconnect(); };
    }, [projectId]);

    const applyConversation = (next: AgentConversation) => {
        setConversation(next);
        setSession(next.session);
        setEvents(next.session?.events || []);
    };

    const send = async () => {
        const text = draft.trim();
        if (!text && !selectedSkill && !attachments.length && !references.length) return;
        setSending(true);
        atBottomRef.current = true;
        setShowScrollBottom(false);
        setUnreadCount(0);
        try {
            const next = await agentApi.send(projectId, {
                text,
                sessionId: session?.id,
                attachmentFileIds: attachments.map((file) => file.id),
                canvasReferences: references.map((item) => ({ projectId, nodeId: item.nodeId })),
                skillId: selectedSkill?.id,
            });
            applyConversation(next);
            if (next.session) markSessionSeen(next.session.id, next.session.eventSeq);
            setDraft(projectId, "");
            setAttachments([]);
            setReferences([]);
            setSelectedSkill(null);
            setStreamVersion((value) => value + 1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "消息发送失败");
        } finally {
            setSending(false);
        }
    };

    const newSession = async () => {
        try {
            const created = await agentApi.createSession(projectId);
            setConversation((current) => current ? { ...current, sessions: [created, ...current.sessions], session: created } : current);
            setSession(created);
            setCurrentSession(projectId, created.id);
            markSessionSeen(created.id, created.eventSeq);
            setEvents([]);
            setStreamVersion((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : "新建会话失败"); }
    };

    const activate = async (id: string) => {
        try {
            const next = await agentApi.conversation(projectId, id);
            if (next.session) next.session.events = mergeEvents(next.session.events || [], backgroundEventsRef.current.get(id) || []);
            backgroundEventsRef.current.delete(id);
            applyConversation(next);
            setCurrentSession(projectId, id);
            if (next.session) markSessionSeen(id, next.session.eventSeq);
            setBackgroundUnread((current) => ({ ...current, [id]: 0 }));
            setHistoryOpen(false);
            setStreamVersion((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : "切换会话失败"); }
    };

    const forkSession = async (source = session) => {
        if (!source) return;
        try {
            const created = await agentApi.fork(source.id);
            setConversation((current) => current ? { ...current, sessions: [created, ...current.sessions], session: created } : current);
            setSession(created);
            setCurrentSession(projectId, created.id);
            markSessionSeen(created.id, created.eventSeq);
            setEvents(created.events || []);
            setHistoryOpen(false);
            setStreamVersion((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : "分叉会话失败"); }
    };

    const upload = async (files: File[]) => {
        if (!files.length) return;
        setUploading(true);
        try {
            const uploaded = await Promise.all(files.map((file) => uploadServerFile(file, file.name)));
            setAttachments((current) => [...current, ...uploaded].slice(0, 20));
        } catch (error) { message.error(error instanceof Error ? error.message : "附件上传失败"); }
        finally { setUploading(false); }
    };

    const decide = async (decision: "approved" | "rejected", scope: "once" | "session" | "project" = "once", proposalEdits?: unknown) => {
        if (!session) return;
        setDecisionBusy(true);
        try {
            const next = await agentApi.decide(session.id, { decision, scope, comment: answer, ...(proposalEdits === undefined ? {} : { proposalEdits }) });
            setSession(next);
            setAnswer("");
        } catch (error) { message.error(error instanceof Error ? error.message : "提交失败"); }
        finally { setDecisionBusy(false); }
    };

    const removeSession = async (id: string) => {
        try {
            await agentApi.remove(id);
            setConversation((current) => current ? { ...current, sessions: current.sessions.filter((item) => item.id !== id) } : current);
        } catch (error) { message.error(error instanceof Error ? error.message : "删除会话失败"); }
    };

    const cancel = async () => {
        if (!session) return;
        try { setSession(await agentApi.cancel(session.id)); }
        catch (error) { message.error(error instanceof Error ? error.message : "停止任务失败"); }
    };

    const loadEarlier = async () => {
        if (!session || !events.length || olderLoadingRef.current) return;
        olderLoadingRef.current = true;
        setOlderLoading(true);
        const previousHeight = scrollRef.current?.scrollHeight || 0;
        try {
            const older = await agentApi.events(session.id, events[0]?.seq || 1);
            setEvents((current) => mergeEvents(older, current));
            requestAnimationFrame(() => {
                const node = scrollRef.current;
                if (node && previousHeight) node.scrollTop += node.scrollHeight - previousHeight;
            });
        }
        catch (error) { message.error(error instanceof Error ? error.message : "更早消息加载失败"); }
        finally { olderLoadingRef.current = false; setOlderLoading(false); }
    };

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: theme.node.panel, color: theme.node.text }}>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.itemHover }}><Bot className="size-4" /></span>
                <div className="min-w-0 flex-1">
                    <button type="button" className="flex max-w-full items-center gap-1 text-left" onClick={() => setHistoryOpen(true)}>
                        <span className="truncate text-sm font-medium">{session?.title || "Canvas Agent"}</span>
                        <History className="size-3 shrink-0 opacity-35" />
                    </button>
                    <div className="flex items-center gap-1.5 truncate text-[11px]" style={{ color: theme.node.muted }}>
                        <span className={`size-1.5 shrink-0 rounded-full ${!model.ready ? "bg-amber-500" : busy ? "animate-pulse bg-blue-500" : "bg-emerald-500"}`} />
                        <span className="truncate">{busy ? statusLabel(session?.status) : model.ready ? `${model.providerName} · ${model.modelName}` : "管理员尚未配置 Agent 模型"}</span>
                    </div>
                </div>
                <Tooltip title="新建会话"><Button type="text" shape="circle" icon={<Plus className="size-4" />} onClick={newSession} disabled={busy} /></Tooltip>
                <Tooltip title="分叉当前会话"><Button type="text" shape="circle" icon={<GitFork className="size-4" />} onClick={() => void forkSession()} disabled={!session || busy} /></Tooltip>
                <Tooltip title="历史会话"><Button type="text" shape="circle" icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)} /></Tooltip>
                <Tooltip title="Skill"><Button type="text" shape="circle" icon={<Sparkles className="size-4" />} onClick={() => setSkillsOpen(true)} /></Tooltip>
                {embedded ? <Tooltip title="关闭"><Button type="text" shape="circle" icon={<X className="size-4" />} onClick={() => closePanel(projectId)} /></Tooltip> : null}
            </header>

            <div
                ref={scrollRef}
                className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4"
                onScroll={(event) => { const target = event.currentTarget; atBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 120; setShowScrollBottom(!atBottomRef.current); if (atBottomRef.current) setUnreadCount(0); if (target.scrollTop < 80 && events[0]?.seq && events[0].seq > 1 && !olderLoading) void loadEarlier(); }}
            >
                <div ref={contentRef}>
                    <AgentConversationFlow
                        events={events}
                        loading={loading}
                        theme={theme}
                        status={session?.status}
                        canLoadEarlier={Boolean(events[0]?.seq && events[0].seq > 1)}
                        loadingEarlier={olderLoading}
                        onLoadEarlier={() => void loadEarlier()}
                        onSuggestion={(text) => { setDraft(projectId, text); setComposerFocusRequest((value) => value + 1); }}
                    />
                </div>
            </div>

            <AgentUserLocator events={events} containerRef={scrollRef} theme={theme} />
            <ScrollToBottomButton visible={showScrollBottom} unread={unreadCount} bottom={inputDockHeight + 12} onClick={() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); atBottomRef.current = true; setUnreadCount(0); setShowScrollBottom(false); }} />

            <div ref={inputDockRef} className="shrink-0">
                {session?.pendingDecision ? <AgentDecisionCard pending={session.pendingDecision} value={answer} theme={theme} busy={decisionBusy} onChange={setAnswer} onDecide={(decision, scope, proposalEdits) => void decide(decision, scope, proposalEdits)} /> : null}

                {session?.pendingDecision?.kind !== "question" ? <AgentComposer
                    value={draft}
                    theme={theme}
                    ready={model.ready}
                    busy={busy}
                    sending={sending}
                    uploading={uploading}
                    focusRequest={composerFocusRequest}
                    skills={skills}
                    nodes={nodes}
                    skill={selectedSkill}
                    references={references}
                    attachments={attachments}
                    onChange={(value) => setDraft(projectId, value)}
                    onSend={() => void send()}
                    onCancel={() => void cancel()}
                    onUpload={(files) => void upload(files)}
                    onSkill={setSelectedSkill}
                    onReference={(reference) => setReferences((current) => current.some((item) => item.nodeId === reference.nodeId) ? current : [...current, reference])}
                    onRemoveReference={(id) => setReferences((current) => current.filter((item) => item.nodeId !== id))}
                    onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                /> : null}
            </div>

            <Drawer title="历史会话" placement="right" width={Math.min(430, window.innerWidth)} open={historyOpen} onClose={() => setHistoryOpen(false)}>
                <AgentHistoryList sessions={conversation?.sessions || []} activeId={session?.id} unread={backgroundUnread} query={historyQuery} theme={theme} onQuery={setHistoryQuery} onActivate={(id) => void activate(id)} onDelete={(id) => void removeSession(id)} onFork={(id) => { const source = conversation?.sessions.find((item) => item.id === id); if (source) void forkSession(source); }} />
            </Drawer>

            <Drawer title="可用 Skill" placement="right" width={Math.min(430, window.innerWidth)} open={skillsOpen} onClose={() => setSkillsOpen(false)}>
                <AgentSkillList skills={skills} query={skillQuery} theme={theme} onQuery={setSkillQuery} onSelect={(skill) => { setSelectedSkill(skill); setSkillsOpen(false); setComposerFocusRequest((value) => value + 1); }} />
            </Drawer>
        </div>
    );
}

function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]) {
    const map = new Map(current.map((event) => [event.seq, event]));
    incoming.forEach((event) => map.set(event.seq, event));
    return Array.from(map.values()).sort((a, b) => a.seq - b.seq);
}

function upsertSession(current: AgentSession[], incoming: AgentSession) {
    return [incoming, ...current.filter((item) => item.id !== incoming.id)].sort((a, b) => Number(b.id === incoming.id) - Number(a.id === incoming.id));
}

function statusLabel(status?: AgentSession["status"]) {
    return ({ idle: "准备就绪", running: "正在处理", waiting_for_user: "等待确认", completed: "执行完成", failed: "执行失败", canceled: "已取消" } as Record<string, string>)[status || ""] || "已连接";
}

function focusCanvasNodes(context: AgentCanvasContext | null, ids: string[]) {
    if (!context) throw new Error("当前页面没有打开画布");
    const targets = context.snapshot.nodes.filter((node) => ids.includes(node.id));
    if (!targets.length) throw new Error("要聚焦的节点不存在");
    const minX = Math.min(...targets.map((node) => node.position.x));
    const minY = Math.min(...targets.map((node) => node.position.y));
    const maxX = Math.max(...targets.map((node) => node.position.x + node.width));
    const maxY = Math.max(...targets.map((node) => node.position.y + node.height));
    const scale = Math.min(1, Math.max(.35, 700 / Math.max(maxX - minX, maxY - minY, 1)));
    context.applyOps([{ type: "select_nodes", ids }, { type: "set_viewport", viewport: { x: window.innerWidth / 2 - ((minX + maxX) / 2) * scale, y: window.innerHeight / 2 - ((minY + maxY) / 2) * scale, k: scale } }]);
}
