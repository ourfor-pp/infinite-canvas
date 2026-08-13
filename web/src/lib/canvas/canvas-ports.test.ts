import { beforeAll, describe, expect, it } from "vitest";

import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { normalizeConnection } from "./canvas-node-geometry";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const node = (id: string, type: string): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 400, metadata: {} });

describe("语义画布端口", () => {
    beforeAll(registerBuiltinNodes);

    it.each([
        ["text", "output", "setting"],
        ["image", "output", "reference-image"],
        ["audio", "output", "reference-audio"],
        ["visual-style", "style", "style"],
    ])("将 %s 输出连接到角色对应语义输入", (sourceType, sourcePortId, expectedTargetPortId) => {
        const nodes = [node("source", sourceType), node("target", "character")];
        const connection = normalizeConnection("source", "target", nodes, "source", sourcePortId, []);

        expect(connection).toMatchObject({ fromNodeId: "source", fromPortId: sourcePortId, toNodeId: "target", toPortId: expectedTargetPortId });
    });

    it.each([
        ["text", "setting"],
        ["image", "reference-image"],
        ["audio", "reference-audio"],
        ["visual-style", "style"],
    ])("从角色统一入口反向连接 %s 时仍解析为对应语义端口", (sourceType, expectedTargetPortId) => {
        const nodes = [node("source", sourceType), node("target", "character")];
        const connection = normalizeConnection("target", "source", nodes, "target", "input", []);

        expect(connection).toMatchObject({ fromNodeId: "source", toNodeId: "target", toPortId: expectedTargetPortId });
    });

    it("拒绝不兼容的视频到角色连接", () => {
        expect(normalizeConnection("source", "target", [node("source", "video"), node("target", "character")], "source", "output", [])).toBeNull();
    });

    it("视觉风格单连接端口占用后拒绝第二条连接", () => {
        const nodes = [node("style-1", "visual-style"), node("style-2", "visual-style"), node("target", "character")];
        const existing: CanvasConnection[] = [{ id: "connection-1", fromNodeId: "style-1", fromPortId: "style", toNodeId: "target", toPortId: "style" }];

        expect(normalizeConnection("style-2", "target", nodes, "source", "style", existing)).toBeNull();
        expect(normalizeConnection("target", "style-2", nodes, "target", "input", existing)).toBeNull();
    });
});
