import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "qwen-readiness-"));
process.env.DATA_DIR = root;
process.env.AUTH_MODE = "dev";
const { refreshMediaExecutorCatalog, isMediaExecutorModelAvailable } = await import("./media-executor-settings.js");
const custom = "qwen3-tts-1.7b-customvoice-local", design = "qwen3-tts-1.7b-voicedesign-local";
let ready = false;
const server = createServer((req, res) => {
    assert.equal(req.headers["x-media-protocol"], "2");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ protocolVersion: "2", models: { [custom]: { engine: "qwen" }, [design]: { engine: "qwen" } },
        runtimes: { qwen: false }, configuredRuntimes: { qwen: true }, modelReadiness: { [custom]: true, [design]: ready } }));
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
test("Qwen 按模型就绪发现，工作进程空闲退出不隐藏已验证模型", async () => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const settings = { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "test", stableAudio3LicenseAccepted: false };
    let catalog = await refreshMediaExecutorCatalog(settings);
    assert.ok(catalog.models[custom]); assert.equal(catalog.models[design], undefined);
    assert.equal(isMediaExecutorModelAvailable(custom), true);
    ready = true;
    catalog = await refreshMediaExecutorCatalog(settings);
    assert.ok(catalog.models[design]); assert.equal(isMediaExecutorModelAvailable(design), true);
    ready = false;
    await refreshMediaExecutorCatalog(settings);
    assert.equal(isMediaExecutorModelAvailable(design), false);
});
