import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrevis } from "./previs/model.js";
import { evaluatePrevis } from "./previs/evaluate.js";

function fixture() {
    return parsePrevis({ version: 1, id: "scene", name: "交接", objects: [
        { id: "a", name: "甲", kind: "human", position: [-2, 0, 0] },
        { id: "b", name: "乙", kind: "animal", position: [2, 0, 0] },
        { id: "box", name: "箱", kind: "box", position: [0, .5, 0] },
    ] }, { version: 1, segmentId: "segment", duration: 4,
        initial: { a: { position: [-2, 0, 0] }, b: { position: [2, 0, 0] } },
        tracks: [{ objectId: "a", keys: [{ time: 0, position: [-2, 0, 0] }, { time: 4, position: [2, 0, 0] }] }],
        actions: [{ id: "walk", kind: "walk", objectId: "a", start: 0, end: 4 }],
        attachments: [{ time: 0, objectId: "box", parentId: "a" }, { time: 2, objectId: "box", parentId: "b" }],
        shots: [{ id: "wide", name: "全景", start: 0, end: 2, keys: [{ time: 0, position: [0, 3, 8], target: [0, 1, 0] }] },
            { id: "near", name: "近景", start: 2, end: 4, keys: [{ time: 2, position: [0, 2, 3], target: [0, 1, 0], follow: "a" }] }],
    });
}
test("absolute seeking preserves actor state across camera cuts and handoffs", () => {
    const { scene, plan } = fixture();
    const before = evaluatePrevis(scene, plan, 1), after = evaluatePrevis(scene, plan, 3);
    assert.deepEqual(before.poses.a.position, [-1, 0, 0]);
    assert.deepEqual(after.poses.a.position, [1, 0, 0]);
    assert.equal(before.shotId, "wide"); assert.equal(after.shotId, "near");
    assert.equal(before.attachments.get("box")?.parentId, "a"); assert.equal(after.attachments.get("box")?.parentId, "b");
    assert.deepEqual(evaluatePrevis(scene, plan, 1), before);
    assert.deepEqual(after.camera.position, [1, 2, 3]);
    assert.deepEqual(evaluatePrevis(scene, plan, 2).poses.a.position, [0, 0, 0]);
});
test("invalid identity, missing initial state, unsupported motion and camera gaps are rejected", () => {
    const { scene, plan } = fixture();
    assert.throws(() => parsePrevis(scene, { ...plan, initial: {} }), /初始状态/);
    assert.throws(() => parsePrevis(scene, { ...plan, tracks: [{ objectId: "missing", keys: [{ time: 0, position: [0, 0, 0] }] }] }), /对象不存在/);
    assert.throws(() => parsePrevis(scene, { ...plan, shots: plan.shots.map((s, i) => i ? { ...s, start: 2.2 } : s) }), /连续覆盖/);
    assert.throws(() => parsePrevis(scene, { ...plan, actions: [{ ...plan.actions[0], kind: "fight" }] }));
    assert.throws(() => parsePrevis(scene, { ...plan, attachments: [{ time: 3, objectId: "box", parentId: null }] }), /世界坐标/);
});
test("shortest-angle rotation and explicit release are deterministic", () => {
    const { scene, plan } = fixture();
    plan.tracks[0].keys[0].yaw = Math.PI * .9; plan.tracks[0].keys[1].yaw = -Math.PI * .9;
    plan.attachments.push({ time: 3, objectId: "box", parentId: null, hand: "right", offset: [0, 0, 0], position: [0, .5, 2] });
    const state = evaluatePrevis(scene, plan, 2);
    assert.ok(Math.abs(Math.abs(state.poses.a.yaw) - Math.PI) < 1e-8);
    assert.deepEqual(evaluatePrevis(scene, plan, 4).attachments.get("box")?.position, [0, .5, 2]);
});
