import { describe, expect, it } from "vitest";

import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { createVisualStyleOverrideOps, inheritProjectVisualStyleOps } from "./visual-style-overrides";

const target = { id: "character-1", type: "character", title: "角色", position: { x: 600, y: 120 }, width: 420, height: 760 } as CanvasNodeData;

describe("业务节点视觉风格覆盖", () => {
    it("选择模板时创建局部风格节点并连接业务节点", () => {
        expect(createVisualStyleOverrideOps(target, "style-1", "黑色电影", "style-node-1")).toEqual([
            { type: "add_node", id: "style-node-1", nodeType: "visual-style", title: "黑色电影", position: { x: 100, y: 120 }, width: 420, height: 615, metadata: { visualStyleId: "style-1" } },
            { type: "connect_nodes", fromNodeId: "style-node-1", fromPortId: "style", toNodeId: "character-1", toPortId: "style" },
        ]);
    });

    it("恢复项目风格时只移除目标节点的局部风格连接", () => {
        const connections = [
            { id: "local-style", fromNodeId: "style-node", fromPortId: "style", toNodeId: "character-1", toPortId: "style" },
            { id: "reference", fromNodeId: "image-1", fromPortId: "output", toNodeId: "character-1", toPortId: "reference-image" },
            { id: "other-style", fromNodeId: "style-node", fromPortId: "style", toNodeId: "character-2", toPortId: "style" },
        ] as CanvasConnection[];
        expect(inheritProjectVisualStyleOps(connections, "character-1")).toEqual([{ type: "delete_connections", ids: ["local-style"] }]);
    });
});
