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

test("待回答问题固定替换输入框且不进入对话流", async ({ page }) => {
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto("/__agent-test.html?state=question");
    const question = page.locator(".agent-question-card");
    await expect(question).toBeVisible();
    await expect(page.locator(".agent-composer")).toHaveCount(0);
    await expect(page.locator(".agent-assistant-round .agent-question-card")).toHaveCount(0);
    await expect(page.getByText("主角第一次出场应呈现怎样的气质？")).toHaveCount(1);
    await expect(question.locator(".ant-radio").first()).toHaveCSS("opacity", "0");
    await expect(question.getByText("推荐")).toBeVisible();
    const optionTitle = question.locator(".agent-question-option-title").first();
    await expect(optionTitle).toHaveCSS("white-space", "nowrap");
    expect((await optionTitle.boundingBox())?.height).toBeLessThanOrEqual(24);
    const box = await question.boundingBox();
    expect(box?.y).toBeGreaterThan(600);
    expect((box?.y || 0) + (box?.height || 0)).toBeLessThanOrEqual(900);
});

test("权限审批位于输入框上方且不取代普通输入", async ({ page }) => {
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto("/__agent-test.html?state=approval");
    const approval = page.locator(".agent-approval-bar");
    const composer = page.locator(".agent-composer");
    await expect(approval).toBeVisible();
    await expect(approval.getByText("待你决策")).toBeVisible();
    await expect(composer).toBeVisible();
    const approvalBox = await approval.boundingBox();
    const composerBox = await composer.boundingBox();
    expect((approvalBox?.y || 0) + (approvalBox?.height || 0)).toBeLessThan(composerBox?.y || 0);
});
