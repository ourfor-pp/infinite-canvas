import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { DirectorState } from "@/types/director";
import { ShotWorkspace } from "./shot-workspace";
import { ProductionWorkspace } from "./production-workspace";
import { EditWorkspace } from "./edit-workspace";

const mocks = vi.hoisted(() => ({ version: 1, prepare: vi.fn(), error: vi.fn(), api: { referenceImage: vi.fn(), shotStoryboards: vi.fn(), shotDesigns: vi.fn(), file: vi.fn(), playbackPlan: vi.fn(), generateVideoSegment: vi.fn() } }));
vi.mock("antd", () => ({ App: { useApp: () => ({ message: { error: mocks.error } }) } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/services/api/director", () => ({ directorApi: mocks.api }));
vi.mock("./use-director-sync", () => ({ useDirectorResourceVersion: () => mocks.version, directorMediaUrl: (id: string) => `/media/${id}` }));
vi.mock("@/stores/use-agent-store", () => ({ useAgentStore: (select: (state: unknown) => unknown) => select({ prepareComposer: mocks.prepare }) }));
vi.mock("@/stores/use-director-store", () => ({ useDirectorStore: (select: (state: unknown) => unknown) => select({ data: {} }) }));
vi.mock("@/components/workspace-image-preview-lightbox", () => ({ WorkspaceImagePreviewLightbox: ({ activeIndex, onClose }: { activeIndex: number | null; onClose: () => void }) => activeIndex === null ? null : <div role="dialog"><button onClick={onClose}>关闭预览</button></div> }));
const state = {
    sequences: [{ id: "scene", title: "端茶", position: 0 }],
    videoSegments: [1, 2].map((i) => ({ id: `task-${i}`, title: `端茶故事板 ${i}`, sequenceId: "scene", position: i, revision: 1, payload: { shotIds: [], durationSeconds: 8, storyboardSheet: { imageFileId: `board-${i}`, promptSnapshot: `第 ${i} 页提示词`, frames: [] } } })),
    timeline: { revision: 1, payload: { videoClips: [], tracks: [] } },
} as unknown as DirectorState;
const props = { projectId: "project", state, onRefresh: vi.fn(async () => {}) };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.version = 1; mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "端杯", sequenceId: "scene", order: 1 }], total: 1 }); mocks.api.shotStoryboards.mockImplementation(async (_project, shotId) => ({ shotId, total: 2, items: [1, 2].map((i) => ({ id: `shots/${shotId}/boards/${i}`, title: `新故事板 ${i}`, image: { fileId: `new-${shotId}-${i}`, hash: `hash-${mocks.version}` }, prompt: `第 ${i} 页提示词`, promptPath: `shots/${shotId}/boards/${i}/prompt.md`, references: [{ path: "assets/ref.png", name: "人物参考", fileId: "ref", hash: "ref-hash" }], errors: [] })) })); mocks.api.file.mockResolvedValue({ content: "真实视频提示词", hash: "hash" }); mocks.api.playbackPlan.mockRejectedValue(new Error("暂无素材")); });
afterEach(cleanup);

it("同场景多张故事板整体预览，翻页后恢复选择，分镜不提供视频生成", async () => {
    const view = render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(screen.queryByRole("button", { name: "生成预览" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一张故事板" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("新故事板 2");
    fireEvent.click(screen.getByRole("button", { name: "放大查看完整故事板" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(screen.getByText("第 2 页提示词")).toBeTruthy();
    view.unmount(); render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("新故事板 2");
});

it("故事板重绘只准备带当前页引用的 Agent 输入，不提交生成", async () => {
    render(<ShotWorkspace {...props} />);
    await screen.findByRole("button", { name: "重绘故事板" });
    fireEvent.click(screen.getByRole("button", { name: "重绘故事板" }));
    expect(mocks.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ entityId: "shot-a", instruction: expect.stringContaining("不创建或提交视频生成") }));
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});

it("视频制作接收任务深链，切换剪辑再返回保留任务草稿", async () => {
    render(<MemoryRouter initialEntries={["/studio?task=task-1"]}><EditWorkspace {...props} /></MemoryRouter>);
    const name = await screen.findByRole("textbox", { name: "任务名称" });
    fireEvent.change(name, { target: { value: "修改中的制作方案" } });
    expect(screen.getByRole("button", { name: "生成预览" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "剪辑成片" }));
    await screen.findByText("暂无素材");
    expect(screen.queryByRole("button", { name: "生成预览" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "视频制作" }));
    expect((screen.getByRole("textbox", { name: "任务名称" }) as HTMLInputElement).value).toBe("修改中的制作方案");
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
    expect(sections).toEqual(["故事板列表", "当前故事板", "引用素材", "故事板提示词"]);
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


it("视频制作上方预览与提示词、下方镜头导航，最新故事板替代旧任务封面且切换保留草稿", async () => {
    mocks.api.shotDesigns.mockResolvedValue({ items: ["a", "b", "c"].map((id, index) => ({ id: `shot-${id}`, name: `镜头${id}`, sequenceId: "scene", order: index, storyboardImage: id === "c" ? undefined : { fileId: `fresh-${id}`, path: `shots/${id}/storyboard.png`, hash: "fresh" } })), total: 3 });
    mocks.api.referenceImage.mockResolvedValue({ fileId: "ref" });
    const next = { ...state, videoSegments: state.videoSegments.map((task, index) => ({ ...task, payload: { ...task.payload, shotIds: [index ? "shot-b" : "shot-a"] } })) };
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    const prompt = await screen.findByRole("textbox", { name: "最终视频提示词" });
    await waitFor(() => expect((prompt as HTMLTextAreaElement).value).toBe("真实视频提示词"));
    expect(screen.getByAltText("镜头a 最新故事板").getAttribute("src")).toContain("fresh-a");
    expect(document.querySelector('img[src*="/media/board-"]')).toBeNull();
    fireEvent.change(prompt, { target: { value: "尚未保存的提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "引用当前故事板" }));
    fireEvent.click(screen.getByRole("button", { name: "制作镜头 镜头b" }));
    await screen.findByAltText("镜头b 最新故事板");
    fireEvent.click(screen.getByRole("button", { name: "制作镜头 镜头a" }));
    expect((screen.getByRole("textbox", { name: "最终视频提示词" }) as HTMLTextAreaElement).value).toBe("尚未保存的提示词");
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "制作镜头 镜头c" }));
    expect(screen.getByText("当前镜头尚未安排视频制作")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "最终视频提示词" })).toBeNull();
});

it("一镜多任务可切换，旧视频保留待检查标记", async () => {
    const shots = [{ id: "shot-a", name: "主镜头", sequenceId: "scene", order: 1 }];
    mocks.api.shotDesigns.mockResolvedValue({ items: shots, total: 1 });
    const next = { ...state, videoSegments: state.videoSegments.map((task) => ({ ...task, payload: { ...task.payload, shotIds: ["shot-a"], videoFileId: "existing-video", videoStale: true } })) };
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    await screen.findByText("来源变化，待检查");
    const picker = screen.getByRole("combobox", { name: "当前制作任务" });
    fireEvent.change(picker, { target: { value: "task-2" } });
    await waitFor(() => expect((screen.getByRole("textbox", { name: "任务名称" }) as HTMLInputElement).value).toBe("端茶故事板 2"));
    expect(document.querySelector('video[src="/media/existing-video"]')).toBeTruthy();
});


it("生成参考位于视频左栏，旧任务故事板被最新镜头板原位替换，保存提交同一列表", async () => {
    const latest = "storyboards/scene/shot-a/storyboard.png";
    mocks.api.shotDesigns.mockResolvedValue({ items: [{ id: "shot-a", name: "新镜头", sequenceId: "scene", order: 1, storyboardImage: { fileId: "fresh", path: latest, hash: "fresh" } }], total: 1 });
    mocks.api.referenceImage.mockImplementation(async (_project, path) => ({ fileId: path === latest ? "fresh" : "character" }));
    const task = { ...state.videoSegments[0], payload: { ...state.videoSegments[0].payload, shotIds: ["shot-a"], referenceImages: ["assets/character.png", "productions/task-1/storyboard.png", "assets/prop.png"] } };
    const next = { ...state, videoSegments: [task] };
    Object.assign(mocks.api, { updateVideoSegment: vi.fn(async () => task), updateMarkdownFile: vi.fn(async () => ({ hash: "saved" })), state: vi.fn(async () => next), videoSegmentPreflight: vi.fn(async () => ({ route: { reason: "已核对" }, blockedReasons: [], warnings: [] })) });
    render(<MemoryRouter><ProductionWorkspace {...props} state={next} /></MemoryRouter>);
    await screen.findByText(/故事板引用已更新为当前镜头版本/);
    const refs = within(screen.getByLabelText("视频预览")).getByRole("region", { name: "本次生成参考" });
    await within(refs).findByAltText(latest);
    expect(within(refs).queryByAltText("productions/task-1/storyboard.png")).toBeNull();
    expect(screen.getByLabelText("视频提示词与设置").contains(refs)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存并预检" }));
    await waitFor(() => expect((mocks.api as any).updateVideoSegment).toHaveBeenCalledWith("task-1", expect.objectContaining({ payload: expect.objectContaining({ referenceImages: ["assets/character.png", latest, "assets/prop.png"] }) })));
    await screen.findByText("预检通过，可以生成。");
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});
