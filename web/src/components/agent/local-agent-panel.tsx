import { useDirectorStore } from "@/stores/use-director-store";
import { readDirectorQuery } from "@/services/director-queries";
import { useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Dropdown, Tooltip } from "antd";
import { History, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { canvasThemes, sxhAgentLightTheme } from "@/lib/canvas-theme";
import { randomId } from "@/lib/utils";
import { agentApi, agentClientId, subscribeAgent, type AgentEngine, type AgentComposerDocument, type AgentConversation, type AgentEvent, type AgentQueuedMessage, type AgentReferenceCandidate, type AgentSceneCapabilities, type AgentSession, type AgentTurnIndexItem } from "@/services/api/agent";
import { uploadServerFile, type ServerFile } from "@/services/api/server";
import { selectAgentEntityReferences, useAgentStore, type AgentCanvasContext } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    AgentConversationFlow,
    AgentDecisionCard,
    AgentHistoryList,
    AgentUserLocator,
    ScrollToBottomButton,
} from "./agent-conversation-ui";
import { CodexModelPicker } from "./codex-model-picker";
import { AgentComposer } from "./agent-composer";
import { AgentApprovalBar, AgentQuestionComposer } from "./agent-decision-dock";
import { EMPTY_COMPOSER_DOCUMENT, composerPlainText, normalizeComposerDocument } from "./agent-composer-model";
import { AgentErrorBoundary } from "./agent-error-boundary";
import { useAgentScroll } from "./use-agent-scroll";
import { agentDraftStorage } from "./agent-draft-storage";

export function LocalAgentPanel({ projectId, themeMode }: { projectId: string; themeMode?: "light" | "dark" }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const currentTheme = useThemeStore((state) => state.theme);
    const theme = themeMode === "light" ? sxhAgentLightTheme : canvasThemes[themeMode || currentTheme];
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const draft = useAgentStore((state) => state.drafts[projectId] || "");
    const savedSessionId = useAgentStore((state) => state.currentSessionIds[projectId]);
    const setDraft = useAgentStore((state) => state.setDraft);
    const setCurrentSession = useAgentStore((state) => state.setCurrentSession);
    const markSessionSeen = useAgentStore((state) => state.markSessionSeen);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const entityReferences = useAgentStore((state) => selectAgentEntityReferences(state, projectId));
    const preparedFocusRequest = useAgentStore((state) => state.focusRequests[projectId] || 0);
    const removeEntityReference = useAgentStore((state) => state.removeEntityReference);
    const clearEntityReferences = useAgentStore((state) => state.clearEntityReferences);
    const [conversation, setConversation] = useState<AgentConversation | null>(null);
    const [session, setSession] = useState<AgentSession | null>(null);
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const [capabilities, setCapabilities] = useState<AgentSceneCapabilities | null>(null);
    const [references, setReferences] = useState<AgentReferenceCandidate[]>([]);
    const directorReferenceVersion = useDirectorStore((store) => ["project", "assets", "direction", "segments", "sources"].map((resource) => store.data[projectId]?.epochs[resource as import("@/types/director-sync").DirectorResource] || 0).join(":"));
    const [model, setModel] = useState({ ready: false, modelName: "", providerName: "", protocolVersion: 1, storageVersion: 1 });
    const [composerDocument, setComposerDocument] = useState<AgentComposerDocument>(() => draft ? { version: 1, segments: [{ type: "text", text: draft }] } : EMPTY_COMPOSER_DOCUMENT);
    useEffect(() => {
        if (capabilities?.sceneId !== "director") return;
        return useDirectorStore.getState().retainProject(projectId, ["assets", "direction", "segments", "sources"]);
    }, [projectId, capabilities?.sceneId]);
    useEffect(() => {
        if (capabilities?.sceneId !== "director") return;
        let active = true;
        void readDirectorQuery(projectId, "project", ["agent-references"], () => agentApi.references(projectId)).then((items) => { if (active) setReferences(items); }).catch(() => undefined);
        return () => { active = false; };
    }, [projectId, capabilities?.sceneId, directorReferenceVersion]);
    useEffect(() => {
        if (capabilities?.sceneId !== "director") return;
        const { data, states } = useDirectorStore.getState();
        const project = data[projectId]; const state = states[projectId];
        if (!project?.ready || !state) return;
        setComposerDocument((current) => {
            let changed = false;
            const segments = current.segments.map((segment) => {
                if (!("projectId" in segment) || segment.projectId !== projectId) return segment;
                const collection = segment.type === "asset" ? project.assets : segment.type === "style" ? project.styles : segment.type === "director" && segment.entityKind === "sequence" ? state.sequences : segment.type === "director" && segment.entityKind === "video-segment" ? state.videoSegments : undefined;
                if (!collection) return segment;
                const id = segment.type === "asset" ? segment.assetId : segment.type === "style" ? segment.styleId : segment.type === "director" ? segment.entityId : "";
                const entity = collection.find((item) => item.id === id);
                const label = entity && ("name" in entity ? entity.name : entity.title);
                if (label === segment.label && entity) return segment;
                changed = true;
                return entity ? { ...segment, label } : { type: "text" as const, text: `@${segment.label || id}（已删除）` };
            });
            return changed ? { version: 1, segments } : current;
        });
    }, [projectId, capabilities?.sceneId, directorReferenceVersion]);
    const [followUpMode, setFollowUpMode] = useState<"steer" | "queue">("steer");
    const [queuedMessages, setQueuedMessages] = useState<AgentQueuedMessage[]>([]);
    const [turnIndex, setTurnIndex] = useState<AgentTurnIndexItem[]>([]);
    const [attachments, setAttachments] = useState<ServerFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [pendingMessage, setPendingMessage] = useState<{ projectId: string; event: AgentEvent } | null>(null);
    const sendingRef = useRef(false);
    const projectIdRef = useRef(projectId);
    projectIdRef.current = projectId;
    const [modelSaving, setModelSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [olderLoading, setOlderLoading] = useState(false);
    const [backgroundUnread, setBackgroundUnread] = useState<Record<string, number>>({});
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyQuery, setHistoryQuery] = useState("");
    const [decisionBusy, setDecisionBusy] = useState(false);
    const [streamVersion, setStreamVersion] = useState(0);
    const [composerFocusRequest, setComposerFocusRequest] = useState(0);
    const [restartingMessageSeq, setRestartingMessageSeq] = useState<number | null>(null);
    const [inputDockHeight, setInputDockHeight] = useState(144);
    const contentRef = useRef<HTMLDivElement>(null);
    const inputDockRef = useRef<HTMLDivElement>(null);
    const olderLoadingRef = useRef(false);
    const handledClientActionsRef = useRef(new Set<string>());
    const backgroundEventsRef = useRef(new Map<string, AgentEvent[]>());
    const hydratedDraftScopeRef = useRef("");
    const activeSessionRef = useRef<AgentSession | null>(null);
    const eventsRef = useRef<AgentEvent[]>([]);
    const lastStreamEventAtRef = useRef(Date.now());
    const reconcilingRef = useRef(false);
    const staleSkillWarningRef = useRef("");
    const engineState = capabilities?.engines?.find((item) => item.id === (session?.engine || "builtin"));
    const busy = session?.status === "running" || session?.status === "waiting_for_user";
    eventsRef.current = events;
    const eventKey = `${pendingMessage?.event.payload.clientMessageId || ""}:${events.at(-1)?.seq || 0}:${String(events.at(-1)?.payload?.text || "").length}:${events.length}`;
    const { scrollRef, atBottomRef, showBottom: showScrollBottom, unread: unreadCount, onScroll: updateScroll, scrollBottom, preserveBeforePrepend, restoreAfterPrepend, beforeCollapse } = useAgentScroll({ sessionId: session?.id, eventKey, contentRef });

    useEffect(() => {
        if (capabilities?.sceneId !== "director" || busy) return;
        let disposed = false;
        const timer = setInterval(() => { void agentApi.capabilities(projectId).then((value) => { if (!disposed) setCapabilities(value); }).catch(() => {}); }, 15_000);
        return () => { disposed = true; clearInterval(timer); };
    }, [projectId, capabilities?.sceneId, busy]);

    useEffect(() => {
        if (!entityReferences.length) return;
        setComposerDocument((current) => ({
            version: 1,
            segments: [...current.segments, ...entityReferences.flatMap((item) => [item.kind === "asset"
                ? { type: "asset" as const, mentionId: randomId(), projectId, assetId: item.assetId, nodeId: item.nodeId, path: item.path, label: item.title }
                : item.kind === "style" ? { type: "style" as const, mentionId: randomId(), projectId, styleId: item.styleId, nodeId: item.nodeId, label: item.title }
                : { type: "director" as const, mentionId: randomId(), projectId, entityKind: item.entityKind, entityId: item.entityId, label: item.title }, { type: "text" as const, text: item.instruction ? `\n${item.instruction}\n` : " " }])],
        }));
        clearEntityReferences(projectId);
    }, [entityReferences, projectId, clearEntityReferences]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setConversation(null);
        setCapabilities(null);
        setReferences([]);
        staleSkillWarningRef.current = "";
        activeSessionRef.current = null;
        setSession(null);
        setEvents([]);
        setComposerDocument(draft ? { version: 1, segments: [{ type: "text", text: draft }] } : EMPTY_COMPOSER_DOCUMENT);
        setQueuedMessages([]);
        setAttachments([]);
        handledClientActionsRef.current.clear();
        atBottomRef.current = true;
        Promise.all([agentApi.config(), agentApi.capabilities(projectId), agentApi.references(projectId), agentApi.conversation(projectId, savedSessionId).catch(() => agentApi.conversation(projectId))])
            .then(async ([config, nextCapabilities, nextReferences, nextConversation]) => {
                if (config.protocolVersion !== 4) throw new Error(`不支持的 Agent 通信协议版本：${config.protocolVersion}`);
                if (config.storageVersion !== 2) throw new Error(`不支持的 Agent 存储版本：${config.storageVersion}`);
                if (!nextConversation.session) {
                    const created = await agentApi.createSession(projectId);
                    nextConversation = { ...nextConversation, sessions: [created, ...nextConversation.sessions], session: created, queuedMessages: [] };
                }
                if (!active) return;
                setModel(config);
                setCapabilities(nextCapabilities);
                setReferences(nextReferences);
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
        const scope = `${projectId}:${session.id}`;
        let active = true;
        hydratedDraftScopeRef.current = "";
        void agentDraftStorage.get(scope).then((saved) => {
            if (!active) return;
            if (saved?.version === 1) {
                setComposerDocument(normalizeComposerDocument(saved.document));
                setAttachments(Array.isArray(saved.attachments) ? saved.attachments : []);
                setFollowUpMode(saved.followUpMode === "queue" ? "queue" : "steer");
            }
            hydratedDraftScopeRef.current = scope;
        });
        return () => { active = false; };
    }, [projectId, session?.id]);

    useEffect(() => {
        if (!capabilities) return;
        const available = new Set(capabilities.skills.map((skill) => skill.id));
        const invalid = composerDocument.segments.filter((segment) => segment.type === "skill" && !available.has(segment.skillId));
        if (!invalid.length) return;
        setComposerDocument(normalizeComposerDocument({ version: 1, segments: composerDocument.segments.map((segment) => segment.type === "skill" && !available.has(segment.skillId) ? { type: "text" as const, text: `/${segment.label || segment.skillId}` } : segment) }));
        const key = `${projectId}:${invalid.map((segment) => segment.type === "skill" ? segment.skillId : "").join(",")}`;
        if (staleSkillWarningRef.current !== key) { staleSkillWarningRef.current = key; message.info("草稿中的旧 Skill 不适用于当前场景，已保留为普通文字"); }
    }, [capabilities, composerDocument, message, projectId]);

    useEffect(() => {
        if (!session?.id) return;
        const scope = `${projectId}:${session.id}`;
        if (hydratedDraftScopeRef.current !== scope) return;
        const timer = window.setTimeout(() => { void agentDraftStorage.set(scope, { version: 1, document: composerDocument, attachments, followUpMode }); }, 250);
        return () => window.clearTimeout(timer);
    }, [attachments, composerDocument, followUpMode, projectId, session?.id]);

    useEffect(() => {
        const sessionId = session?.id;
        if (!sessionId) return;
        void agentApi.turnIndex(sessionId).then((items) => {
            if (activeSessionRef.current?.id === sessionId) setTurnIndex(items);
        }).catch(() => {
            if (activeSessionRef.current?.id === sessionId) setTurnIndex([]);
        });
    }, [session?.id]);

    useEffect(() => {
        return subscribeAgent(projectId, (event) => {
            lastStreamEventAtRef.current = Date.now();
            const activeSession = activeSessionRef.current;
            if (event.type === "queue.updated") {
                if (event.sessionId === activeSession?.id) setQueuedMessages(event.queuedMessages);
                return;
            }
            if (event.type === "snapshot") {
                setConversation((current) => current ? { ...current, sessions: event.sessions } : current);
                if (!activeSession) return;
                const selected = event.sessions.find((item) => item.id === activeSession.id);
                if (selected) setActiveSession(selected);
                setQueuedMessages(event.queuedMessages[activeSession.id] || []);
                const seen = useAgentStore.getState().seenEventSeqs;
                setBackgroundUnread(Object.fromEntries(event.sessions.filter((item) => item.id !== activeSession.id && item.eventSeq > (seen[item.id] || 0)).map((item) => [item.id, Math.min(99, item.eventSeq - (seen[item.id] || 0))])));
                if (selected && needsConversationReconcile(selected.eventSeq, eventsRef.current)) void agentApi.conversation(projectId, activeSession.id).then((next) => {
                    if (activeSessionRef.current?.id !== activeSession.id) return;
                    applyConversation(next);
                    if (next.session) markSessionSeen(next.session.id, next.session.eventSeq);
                }).catch(() => undefined);
                setAgentState({ connected: true, activity: "已同步" });
                return;
            }
            if (event.events.some((item) => item.kind === "tool_result") && !useDirectorStore.getState().data[projectId]?.ready) void agentApi.references(projectId).then((items) => { if (projectIdRef.current === projectId) setReferences(items); }).catch(() => undefined);
            event.events.filter((item) => item.kind === "client_action").forEach((item) => void runClientAction(event.session.id, item));
            setConversation((current) => current ? { ...current, sessions: upsertSession(current.sessions, event.session), ...(current.session?.id === event.session.id ? { session: event.session } : {}) } : current);
            if (event.session.id === activeSession?.id) {
                setActiveSession(event.session);
                setEvents((current) => mergeEvents(current, event.events));
                markSessionSeen(event.session.id, event.session.eventSeq);
            } else if (event.events.length) {
                backgroundEventsRef.current.set(event.session.id, mergeEvents(backgroundEventsRef.current.get(event.session.id) || [], event.events));
                setBackgroundUnread((current) => ({ ...current, [event.session.id]: Math.min(99, (current[event.session.id] || 0) + 1) }));
            }
            setAgentState({ connected: true, activity: statusLabel(event.session.status) });
        }, (connected) => {
            if (!connected) {
                setAgentState({ connected: false, activity: "正在重新连接" });
                return;
            }
            setAgentState({ connected: true, activity: "已连接" });
            const active = activeSessionRef.current;
            if (!active) return;
            void agentApi.conversation(projectId, active.id).then((next) => {
                if (activeSessionRef.current?.id !== active.id) return;
                applyConversation(next);
                if (next.session) markSessionSeen(next.session.id, next.session.eventSeq);
            }).catch(() => undefined);
        });
    }, [projectId]);

    useEffect(() => {
        if (!busy || !session?.id) return;
        const timer = window.setInterval(() => {
            const active = activeSessionRef.current;
            if (!active || reconcilingRef.current || Date.now() - lastStreamEventAtRef.current < 4_000) return;
            reconcilingRef.current = true;
            void agentApi.conversation(projectId, active.id).then((next) => {
                if (activeSessionRef.current?.id !== active.id) return;
                applyConversation(next);
                if (next.session) markSessionSeen(next.session.id, next.session.eventSeq);
                lastStreamEventAtRef.current = Date.now();
            }).catch(() => undefined).finally(() => { reconcilingRef.current = false; });
        }, 2_000);
        return () => window.clearInterval(timer);
    }, [busy, projectId, session?.id]);

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
        const content = contentRef.current;
        const dock = inputDockRef.current;
        if (!content || !dock) return;
        const dockObserver = new ResizeObserver(() => {
            setInputDockHeight(dock.offsetHeight);
            if (atBottomRef.current) requestAnimationFrame(() => scrollBottom("auto"));
        });
        dockObserver.observe(dock);
        setInputDockHeight(dock.offsetHeight);
        return () => { dockObserver.disconnect(); };
    }, [atBottomRef, projectId, scrollBottom]);

    const setActiveSession = (next: AgentSession | null) => {
        activeSessionRef.current = next;
        setSession(next);
    };

    const applyConversation = (next: AgentConversation) => {
        const currentSession = activeSessionRef.current;
        const sameSession = Boolean(currentSession && next.session?.id === currentSession.id);
        const selectedSession = sameSession && currentSession!.eventSeq > next.session!.eventSeq ? currentSession : next.session;
        setConversation({ ...next, session: selectedSession, sessions: selectedSession ? upsertSession(next.sessions, selectedSession) : next.sessions });
        setActiveSession(selectedSession);
        setEvents((current) => sameSession ? mergeEvents(current, next.session?.events || []) : next.session?.events || []);
        setQueuedMessages(next.queuedMessages || []);
    };

    const reloadConversation = async () => {
        setLoading(true);
        try {
            const next = await agentApi.conversation(projectId, session?.id);
            applyConversation(next);
            setStreamVersion((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : "重新加载会话失败"); }
        finally { setLoading(false); }
    };

    const send = async () => {
        if (sendingRef.current) return;
        if (!composerPlainText(composerDocument).trim() && !attachments.length && !composerDocument.segments.some((item) => item.type !== "text")) return;
        sendingRef.current = true;
        const sourceSessionId = session?.id;
        const clientMessageId = randomId();
        const submittedDocument = composerDocument;
        setPendingMessage({ projectId, event: { sessionId: sourceSessionId || "", seq: -1, runId: null, kind: "user_text", createdAt: new Date().toISOString(), payload: {
            clientMessageId, text: composerPlainText(submittedDocument), attachments: attachments.map((file) => ({ fileId: file.id, name: file.name, mimeType: file.mimeType })),
        } } });
        setSending(true);
        atBottomRef.current = true;
        try {
            const next = await agentApi.send(projectId, {
                preferredSessionId: session?.id,
                clientMessageId,
                submissionMode: session?.status === "waiting_for_user" ? "queue" : busy ? followUpMode : "direct",
                content: composerDocument,
                attachmentFileIds: attachments.map((file) => file.id),
            });
            if (projectIdRef.current !== projectId || activeSessionRef.current?.id !== sourceSessionId) return;
            applyConversation(next);
            if (next.session) markSessionSeen(next.session.id, next.session.eventSeq);
            setDraft(projectId, "");
            setComposerDocument(EMPTY_COMPOSER_DOCUMENT);
            setAttachments([]);
            if (session?.id) void agentDraftStorage.remove(`${projectId}:${session.id}`);
            clearEntityReferences(projectId);
            setStreamVersion((value) => value + 1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "消息发送失败");
        } finally {
            sendingRef.current = false;
            setSending(false);
            setPendingMessage(null);
        }
    };

    const newSession = async (engine: AgentEngine = "builtin") => {
        try {
            const created = await agentApi.createSession(projectId, engine);
            setConversation((current) => current ? { ...current, sessions: [created, ...current.sessions], session: created } : current);
            setActiveSession(created);
            setCurrentSession(projectId, created.id);
            markSessionSeen(created.id, created.eventSeq);
            setEvents([]);
            setQueuedMessages([]);
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
            setActiveSession(created);
            setCurrentSession(projectId, created.id);
            markSessionSeen(created.id, created.eventSeq);
            setEvents(created.events || []);
            setQueuedMessages([]);
            setHistoryOpen(false);
            setStreamVersion((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : "分叉会话失败"); }
    };

    const restartFromMessage = async (event: AgentEvent) => {
        if (!session || restartingMessageSeq !== null) return;
        setRestartingMessageSeq(event.seq);
        try {
            const created = await agentApi.fork(session.id, event.seq);
            const storedContent = event.payload.content as AgentComposerDocument | undefined;
            const content = storedContent
                ? normalizeComposerDocument(storedContent)
                : { version: 1 as const, segments: [{ type: "text" as const, text: String(event.payload.text || "") }] };
            const nextAttachments = (Array.isArray(event.payload.attachments) ? event.payload.attachments : []).flatMap((value) => {
                if (!value || typeof value !== "object") return [];
                const item = value as Record<string, unknown>; const id = String(item.fileId || "");
                if (!id) return [];
                return [{ id, fileId: id, name: String(item.name || "附件"), mimeType: String(item.mimeType || "application/octet-stream"), bytes: Number(item.bytes) || 0, metadata: {}, createdAt: event.createdAt, url: "" } satisfies ServerFile];
            });
            setConversation((current) => current ? { ...current, sessions: [created, ...current.sessions.filter((item) => item.id !== created.id)], session: created } : current);
            setActiveSession(created);
            setCurrentSession(projectId, created.id);
            markSessionSeen(created.id, created.eventSeq);
            setEvents(created.events || []);
            setQueuedMessages([]);
            setComposerDocument(content);
            setAttachments(nextAttachments);
            setDraft(projectId, composerPlainText(content));
            setHistoryOpen(false);
            setComposerFocusRequest((value) => value + 1);
            setStreamVersion((value) => value + 1);
            message.success("已创建新分支，可以修改后发送");
        } catch (error) { message.error(error instanceof Error ? error.message : "从这条消息重新开始失败"); }
        finally { setRestartingMessageSeq(null); }
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

    const decide = async (decision: "approved" | "rejected", scope: "once" | "session" | "project" = "once", proposalEdits?: unknown, answers?: Record<string, string>) => {
        if (!session) return;
        setDecisionBusy(true);
        try {
            const next = await agentApi.decide(session.id, { decision, scope, ...(answers ? { answers } : {}), ...(proposalEdits === undefined ? {} : { proposalEdits }) });
            setActiveSession(next);
            if (next.events?.length) setEvents((current) => mergeEvents(current, next.events || []));
            return next;
        } catch (error) { message.error(error instanceof Error ? error.message : "提交失败"); throw error; }
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
        try { setActiveSession(await agentApi.cancel(session.id)); }
        catch (error) { message.error(error instanceof Error ? error.message : "停止任务失败"); }
    };

    const loadEarlier = async () => {
        if (!session || !events.length || olderLoadingRef.current) return;
        olderLoadingRef.current = true;
        setOlderLoading(true);
        preserveBeforePrepend();
        try {
            const older = await agentApi.events(session.id, events[0]?.seq || 1);
            setEvents((current) => mergeEvents(older, current));
            restoreAfterPrepend();
        }
        catch (error) { message.error(error instanceof Error ? error.message : "更早消息加载失败"); }
        finally { olderLoadingRef.current = false; setOlderLoading(false); }
    };

    const locateTurn = async (seq: number) => {
        if (!session) return;
        preserveBeforePrepend();
        try {
            let before = events[0]?.seq || session.eventSeq + 1; let collected: AgentEvent[] = [];
            while (before > seq) { const page = await agentApi.events(session.id, before, 500); if (!page.length) break; collected = mergeEvents(page, collected); before = page[0].seq; }
            setEvents((current) => mergeEvents(collected, current));
            restoreAfterPrepend();
            requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-agent-user-seq='${seq}']`)?.scrollIntoView({ behavior: "smooth", block: "start" })));
        } catch (error) { message.error(error instanceof Error ? error.message : "定位历史轮次失败"); }
    };

    return (
        <AgentErrorBoundary resetKey={`${projectId}:${session?.id || "loading"}:${streamVersion}`} onReload={() => void reloadConversation()}><div className="agent-panel-shell relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: theme.node.panel, color: theme.node.text }}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                <div className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full text-left" onClick={() => setHistoryOpen(true)}>
                        <span className="block truncate text-sm font-medium">{session?.title || (capabilities?.sceneId === "director" ? "导演 Agent" : "Canvas Agent")}</span>
                    </button>
                </div>
                {session?.engine === "codex" ? <span className="text-xs opacity-50">Codex</span> : null}
                {capabilities?.sceneId === "director" ? <Dropdown trigger={["click"]} menu={{ items: [{ key: "builtin", label: "新建内置 Agent 对话" }, { key: "codex", label: "新建 Codex 对话" }], onClick: ({ key }) => void newSession(key as AgentEngine) }}><Button type="text" shape="circle" aria-label="选择引擎新建会话" icon={<Plus className="size-4" />} disabled={busy} /></Dropdown> : <Tooltip title="新建会话"><Button type="text" shape="circle" icon={<Plus className="size-4" />} onClick={() => void newSession()} disabled={busy} /></Tooltip>}
                <Tooltip title="历史会话"><Button type="text" shape="circle" icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)} /></Tooltip>
            </header>

            <div
                ref={scrollRef}
                className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4"
                onScroll={(event) => { updateScroll(); if (event.currentTarget.scrollTop < 80 && events[0]?.seq && events[0].seq > 1 && !olderLoading) void loadEarlier(); }}
            >
                <div ref={contentRef}>
                    <AgentConversationFlow
                        events={events}
                        loading={loading}
                        theme={theme}
                        emptyState={capabilities?.composer}
                        status={session?.status}
                        currentRunId={session?.currentRunId}
                        pendingMessage={pendingMessage?.projectId === projectId && pendingMessage.event.sessionId === (session?.id || "") ? pendingMessage.event : null}
                        pendingDecision={session?.pendingDecision}
                        canLoadEarlier={false}
                        loadingEarlier={olderLoading}
                        onLoadEarlier={() => void loadEarlier()}
                        onSuggestion={(text) => { setComposerDocument({ version: 1, segments: [{ type: "text", text }] }); setDraft(projectId, text); setComposerFocusRequest((value) => value + 1); }}
                        restartingMessageSeq={restartingMessageSeq}
                        onRestartFromMessage={session?.engine === "codex" ? undefined : (event) => void restartFromMessage(event)}
                        onBeforeProcessAutoCollapse={beforeCollapse}
                    />
                </div>
            </div>

            <AgentUserLocator events={events} turnIndex={turnIndex} containerRef={scrollRef} theme={theme} onLocate={(seq) => void locateTurn(seq)} />
            <ScrollToBottomButton visible={showScrollBottom} unread={unreadCount} bottom={inputDockHeight + 12} onClick={() => scrollBottom()} />

            <div ref={inputDockRef} className="shrink-0">
                {queuedMessages.length ? <QueuedMessages items={queuedMessages} busy={sending} onSteer={(id) => session && void agentApi.steerQueued(session.id, id).then(applyConversation).catch((error) => message.error(error.message))} onRetry={(id) => session && void agentApi.retryQueued(session.id, id).then(setQueuedMessages).catch((error) => message.error(error.message))} onDelete={(id) => session && void agentApi.deleteQueued(session.id, id).then(() => setQueuedMessages((items) => items.filter((item) => item.id !== id))).catch((error) => message.error(error.message))} /> : null}
                {session?.pendingDecision?.kind === "question" ? <AgentQuestionComposer pending={session.pendingDecision} busy={decisionBusy} onDecide={decide} /> : null}
                {session?.pendingDecision?.kind === "approval" ? <AgentApprovalBar pending={session.pendingDecision} busy={decisionBusy} onDecide={decide} /> : null}
                {session?.pendingDecision?.kind === "proposal" ? <AgentDecisionCard pending={session.pendingDecision} theme={theme} busy={decisionBusy} onDecide={(decision, scope, proposalEdits) => void decide(decision, scope, proposalEdits)} /> : null}
                {session?.pendingDecision?.kind !== "question" && session?.pendingDecision?.kind !== "proposal" ? <AgentComposer
                    document={composerDocument}
                    modelControl={session?.engine === "codex" ? <CodexModelPicker key={session.id} session={session} onSavingChange={setModelSaving} onChange={(updated) => { if (activeSessionRef.current?.id === updated.id) setActiveSession({ ...activeSessionRef.current, codexOptions: updated.codexOptions }); }} /> : undefined}
                    ready={engineState?.ready ?? model.ready}
                    unavailableReason={engineState?.reason}
                    busy={busy}
                    waiting={session?.status === "waiting_for_user"}
                    sending={sending || modelSaving}
                    uploading={uploading}
                    focusRequest={composerFocusRequest + preparedFocusRequest}
                    skills={capabilities?.skills || []}
                    references={references}
                    placeholder={capabilities?.composer.placeholder}
                    referenceLabel={capabilities?.composer.referenceLabel}
                    attachments={attachments}
                    followUpMode={session?.status === "waiting_for_user" ? "queue" : followUpMode}
                    onDocumentChange={(value) => { setComposerDocument(value); setDraft(projectId, composerPlainText(value)); }}
                    onFollowUpModeChange={setFollowUpMode}
                    onSend={() => void send()}
                    onCancel={() => void cancel()}
                    onUpload={(files) => void upload(files)}
                    onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                /> : null}
            </div>

            <Drawer title="历史会话" placement="right" size={Math.min(430, window.innerWidth)} open={historyOpen} onClose={() => setHistoryOpen(false)}>
                <AgentHistoryList sessions={conversation?.sessions || []} activeId={session?.id} unread={backgroundUnread} query={historyQuery} theme={theme} onQuery={setHistoryQuery} onActivate={(id) => void activate(id)} onDelete={(id) => void removeSession(id)} onFork={(id) => { const source = conversation?.sessions.find((item) => item.id === id); if (source) void forkSession(source); }} />
            </Drawer>

        </div></AgentErrorBoundary>
    );
}

function QueuedMessages({ items, busy, onSteer, onRetry, onDelete }: { items: AgentQueuedMessage[]; busy: boolean; onSteer: (id: string) => void; onRetry: (id: string) => void; onDelete: (id: string) => void }) {
    return <div className="agent-queue-list">{items.map((item) => <div key={item.id} className="agent-queue-item"><span className={`agent-queue-dot is-${item.status}`} /><span className="min-w-0 flex-1"><strong>{item.displayText}</strong><small>{item.status === "queued" ? "等待当前任务完成" : item.status === "held" ? "等待确认" : item.status === "failed" ? item.error || "发送失败" : "正在发送"}</small></span>{["queued", "held", "failed"].includes(item.status) ? <span className="flex shrink-0 gap-1">{item.status === "failed" || item.status === "held" ? <button disabled={busy} onClick={() => onRetry(item.id)}>重试</button> : null}<button disabled={busy} onClick={() => onSteer(item.id)}>马上</button><button disabled={busy} onClick={() => onDelete(item.id)}>删除</button></span> : null}</div>)}</div>;
}

export function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]) {
    const sessionId = current[0]?.sessionId || incoming[0]?.sessionId;
    const events = current.filter((event) => !sessionId || event.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
    const bySeq = new Map(events.map((event) => [event.seq, event]));
    const streams = new Map<string, AgentEvent>();
    for (const event of events) {
        const key = streamEventKey(event);
        if (!key) continue;
        const previous = streams.get(key);
        if (!previous) streams.set(key, event);
        else {
            bySeq.delete(previous.seq);
            const merged = mergeStreamEvent(previous, event);
            bySeq.set(merged.seq, merged);
            streams.set(key, merged);
        }
    }
    for (const event of incoming.filter((item) => !sessionId || item.sessionId === sessionId).sort((a, b) => a.seq - b.seq)) {
        const key = streamEventKey(event);
        const previous = key ? streams.get(key) : undefined;
        if (!key || !previous) {
            bySeq.set(event.seq, event);
            if (key) streams.set(key, event);
            continue;
        }
        if (event.seq < previous.seq || (event.seq === previous.seq && event.payload.delta !== false)) continue;
        bySeq.delete(previous.seq);
        const merged = mergeStreamEvent(previous, event);
        bySeq.set(merged.seq, merged);
        streams.set(key, merged);
    }
    return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}

export function needsConversationReconcile(serverEventSeq: number, loadedEvents: AgentEvent[]) {
    return serverEventSeq > (loadedEvents.at(-1)?.seq || 0);
}

function streamEventKey(event: AgentEvent) {
    if (event.kind !== "assistant_text" && event.kind !== "thinking") return "";
    const streamId = String(event.payload?.streamId || "");
    return streamId ? `${event.kind}:${streamId}` : "";
}

function mergeStreamEvent(previous: AgentEvent, incoming: AgentEvent): AgentEvent {
    if (incoming.payload.delta === false) return incoming;
    return {
        ...incoming,
        payload: {
            ...previous.payload,
            ...incoming.payload,
            text: `${String(previous.payload.text || "")}${String(incoming.payload.text || "")}`,
        },
    };
}

function upsertSession(current: AgentSession[], incoming: AgentSession) {
    return [incoming, ...current.filter((item) => item.id !== incoming.id)].sort((a, b) => Number(b.id === incoming.id) - Number(a.id === incoming.id));
}

function statusLabel(status?: AgentSession["status"]) {
    return ({ idle: "准备就绪", running: "正在处理", waiting_for_user: "等待你处理", completed: "执行完成", failed: "执行失败", canceled: "已取消" } as Record<string, string>)[status || ""] || "已连接";
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
