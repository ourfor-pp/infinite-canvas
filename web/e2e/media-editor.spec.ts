import { expect, test } from "@playwright/test";

test("业务卡媒体编辑器通过 Portal 打开且不改变节点尺寸", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto("/__media-editor-test.html");
    const card = page.getByTestId("business-card");
    const popover = page.getByTestId("media-editor-popover");
    const before = await card.boundingBox();
    await page.getByRole("button", { name: /调\s*图/ }).click();
    const toolbarControls = popover.locator('[data-control-appearance="toolbar"]');
    await expect(toolbarControls).toHaveCount(3);
    for (const control of await toolbarControls.all()) {
        await expect(control).toHaveCSS("height", "36px");
        await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        const boxShadow = await control.evaluate((element) => getComputedStyle(element).boxShadow);
        expect(boxShadow === "none" || !boxShadow.replaceAll("rgba(0, 0, 0, 0)", "").match(/rgba?\(/)).toBeTruthy();
    }
    await toolbarControls.nth(1).click();
    await page.getByRole("option", { name: /备用图片/ }).click();
    await expect(popover).toBeVisible();
    await expect(page.getByRole("button", { name: "最终提示词" })).toBeVisible();
    await page.getByRole("button", { name: "最终提示词" }).click();
    await expect(page.getByText("后端最终使用的提示词")).toBeVisible();
    expect(Number(await page.locator(".media-request-preview-popover").evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThan(Number(await popover.evaluate((element) => getComputedStyle(element).zIndex)));
    await page.getByRole("button", { name: "最终提示词" }).click();
    await expect(popover).toHaveCSS("width", "960px");
    await expect(popover).toHaveCSS("background-color", "rgb(251, 250, 247)");
    expect(await card.boundingBox()).toEqual(before);
    await popover.locator(".ant-image").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(Number(await page.locator(".media-image-preview").evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThan(Number(await popover.evaluate((element) => getComputedStyle(element).zIndex)));
    await page.getByRole("button", { name: "close" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(popover).toBeVisible();
    await page.getByRole("button", { name: "交给 Agent" }).click();
    await expect(page.getByTestId("agent-calls")).toHaveText("1");
});

test("业务主图点击直接打开调图浮层且适配窄视口与深色主题", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/__media-editor-test.html");
    await page.getByRole("button", { name: "调整林夏图片" }).click();
    await expect(page.getByTestId("media-editor-popover")).toBeVisible();
    await page.getByRole("button", { name: /调\s*图/ }).click();
    await page.getByRole("button", { name: "切换主题" }).click();
    await page.getByRole("button", { name: "调整林夏图片" }).click();
    const previewToggle = page.getByRole("button", { name: "最终提示词" });
    await expect(previewToggle).toBeVisible();
    const popover = page.getByTestId("media-editor-popover");
    await expect(popover).toHaveCSS("background-color", "rgb(31, 29, 26)");
    const box = await popover.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
});

test("@ 选择画布图片会建立引用，移除顶部缩略图会断开引用", async ({ page }) => {
    await page.goto("/__media-editor-test.html");
    await page.getByRole("button", { name: /调\s*图/ }).click();
    const editor = page.getByRole("textbox");
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially(" @");
    await expect(page.getByText("素材引用")).toBeVisible();
    await page.getByRole("button", { name: /图片\s*展开/ }).click();
    await page.getByRole("button", { name: /图片2.*月面参考图/ }).click();
    await expect(page.getByTestId("connected-images")).toHaveText("image-1,image-2");
    await expect(page.getByRole("button", { name: "移除图片2" })).toBeVisible();
    await page.getByRole("button", { name: "移除图片2" }).click();
    await expect(page.getByTestId("connected-images")).toHaveText("image-1");
});

test("下拉菜单展开时第一次点击外部只关闭菜单", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto("/__media-editor-test.html");
    await page.getByRole("button", { name: /调\s*图/ }).click();
    const popover = page.getByTestId("media-editor-popover");
    await popover.locator('[data-control-appearance="toolbar"]').nth(1).click();
    await expect(page.getByRole("option", { name: /备用图片/ })).toBeVisible();
    await page.mouse.click(12, 180);
    await expect(page.getByRole("option", { name: /备用图片/ })).toBeHidden();
    await expect(popover).toBeVisible();
    await page.mouse.click(12, 180);
    await expect(popover).toBeHidden();
});
