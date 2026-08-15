# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web/e2e/agent-ui.spec.ts >> 蓝白对话回合在窄栏正确展示
- Location: web/e2e/agent-ui.spec.ts:16:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/__agent-test.html", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | test("原子提及、输入法与运行中发送控件", async ({ page }) => {
  4  |     await page.addInitScript(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true }); });
  5  |     await page.goto("/__agent-test.html");
  6  |     const editor = page.getByRole("textbox");
  7  |     await editor.click(); await editor.pressSequentially("请用 /写");
  8  |     await expect(page.getByText("/写故事")).toBeVisible(); await page.keyboard.press("Enter");
  9  |     await expect(editor.locator(".agent-mention-token")).toHaveText("/写故事");
  10 |     await editor.pressSequentially(" 修改 @故"); await page.keyboard.press("Enter");
  11 |     await expect(editor.locator(".agent-mention-token")).toHaveCount(2);
  12 |     await expect(page.getByRole("button", { name: /发送时机|马上/ })).toBeVisible();
  13 |     await page.getByRole("button", { name: "发送" }).click(); await expect(page.getByTestId("sent")).toHaveText("1");
  14 | });
  15 | 
  16 | test("蓝白对话回合在窄栏正确展示", async ({ page }) => {
> 17 |     await page.setViewportSize({ width: 390, height: 760 }); await page.goto("/__agent-test.html");
     |                                                                         ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  18 |     await expect(page.locator(".agent-panel-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  19 |     const userBubble = page.locator(".agent-user-bubble").first();
  20 |     await expect(userBubble).toHaveCSS("color", "rgb(255, 255, 255)");
  21 |     await expect(userBubble).toHaveCSS("border-top-width", "0px");
  22 |     await expect(userBubble).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  23 |     const assistantHeading = page.getByRole("heading", { name: "画布结构", level: 2 });
  24 |     await expect(assistantHeading).toHaveCSS("font-size", "18px");
  25 |     await expect(assistantHeading).toHaveCSS("line-height", "25.2px");
  26 |     await expect(page.getByText("画布结构已经读取完成。")).toBeVisible(); await expect(page.getByText(/1 次工具调用/)).toBeVisible();
  27 |     await expect(page.getByText("我先读取画布最新状态。")).toBeHidden();
  28 |     const completedProcess = page.getByRole("button", { name: /1 次工具调用.*1 条过程记录/ }); await expect(completedProcess).toHaveAttribute("aria-expanded", "false"); await completedProcess.click(); await expect(page.getByText("我先读取画布最新状态。")).toBeVisible();
  29 |     const status = page.locator(".agent-status-pill"); await expect(status).toContainText("思考：正在读取故事"); await expect(status).toHaveCSS("border-radius", "999px");
  30 |     await status.hover();
  31 |     const popover = page.locator(".agent-status-popover"); await expect(popover).toBeVisible();
  32 |     const popoverContent = popover.locator(".agent-status-popover-content");
  33 |     await expect(popoverContent.locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  34 |     await expect(popoverContent).toHaveCSS("max-height", "280px");
  35 |     expect((await popover.boundingBox())?.height).toBeLessThanOrEqual(300);
  36 |     await expect(page.locator(".agent-composer")).toHaveCSS("border-radius", "20px");
  37 | });
  38 | 
  39 | test("待回答问题固定替换输入框且不进入对话流", async ({ page }) => {
  40 |     await page.setViewportSize({ width: 460, height: 900 });
  41 |     await page.goto("/__agent-test.html?state=question");
  42 |     const question = page.locator(".agent-question-card");
  43 |     await expect(question).toBeVisible();
  44 |     await expect(page.locator(".agent-composer")).toHaveCount(0);
  45 |     await expect(page.locator(".agent-assistant-round .agent-question-card")).toHaveCount(0);
  46 |     await expect(page.getByText("主角第一次出场应呈现怎样的气质？")).toHaveCount(1);
  47 |     await expect(question.locator(".ant-radio").first()).toHaveCSS("opacity", "0");
  48 |     await expect(question.getByText("推荐")).toBeVisible();
  49 |     const box = await question.boundingBox();
  50 |     expect(box?.y).toBeGreaterThan(600);
  51 |     expect((box?.y || 0) + (box?.height || 0)).toBeLessThanOrEqual(900);
  52 | });
  53 | 
  54 | test("权限审批位于输入框上方且不取代普通输入", async ({ page }) => {
  55 |     await page.setViewportSize({ width: 460, height: 900 });
  56 |     await page.goto("/__agent-test.html?state=approval");
  57 |     const approval = page.locator(".agent-approval-bar");
  58 |     const composer = page.locator(".agent-composer");
  59 |     await expect(approval).toBeVisible();
  60 |     await expect(approval.getByText("待你决策")).toBeVisible();
  61 |     await expect(composer).toBeVisible();
  62 |     const approvalBox = await approval.boundingBox();
  63 |     const composerBox = await composer.boundingBox();
  64 |     expect((approvalBox?.y || 0) + (approvalBox?.height || 0)).toBeLessThan(composerBox?.y || 0);
  65 | });
  66 | 
```