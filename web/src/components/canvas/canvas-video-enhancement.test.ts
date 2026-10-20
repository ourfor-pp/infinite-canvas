import { describe, expect, it } from "vitest";
import { buildVideoEnhancementContext } from "./canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";

const video = (id: string, content?: string): CanvasNodeData => ({ id, type: CanvasNodeType.Video, title: id, position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content, storageKey: content ? `file:${id}` : undefined } });
const link = (from: string): CanvasConnection => ({ id: from, fromNodeId: from, fromPortId: "output", toNodeId: "target", toPortId: "input" });

describe("视频提质的显式源选择", () => {
    it("只有提质操作采用当前节点视频，并且不追加旧提示词", () => {
        const target = video("target", "/source.mp4");
        target.metadata!.prompt = "生成时的旧提示词";
        const result = buildVideoEnhancementContext("target", [target], []);
        expect(result.referenceVideos.map(v => v.url)).toEqual(["/source.mp4"]);
        expect(result.prompt).toBe("");
    });
    it("外部视频优先，多个视频保留交给契约拒绝，不静默选第一条", () => {
        const nodes = [video("target", "/old.mp4"), video("one", "/one.mp4"), video("two", "/two.mp4")];
        expect(buildVideoEnhancementContext("target", nodes, [link("one")]).referenceVideos.map(v => v.url)).toEqual(["/one.mp4"]);
        expect(buildVideoEnhancementContext("target", nodes, [link("one"), link("two")]).referenceVideos).toHaveLength(2);
        expect(buildVideoEnhancementContext("target", [video("target")], []).referenceVideos).toHaveLength(0);
    });
});
