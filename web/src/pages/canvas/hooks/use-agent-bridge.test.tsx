import { StrictMode, useRef, useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useAgentStore, type AgentCanvasContext } from "@/stores/use-agent-store";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { useAgentBridge } from "./use-agent-bridge";

afterEach(() => { cleanup(); useAgentStore.getState().setCanvasContext(null); });

function useHarness(projectId: string) {
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState(new Set<string>());
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const nodesRef = useRef(nodes), connectionsRef = useRef(connections), selectedNodeIdsRef = useRef(selectedNodeIds), viewportRef = useRef(viewport);
    nodesRef.current = nodes; connectionsRef.current = connections; selectedNodeIdsRef.current = selectedNodeIds; viewportRef.current = viewport;
    useAgentBridge({ projectId, title: projectId, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef: useRef(null), setNodes, setConnections, setSelectedNodeIds, setViewport, setSelectedConnectionId: () => {}, setContextMenu: () => {} });
    return { setViewport };
}

it("连续更新视口不发布空上下文，卸载时清空", () => {
    const { result, unmount } = renderHook(() => useHarness("canvas-test"), { wrapper: StrictMode });
    const updates: (AgentCanvasContext | null)[] = [];
    const unsubscribe = useAgentStore.subscribe(state => updates.push(state.canvasContext));
    try {
        for (let x = 1; x <= 100; x++) act(() => result.current.setViewport({ x, y: 0, k: 1 }));
        expect(updates).toHaveLength(100);
        expect(updates.every(context => context !== null)).toBe(true);
        expect(useAgentStore.getState().canvasContext?.snapshot.viewport.x).toBe(100);
        unmount();
        expect(useAgentStore.getState().canvasContext).toBeNull();
    } finally { unsubscribe(); }
});

it("切换项目、执行操作与撤销后发布最新上下文", () => {
    const { rerender } = renderHook(({ id }) => useHarness(id), { initialProps: { id: "first" } });
    rerender({ id: "second" });
    expect(useAgentStore.getState().canvasContext?.snapshot.projectId).toBe("second");
    act(() => { useAgentStore.getState().canvasContext!.applyOps([{ type: "set_viewport", viewport: { x: 20, y: 30, k: 2 } }]); });
    expect(useAgentStore.getState().canvasContext?.canUndo).toBe(true);
    expect(useAgentStore.getState().canvasContext?.snapshot.viewport.k).toBe(2);
    act(() => { useAgentStore.getState().canvasContext!.undoOps(); });
    expect(useAgentStore.getState().canvasContext?.canUndo).toBe(false);
    expect(useAgentStore.getState().canvasContext?.snapshot.viewport.k).toBe(1);
});
