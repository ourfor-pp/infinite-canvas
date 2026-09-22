import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
    test(`通用画布 ${theme} 移除业务设定，仍可创建文字与图片`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        const requested: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const now = new Date().toISOString();
        const session = { id: "session-1", projectId: "canvas-e2e", engine: "builtin", sdkSessionId: null, title: "画布对话", status: "idle", eventSeq: 0, currentRunId: null, pendingDecision: null, lastError: null, lastErrorCode: null, createdAt: now, updatedAt: now, events: [] };
        await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
            const request = route.request();
            const path = new URL(request.url()).pathname;
            requested.push(path);
            let data: unknown = request.method() === "PUT" ? { ...request.postDataJSON(), id: "canvas-e2e", revision: 2 } : [];
            if (path === "/api/agent/config") data = { ready: false, modelName: "", providerName: "", protocolVersion: 4, storageVersion: 2 };
            if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [{ id: "builtin", ready: false }], skills: [], referenceKinds: ["canvas"], composer: { placeholder: "描述任务", referenceLabel: "引用画布", emptyTitle: "画布 Agent", emptyDescription: "", suggestions: [] } };
            if (path.endsWith("/conversation")) data = { projectId: "canvas-e2e", sessions: [session], session, queuedMessages: [] };
            await route.fulfill({ json: { data } });
        });
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.goto(`/__canvas-test.html?theme=${theme}`);
        await expect(page.getByRole("button", { name: "文本", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "业务设定", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "文本", exact: true }).click();
        await expect(page.locator('[data-node-id^="text-"]')).toHaveCount(1);
        await expect(page.locator('[data-node-id^="text-"]').getByRole("button", { name: /生图/ })).toHaveCount(0);
        const textNode = page.locator('[data-node-id^="text-"]');
        const originalSize = await textNode.evaluate((element) => [element.style.width, element.style.height]);
        await textNode.getByText("双击编辑文字", { exact: true }).dblclick();
        const editor = textNode.locator("textarea").first();
        await expect(editor).toBeFocused();
        await editor.fill("双击编辑回归测试");
        await editor.press("Escape");
        await expect(textNode.getByText("双击编辑回归测试", { exact: true })).toBeVisible();
        await textNode.getByText("双击编辑回归测试", { exact: true }).dblclick();
        await expect(editor).toBeFocused();
        await expect(editor).toHaveValue("双击编辑回归测试");
        await editor.dblclick();
        await expect(editor).toBeFocused();
        await editor.fill("再次编辑后的文字");
        await editor.press("Escape");
        await expect(textNode.getByText("再次编辑后的文字", { exact: true })).toBeVisible();
        expect(await textNode.evaluate((element) => [element.style.width, element.style.height])).toEqual(originalSize);
        await page.screenshot({ path: testInfo.outputPath(`text-node-${theme}.png`) });
        await page.getByRole("button", { name: "图片", exact: true }).click();
        await expect(page.locator('[data-node-id^="image-"]')).toHaveCount(1);
        expect(requested.some((path) => /creative-assets|visual-styles/.test(path))).toBe(false);
        await expect(page.locator(".ant-message-error")).toHaveCount(0);
        expect(errors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`canvas-${theme}.png`) });
    });
}

test("图片节点首次生成与重做均原地回填，失败保留旧图", async ({ page }) => {
    let attempt = 0;
    let fail = false;
    const prompts: string[] = [];
    const references: unknown[][] = [];
    const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="blue"/></svg>');
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        let data: unknown = [];
        if (path.endsWith("/content")) return route.fulfill({ contentType: "image/svg+xml", body: image });
        if (path === "/api/generations" && request.method() === "POST") {
            attempt++;
            prompts.push(request.postDataJSON().prompt);
            references.push(request.postDataJSON().references || []);
            data = { id: `gen-${attempt}` };
        } else if (/\/generations\/gen-/.test(path)) {
            data = { id: `gen-${attempt}`, status: fail ? "failed" : "succeeded", error: "测试失败", result: { files: [{ fileId: `result-${attempt}`, mimeType: "image/svg+xml", bytes: image.length }] } };
        } else if (/\/files\//.test(path)) data = { fileId: path.split("/").at(-1), mimeType: "image/svg+xml", bytes: image.length };
        else if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        else if (request.method() === "PUT") data = { ...request.postDataJSON(), id: "canvas-e2e", revision: 2 };
        await route.fulfill({ json: { data } });
    });
    await page.goto("/__canvas-test.html");
    await page.evaluate(async () => {
        const path = "/src/stores/use-config-store.ts";
        const { useConfigStore } = await import(/* @vite-ignore */ path);
        useConfigStore.getState().hydrateFromServer({ count: "1", canvasImageCount: "1" });
        useConfigStore.getState().hydrateModels([{ id: "test", name: "测试图片", value: "p::test", providerId: "p", providerName: "测试", output: "image", inputs: ["text", "image"], enabled: true, imageModes: ["generate", "edit"] }]);
    });
    await page.getByRole("button", { name: "图片", exact: true }).click();
    const node = page.locator('[data-node-id^="image-"]');
    const id = await node.getAttribute("data-node-id");
    const prompt = page.locator('[data-canvas-node-panel] [contenteditable="true"]');
    const generate = page.getByRole("button", { name: "开始生成", exact: true });
    await prompt.fill("蓝色茶杯");
    await generate.click();
    await expect(node.locator('img.pointer-events-none[src*="result-1"]').first()).toBeVisible();
    await expect(generate).toBeVisible();
    fail = true;
    await prompt.fill("红色茶杯");
    await generate.click();
    await expect(page.locator(".ant-message-error")).toContainText("测试失败");
    await expect(page.locator("[data-node-id]")).toHaveCount(1);
    await expect(node.locator('img.pointer-events-none[src*="result-1"]').first()).toBeVisible();
    fail = false;
    await generate.click();
    await expect(node.locator('img.pointer-events-none[src*="result-3"]').first()).toBeVisible();
    await expect(page.locator("[data-node-id]")).toHaveCount(1);
    expect(await node.getAttribute("data-node-id")).toBe(id);
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain("红色茶杯");
    expect(references).toEqual([[], [], []]);
});

test("参考图叉号仅断开对应连线并保留原节点", async ({ page }, testInfo) => {
    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/content")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="steelblue"/></svg>' });
        let data: unknown = [];
        if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        else if (route.request().method() === "PUT") data = { ...route.request().postDataJSON(), id: "canvas-e2e", revision: 2 };
        await route.fulfill({ json: { data } });
    });
    await page.goto("/__canvas-test.html");
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await expect(page.locator("[data-node-id]")).toHaveCount(1);
    await page.evaluate(async () => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        const project = useCanvasStore.getState().projects[0];
        const content = "/api/files/reference-image/content";
        const nodes = ["reference", "target"].map((id, index) => ({ id, type: "image", title: id === "reference" ? "蓝杯" : "目标图片", position: { x: 350 + index * 350, y: 100 }, width: 240, height: 240, metadata: { content, storageKey: "server:reference-image", naturalWidth: 240, naturalHeight: 240, status: "success", prompt: "保留蓝杯文字" } }));
        const referencePath = "/src/lib/canvas/canvas-resource-references.ts";
        const { buildNodeMentionReferences } = await import(/* @vite-ignore */ referencePath);
        const connections = [{ id: "reference-edge", fromNodeId: "reference", toNodeId: "target", fromPortId: "output", toPortId: "input" }];
        nodes[1].metadata.prompt += " " + buildNodeMentionReferences(nodes[1], nodes, connections)[0].label;
        window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: { ...project, nodes, connections: [{ id: "reference-edge", fromNodeId: "reference", toNodeId: "target", fromPortId: "output", toPortId: "input" }] } }));
    });
    const target = page.locator('[data-node-id="target"]');
    await target.dblclick({ position: { x: 100, y: 100 } });
    const panel = page.locator("[data-canvas-node-panel]");
    const remove = panel.getByRole("button", { name: "移除蓝杯", exact: true });
    await expect(remove).toBeVisible();
    await expect(page.locator('[data-connection-id="reference-edge"]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("reference-remove-button.png") });
    await remove.click();
    await expect(page.locator('[data-connection-id="reference-edge"]')).toHaveCount(0);
    await expect(page.locator("[data-node-id]")).toHaveCount(2);
    await expect(panel.getByRole("button", { name: "移除蓝杯", exact: true })).toHaveCount(0);
    await expect(panel.locator('[contenteditable="true"]')).toContainText("保留蓝杯文字");
    await expect(panel.locator('[contenteditable="true"]')).toHaveText("保留蓝杯文字");
    await expect(panel.locator('[aria-label="参考素材"] img')).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "上传参考图", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "移除目标图片", exact: true })).toHaveCount(0);
});
