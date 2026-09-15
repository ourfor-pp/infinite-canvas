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
        await page.getByRole("button", { name: "图片", exact: true }).click();
        await expect(page.locator('[data-node-id^="image-"]')).toHaveCount(1);
        expect(requested.some((path) => /creative-assets|visual-styles/.test(path))).toBe(false);
        await expect(page.locator(".ant-message-error")).toHaveCount(0);
        expect(errors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`canvas-${theme}.png`) });
    });
}
