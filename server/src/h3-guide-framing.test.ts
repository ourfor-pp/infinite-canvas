import assert from "node:assert/strict";
import test from "node:test";
import { guideCrop } from "./h3-guide-framing.js";

test("方形首格横幅适配明确暴露上下裁切", () => {
    assert.deepEqual(guideCrop(508, 508, 864, 480), { x: 0, y: 113, width: 508, height: 282 });
});
test("横幅与超宽输入按正确方向裁切", () => {
    assert.deepEqual(guideCrop(832, 466, 864, 480), { x: 0, y: 2, width: 832, height: 462 });
    assert.deepEqual(guideCrop(1200, 400, 800, 800), { x: 400, y: 0, width: 400, height: 400 });
    assert.deepEqual(guideCrop(864, 480, 864, 480), { x: 0, y: 0, width: 864, height: 480 });
});
test("半像素沿用ComfyUI的Python偶数舍入", () => {
    assert.deepEqual(guideCrop(10, 15, 10, 10), { x: 0, y: 2, width: 10, height: 11 });
    assert.deepEqual(guideCrop(10, 17, 10, 10), { x: 0, y: 4, width: 10, height: 9 });
    assert.throws(() => guideCrop(0, 15, 10, 10));
});
