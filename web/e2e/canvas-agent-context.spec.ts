import { expect, test } from "@playwright/test";

test("画布连续交互与 React 热更新后 Agent 上下文保持可用", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        let data: unknown = [];
        if (path === "/api/projects/canvas-e2e" && request.method() === "PUT") {
            const project = request.postDataJSON();
            data = { ...project, revision: project.revision + 1 };
        } else if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        await route.fulfill({ json: { data } });
    });
    await page.goto("/__canvas-test.html");
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await page.evaluate(async () => {
        const path = "/src/stores/use-agent-store.ts";
        const { useAgentStore } = await import(/* @vite-ignore */ path);
        useAgentStore.getState().openPanel("canvas-e2e");
    });
    for (let iteration = 0; iteration < 3; iteration++) {
        await page.evaluate(async () => {
            const originalPath = "/src/pages/canvas/project.tsx";
            const previous = await import(/* @vite-ignore */ originalPath);
            const path = `${originalPath}?t=${Date.now()}`;
            const next = await import(/* @vite-ignore */ path);
            const refreshPath = "/@react-refresh";
            const refresh = await import(/* @vite-ignore */ refreshPath);
            const reason = refresh.validateRefreshBoundaryAndEnqueueUpdate(originalPath, previous, next);
            if (reason) throw new Error(reason);
            await new Promise(resolve => setTimeout(resolve, 100));
        });
        await expect(page.locator('[data-node-id^="text-"]')).toHaveCount(1);
        for (let step = 0; step < 20; step++) {
            await page.evaluate(async (x) => {
                const path = "/src/stores/use-agent-store.ts";
                const { useAgentStore } = await import(/* @vite-ignore */ path);
                useAgentStore.getState().canvasContext.applyOps([{ type: "set_viewport", viewport: { x, y: 0, k: 1 } }]);
            }, step);
        }
    }
    await expect(page.getByText("Unexpected Application Error!", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
});
