import { describe, expect, it } from "vitest";
import { getVirtualWindow } from "./conversation-virtualizer";
describe("conversation virtualizer", () => { it("renders every short item and a bounded long window", () => { expect(getVirtualWindow([10, 20], 0, 100).items).toHaveLength(2); const result = getVirtualWindow(Array(100).fill(40), 2000, 400); expect(result.total).toBe(4000); expect(result.items.length).toBeLessThan(100); expect(result.items.some((item) => item.index === 50)).toBe(true); }); });
