import { describe, expect, it } from "vitest";

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
