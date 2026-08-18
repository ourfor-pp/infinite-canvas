import { expect, test, type Page } from "@playwright/test";

const now = new Date().toISOString();
const state = {
    activeStyleId: "style-1",
    workspace: { projectId: "director-e2e", targetDurationSeconds: 600, aspectRatio: "16:9", language: "zh-CN", stage: "storyboard", status: "draft", revision: 1, createdAt: now, updatedAt: now },
    sources: [
        {
            id: "source-1",
            projectId: "director-e2e",
            fileId: "novel",
            name: "长篇小说.txt",
            mimeType: "text/plain",
            status: "ready",
            error: null,
            charCount: 1_200_000,
            chapterCount: 120,
            summary: "",
            outline: "",
            revision: 1,
            createdAt: now,
            updatedAt: now,
        },
    ],
    documents: [
        { projectId: "director-e2e", kind: "story", content: "# 故事\n雨夜追凶。", status: "draft", revision: 2, createdAt: now, updatedAt: now },
        {
            projectId: "director-e2e",
            kind: "script",
            content: `## 场 1\n林夏走进车站。\n\n${"第一场动作描述。\n\n".repeat(18)}## 场 2\n列车驶入站台。\n\n${"第二场动作描述。\n\n".repeat(18)}## 场 3\n两人在出口相遇。\n\n${"第三场动作描述。\n\n".repeat(18)}`,
            status: "confirmed",
            revision: 2,
            createdAt: now,
            updatedAt: now,
        },
    ],
    sequences: [
        {
            id: "seq-1",
            projectId: "director-e2e",
            position: 0,
            title: "雨夜车站",
            summary: "旧怀表出现",
            status: "draft",
            payload: {},
            revision: 1,
            createdAt: now,
            updatedAt: now,
        },
    ],
    videoSegments: [
        {
            id: "segment-1",
            projectId: "director-e2e",
            sequenceId: "seq-1",
            position: 0,
            title: "车站全景",
            status: "confirmed",
            payload: { description: "林夏走入车站", durationSeconds: 8, boundary: "cut", h3Mode: "ref2va", h3ModeReason: "完整故事板作为视频段构图与动作参考", nativeAudioStatus: "ready", videoFileId: "video-1", storyboardFrameCount: 6, h3PromptSnapshot: { mode: "ref2va", qualityPreset: "preview", prompt: "subject_definitions: <Picture 1> is the complete storyboard sheet.\n\nsummary: A rainy station scene.\n\nretention_analysis: Preserve identity and geography.\n\ndetailed_description: [Shot 1] Rain falls over the station.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A", references: [{ fileId: "storyboard-1", kind: "image", role: "reference" }, { fileId: "character-image", kind: "image", role: "reference" }, { fileId: "scene-image", kind: "image", role: "reference" }], storyboardRevision: 1 }, storyboardSheet: { revision: 1, layout: "3x2", imageFileId: "storyboard-1", promptSnapshot: "Create ONE cinematic storyboard sheet for an 8-second video segment.", referenceSnapshot: { selected: [{ fileId: "character-image", name: "林夏", purpose: "主角色" }, { fileId: "scene-image", name: "雨夜车站", purpose: "场景" }], omitted: [], videoSelected: [{ fileId: "character-image", name: "林夏", purpose: "主角色" }, { fileId: "scene-image", name: "雨夜车站", purpose: "场景" }], videoOmitted: [], blockedReasons: [], route: { mode: "ref2va", reason: "完整故事板作为视频段构图与动作参考" }, capabilities: { turboPreview: false }, recipes: {}, frameAlignment: {} }, frames: Array.from({ length: 6 }, (_, position) => ({ id: `frame-${position}`, position, shotNumber: 1, timeSeconds: position === 5 ? 8 : position * 1.6, kind: position === 0 ? "shot-start" : position === 5 ? "shot-end" : "keyframe", description: "雨夜中的车站", action: "林夏走入车站", cameraAngle: "平视", cameraMove: "缓慢推进", dialogue: "", sound: "雨声" })) } },
            revision: 1,
            createdAt: now,
            updatedAt: now,
        },
    ],
    timeline: { projectId: "director-e2e", payload: { segmentOrder: ["segment-1"], tracks: ["model-original", "dialogue", "narration", "ambient", "sfx", "music"].map((kind) => ({ id: kind, kind, clips: [] })) }, revision: 1, createdAt: now, updatedAt: now },
};
const asset = {
    id: "asset-1",
    projectId: "director-e2e",
    kind: "character",
    name: "林夏",
    status: "confirmed",
    payload: {
        description: "调查记者，深色风衣",
        designProfile: null,
        variants: [{ id: "asset-image", kind: "image", fileId: "character-image", label: "角色四视图", prompt: "Character turnaround sheet, four full-body views on pure white.", generationId: "asset-generation", createdAt: now }],
        primaryImageId: "asset-image",
        primaryAudioId: null,
        mediaDrafts: { image: { prompt: "角色设定图", model: null, params: {} }, audio: { prompt: "冷静女声", model: null, params: {}, audioMode: "speech" } },
    },
    revision: 1,
    createdAt: now,
    updatedAt: now,
};
const style = {
    id: "style-1",
    projectId: "director-e2e",
    name: "冷峻悬疑",
    mode: "custom",
    templateId: null,
    description: "低饱和冷灰",
    status: "confirmed",
    dna: { medium: "电影", rendering: "写实", palette: "冷灰", lighting: "侧光", contrast: "高", texture: "胶片", lensAndDepth: "浅景深", composition: "宽银幕", postProcessing: "低饱和", exclusions: [] },
    references: {},
    referenceFileId: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
};

async function mockApi(page: Page, directorState: typeof state = state) {
    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace(/^\/api/, "");
        let data: unknown = [];
        if (path === "/director/projects/director-e2e") data = directorState;
        else if (path === "/projects/director-e2e/creative-assets") data = [asset];
        else if (path === "/projects/director-e2e/visual-styles") data = [style];
        else if (path === "/agent/config") data = { ready: true, modelName: "Director Agent", providerName: "Test", protocolVersion: 3, storageVersion: 2 };
        else if (path === "/agent/projects/director-e2e/capabilities")
            data = {
                sceneId: "director",
                skills: [{ id: "director-plan-storyboards", name: "导演台故事板规划", description: "规划长片分镜" }],
                referenceKinds: ["director", "asset", "style"],
                composer: {
                    placeholder: "描述导演任务，输入 / 调用 Skill，@ 引用故事、视频段或素材…",
                    referenceLabel: "引用导演台内容",
                    emptyTitle: "和导演台一起创作",
                    emptyDescription: "Agent 已绑定当前导演项目，可以改编故事、编写剧本并推进素材、分镜和成片。",
                    suggestions: ["根据小说生成故事总纲和改编方案", "从剧本整理角色、场景和道具", "规划下一组视频段与故事板"],
                },
            };
        else if (path === "/agent/projects/director-e2e/references") data = [];
        else if (path === "/director/video-segments/segment-1/preflight") data = { storyboardFileId: "storyboard-1", selected: [{ fileId: "character-image", name: "林夏", purpose: "主角色" }, { fileId: "scene-image", name: "雨夜车站", purpose: "场景" }], omitted: [], videoSelected: [{ fileId: "character-image", name: "林夏", purpose: "主角色" }, { fileId: "scene-image", name: "雨夜车站", purpose: "场景" }], videoOmitted: [], blockedReasons: [], route: { mode: "ref2va", reason: "完整故事板作为视频段构图与动作参考" }, capabilities: { turboPreview: false }, recipes: { preview: { turbo: false }, final: { turbo: false } }, frameAlignment: { modelFrames: 209 } };
        else if (path === "/generations") data = [{ id: "asset-generation", status: "succeeded", kind: "image", progress: 1, providerId: "openai", modelId: "gpt-image-2", request: { references: [{ fileId: "style-image", kind: "image" }], params: { __promptPackage: { asset: { revision: 1 } } } }, result: null, error: null, errorCode: null, usage: null, createdAt: now, updatedAt: now }];
        else if (path.includes("/agent/projects/director-e2e/conversation"))
            data = {
                projectId: "director-e2e",
                sessions: [
                    {
                        id: "session-1",
                        projectId: "director-e2e",
                        sdkSessionId: null,
                        title: "导演 Agent",
                        status: "idle",
                        eventSeq: 0,
                        currentRunId: null,
                        pendingDecision: null,
                        lastError: null,
                        lastErrorCode: null,
                        createdAt: now,
                        updatedAt: now,
                        events: [],
                    },
                ],
                session: {
                    id: "session-1",
                    projectId: "director-e2e",
                    sdkSessionId: null,
                    title: "导演 Agent",
                    status: "idle",
                    eventSeq: 0,
                    currentRunId: null,
                    pendingDecision: null,
                    lastError: null,
                    lastErrorCode: null,
                    createdAt: now,
                    updatedAt: now,
                    events: [],
                },
                queuedMessages: [],
            };
        else if (path === "/agent/sessions/session-1/turn-index") data = [];
        else if (path === "/director/sequences/seq-1" && request.method() === "PUT") {
            directorState.sequences[0] = { ...directorState.sequences[0], ...(request.postDataJSON() as object), revision: directorState.sequences[0].revision + 1 };
            data = directorState.sequences[0];
        } else if (path === "/creative-assets/asset-1/generations") data = { id: "generation-1", status: "queued", kind: "image", progress: 0, modelId: "gpt-image-2", request: { params: { __creativeAsset: { projectId: "director-e2e", assetId: "asset-1" } } }, createdAt: now, updatedAt: now };
        else if (path === "/director/projects/director-e2e/renders" && request.method() === "POST") data = { id: "render-1", projectId: "director-e2e", status: "queued", progress: 0, outputFileId: null, error: null, createdAt: now, updatedAt: now };
        else if (path === "/director/projects/director-e2e/renders") data = [];
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
    });
}

test("导演台顶级导航、Agent、素材抽卡、整张故事板与视频段时间线", async ({ page }) => {
    test.setTimeout(60_000);
    await mockApi(page, structuredClone(state));
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.goto("/__director-test.html");
    await expect(page.locator("main.director-light")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByRole("navigation", { name: "导演台功能" })).toBeVisible();
    await expect(page.getByRole("button", { name: "返回导演项目库" })).toBeVisible();
    await expect(page.locator("main.director-light > aside")).toHaveCount(0);
    await expect(page.locator(".agent-panel-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByRole("button", { name: "继续创作", exact: true })).toHaveClass(/!bg-blue-600/);
    await expect(page.getByText("PRODUCTION OVERVIEW", { exact: true })).toHaveCount(0);
    await expect(page.getByText("导演 Agent")).toBeVisible();
    await expect(page.getByText("和导演台一起创作")).toBeVisible();
    await expect(page.getByText("Agent 已绑定当前导演项目，可以改编故事、编写剧本并推进素材、分镜和成片。")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveAttribute("data-placeholder", "描述导演任务，输入 / 调用 Skill，@ 引用故事、视频段或素材…");
    await expect(page.getByText("和画布一起思考")).toHaveCount(0);
    for (const section of ["概览", "故事", "剧本", "风格", "素材", "分镜", "视频创作台"]) await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "角色与场景", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "道具", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "故事与剧本", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "故事", exact: true }).click();
    await expect(page.getByText("STORY DEPARTMENT", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "故事与剧本", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("director-story-preview").getByRole("heading", { name: "故事", level: 1 })).toBeVisible();
    await expect(page.getByTestId("director-story-preview")).not.toContainText("# 故事");
    await expect(page.getByTestId("director-story-preview")).toHaveCSS("border-top-width", "0px");
    const toolbarBox = await page.getByTestId("director-document-toolbar").boundingBox();
    const previewBox = await page.getByTestId("director-story-preview").boundingBox();
    expect(toolbarBox && previewBox && Math.abs(previewBox.y - toolbarBox.y - toolbarBox.height)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const storyEditor = page.getByRole("textbox", { name: "故事 Markdown 编辑器" });
    await expect(storyEditor).toBeVisible();
    await expect(storyEditor).toContainText("故事");
    await expect(page.getByRole("button", { name: "加粗" })).toBeVisible();
    await storyEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("新增故事段落");
    await expect(page.getByText("未保存", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.getByTestId("director-story-preview")).toContainText("新增故事段落");
    await page.getByRole("button", { name: "剧本", exact: true }).click();
    await expect(page.getByTestId("director-script-preview").getByRole("heading", { name: "场 1", level: 2 })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "剧本场次目录" })).toContainText("场 1");
    await expect(page.getByRole("button", { name: "锁定", exact: true })).toHaveCount(0);
    const longOutlineTitle = page.getByRole("complementary", { name: "剧本场次目录" }).getByRole("button", { name: "场 1", exact: true });
    await expect(longOutlineTitle).toHaveCSS("white-space", "normal");
    const sceneThree = page.getByRole("complementary", { name: "剧本场次目录" }).getByRole("button", { name: "场 3", exact: true });
    await sceneThree.click();
    await expect(sceneThree).toHaveAttribute("aria-current", "location");
    await expect
        .poll(() =>
            page
                .getByTestId("director-script-preview")
                .locator("article")
                .evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(100);
    await page
        .getByTestId("director-script-preview")
        .locator("article")
        .evaluate((element) => element.scrollTo({ top: 0 }));
    await expect(page.getByRole("complementary", { name: "剧本场次目录" }).getByRole("button", { name: "场 1", exact: true })).toHaveAttribute("aria-current", "location");
    await page.getByRole("button", { name: "素材", exact: true }).click();
    await expect(page.getByText("林夏")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "素材分类" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "锁定", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "提示词" }).click();
    await expect(page.getByText("素材提示词")).toBeVisible();
    await expect(page.getByText("Character turnaround sheet, four full-body views on pure white.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("素材提示词")).toBeHidden();
    const generation = page.waitForRequest((request) => request.url().includes("/creative-assets/asset-1/generations"));
    await page.getByRole("button", { name: "抽图" }).click();
    await generation;
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    await expect(page.getByRole("button", { name: "分镜", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("雨夜车站")).toBeVisible();
    await expect(page.getByTestId("director-storyboard-card")).toHaveCount(1);
    await expect(page.getByTestId("director-storyboard-sheet").locator("img")).toHaveCount(1);
    await expect(page.getByTestId("director-storyboard-sheet").locator("button, [role=button]")).toHaveCount(0);
    await expect(page.getByText("完整故事板 · 6 格 · 1 个 Shot")).toBeVisible();
    await expect(page.getByText("完整故事板作为一个参考文件，不裁格、不设置画格锚点")).toBeVisible();
    await expect(page.getByText(/8 秒 · 6 格/)).toBeVisible();
    await expect(page.getByRole("button", { name: "重抽整板" })).toBeVisible();
    await page.getByRole("button", { name: "提示词" }).click();
    await expect(page.getByText("分镜提示词")).toBeVisible();
    await expect(page.getByText("subject_definitions:", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "故事板提示词" }).click();
    await expect(page.getByText("Create ONE cinematic storyboard sheet for an 8-second video segment.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("分镜提示词")).toBeHidden();
    await expect(page.getByRole("button", { name: "快速预览" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成成片" })).toBeVisible();
    await page.getByRole("button", { name: "视频创作台", exact: true }).click();
    await expect(page.getByTestId("director-program-monitor")).toBeVisible();
    await expect(page.getByRole("button", { name: "播放连续预览" })).toBeVisible();
    const programFrame = await page.getByTestId("director-program-frame").boundingBox();
    expect(programFrame).not.toBeNull();
    expect(programFrame!.width / programFrame!.height).toBeCloseTo(16 / 9, 1);
    expect(programFrame!.width).toBeLessThanOrEqual(801);
    const playButton = page.getByRole("button", { name: "播放连续预览" });
    await expect(playButton.locator("svg")).toBeVisible();
    await expect(playButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(playButton).toHaveCSS("color", "rgb(15, 23, 42)");
    await expect(page.getByRole("button", { name: "静音" }).locator("svg")).toBeVisible();
    await expect(page.getByRole("button", { name: "全屏播放" }).locator("svg")).toBeVisible();
    await expect(page.getByText("已有 1 段可播放", { exact: false })).toBeVisible();
    await expect(page.getByText("对白", { exact: true })).toBeVisible();
    await expect(page.getByText("模型原声", { exact: true })).toBeVisible();
    await expect(page.getByText("视频", { exact: true })).toBeVisible();
    await expect(page.getByTestId("director-playhead")).toBeVisible();
    const render = page.waitForRequest((request) => request.url().endsWith("/director/projects/director-e2e/renders") && request.method() === "POST");
    await page.getByRole("button", { name: "导出 MP4" }).click();
    await page.getByRole("button", { name: "仍然导出" }).click();
    await render;
    await expect(page.getByText("成片合成")).toBeVisible();
});

test("导演风格使用独立顶部工作区", async ({ page }) => {
    await mockApi(page, structuredClone(state));
    await page.goto("/__director-test.html");
    await page.getByRole("navigation", { name: "导演台功能" }).getByRole("button", { name: "风格", exact: true }).click();
    await expect(page.getByRole("button", { name: "风格", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("冷峻悬疑").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeVisible();
    await expect(page.locator(".ant-drawer-content")).toHaveCount(0);
    await page.getByRole("navigation", { name: "导演台功能" }).getByRole("button", { name: "素材", exact: true }).click();
    await expect(page.getByRole("button", { name: /风格.*冷峻悬疑/ })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "素材分类" })).toBeVisible();
});

test("总播放器切换到连续视频段后保持播放", async ({ page }) => {
    const directorState = structuredClone(state);
    directorState.videoSegments.push({
        ...structuredClone(directorState.videoSegments[0]),
        id: "segment-2",
        position: 1,
        title: "站台追逐",
        payload: { ...structuredClone(directorState.videoSegments[0].payload), videoFileId: "video-2" },
    });
    directorState.timeline.payload.segmentOrder = ["segment-1", "segment-2"];
    await page.addInitScript(() => {
        HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        HTMLMediaElement.prototype.pause = function () {};
    });
    await mockApi(page, directorState);
    await page.goto("/__director-test.html");
    await page.getByRole("button", { name: "视频创作台", exact: true }).click();
    await page.getByRole("button", { name: "播放连续预览" }).click();
    await expect(page.getByRole("button", { name: "暂停连续预览" })).toBeVisible();
    await expect(page.getByText(/当前片段 01\/2 · 车站全景/)).toBeVisible();
    await page.getByTestId("director-program-frame").locator("video").dispatchEvent("ended");
    await expect(page.getByText(/当前片段 02\/2 · 站台追逐/)).toBeVisible();
    await expect(page.getByRole("button", { name: "暂停连续预览" })).toBeVisible();
});
