import type { CanvasNodeData } from "@/types/canvas";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type ReferenceNumbers = Record<string, { kind: string; index: number }>;

export function assignCanvasReferenceNumbers(nodes: CanvasNodeData[], previous: ReferenceNumbers = {}): ReferenceNumbers {
    if (nodes.every(node => previous[node.id])) return previous;
    const numbers = { ...previous };
    const next: Record<string, number> = {};
    for (const item of Object.values(numbers)) next[item.kind] = Math.max(next[item.kind] || 0, item.index);
    for (const node of nodes) {
        if (numbers[node.id]) continue;
        const index = (next[node.type] || 0) + 1;
        next[node.type] = index;
        numbers[node.id] = { kind: node.type, index };
    }
    return numbers;
}

export function canvasNodeReferenceCode(node: CanvasNodeData, projectId?: string) {
    const project = useCanvasStore.getState().projects.find(item => projectId ? item.id === projectId : Boolean(item.agentNodeNumbers?.[node.id]));
    const index = project?.agentNodeNumbers?.[node.id]?.index;
    const kind = ({ image: "图片", video: "视频", audio: "音频", text: "文本", group: "分组", config: "配置" } as Record<string, string>)[node.type] || "节点";
    return index ? `${kind} ${index}` : kind;
}
export const canvasNodeReferenceLabel = canvasNodeReferenceCode;

export function focusCanvasReference(projectId: string, nodeId: string) {
    window.dispatchEvent(new CustomEvent("infinite-canvas:focus-node", { detail: { projectId, nodeId } }));
}
