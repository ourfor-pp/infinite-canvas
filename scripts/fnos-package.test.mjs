import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("fnOS 网关路径和桌面入口必须属于安装包名", () => {
    const appname = read("deploy/fnos/manifest").match(/^appname\s*=\s*(\S+)/m)[1];
    const entries = JSON.parse(read("deploy/fnos/app/ui/config"))[".url"];
    for (const [id, entry] of Object.entries(entries)) {
        assert.ok(id.startsWith(`${appname}.`));
        assert.ok(entry.gatewayPrefix === `/app/${appname}` || entry.gatewayPrefix.startsWith(`/app/${appname}/`));
        assert.ok(entry.url.startsWith(`${entry.gatewayPrefix}/`));
        assert.equal(entry.gatewaySocket, "app.sock");
    }
});
