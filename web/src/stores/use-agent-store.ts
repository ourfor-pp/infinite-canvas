import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

export type AgentCanvasContext = {
    snapshot: CanvasAgentSnapshot;
    applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot;
    undoOps: () => CanvasAgentSnapshot | null;
    canUndo: boolean;
};

type AgentStore = {
    width: number;
    panelOpen: Record<string, boolean>;
    panelClosing: Record<string, boolean>;
    connected: boolean;
    enabled: boolean;
    activity: string;
    canvasContext: AgentCanvasContext | null;
    drafts: Record<string, string>;
    currentSessionIds: Record<string, string>;
    seenEventSeqs: Record<string, number>;
    setAgentState: (patch: Partial<Pick<AgentStore, "width" | "connected" | "enabled" | "activity">>) => void;
    openPanel: (projectId: string) => void;
    closePanel: (projectId: string) => void;
    togglePanel: (projectId: string) => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    setDraft: (projectId: string, value: string) => void;
    setCurrentSession: (projectId: string, sessionId: string) => void;
    markSessionSeen: (sessionId: string, eventSeq: number) => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

const saved = <T extends Record<string, unknown>>(key: string) => {
    if (typeof window === "undefined") return {} as T;
    try { return JSON.parse(localStorage.getItem(key) || "{}") as T; } catch { return {} as T; }
};

const persist = (key: string, value: Record<string, unknown>) => {
    if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(value));
};

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 460 : Number(localStorage.getItem("agent-panel-width")) || 460,
    panelOpen: saved<Record<string, boolean>>("agent-panel-open-by-project"),
    panelClosing: {},
    connected: false,
    enabled: true,
    activity: "准备就绪",
    canvasContext: null,
    drafts: saved<Record<string, string>>("agent-drafts-by-project"),
    currentSessionIds: saved<Record<string, string>>("agent-session-by-project"),
    seenEventSeqs: saved<Record<string, number>>("agent-seen-events"),
    setAgentState: (patch) => set(patch),
    openPanel: (projectId) => set((state) => {
        const panelOpen = { ...state.panelOpen, [projectId]: true };
        persist("agent-panel-open-by-project", panelOpen);
        return { panelOpen, panelClosing: { ...state.panelClosing, [projectId]: false } };
    }),
    closePanel: (projectId) => {
        const panelOpen = { ...get().panelOpen, [projectId]: false };
        persist("agent-panel-open-by-project", panelOpen);
        set((state) => ({ panelOpen, panelClosing: { ...state.panelClosing, [projectId]: true } }));
        setTimeout(() => set((state) => ({ panelClosing: { ...state.panelClosing, [projectId]: false } })), CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: (projectId) => (get().panelOpen[projectId] ? get().closePanel(projectId) : get().openPanel(projectId)),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    setDraft: (projectId, value) => set((state) => {
        const drafts = { ...state.drafts, [projectId]: value };
        persist("agent-drafts-by-project", drafts);
        return { drafts };
    }),
    setCurrentSession: (projectId, sessionId) => set((state) => {
        const currentSessionIds = { ...state.currentSessionIds, [projectId]: sessionId };
        persist("agent-session-by-project", currentSessionIds);
        return { currentSessionIds };
    }),
    markSessionSeen: (sessionId, eventSeq) => set((state) => {
        const seenEventSeqs = { ...state.seenEventSeqs, [sessionId]: eventSeq };
        persist("agent-seen-events", seenEventSeqs);
        return { seenEventSeqs };
    }),
}));
