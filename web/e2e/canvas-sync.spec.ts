import { expect, test } from "@playwright/test";

test("画布冲突重新加载刷新真实节点，后续编辑不提交旧内容", async ({ page }) => {
    let remote: Record<string, unknown>;
    const saves: Record<string, unknown>[] = [];
    await page.route("**/api/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        let data: unknown = [];
        if (path === "/api/projects/canvas-e2e") {
            if (request.method() === "PUT") {
                const value = request.postDataJSON();
                saves.push(value);
                if (remote && value.revision !== remote.revision) return route.fulfill({ status: 409, json: { error: { code: "PROJECT_CONFLICT", message: "冲突", details: { current: remote } } } });
                remote = { ...value, revision: value.revision + 1 };
            }
            data = remote;
        } else if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        await route.fulfill({ json: { data } });
    });
    await page.goto("/__canvas-test.html");
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect.poll(() => saves.length).toBe(1);
    remote = { ...remote!, revision: Number(remote!.revision) + 1, nodes: (remote!.nodes as Array<Record<string, unknown>>).map(node => ({ ...node, metadata: { ...(node.metadata as object), content: "服务端的新正文" } })) };
    const latest = remote;
    await page.evaluate(async latest => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        const store = useCanvasStore.getState();
        const current = store.openProject("canvas-e2e");
        store.updateProject(current.id, { nodes: current.nodes.map((node: { metadata: object }) => ({ ...node, metadata: { ...node.metadata, content: "未保存的旧正文" } })) });
        store.applyServerProject(latest);
        await store.resolveConflict(current.id, "reload");
    }, latest);
    await expect(page.locator('[data-node-id^="text-"]').getByText("服务端的新正文", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].revision).toBe(latest.revision);
    expect(JSON.stringify(saves[1].nodes)).toContain("服务端的新正文");
    expect(JSON.stringify(saves[1].nodes)).not.toContain("未保存的旧正文");
});
