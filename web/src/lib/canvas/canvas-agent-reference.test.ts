import { expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { assignCanvasReferenceNumbers, canvasNodeReferenceCode } from "./canvas-agent-reference";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

const node = (id: string, type = CanvasNodeType.Image): CanvasNodeData => ({ id, type, title: "一段很长的提示词", position: { x: 0, y: 0 }, width: 100, height: 100 });
it("按类型编号，重排和删除不重排，重载后新增也不复用已删编号", () => {
    const first = node("a"), second = node("b"), video = node("v", CanvasNodeType.Video);
    const numbers = assignCanvasReferenceNumbers([first, second, video]);
    expect(numbers).toEqual({ a: { kind: "image", index: 1 }, b: { kind: "image", index: 2 }, v: { kind: "video", index: 1 } });
    expect(assignCanvasReferenceNumbers([video, first], numbers)).toBe(numbers);
    const restored = JSON.parse(JSON.stringify(numbers));
    const next = assignCanvasReferenceNumbers([first, video, node("c")], restored);
    expect(next.c.index).toBe(3);
    useCanvasStore.setState({ projects: [{ id: "p", nodes: [first, video], agentNodeNumbers: next } as CanvasProject] });
    expect(canvasNodeReferenceCode({ ...first, title: "重新命名" }, "p")).toBe("图片 1");
    expect(canvasNodeReferenceCode(video, "p")).toBe("视频 1");
});
