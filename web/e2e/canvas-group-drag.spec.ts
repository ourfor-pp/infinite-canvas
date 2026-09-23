import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`多选图片一起入组，移动分组时全部跟随 ${theme}`, async ({ page }, testInfo) => {
    await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        let data: unknown = [];
        if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        else if (req.method() === "PUT") data = { ...req.postDataJSON(), revision: 2 };
        await route.fulfill({ json: { data } });
    });
    await page.setViewportSize({ width: 1800, height: 960 });
    await page.goto(`/__canvas-test.html?theme=${theme}`);
    await page.addStyleTag({ content: "#root > .ant-app { height:100% }" });
    await page.evaluate(async () => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        const project = useCanvasStore.getState().projects[0];
        const nodes = [
            { id: "group", type: "group", title: "目标分组", position: { x: 750, y: 150 }, width: 360, height: 350 },
            ...[0, 1, 2].map(i => ({ id: `pic-${i}`, type: "image", title: `图${i}`, position: { x: 330 + i * 130, y: 200 }, width: 100, height: 100, metadata: {} })),
        ];
        window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: { ...project, nodes } }));
    });
    const nodes = page.locator('[data-node-id^="pic-"]');
    await expect(nodes).toHaveCount(3);
    await nodes.nth(0).click({ position: { x: 50, y: 50 } });
    await nodes.nth(1).click({ position: { x: 50, y: 50 }, modifiers: ["Shift"] });
    await nodes.nth(2).click({ position: { x: 50, y: 50 }, modifiers: ["Shift"] });
    const start = (await nodes.nth(0).boundingBox())!;
    await page.mouse.move(start.x + 50, start.y + 50);
    await page.mouse.down();
    await page.mouse.move(start.x + 510, start.y + 50, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(async () => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        return useCanvasStore.getState().projects[0].nodes.filter((n: any) => n.type === "image").map((n: any) => n.metadata?.groupId);
    })).toEqual(["group", "group", "group"]);
    const group = page.locator('[data-node-id="group"]');
    const box = (await group.boundingBox())!;
    for (const node of await nodes.all()) {
        const child = (await node.boundingBox())!;
        expect(child.x + child.width).toBeLessThanOrEqual(box.x + box.width);
        expect(child.y).toBeGreaterThanOrEqual(box.y + 60);
        expect(child.y + child.height).toBeLessThanOrEqual(box.y + box.height);
    }
    await group.getByRole("button", { name: "目标分组", exact: true }).click();
    const name = group.getByRole("textbox", { name: "分组名称" });
    await name.fill("产品参考");
    await name.press("Enter");
    await expect(group.getByRole("button", { name: "产品参考", exact: true })).toBeVisible();
    const before = await nodes.nth(2).boundingBox();
    await page.mouse.move(box.x + box.width - 60, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 60, box.y + 120, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await nodes.nth(2).boundingBox())!.y - before!.y).toBeCloseTo(100, 0);
    await nodes.nth(0).click({ position: { x: 50, y: 50 } });
    await expect(nodes.nth(0).locator("[data-canvas-node-panel]")).toBeVisible();
    await group.click({ position: { x: 8, y: 150 } });
    await expect(page.locator("[data-canvas-node-panel]")).toHaveCount(0);
    await nodes.nth(1).click({ position: { x: 50, y: 50 } });
    await expect(nodes.nth(1).locator("[data-canvas-node-panel]")).toBeVisible();
    await group.click({ position: { x: 8, y: 150 } });
    await expect(page.locator("[data-canvas-node-panel]")).toHaveCount(0);
    await group.screenshot({ path: testInfo.outputPath("group.png") });
});
