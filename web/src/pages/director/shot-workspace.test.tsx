import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/query-client";
import { MemoryRouter } from "react-router-dom";
import type { DirectorState } from "@/types/director";
import { ShotWorkspace } from "./shot-workspace";
import { ProductionWorkspace } from "./production-workspace";
import { EditWorkspace } from "./edit-workspace";

const mocks = vi.hoisted(() => ({ version: 1, prepare: vi.fn(), error: vi.fn(), api: { referenceImage: vi.fn(), shotStoryboards: vi.fn(), shotDesigns: vi.fn(), file: vi.fn(), playbackPlan: vi.fn(), generateVideoSegment: vi.fn() } }));
vi.mock("antd", () => ({ App: { useApp: () => ({ message: { error: mocks.error, success: vi.fn() } }) } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/services/api/director", () => ({ directorApi: mocks.api }));
vi.mock("./use-director-sync", () => ({ useDirectorResourceVersion: () => mocks.version, directorMediaUrl: (id: string) => `/media/${id}` }));
vi.mock("@/stores/use-agent-store", () => ({ useAgentStore: (select: (state: unknown) => unknown) => select({ prepareComposer: mocks.prepare }) }));
vi.mock("@/stores/use-director-store", () => ({ useDirectorStore: Object.assign((select: (state: unknown) => unknown) => select({ data: {} }), { getState: () => ({ data: { project: { epochs: { segments: mocks.version, media: mocks.version } } } }) }) }));
vi.mock("@/components/workspace-image-preview-lightbox", () => ({ WorkspaceImagePreviewLightbox: ({ activeIndex, onClose }: { activeIndex: number | null; onClose: () => void }) => activeIndex === null ? null : <div role="dialog"><button onClick={onClose}>关闭预览</button></div> }));
const state = {
    sequences: [{ id: "scene", title: "端茶", position: 0 }],
    videoSegments: [1, 2].map((i) => ({ id: `task-${i}`, title: `端茶故事板 ${i}`, sequenceId: "scene", position: i, revision: 1, payload: { shotIds: [], durationSeconds: 8, storyboardSheet: { imageFileId: `board-${i}`, promptSnapshot: `第 ${i} 页提示词`, frames: [] } } })),
    timeline: { revision: 1, payload: { videoClips: [], tracks: [] } },
} as unknown as DirectorState;
const props = { projectId: "project", state, onRefresh: vi.fn(async () => {}) };
beforeEach(() => { queryClient.clear(); vi.clearAllMocks(); localStorage.clear(); mocks.version = 1; mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "端杯", sequenceId: "scene", order: 1 }], total: 1 }); mocks.api.shotStoryboards.mockImplementation(async (_project, shotId) => ({ shotId, total: 2, items: [1, 2].map((i) => ({ id: `shots/${shotId}/boards/${i}`, title: `新故事板 ${i}`, image: { fileId: `new-${shotId}-${i}`, hash: `hash-${mocks.version}` }, prompt: `第 ${i} 页提示词`, promptPath: `shots/${shotId}/boards/${i}/prompt.md`, references: [{ path: "assets/ref.png", name: "人物参考", fileId: "ref", hash: "ref-hash" }], errors: [] })) })); mocks.api.file.mockResolvedValue({ content: "真实视频提示词", hash: "hash" }); mocks.api.playbackPlan.mockRejectedValue(new Error("暂无素材")); });
afterEach(cleanup);

it("选中镜头直接展示整板，不显示故事板列表或翻页控件", async () => {
    const view = render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(screen.queryByRole("button", { name: "预览生成" })).toBeNull();
    expect(screen.queryByLabelText("故事板列表")).toBeNull();
    expect(screen.queryByRole("button", { name: "下一张故事板" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("新故事板 1");
    fireEvent.click(screen.getByRole("button", { name: "放大查看完整故事板" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(screen.getByText("第 1 页提示词")).toBeTruthy();
    view.unmount(); render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("新故事板 1");
});

it("故事板重绘只准备带当前页引用的 Agent 输入，不提交生成", async () => {
    render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    fireEvent.click(screen.getByRole("button", { name: "重绘故事板" }));
    expect(mocks.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ entityId: "shot-a", instruction: expect.stringContaining("不创建或提交视频生成") }));
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});

it("视频制作接收任务深链，切换剪辑再返回保留任务草稿", async () => {
    const view = render(<MemoryRouter initialEntries={["/studio?task=task-1"]}><EditWorkspace {...props} mode="production" /></MemoryRouter>);
    expect(screen.queryByRole("tablist", { name: "视频创作阶段" })).toBeNull();
    const name = await screen.findByRole("textbox", { name: "最终视频提示词" });
    fireEvent.change(name, { target: { value: "修改中的制作方案" } });
    expect(screen.getByRole("button", { name: "预览生成" })).toBeTruthy();
    view.rerender(<MemoryRouter><EditWorkspace {...props} mode="edit" /></MemoryRouter>);
    await screen.findByText("暂无素材");
    expect(screen.queryByRole("button", { name: "预览生成" })).toBeNull();
    view.rerender(<MemoryRouter><EditWorkspace {...props} mode="production" /></MemoryRouter>);
    expect((screen.getByRole("textbox", { name: "最终视频提示词" }) as HTMLInputElement).value).toBe("修改中的制作方案");
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});


it("镜头列表按场景切换关联故事板，未制作镜头不会显示其他镜头的板", async () => {
    const shots = [
        { id: "shot-a", sequenceId: "scene", order: 1, name: "端杯", action: "端起茶杯" },
        { id: "shot-b", sequenceId: "scene-b", order: 1, name: "听后停顿", action: "停住" },
        { id: "shot-c", sequenceId: "scene-b", order: 2, name: "尚未绘制" },
    ];
    mocks.api.shotDesigns.mockResolvedValue({ items: shots, total: shots.length });
    mocks.api.shotStoryboards.mockImplementation(async (_project, shotId) => ({ shotId, total: shotId === "shot-c" ? 0 : 1, items: shotId === "shot-c" ? [] : [{ id: shotId, title: `新板 ${shotId}`, image: { fileId: shotId, hash: "new" }, prompt: "新提示", references: [], errors: [] }] }));
    const next = { ...state, sequences: [...state.sequences, { id: "scene-b", title: "听话", position: 1 }], videoSegments: state.videoSegments.map((task, index) => ({ ...task, sequenceId: index ? "scene-b" : "scene", payload: { ...task.payload, shotIds: [index ? "shot-b" : "shot-a"] } })) } as DirectorState;
    render(<ShotWorkspace {...props} state={next} />);
    await screen.findByRole("button", { name: "选择镜头 听后停顿" });
    expect(screen.queryByRole("combobox", { name: "故事板场景" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "选择镜头 听后停顿" }));
    await screen.findByRole("heading", { name: "新板 shot-b" });
    expect(screen.queryByRole("button", { name: "故事板 1 端茶故事板 1" })).toBeNull();
    const sections = [...screen.getByLabelText("故事板工作区").children].map((node) => node.getAttribute("aria-label"));
    expect(sections).toEqual(["当前故事板", "引用素材", "故事板提示词"]);
    fireEvent.click(screen.getByRole("button", { name: "选择镜头 尚未绘制" }));
    expect(screen.getByText("当前镜头尚无故事板")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "放大查看完整故事板" })).toBeNull();
});


it("交给 Agent 修订只提及当前镜头，不附加指令或制作任务", async () => {
    mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "端杯", sequenceId: "scene", order: 1 }, { id: "shot-b", name: "停顿", sequenceId: "scene", order: 2 }], total: 2 });
    const next = { ...state, videoSegments: state.videoSegments.map((task) => ({ ...task, payload: { ...task.payload, shotIds: ["shot-a", "shot-b"] } })) };
    render(<ShotWorkspace {...props} state={next} />);
    await screen.findByRole("button", { name: "选择镜头 停顿" });
    fireEvent.click(screen.getByRole("button", { name: "选择镜头 停顿" }));
    fireEvent.click(screen.getByRole("button", { name: "交给 Agent 修订" }));
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("project", { kind: "director", projectId: "project", entityKind: "shot-design", entityId: "shot-b", title: "停顿", subtitle: "镜头" });
});


it("只显示镜头文件故事板及其提示和引用，同路径替换后随媒体事件更新缓存版本", async () => {
    const view = render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(screen.queryByText("端茶故事板 1")).toBeNull();
    expect(screen.getByAltText("新故事板 1").getAttribute("src")).toBe("/media/new-shot-a-1?hash=hash-1");
    expect(screen.getByText("第 1 页提示词")).toBeTruthy();
    expect(screen.getByAltText("人物参考").getAttribute("src")).toContain("/media/ref");
    await queryClient.invalidateQueries({ queryKey: ["director", "project"], refetchType: "none" });
    mocks.version = 2; view.rerender(<ShotWorkspace {...props} />);
    await waitFor(() => expect(screen.getByAltText("新故事板 1").getAttribute("src")).toContain("hash-2"));
});

it("切换镜头立即清除旧板，迟到的旧请求不覆盖当前镜头", async () => {
    mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "端杯", sequenceId: "scene", order: 1 }, { id: "shot-b", name: "停顿", sequenceId: "scene", order: 2 }], total: 2 });
    let resolveOld!: (result: unknown) => void;
    mocks.api.shotStoryboards.mockImplementation((_project, shotId) => shotId === "shot-a" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ shotId, total: 0, items: [] }));
    render(<ShotWorkspace {...props} />);
    await waitFor(() => expect(resolveOld).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "选择镜头 停顿" }));
    resolveOld({ shotId: "shot-a", total: 1, items: [{ id: "old", title: "迟到旧板", prompt: "", errors: [] }] });
    await waitFor(() => expect(mocks.api.shotStoryboards).toHaveBeenCalledWith("project", "shot-b", 0));
    expect(screen.queryByText("迟到旧板")).toBeNull();
    expect(screen.queryByRole("button", { name: "放大查看完整故事板" })).toBeNull();
});


it("视频制作右侧镜头导航，主区视频引用提示词依次排列且切换保留草稿", async () => {
    mocks.api.shotDesigns.mockResolvedValue({ items: ["a", "b", "c"].map((id, index) => ({ id: `shot-${id}`, name: `镜头${id}`, sequenceId: "scene", order: index, storyboardImage: id === "c" ? undefined : { fileId: `fresh-${id}`, path: `shots/${id}/storyboard.png`, hash: "fresh" } })), total: 3 });
    mocks.api.referenceImage.mockResolvedValue({ fileId: "ref" });
    const next = { ...state, videoSegments: state.videoSegments.map((task, index) => ({ ...task, payload: { ...task.payload, shotIds: [index ? "shot-b" : "shot-a"] } })) };
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    const prompt = await screen.findByRole("textbox", { name: "最终视频提示词" });
    expect(screen.queryByRole("combobox", { name: "当前制作任务" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "交给 Agent 修订" }));
    expect(mocks.prepare).toHaveBeenCalledWith("project", { kind: "director", projectId: "project", entityKind: "shot-design", entityId: "shot-a", title: "镜头a", subtitle: "镜头" });
    await waitFor(() => expect((prompt as HTMLTextAreaElement).value).toBe("真实视频提示词"));
    expect(within(screen.getByRole("region", { name: "视频预览" })).getByText("尚未生成视频")).toBeTruthy();
    expect(screen.queryByText("制作范围与参考设置")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建制作" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存并预检" })).toBeNull();
    expect(document.querySelector('img[src*="/media/board-"]')).toBeNull();
    fireEvent.change(prompt, { target: { value: "尚未保存的提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "制作镜头 镜头b" }));
    await screen.findByText("镜头b", { selector: "header span" });
    fireEvent.click(screen.getByRole("button", { name: "制作镜头 镜头a" }));
    expect((screen.getByRole("textbox", { name: "最终视频提示词" }) as HTMLTextAreaElement).value).toBe("尚未保存的提示词");
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "制作镜头 镜头c" }));
    expect(await screen.findByRole("textbox", { name: "最终视频提示词" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "视频预览" })).getByText("尚未生成视频")).toBeTruthy();
});

it("任务深链保留实际视频归属与待检查标记，不显示任务下拉", async () => {
    const shots = [{ id: "shot-a", name: "主镜头", sequenceId: "scene", order: 1 }];
    mocks.api.shotDesigns.mockResolvedValue({ items: shots, total: 1 });
    const next = { ...state, videoSegments: state.videoSegments.map((task) => ({ ...task, payload: { ...task.payload, shotIds: ["shot-a"], videoFileId: "existing-video", videoStale: true } })) };
    render(<MemoryRouter initialEntries={["/studio?task=task-2"]}><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    await screen.findByRole("textbox", { name: "最终视频提示词" });
    expect(screen.queryByText("来源变化，待检查")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "当前制作任务" })).toBeNull();
    expect(document.querySelector('video[src="/media/existing-video"]')).toBeTruthy();
});


it("生成前保存原位替换的当前故事板引用，预览正片分别传递实际质量参数", async () => {
    const latest = "storyboards/scene/shot-a/storyboard.png";
    mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "新镜头", sequenceId: "scene", order: 1, storyboardImage: { fileId: "fresh", path: latest, hash: "fresh" } }], total: 1 });
    mocks.api.referenceImage.mockImplementation(async (_project, path) => ({ fileId: path === latest ? "fresh" : "character" }));
    const task = { ...state.videoSegments[0], payload: { ...state.videoSegments[0].payload, shotIds: ["shot-a"], referenceImages: ["assets/character.png", "productions/task-1/storyboard.png", "assets/prop.png"] } };
    const next = { ...state, videoSegments: [task] };
    Object.assign(mocks.api, { updateVideoSegment: vi.fn(async () => task), updateMarkdownFile: vi.fn(async () => ({ hash: "saved" })), state: vi.fn(async () => next), videoSegmentPreflight: vi.fn(async () => ({ route: { reason: "已核对" }, blockedReasons: [], warnings: [] })) });
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "引用素材" });
    expect(screen.queryByRole("button", { name: "引用当前故事板" })).toBeNull();
    expect(screen.queryByText(/故事板引用已更新/)).toBeNull();
    const refs = screen.getByRole("region", { name: "引用素材" });
    expect(screen.getByLabelText("视频预览").compareDocumentPosition(refs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(refs.compareDocumentPosition(screen.getByLabelText("视频提示词")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await within(refs).findByAltText(latest);
    expect(within(refs).queryByAltText("productions/task-1/storyboard.png")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预览生成" }));
    await waitFor(() => expect((mocks.api as any).updateVideoSegment).toHaveBeenCalledWith("task-1", expect.objectContaining({ payload: expect.objectContaining({ referenceImages: ["assets/character.png", latest, "assets/prop.png"] }) })));
    await waitFor(() => expect(mocks.api.generateVideoSegment).toHaveBeenCalledWith("task-1", 1, "preview"));
    await waitFor(() => expect((screen.getByRole("button", { name: "正片生成" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "正片生成" }));
    await waitFor(() => expect(mocks.api.generateVideoSegment).toHaveBeenCalledWith("task-1", 1, "final"));
});


it("切回已看镜头立即复用缓存，收到资源变更后重新读取", async () => {
    mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "端杯", sequenceId: "scene", order: 1 }, { id: "shot-b", name: "停顿", sequenceId: "scene", order: 2 }], total: 2 });
    const view = render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    fireEvent.click(screen.getByRole("button", { name: "选择镜头 停顿" }));
    await waitFor(() => expect(screen.getByAltText("新故事板 1").getAttribute("src")).toContain("new-shot-b"));
    const count = mocks.api.shotStoryboards.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "选择镜头 端杯" }));
    expect(screen.getByAltText("新故事板 1").getAttribute("src")).toContain("new-shot-a");
    expect(mocks.api.shotStoryboards.mock.calls.length).toBe(count);
    await queryClient.invalidateQueries({ queryKey: ["director", "project"], refetchType: "none" });
    mocks.version++; view.rerender(<ShotWorkspace {...props} />);
    await waitFor(() => expect(screen.getByAltText("新故事板 1").getAttribute("src")).toContain("hash-2"));
    expect(mocks.api.shotStoryboards.mock.calls.length).toBe(count + 1);
});


it("分镜与视频制作之间往返共用镜头列表与故事板读取", async () => {
    const next = { ...props, state: { ...state, videoSegments: state.videoSegments.map((task) => ({ ...task, payload: { ...task.payload, shotIds: ["shot-a"], referenceImages: ["assets/ref.png"] } })) } };
    mocks.api.referenceImage.mockResolvedValue({ fileId: "ref" });
    let view = render(<ShotWorkspace {...next} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(mocks.api.shotDesigns).toHaveBeenCalledTimes(1);
    expect(mocks.api.shotStoryboards).toHaveBeenCalledTimes(1);
    view.unmount();
    view = render(<MemoryRouter><ProductionWorkspace {...next} /></MemoryRouter>);
    await screen.findByRole("button", { name: "制作镜头 端杯" });
    await screen.findByAltText("assets/ref.png");
    const fileReads = mocks.api.file.mock.calls.length;
    expect(mocks.api.shotDesigns).toHaveBeenCalledTimes(1);
    expect(mocks.api.referenceImage).toHaveBeenCalledTimes(1);
    view.unmount();
    view = render(<ShotWorkspace {...next} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(mocks.api.shotDesigns).toHaveBeenCalledTimes(1);
    expect(mocks.api.shotStoryboards).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<MemoryRouter><ProductionWorkspace {...next} /></MemoryRouter>);
    await screen.findByAltText("assets/ref.png");
    expect(mocks.api.file.mock.calls.length).toBe(fileReads);
    expect(mocks.api.referenceImage).toHaveBeenCalledTimes(1);

});


it("参考图展示素材中文名，路径保留在悬停提示", async () => {
    mocks.api.referenceImage.mockResolvedValue({ fileId: "character", name: "孙悟空" });
    const next = { ...state, videoSegments: [{ ...state.videoSegments[0], payload: { ...state.videoSegments[0].payload, shotIds: ["shot-a"], referenceImages: ["assets/characters/monkey/identity/primary.png"] } }] };
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    const image = await screen.findByAltText("孙悟空");
    expect(screen.getByText("孙悟空")).toBeTruthy();
    expect(image.closest('[title]')?.getAttribute("title")).toBe("assets/characters/monkey/identity/primary.png");
    expect(screen.queryByText("identity/primary.png")).toBeNull();
    expect(image.closest("a")).toBeNull();
    fireEvent.click(image);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(screen.queryByRole("dialog")).toBeNull();
});

it("预检阻止时保留问题信息且不提交视频生成", async () => {
    const task = { ...state.videoSegments[0], payload: { ...state.videoSegments[0].payload, shotIds: ["shot-a"] } };
    const next = { ...state, videoSegments: [task] };
    Object.assign(mocks.api, { updateVideoSegment: vi.fn(async () => task), updateMarkdownFile: vi.fn(async () => ({ hash: "saved" })), state: vi.fn(async () => next), videoSegmentPreflight: vi.fn(async () => ({ route: { reason: "" }, blockedReasons: ["缺少必需参考"], warnings: [] })) });
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "最终视频提示词" }) as HTMLTextAreaElement).value).toBe("真实视频提示词"));
    fireEvent.click(screen.getByRole("button", { name: "正片生成" }));
    await screen.findByText("缺少必需参考");
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});
