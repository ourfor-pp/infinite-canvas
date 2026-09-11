import assert from "node:assert/strict";
import { test } from "node:test";
import { planH3CumulativeSources, type H3CumulativeMedia } from "./h3-media-plan.js";

const item = (segmentId: string, frames: number) => ({ segmentId, generationId: `generation-${segmentId}`, frames });
const media = new Map<string, H3CumulativeMedia>([
    ["a", { fileId: "a-old", chain: [item("a", 124)] }],
    ["b", { fileId: "ab", chain: [item("a", 124), item("b", 243)] }],
    ["c", { fileId: "abc", chain: [item("a", 124), item("b", 243), item("c", 362)] }],
    ["d", { fileId: "ad", chain: [item("a", 124), item("d", 243)] }],
]);

test("连续三段采用同一累计解码并保留准确新增范围", () => {
    const plan = planH3CumulativeSources(["a", "b", "c"], media);
    assert.deepEqual([...plan.values()].map((range) => range.fileId), ["abc", "abc", "abc"]);
    assert.deepEqual(plan.get("b"), { fileId: "abc", trimIn: 124 / 24, duration: 119 / 24 });
    assert.deepEqual(plan.get("c"), { fileId: "abc", trimIn: 243 / 24, duration: 119 / 24 });
    assert.equal([...plan.values()].reduce((sum, range) => sum + Math.round(range.duration * 24), 0), 362);
});

test("独立切镜和另一分支不会覆盖不相邻视频段的来源", () => {
    const plan = planH3CumulativeSources(["a", "d", "cut", "b", "c"], media);
    assert.equal(plan.get("a")?.fileId, "ad");
    assert.equal(plan.get("d")?.fileId, "ad");
    assert.equal(plan.get("cut"), undefined);
    assert.equal(plan.get("b")?.fileId, "abc");
    const reordered = planH3CumulativeSources(["c", "a"], media);
    assert.equal(reordered.get("a")?.fileId, "a-old");
    assert.equal(reordered.get("c")?.trimIn, 243 / 24);
});
