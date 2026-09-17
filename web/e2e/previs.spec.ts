import { expect, test } from "@playwright/test";

test("预演切段和数据刷新不复用已释放的 WebGL 上下文", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/__previs-test.html");
    const canvas = page.getByLabel("三维预演画面");
    await expect(canvas).toBeVisible();
    const original = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    for (let i = 0; i < 4; i++) {
        for (const name of ["切换分镜段", "刷新预演数据"]) {
            const previous = await canvas.elementHandle();
            await page.getByRole("button", { name }).click();
            await expect.poll(() => previous!.evaluate((element) => element.isConnected)).toBe(false);
            await expect(canvas).toBeVisible();
            await expect(page.getByRole("alert")).toHaveCount(0);
        }
    }
    expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(original);
    await expect(page.getByLabel("当前时刻")).toHaveText("1");
    await page.getByRole("button", { name: "定位时间" }).click();
    expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(original);
    await canvas.click({ position: { x: 375, y: 210 } });
    await expect(page.getByLabel("当前对象")).toHaveText("actor");
    expect(errors).toEqual([]);
});

test("跨段持续抬手保持动作进度和持物位置", async ({ page }) => {
    await page.goto("/__previs-test.html");
    const canvas = page.getByLabel("三维预演画面");
    await page.getByRole("button", { name: "拆段前持物" }).click();
    const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    await page.getByRole("button", { name: "拆段后持物" }).click();
    expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(before);
    await page.getByRole("button", { name: "从零抬手" }).click();
    expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(before);
});
