import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`对话图片拖入画布保留原图、比例和落点（${theme}）`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => localStorage.setItem("agent-panel-open-by-project", JSON.stringify({ "canvas-e2e": true })));
    const now = new Date().toISOString();
    const session = { id: "drag-session", projectId: "canvas-e2e", engine: "codex", title: "图片拖放", status: "completed", eventSeq: 4, currentRunId: "drag-run", pendingDecision: null, sdkSessionId: null, lastError: null, lastErrorCode: null, createdAt: now, updatedAt: now, events: [
        { seq: 1, kind: "user_text", payload: { text: "请生成沙发侧视图", attachments: [{ fileId: "reference", name: "参考沙发", mimeType: "image/svg+xml" }] } },
        { seq: 2, kind: "artifact", payload: { fileId: "generated", title: "生成的沙发", mimeType: "image/svg+xml" } },
        { seq: 3, kind: "assistant_text", payload: { text: "已生成沙发侧视图。" } },
        { seq: 4, kind: "run_state", payload: { state: "completed", finalAssistantEventSeq: 3 } },
    ].map(event => ({ ...event, sessionId: "drag-session", runId: "drag-run", createdAt: now })) };
    let saved: any;
    let uploads = 0;
    await page.route("**/api/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        let data: unknown = [];
        if (path.endsWith("/content")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#eceff3"/><rect x="100" y="90" width="400" height="150" rx="30" fill="#8997ab"/></svg>' });
        if (path === "/api/projects/canvas-e2e" && request.method() === "PUT") {
            saved = request.postDataJSON();
            data = { ...saved, revision: saved.revision + 1 };
        } else if (path === "/api/files" && request.method() === "POST") uploads++;
        else if (path.startsWith("/api/files/")) data = { id: path.split("/").at(-1), bytes: 240, mimeType: "image/svg+xml", url: `${path}/content` };
        else if (path === "/api/agent/config") data = { ready: true, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [{ id: "codex", ready: true }], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { projectId: "canvas-e2e", sessions: [session], session, queuedMessages: [] };
        else if (path.endsWith("/codex-models")) data = { defaultModel: "", models: [] };
        await route.fulfill({ json: { data } });
    });
    await page.goto(`/__canvas-test.html?theme=${theme}`);
    const generated = page.getByRole("img", { name: "生成的沙发", exact: true });
    await expect(generated).toBeVisible();
    await generated.click();
    await expect(page.locator(".ant-image-preview" )).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ant-image-preview")).toBeHidden();
    const canvas = page.locator("div.relative.h-full.w-full.select-none.overflow-hidden");
    await canvas.hover({ position: { x: 350, y: 300 } });
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(300);
    for (const [index, title] of ["生成的沙发", "参考沙发"].entries()) {
        const targetPosition = { x: 330 + index * 200, y: 280 + index * 200 };
        await page.getByRole("img", { name: title, exact: true }).first().dragTo(canvas, { targetPosition });
        const nodes = page.locator('[data-node-id^="image-"]');
        await expect(nodes).toHaveCount(index + 1);
        await expect.poll(() => saved?.nodes?.length).toBe(index + 1);
        const node = saved.nodes[index];
        expect(node.metadata.storageKey).toBe(`server:${index ? "reference" : "generated"}`);
        expect(node.metadata.naturalWidth / node.metadata.naturalHeight).toBe(2);
        expect(node.width / node.height).toBe(2);
        const box = (await nodes.nth(index).boundingBox())!;
        const canvasBox = (await canvas.boundingBox())!;
        expect(Math.abs(box.x + box.width / 2 - canvasBox.x - targetPosition.x)).toBeLessThan(2);
        expect(Math.abs(box.y + box.height / 2 - canvasBox.y - targetPosition.y)).toBeLessThan(2);
    }
    expect(uploads).toBe(0);
    await page.screenshot({ path: `../.tmp/agent-image-drag-${theme}.png` });
});
