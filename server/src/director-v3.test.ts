import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "director-v3-test-"));
process.env.DATA_DIR = join(temp, "data");
const { validateDirectorRoot } = await import("./director-workspace.js");
const { db } = await import("./database.js");
after(() => { db.close(); rmSync(temp, { recursive: true, force: true }); });
test("v1 和 v2 明确拒绝，不修改源工程", () => {
    for (const version of [1, 2]) {
        const root = join(temp, `v${version}`); mkdirSync(root);
        const original = `version: ${version}\nformat: infinite-canvas-director\nid: old\nname: 旧作\n`;
        writeFileSync(join(root, "project.yaml"), original);
        const diagnostics = validateDirectorRoot(root);
        assert.ok(diagnostics.some((item) => item.severity === "error" && item.path === "project.yaml"));
        assert.equal(readFileSync(join(root, "project.yaml"), "utf8"), original);
    }
});
