import { describe, expect, it } from "vitest";

import { isCanvasImagePreviewTarget } from "@/lib/canvas/canvas-interaction";
import { getCanvasPointerAction } from "./infinite-canvas";

describe("getCanvasPointerAction", () => {
    it("pans from blank canvas without requiring Control", () => {
        expect(getCanvasPointerAction(0, true, "select", false, false)).toBe("pan");
    });

    it("leaves node left-dragging to the node in Select mode", () => {
        expect(getCanvasPointerAction(0, false, "select", false, false)).toBeNull();
    });

    it("reserves Shift + background drag for range selection", () => {
        expect(getCanvasPointerAction(0, true, "select", false, true)).toBe("box-select");
    });

    it("still pans from nodes with the Move tool, Space, or middle button", () => {
        expect(getCanvasPointerAction(0, false, "pan", false, false)).toBe("pan");
        expect(getCanvasPointerAction(0, false, "select", true, false)).toBe("pan");
        expect(getCanvasPointerAction(1, false, "select", false, false)).toBe("pan");
    });
});

describe("isCanvasImagePreviewTarget", () => {
    it.each(["ant-image-preview", "ant-image-preview-root", "ant-image-preview-wrap"])("recognizes %s and its controls as outside the canvas interaction layer", (className) => {
        const preview = document.createElement("div");
        preview.className = className;
        const close = document.createElement("button");
        preview.append(close);

        expect(isCanvasImagePreviewTarget(close)).toBe(true);
    });

    it("does not treat ordinary canvas content as an image preview", () => {
        expect(isCanvasImagePreviewTarget(document.createElement("button"))).toBe(false);
    });
});
