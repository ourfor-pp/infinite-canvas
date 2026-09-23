import { expect, test } from "@playwright/test";

for (const [label, type, action] of [["文本", "text", "keyboard"], ["图片", "image", "toolbar"], ["音频", "audio", "keyboard"], ["视频", "video", "toolbar"]]) {
    test(`${label}节点在状态模块热更新后仍可删除`, async ({ page }) => {
        let remote: Record<string, any> | undefined;
        let deleted = 0;
        await page.route("**/api/**", async route => {
            const request = route.request();
            const path = new URL(request.url()).pathname;
            if (!path.startsWith("/api/")) return route.continue();
            let data: unknown = [];
            if (path === "/api/projects/canvas-e2e" && request.method() === "PUT") {
                const value = request.postDataJSON();
                if (remote && remote.revision !== value.revision) return route.fulfill({ status: 409, json: { error: { code: "PROJECT_CONFLICT", message: "版本冲突", details: { current: remote } } } });
                await new Promise(resolve => setTimeout(resolve, 300));
                data = remote = { ...value, revision: value.revision + 1 };
            } else if (path.endsWith("/nodes") && request.method() === "DELETE") {
                const value = request.postDataJSON();
                expect(remote?.revision).toBe(value.revision);
                data = remote = { ...remote, nodes: remote!.nodes.filter((node: { id: string }) => !value.ids.includes(node.id)), revision: value.revision + 1 };
                deleted++;
            } else if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
            else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
            else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
            await route.fulfill({ json: { data } });
        });
        await page.goto("/__canvas-test.html");
        await page.getByRole("button", { name: label, exact: true }).click();
        const node = page.locator(`[data-node-id^="${type}-"]`);
        await expect(node).toHaveCount(1);
        const sameStore = await page.evaluate(async () => {
            const path = "/src/stores/canvas/use-canvas-store.ts";
            const first = await import(/* @vite-ignore */ path);
            const refreshed = await import(/* @vite-ignore */ `${path}?t=${Date.now()}`);
            return first.useCanvasStore === refreshed.useCanvasStore;
        });
        expect(sameStore).toBe(true);
        await node.click({ position: { x: 20, y: 20 } });
        if (action === "keyboard") await page.keyboard.press("Delete");
        else await page.getByRole("button", { name: "删除选中", exact: true }).click();
        await expect(node).toHaveCount(0);
        expect(deleted).toBe(1);
        expect(remote?.nodes).toHaveLength(0);
        await expect(page.locator(".ant-message-error")).toHaveCount(0);
    });
}
