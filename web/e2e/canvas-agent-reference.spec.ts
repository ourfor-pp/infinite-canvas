import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`节点工具栏和右键引用到 Agent ${theme}`, async ({ page }, testInfo) => {
    let sends = 0;
    const session = { id: "s1", projectId: "canvas-e2e", engine: "builtin", title: "测试", status: "idle", eventSeq: 0, currentRunId: null, pendingDecision: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] };
    await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path.endsWith("/content")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="steelblue"/></svg>' });
        if (req.method() === "POST" && path.endsWith("/messages")) sends++;
        let data: unknown = [];
        if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [session], session, queuedMessages: [] };
        else if (req.method() === "PUT") data = { ...req.postDataJSON(), revision: 2 };
        await route.fulfill({ json: { data } });
    });
    await page.setViewportSize({ width: 1800, height: 960 });
    await page.addInitScript(() => localStorage.setItem("agent-drafts-by-project", JSON.stringify({ "canvas-e2e": "保留我的描述 " })));
    await page.goto(`/__canvas-test.html?theme=${theme}`);
    await page.addStyleTag({ content: "#root > .ant-app { height:100% }" });
    await page.evaluate(async () => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        const agentPath = "/src/stores/use-agent-store.ts";
        const { useAgentStore } = await import(/* @vite-ignore */ agentPath);
        useAgentStore.setState({ panelOpen: {}, drafts: { "canvas-e2e": "保留我的描述 " } });
        const project = useCanvasStore.getState().projects[0];
        const nodes = [
            { id: "group", type: "group", title: "目标分组", position: { x: 750, y: 150 }, width: 360, height: 350 },
            ...[0, 1, 2].map(i => ({ id: `pic-${i}`, type: "image", title: `图${i}`, position: { x: 330 + i * 130, y: 200 }, width: 100, height: 100, metadata: { content: "/api/files/test-image/content", storageKey: "server:test-image", naturalWidth: 100, naturalHeight: 100 } })),
        ];
        window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: { ...project, nodes } }));
    });
    const nodes = page.locator('[data-node-id^="pic-"]');
    await expect(nodes).toHaveCount(3);
    await nodes.nth(0).click({ position: { x: 50, y: 50 } });
    await page.getByRole("button", { name: "引用到 Agent", exact: true }).click();
    const editor = page.locator(".agent-composer-editor");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("保留我的描述");
    await expect(editor).toContainText("@图0");
    await expect(editor).toBeFocused();
    await expect(editor.locator("[data-segment]")).toHaveCount(1);
    expect(await editor.locator("[data-segment]").evaluate(el => JSON.parse((el as HTMLElement).dataset.segment!))).toMatchObject({ type: "canvas", nodeId: "pic-0", projectId: "canvas-e2e" });
    await nodes.nth(1).click({ button: "right" });
    await page.getByRole("button", { name: "引用到 Agent", exact: true }).last().click();
    await expect(editor).toContainText("@图1");
    await expect(editor).toContainText("保留我的描述");
    await expect(editor.locator("[data-segment]")).toHaveCount(2);
    await expect(editor).toBeFocused();
    const group = page.locator('[data-node-id="group"]');
    await group.click({ button: "right", position: { x: 8, y: 150 } });
    await page.getByRole("button", { name: "引用到 Agent", exact: true }).last().click();
    await expect(editor).toContainText("@目标分组");
    await expect(editor.locator("[data-segment]")).toHaveCount(3);
    expect(sends).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("agent-node-references.png") });
});
