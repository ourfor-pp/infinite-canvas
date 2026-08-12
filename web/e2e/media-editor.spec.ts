import { expect, test } from "@playwright/test";

test("业务卡媒体编辑器通过 Portal 打开且不改变节点尺寸", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto("/__media-editor-test.html");
    const card = page.getByTestId("business-card");
    const popover = page.getByTestId("media-editor-popover");
    const before = await card.boundingBox();
    await page.getByRole("button", { name: /调\s*图/ }).click();
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

test("图片点击只进入预览且浮层适配窄视口与深色主题", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/__media-editor-test.html");
    await page.locator(".ant-image").first().click();
    await expect(page.getByRole("dialog", { name: "林夏" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "林夏" })).toBeHidden();
    await page.getByRole("button", { name: "切换主题" }).click();
    await page.getByRole("button", { name: /调\s*图/ }).click();
    const previewToggle = page.getByRole("button", { name: "最终提示词" });
    await expect(previewToggle).toBeVisible();
    const popover = page.getByTestId("media-editor-popover");
    await expect(popover).toHaveCSS("background-color", "rgb(31, 29, 26)");
    const box = await popover.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
});
