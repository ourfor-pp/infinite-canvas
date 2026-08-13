import { expect, test, type Page } from "@playwright/test";

const now = new Date().toISOString();
const state = {
    workspace: { projectId: "director-e2e", targetDurationSeconds: 600, aspectRatio: "16:9", language: "zh-CN", stage: "storyboard", status: "draft", revision: 1, createdAt: now, updatedAt: now },
    sources: [{ id: "source-1", projectId: "director-e2e", fileId: "novel", name: "长篇小说.txt", mimeType: "text/plain", status: "ready", error: null, charCount: 1_200_000, chapterCount: 120, summary: "", outline: "", revision: 1, createdAt: now, updatedAt: now }],
    documents: [
        { projectId: "director-e2e", kind: "story", content: "# 故事\n雨夜追凶。", status: "draft", revision: 2, createdAt: now, updatedAt: now },
        { projectId: "director-e2e", kind: "script", content: "## 场 1\n林夏走进车站。", status: "confirmed", revision: 2, createdAt: now, updatedAt: now },
    ],
    sequences: [{ id: "seq-1", projectId: "director-e2e", position: 0, title: "雨夜车站", summary: "旧怀表出现", status: "draft", payload: { storyboard: Array.from({ length: 6 }, (_, position) => ({ id: `panel-${position}`, position, title: `镜头 ${position + 1}`, description: "雨夜中的车站", durationSeconds: 4 })) }, revision: 1, createdAt: now, updatedAt: now }],
    shots: [{ id: "shot-1", projectId: "director-e2e", sequenceId: "seq-1", position: 0, title: "车站全景", status: "confirmed", payload: { description: "林夏走入车站", durationSeconds: 4, boundary: "cut", videoFileId: "video-1" }, revision: 1, createdAt: now, updatedAt: now }],
    timeline: { projectId: "director-e2e", payload: { shotOrder: ["shot-1"], tracks: ["dialogue", "narration", "ambient", "sfx", "music"].map((kind) => ({ id: kind, kind, clips: [] })) }, revision: 1, createdAt: now, updatedAt: now },
};
const asset = { id: "asset-1", projectId: "director-e2e", kind: "character", name: "林夏", status: "confirmed", payload: { description: "调查记者，深色风衣", designProfile: null, variants: [], primaryImageId: null, primaryAudioId: null, mediaDrafts: { image: { prompt: "角色设定图", model: null, params: {} }, audio: { prompt: "冷静女声", model: null, params: {}, audioMode: "speech" } } }, revision: 1, createdAt: now, updatedAt: now };
const style = { id: "style-1", projectId: "director-e2e", name: "冷峻悬疑", mode: "custom", templateId: null, description: "低饱和冷灰", status: "confirmed", dna: { medium: "电影", rendering: "写实", palette: "冷灰", lighting: "侧光", contrast: "高", texture: "胶片", lensAndDepth: "浅景深", composition: "宽银幕", postProcessing: "低饱和", exclusions: [] }, references: {}, referenceFileId: null, revision: 1, createdAt: now, updatedAt: now };

async function mockApi(page: Page) {
    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
        const request = route.request(); const path = new URL(request.url()).pathname.replace(/^\/api/, "");
        let data: unknown = [];
        if (path === "/director/projects/director-e2e") data = state;
        else if (path === "/projects/director-e2e/creative-assets") data = [asset];
        else if (path === "/projects/director-e2e/visual-styles") data = [style];
        else if (path === "/agent/config") data = { ready: true, modelName: "Director Agent", providerName: "Test", protocolVersion: 3, storageVersion: 2 };
        else if (path === "/agent/skills") data = [{ id: "plan-storyboards", name: "分镜规划", description: "规划长片分镜" }];
        else if (path.includes("/agent/projects/director-e2e/conversation")) data = { projectId: "director-e2e", sessions: [{ id: "session-1", projectId: "director-e2e", sdkSessionId: null, title: "导演 Agent", status: "idle", eventSeq: 0, currentRunId: null, pendingDecision: null, lastError: null, lastErrorCode: null, createdAt: now, updatedAt: now, events: [] }], session: { id: "session-1", projectId: "director-e2e", sdkSessionId: null, title: "导演 Agent", status: "idle", eventSeq: 0, currentRunId: null, pendingDecision: null, lastError: null, lastErrorCode: null, createdAt: now, updatedAt: now, events: [] }, queuedMessages: [] };
        else if (path === "/agent/sessions/session-1/turn-index") data = [];
        else if (path === "/director/sequences/seq-1" && request.method() === "PUT") { state.sequences[0] = { ...state.sequences[0], ...(request.postDataJSON() as object), revision: state.sequences[0].revision + 1 }; data = state.sequences[0]; }
        else if (path === "/creative-assets/asset-1/generations") data = { id: "generation-1", status: "queued", kind: "image", progress: 0 };
        else if (path === "/director/projects/director-e2e/renders" && request.method() === "POST") data = { id: "render-1", projectId: "director-e2e", status: "queued", progress: 0, outputFileId: null, error: null, createdAt: now, updatedAt: now };
        else if (path === "/director/projects/director-e2e/renders") data = [];
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
    });
}

test("导演台顶级导航、Agent、资产抽卡、故事板确认与成片导出", async ({ page }) => {
    await mockApi(page); await page.setViewportSize({ width: 1600, height: 960 }); await page.goto("/__director-test.html");
    await expect(page.locator("main.director-light")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByRole("navigation", { name: "导演台功能" })).toBeVisible();
    await expect(page.getByRole("button", { name: "返回导演项目库" })).toBeVisible();
    await expect(page.locator("main.director-light > aside")).toHaveCount(0);
    await expect(page.locator(".agent-panel-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByRole("button", { name: "继续创作", exact: true })).toHaveClass(/!bg-blue-600/);
    await expect(page.getByText("PRODUCTION OVERVIEW", { exact: true })).toHaveCount(0);
    await expect(page.getByText("导演 Agent")).toBeVisible();
    await expect(page.getByText("从故事到成片")).toBeVisible();
    await expect(page.getByText("Agent 已进入当前导演项目，可以创作故事与剧本、规划资产和分镜，并编排视频时间线。")).toBeVisible();
    await expect(page.getByRole("button", { name: "根据小说生成故事总纲和改编方案" })).toHaveCSS("color", "rgb(51, 65, 85)");
    await expect(page.getByRole("textbox")).toHaveAttribute("data-placeholder", "描述导演任务，输入 / 调用 Skill，@ 引用故事、镜头或资产…");
    await expect(page.getByText("和画布一起思考")).toHaveCount(0);
    for (const section of ["概览", "故事", "剧本", "角色与场景", "道具", "分镜", "视频创作台"]) await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "故事与剧本", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "故事", exact: true }).click();
    await expect(page.getByText("STORY DEPARTMENT", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "故事与剧本", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("director-story-preview").getByRole("heading", { name: "故事", level: 1 })).toBeVisible();
    await expect(page.getByTestId("director-story-preview")).not.toContainText("# 故事");
    await expect(page.getByTestId("director-story-preview")).toHaveCSS("border-top-width", "0px");
    const toolbarBox = await page.getByTestId("director-document-toolbar").boundingBox(); const previewBox = await page.getByTestId("director-story-preview").boundingBox(); expect(toolbarBox && previewBox && Math.abs(previewBox.y - toolbarBox.y - toolbarBox.height)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "编辑", exact: true }).click(); const storyEditor = page.getByRole("textbox", { name: "故事 Markdown 编辑器" }); await expect(storyEditor).toBeVisible(); await expect(storyEditor).toContainText("故事"); await expect(page.getByRole("button", { name: "加粗" })).toBeVisible();
    await storyEditor.click(); await page.keyboard.press("Control+End"); await page.keyboard.press("Enter"); await page.keyboard.type("新增故事段落"); await expect(page.getByText("未保存", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "预览", exact: true }).click(); await expect(page.getByTestId("director-story-preview")).toContainText("新增故事段落");
    await page.getByRole("button", { name: "剧本", exact: true }).click(); await expect(page.getByTestId("director-script-preview").getByRole("heading", { name: "场 1", level: 2 })).toBeVisible();
    await page.getByRole("button", { name: "角色与场景", exact: true }).click(); await expect(page.getByText("林夏")).toBeVisible();
    const generation = page.waitForRequest((request) => request.url().includes("/creative-assets/asset-1/generations")); await page.getByRole("button", { name: "抽图" }).click(); await generation;
    await page.getByRole("button", { name: "分镜", exact: true }).click(); await expect(page.getByText("雨夜车站")).toBeVisible(); await page.getByRole("button", { name: "确认故事板" }).click(); await expect(page.getByRole("button", { name: "拆为镜头" })).toBeVisible();
    await page.getByRole("button", { name: "视频创作台", exact: true }).click(); await expect(page.getByText("对白", { exact: true })).toBeVisible(); const render = page.waitForRequest((request) => request.url().endsWith("/director/projects/director-e2e/renders") && request.method() === "POST"); await page.getByRole("button", { name: "导出 MP4" }).click(); await render; await expect(page.getByText("成片合成")).toBeVisible();
});
