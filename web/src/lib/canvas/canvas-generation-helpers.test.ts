import { describe, expect, it } from "vitest";

import { fourAngleViews } from "@/lib/canvas/canvas-generation-helpers";

describe("fourAngleViews", () => {
    it("returns stable front, left, right and back camera controls", () => {
        const views = fourAngleViews();
        expect(views.map((view) => view.title)).toEqual(["正面", "左侧", "右侧", "背面"]);
        expect(views.map((view) => view.params.horizontalAngle)).toEqual([0, -90, 90, 180]);
        expect(views.every((view) => view.params.pitchAngle === 0 && !view.params.wideAngle)).toBe(true);
    });
});
