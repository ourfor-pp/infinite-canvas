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
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    connected: boolean;
    enabled: boolean;
    activity: string;
    canvasContext: AgentCanvasContext | null;
    drafts: Record<string, string>;
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext" | "setDraft">>) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    setDraft: (ownerKey: string, value: string) => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 460 : Number(localStorage.getItem("agent-panel-width")) || 460,
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    connected: false,
    enabled: true,
    activity: "准备就绪",
    canvasContext: null,
    drafts: {},
    setAgentState: (patch) => set(patch),
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    setDraft: (ownerKey, value) => set((state) => ({ drafts: { ...state.drafts, [ownerKey]: value } })),
}));
