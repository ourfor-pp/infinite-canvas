import { expect, test } from "@playwright/test";

test("原子提及、输入法与运行中发送控件", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true }); });
    await page.goto("/__agent-test.html");
    const editor = page.getByRole("textbox");
    await editor.click(); await editor.pressSequentially("请用 /写");
    await expect(page.getByText("/写故事")).toBeVisible(); await page.keyboard.press("Enter");
    await expect(editor.locator(".agent-mention-token")).toHaveText("/写故事");
    await editor.pressSequentially(" 修改 @故"); await page.keyboard.press("Enter");
    await expect(editor.locator(".agent-mention-token")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /发送时机|马上/ })).toBeVisible();
    await page.getByRole("button", { name: "发送" }).click(); await expect(page.getByTestId("sent")).toHaveText("1");
});

test("蓝白对话回合在窄栏正确展示", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 }); await page.goto("/__agent-test.html");
    await expect(page.locator(".agent-panel-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const userBubble = page.locator(".agent-user-bubble").first();
    await expect(userBubble).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(userBubble).toHaveCSS("border-top-width", "0px");
    await expect(userBubble).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
    const assistantHeading = page.getByRole("heading", { name: "画布结构", level: 2 });
    await expect(assistantHeading).toHaveCSS("font-size", "18px");
    await expect(assistantHeading).toHaveCSS("line-height", "25.2px");
    await expect(page.getByText("画布结构已经读取完成。")).toBeVisible(); await expect(page.getByText(/1 次工具调用/)).toBeVisible();
    await expect(page.getByText("我先读取画布最新状态。")).toBeHidden();
    const completedProcess = page.getByRole("button", { name: /1 次工具调用.*1 条过程记录/ }); await expect(completedProcess).toHaveAttribute("aria-expanded", "false"); await completedProcess.click(); await expect(page.getByText("我先读取画布最新状态。")).toBeVisible();
    const status = page.locator(".agent-status-pill"); await expect(status).toContainText("思考：正在读取故事"); await expect(status).toHaveCSS("border-radius", "999px");
    await status.hover();
    const popover = page.locator(".agent-status-popover"); await expect(popover).toBeVisible();
    const popoverContent = popover.locator(".agent-status-popover-content");
    await expect(popoverContent.locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(popoverContent).toHaveCSS("max-height", "280px");
    expect((await popover.boundingBox())?.height).toBeLessThanOrEqual(300);
    await expect(page.locator(".agent-composer")).toHaveCSS("border-radius", "20px");
});
