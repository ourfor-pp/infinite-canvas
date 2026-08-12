import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodePort, type CanvasPortDataType } from "@/types/canvas";

const RESOURCE_TYPE: Partial<Record<string, CanvasPortDataType>> = {
    [CanvasNodeType.Text]: "text",
    [CanvasNodeType.Image]: "image",
    [CanvasNodeType.Audio]: "audio",
    [CanvasNodeType.Video]: "video",
    "visual-style": "visual-style",
    character: "creative-asset",
    scene: "creative-asset",
    prop: "creative-asset",
};

export function nodePorts(node: CanvasNodeData): CanvasNodePort[] {
    const configured = getNodeDefinition(node.type)?.ports;
    if (configured) return typeof configured === "function" ? configured(node) : configured;
    if (node.type === CanvasNodeType.Group) return [];
    const outputType = RESOURCE_TYPE[node.type] || "text";
    return [
        { id: "input", label: "输入", direction: "input", dataType: outputType, accepts: ["text", "image", "audio", "video", "visual-style", "creative-asset"], multiple: true, position: 0.5 },
        { id: "output", label: "输出", direction: "output", dataType: outputType, multiple: true, position: 0.5 },
    ];
}

export function portById(node: CanvasNodeData, id: string, direction?: CanvasNodePort["direction"]) {
    return nodePorts(node).find((port) => port.id === id && (!direction || port.direction === direction));
}

export function compatibleTargetPort(source: CanvasNodePort, node: CanvasNodeData, connections: CanvasConnection[]) {
    return nodePorts(node).find((target) => {
        if (target.direction !== "input" || !(target.dataType === source.dataType || target.accepts?.includes(source.dataType))) return false;
        return target.multiple || !connections.some((connection) => connection.toNodeId === node.id && connection.toPortId === target.id);
    });
}

export function compatibleSourcePort(target: CanvasNodePort, node: CanvasNodeData) {
    return nodePorts(node).find((source) => source.direction === "output" && (target.dataType === source.dataType || target.accepts?.includes(source.dataType)));
}

export function portAnchor(node: CanvasNodeData, portId: string, direction: CanvasNodePort["direction"]) {
    const port = portById(node, portId, direction);
    return { x: direction === "output" ? node.position.x + node.width : node.position.x, y: node.position.y + node.height * (port?.position ?? 0.5) };
}
