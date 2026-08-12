import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

export type AgentCanvasContext = {
    snapshot: CanvasAgentSnapshot;
    applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot;
    undoOps: () => CanvasAgentSnapshot | null;
    canUndo: boolean;
};
export type AgentEntityReference =
    | { kind: "asset"; projectId: string; assetId: string; nodeId?: string; title: string; subtitle: string }
    | { kind: "style"; projectId: string; styleId: string; nodeId?: string; title: string; subtitle: string };
export const EMPTY_AGENT_ENTITY_REFERENCES: AgentEntityReference[] = [];

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
    entityReferences: Record<string, AgentEntityReference[]>;
    focusRequests: Record<string, number>;
    setAgentState: (patch: Partial<Pick<AgentStore, "width" | "connected" | "enabled" | "activity">>) => void;
    openPanel: (projectId: string) => void;
    closePanel: (projectId: string) => void;
    togglePanel: (projectId: string) => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    setDraft: (projectId: string, value: string) => void;
    setCurrentSession: (projectId: string, sessionId: string) => void;
    markSessionSeen: (sessionId: string, eventSeq: number) => void;
    prepareComposer: (projectId: string, reference: AgentEntityReference) => void;
    removeEntityReference: (projectId: string, reference: AgentEntityReference) => void;
    clearEntityReferences: (projectId: string) => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export function selectAgentEntityReferences(state: Pick<AgentStore, "entityReferences">, projectId: string) {
    return state.entityReferences[projectId] || EMPTY_AGENT_ENTITY_REFERENCES;
}

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
    entityReferences: {},
    focusRequests: {},
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
    prepareComposer: (projectId, reference) => set((state) => {
        const current = state.entityReferences[projectId] || [];
        const same = (item: AgentEntityReference) => item.kind === reference.kind && (item.kind === "asset" ? item.assetId === (reference.kind === "asset" ? reference.assetId : "") : item.styleId === (reference.kind === "style" ? reference.styleId : ""));
        const panelOpen = { ...state.panelOpen, [projectId]: true };
        persist("agent-panel-open-by-project", panelOpen);
        return { panelOpen, panelClosing: { ...state.panelClosing, [projectId]: false }, entityReferences: { ...state.entityReferences, [projectId]: current.some(same) ? current : [...current, reference] }, focusRequests: { ...state.focusRequests, [projectId]: (state.focusRequests[projectId] || 0) + 1 } };
    }),
    removeEntityReference: (projectId, reference) => set((state) => ({ entityReferences: { ...state.entityReferences, [projectId]: (state.entityReferences[projectId] || []).filter((item) => item.kind !== reference.kind || (item.kind === "asset" ? item.assetId : item.styleId) !== (reference.kind === "asset" ? reference.assetId : reference.styleId)) } })),
    clearEntityReferences: (projectId) => set((state) => ({ entityReferences: { ...state.entityReferences, [projectId]: [] } })),
}));
