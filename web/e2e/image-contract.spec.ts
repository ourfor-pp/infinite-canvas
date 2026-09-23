import { expect, test } from "@playwright/test";
import { imageContractFor } from "../../server/src/image-contract";
for (const theme of ["light", "dark"]) test(`图片按模型展示参数并清理旧设置 ${theme}`, async ({ page }, testInfo) => {
    const requests: any[] = [];
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="steelblue"/></svg>';
    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path.endsWith("/content")) return route.fulfill({ contentType: "image/svg+xml", body: image });
        let data: unknown = [];
        if (path === "/api/generations" && req.method() === "POST") { requests.push(req.postDataJSON()); data = { id: `image-${requests.length}` }; }
        else if (/\/generations\/image-/.test(path)) data = { id: `image-${requests.length}`, status: "succeeded", result: { files: [{ fileId: `result-${requests.length}`, mimeType: "image/svg+xml", bytes: image.length }] } };
        else if (path.includes("/files/")) data = { fileId: path.split("/").at(-1), mimeType: "image/svg+xml", bytes: image.length };
        else if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        else if (req.method() === "PUT") data = { ...req.postDataJSON(), id: "canvas-e2e", revision: 2 };
        await route.fulfill({ json: { data } });
    });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`/__canvas-test.html?theme=${theme}`);
    await page.addStyleTag({ content: "#root > .ant-app { height:100% }" });
    const models = [["gpt-test", "GPT 图片", "openai-images"], ["gemini-test", "Gemini 图片", "gemini-image"], ["qwen-image-2.1-local", "Qwen 图片", ""]].map(([id, name, endpoint]) => ({ id, name, value: `p::${id}`, providerId: "p", providerName: "测试", output: "image", inputs: ["text", "image"], enabled: true, imageModes: ["generate", "edit"], maxReferenceImages: 3, imageContract: imageContractFor({ id, endpoint, imageModes: ["generate", "edit"], maxReferenceImages: 3 }) }));
    await page.evaluate(async (models) => {
        const path = "/src/stores/use-config-store.ts";
        const { useConfigStore } = await import(/* @vite-ignore */ path);
        useConfigStore.getState().hydrateFromServer({ count: "1", canvasImageCount: "1", size: "auto", quality: "auto", background: "auto" });
        useConfigStore.getState().hydrateModels(models, { image: models[0].value });
    }, models);
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await page.locator('[data-node-id^="image-"]').dblclick({ position: { x: 80, y: 80 } });
    const panel = page.locator("[data-canvas-node-panel]");
    await panel.locator('[contenteditable="true"]').fill("一个蓝色茶杯");
    const settings = panel.locator('button[data-control-appearance="toolbar"]').filter({ has: page.locator("svg.lucide-settings-2") });
    await settings.click();
    await page.getByLabel("质量", { exact: true }).selectOption("high");
    await page.getByLabel("背景", { exact: true }).selectOption("transparent");
    await page.getByLabel("尺寸", { exact: true }).selectOption("1536x1024");
    await settings.click();
    await panel.getByRole("combobox").click();
    await page.getByRole("option", { name: /Gemini 图片/ }).click();
    await settings.click();
    await expect(page.getByLabel("质量", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("背景", { exact: true })).toHaveCount(0);
    await page.getByLabel("画面比例", { exact: true }).selectOption("16:9");
    await expect(page.getByLabel("生成数量")).toHaveAttribute("max", "1");
    await page.screenshot({ path: testInfo.outputPath(`image-settings-${theme}.png`) });
    await settings.click();
    await panel.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(page.locator('img.pointer-events-none[src*="result-1"]').first()).toBeVisible();
    expect(requests[0]).toMatchObject({ imageInputVersion: 1, model: "p::gemini-test", params: { size: "16:9", count: 1 } });
    expect(requests[0].params).not.toHaveProperty("quality");
    expect(requests[0].params).not.toHaveProperty("background");
    await expect(page.locator("[data-node-id]")).toHaveCount(1);
});


for (const theme of ["light", "dark"]) test(`Qwen 参考图编辑支持原生 2K 和重生成动画 ${theme}`, async ({ page }, testInfo) => {
    let submitted: any;
    let finish = false;
    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path.endsWith("/content")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="steelblue"/></svg>' });
        let data: unknown = [];
        if (path === "/api/generations" && req.method() === "POST") { submitted = req.postDataJSON(); data = { id: "ratio-test" }; }
        else if (path.endsWith("/generations/ratio-test")) data = { id: "ratio-test", status: finish ? "succeeded" : "running", result: { files: [{ fileId: "ratio-result", mimeType: "image/svg+xml" }] } };
        else if (path.includes("/files/")) data = { fileId: path.split("/").at(-1), mimeType: "image/svg+xml" };
        else if (path === "/api/agent/config") data = { ready: false, protocolVersion: 4, storageVersion: 2 };
        else if (path.endsWith("/capabilities")) data = { sceneId: "canvas", engines: [], skills: [], referenceKinds: ["canvas"], composer: { suggestions: [] } };
        else if (path.endsWith("/conversation")) data = { sessions: [], session: null, queuedMessages: [] };
        else if (req.method() === "PUT") data = { ...req.postDataJSON(), id: "canvas-e2e", revision: 2 };
        await route.fulfill({ json: { data } });
    });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`/__canvas-test.html?theme=${theme}`);
    await page.addStyleTag({ content: "#root > .ant-app { height:100% }" });
    const contract = imageContractFor({ id: "qwen-image-2.1-local", imageModes: ["generate", "edit"], maxReferenceImages: 10 });
    await page.evaluate(async (contract) => {
        const path = "/src/stores/use-config-store.ts";
        const { useConfigStore } = await import(/* @vite-ignore */ path);
        const value = "local-media::qwen-image-2.1-local";
        useConfigStore.getState().hydrateFromServer({ count: "1", canvasImageCount: "1", size: "auto", quality: "auto", background: "auto" });
        useConfigStore.getState().hydrateModels([{ id: "qwen-image-2.1-local", name: "Qwen Image 2.1", value, providerId: "local-media", providerName: "本地媒体执行器", output: "image", inputs: ["text", "image"], enabled: true, imageModes: ["generate", "edit"], maxReferenceImages: 10, imageContract: contract }], { image: value });
    }, contract);
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await page.evaluate(async () => {
        const path = "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ path);
        const project = useCanvasStore.getState().projects[0];
        const nodes = ["reference", "target"].map((id, i) => ({ id, type: "image", title: id, position: { x: 350 + i * 350, y: 100 }, width: 240, height: 240, metadata: { content: "/api/files/reference-image/content", storageKey: "server:reference-image", naturalWidth: 240, naturalHeight: 240, status: "success", prompt: "改成红色", model: "local-media::qwen-image-2.1-local" } }));
        window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: { ...project, nodes, connections: [{ id: "ref-edge", fromNodeId: "reference", toNodeId: "target", fromPortId: "output", toPortId: "input" }] } }));
    });
    await page.locator('[data-node-id="target"]').dblclick({ position: { x: 100, y: 100 } });
    const panel = page.locator("[data-canvas-node-panel]");
    await expect(panel.locator('[aria-label="参考素材"] img')).toHaveCount(1);
    await page.waitForTimeout(400); // Wait for double-click viewport focus before opening its portal.
    const settings = panel.locator('button[data-control-appearance="toolbar"]').filter({ has: page.locator("svg.lucide-settings-2") });
    await settings.click();
    const size = page.getByLabel("输出尺寸（自动跟随参考图）", { exact: true });
    await size.selectOption("1024x1536");
    await expect(size).toHaveValue("1024x1536");
    await size.selectOption("1536x2752");
    await page.screenshot({ path: testInfo.outputPath("reference-output-size.png") });
    await settings.click();
    await panel.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect.poll(() => submitted?.params.size).toBe("1536x2752");
    const target = page.locator('[data-node-id="target"]');
    await expect(target.getByRole("status")).toBeVisible();
    await expect(target.locator(".animate-spin")).toBeVisible();
    await expect(target.locator('img[src*="reference-image"]').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("image-regenerating.png") });
    finish = true;
    expect(submitted.references).toEqual([expect.objectContaining({ fileId: "reference-image", kind: "image" })]);
    await expect(page.locator('[data-node-id="target"] img[src*="ratio-result"]').first()).toBeVisible();
    await expect(target.getByRole("status")).toHaveCount(0);
    await expect(page.locator("[data-node-id]")).toHaveCount(2);
});
