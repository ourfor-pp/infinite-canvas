import { beforeAll, describe, expect, it } from "vitest";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { getNodeDefinition } from "./node-registry";
import { normalizeConnection } from "./canvas-node-geometry";
import type { CanvasNodeData } from "@/types/canvas";

const node = (id: string, type: string): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 400, metadata: {} });

describe("通用画布节点", () => {
    beforeAll(registerBuiltinNodes);
    it.each(["character", "scene", "prop", "visual-style"])("不再注册 %s 业务节点", (type) => {
        expect(getNodeDefinition(type)).toBeUndefined();
    });
    it.each(["text", "image", "audio", "video"])("保留 %s 到通用图片节点的资源连线", (type) => {
        const nodes = [node("source", type), node("target", "image")];
        expect(normalizeConnection("source", "target", nodes, "source", "output", [])).toMatchObject({ fromNodeId: "source", fromPortId: "output", toNodeId: "target", toPortId: "input" });
    });
});
