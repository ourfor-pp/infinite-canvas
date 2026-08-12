import { describe, expect, it } from "vitest";

import { viewportForCanvasBounds } from "./canvas-node-geometry";

describe("画布节点聚焦", () => {
    it("将节点在保留工具栏留白后放入可用视口", () => {
        const bounds = { left: 100, top: 200, right: 500, bottom: 500 };
        const viewport = viewportForCanvasBounds(bounds, { width: 1200, height: 800 });
        const left = bounds.left * viewport.k + viewport.x;
        const right = bounds.right * viewport.k + viewport.x;
        const top = bounds.top * viewport.k + viewport.y;
        const bottom = bounds.bottom * viewport.k + viewport.y;
        expect(viewport.k).toBeLessThanOrEqual(2);
        expect(left).toBeGreaterThanOrEqual(56);
        expect(right).toBeLessThanOrEqual(1200 - 56);
        expect(top).toBeGreaterThanOrEqual(76);
        expect(bottom).toBeLessThanOrEqual(800 - 88);
    });

    it("节点与下方编辑框作为同一边界计算，并允许超过 100% 放大", () => {
        const nodeOnly = viewportForCanvasBounds({ left: 200, top: 100, right: 600, bottom: 300 }, { width: 1400, height: 1000 });
        const withEditor = viewportForCanvasBounds({ left: 100, top: 100, right: 700, bottom: 720 }, { width: 1400, height: 1000 });
        expect(nodeOnly.k).toBe(2);
        expect(withEditor.k).toBeLessThan(nodeOnly.k);
    });
});
