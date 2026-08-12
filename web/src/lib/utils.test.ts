import { describe, expect, it, vi } from "vitest";
import { randomId } from "./utils";

describe("randomId", () => {
    it("works on LAN HTTP pages without crypto.randomUUID", () => {
        vi.stubGlobal("crypto", {});
        expect(randomId()).toMatch(/^[A-Za-z0-9_-]{21}$/);
        vi.unstubAllGlobals();
    });
});
