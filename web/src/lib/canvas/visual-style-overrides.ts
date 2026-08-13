import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export function createVisualStyleOverrideOps(target: CanvasNodeData, styleId: string, name: string, styleNodeId: string): CanvasAgentOp[] {
    return [
        { type: "add_node", id: styleNodeId, nodeType: "visual-style", title: name, position: { x: target.position.x - 460, y: target.position.y }, width: 380, height: 620, metadata: { visualStyleId: styleId } },
        { type: "connect_nodes", fromNodeId: styleNodeId, fromPortId: "style", toNodeId: target.id, toPortId: "style" },
    ];
}

export function inheritProjectVisualStyleOps(connections: CanvasConnection[], targetNodeId: string): CanvasAgentOp[] {
    return [{ type: "delete_connections", ids: connections.filter((connection) => connection.toNodeId === targetNodeId && connection.toPortId === "style").map((connection) => connection.id) }];
}
