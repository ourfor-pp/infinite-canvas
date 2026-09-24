import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`Agent 剪辑交接 ${theme}`, async ({ page }, testInfo) => {
    await page.route(/^https?:\/\/[^/]+\/api\//, route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.endsWith("/config")) return route.fulfill({ json: { data: { ready: false, protocolVersion: 4, storageVersion: 2 } } });
        if (path.endsWith("/capabilities")) return route.fulfill({ json: { data: { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } } } });
        if (path.endsWith("/conversation")) return route.fulfill({ json: { data: { sessions: [], session: null, queuedMessages: [] } } });
        return route.fulfill({ json: { data: request.method() === "PUT" ? { ...request.postDataJSON(), revision: 2 } : [] } });
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`/__canvas-test.html?theme=${theme}`);
    await expect(page.getByText("通用画布验收", { exact: true })).toBeVisible();
    await page.addStyleTag({ content: "#root > .ant-app { height:100% }" });
    await page.evaluate(async () => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        const project = useCanvasStore.getState().projects[0];
        window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: { ...project, nodes: [
            { id: "voice", type: "audio", title: "旁白", position: { x: 250, y: 220 }, width: 320, height: 120, metadata: { status: "loading", agentGenerationStatus: "running", agentGenerationProgress: 0.45 } },
            { id: "clip", type: "video", title: "剪辑成片", position: { x: 650, y: 200 }, width: 320, height: 200, metadata: { status: "success", productionMethod: "agent-edit", editInstructions: "缩短开头，降低配乐音量", editRecord: "四段视频顺序拼接" } },
        ], connections: [{ id: "reference", fromNodeId: "voice", fromPortId: "output", toNodeId: "clip", toPortId: "input" }] } }));
    });
    await page.locator('[data-node-id="clip"]').dblclick({ position: { x: 50, y: 50 } });
    const button = page.getByRole("button", { name: "交给 Agent 修改", exact: true });
    await expect(button).toBeVisible();
    await expect(page.getByText("Agent 剪辑", { exact: true })).toBeVisible();
    await expect(page.getByText("当前模型缺少视频输入定义")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("agent-edit.png") });
    await button.click();
    await expect(page.locator(".agent-composer-editor")).toContainText("缩短开头，降低配乐音量");
    await expect(page.locator('.agent-composer-editor [data-segment]')).toHaveAttribute("title", "剪辑成片 · 点击定位");
});
