import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle } from "@/types/canvas";
import { compatibleTargetPort, nodePorts, portById } from "./canvas-ports";

export type CanvasFocusBounds = { left: number; top: number; right: number; bottom: number };

export function viewportForCanvasBounds(bounds: CanvasFocusBounds, viewportSize: { width: number; height: number }, maxZoom = 2) {
    const inset = { left: 56, right: 56, top: 76, bottom: 88 };
    const availableWidth = Math.max(1, viewportSize.width - inset.left - inset.right);
    const availableHeight = Math.max(1, viewportSize.height - inset.top - inset.bottom);
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const k = Math.min(Math.max(Math.min(availableWidth / width, availableHeight / height), 0.05), maxZoom);
    const screenCenterX = inset.left + availableWidth / 2;
    const screenCenterY = inset.top + availableHeight / 2;
    const worldCenterX = (bounds.left + bounds.right) / 2;
    const worldCenterY = (bounds.top + bounds.bottom) / 2;
    return { x: screenCenterX - worldCenterX * k, y: screenCenterY - worldCenterY * k, k };
}

export function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

export function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return null;
    return (
        [...nodes].reverse().find((group) => {
            if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
            return movingNodes.some((node) => {
                const centerX = node.position.x + node.width / 2;
                const centerY = node.position.y + node.height / 2;
                return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
            });
        }) || null
    );
}

export function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const width = Math.max(group.width, bounds.right - bounds.left + pad * 2);
    const height = Math.max(group.height, bounds.bottom - bounds.top + 64 + pad);
    const left = group.position.x + pad;
    const top = group.position.y + 64;
    const right = group.position.x + width - pad;
    const bottom = group.position.y + height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (node.id === group.id) return { ...node, width, height };
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

export function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return (
        [...nodes]
            .reverse()
            .find((group) => group.type === CanvasNodeType.Group && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id ||
        undefined
    );
}

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return { x: current.handleType === "source" ? node.position.x : node.position.x + node.width, y: node.position.y + node.height / 2 };
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target", firstPortId: string, connections: CanvasConnection[]) {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Group || second.type === CanvasNodeType.Group) return null;
    const sourceNode = firstHandleType === "source" ? first : second;
    const targetNode = firstHandleType === "source" ? second : first;
    const fixed = portById(first, firstPortId, firstHandleType === "source" ? "output" : "input");
    if (!fixed) return null;
    const sourcePort = firstHandleType === "source" ? fixed : nodePorts(sourceNode).find((port) => port.direction === "output" && (fixed.dataType === port.dataType || fixed.accepts?.includes(port.dataType)));
    const targetPort = firstHandleType === "target" ? fixed : sourcePort ? compatibleTargetPort(sourcePort, targetNode, connections) : null;
    if (!sourcePort || !targetPort) return null;
    if (!targetPort.multiple && connections.some((connection) => connection.toNodeId === targetNode.id && connection.toPortId === targetPort.id)) return null;
    return { fromNodeId: sourceNode.id, fromPortId: sourcePort.id, toNodeId: targetNode.id, toPortId: targetPort.id };
}
