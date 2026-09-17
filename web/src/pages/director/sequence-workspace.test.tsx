import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { queryClient } from "@/lib/query-client";
import type { DirectorState } from "@/types/director";
import { SequenceWorkspace } from "./sequence-workspace";
import { ProductionWorkspace } from "./production-workspace";

const mocks = vi.hoisted(() => ({ version: 1, prepare: vi.fn(), error: vi.fn(), api: { segmentPlans: vi.fn(), previs: vi.fn(), previsRenders: vi.fn(), controlPrevisRender: vi.fn(), renderPrevis: vi.fn(), file: vi.fn(), referenceImage: vi.fn(), referenceVideo: vi.fn(), generateVideoSegment: vi.fn(), updateMarkdownFile: vi.fn(), state: vi.fn(), videoSegmentPreflight: vi.fn() } }));
vi.mock("antd", () => { const app = { message: { error: mocks.error, success: vi.fn() } }; return { App: { useApp: () => app } }; });
vi.mock("@/services/api/director", () => ({ directorApi: mocks.api }));
vi.mock("./use-director-sync", () => ({ useDirectorResourceVersion: () => mocks.version, directorMediaUrl: (id: string) => `/media/${id}` }));
vi.mock("@/stores/use-agent-store", () => ({ useAgentStore: (select: (state: unknown) => unknown) => select({ prepareComposer: mocks.prepare }) }));
vi.mock("@/stores/use-director-store", () => ({ useDirectorStore: Object.assign((select: (state: unknown) => unknown) => select({ data: {} }), { getState: () => ({ data: { project: { epochs: { segments: mocks.version, media: mocks.version } } } }) }) }));
vi.mock("./previs-viewport", () => ({ PrevisViewport: ({ time, onSelect }: { time: number; onSelect: (id: string) => void }) => <button aria-label="预演对象" data-time={time} onClick={() => onSelect("actor")}>三维视口</button> }));
vi.mock("@/components/workspace-image-preview-lightbox", () => ({ WorkspaceImagePreviewLightbox: () => null }));
const designs = ["a", "b"].map((id, order) => ({ id, name: `分镜段${id}`, sequenceId: "scene", order: order + 1, estimatedSeconds: 24, previsMode: "required", action: "交叉走位" }));
const state = { sequences: [{ id: "scene", title: "桥边相遇", position: 0 }], videoSegments: [2, 1].map((i) => ({ id: `task-${i}`, title: `制作${i}`, sequenceId: "scene", position: i, revision: 1, payload: { durationSeconds: 8, segmentId: i === 1 ? "a" : "b", referenceImages: [], videoReferences: [], videoFileId: `video-${i}`, videoInputSnapshot: { prompt: `实际提示${i}`, references: [{ fileId: `frozen-${i}`, kind: "image", label: `实际参考${i}` }] } } })) } as unknown as DirectorState;
const props = { projectId: "project", state, onRefresh: vi.fn(async () => {}) };
const previs = (id: string) => ({ segmentId: id, hash: `hash-${mocks.version}`, scene: { objects: [{ id: "actor", name: "蓝衣高个" }] }, plan: { duration: 24, shots: [{ id: "wide", name: "相遇", start: 0, end: 12 }, { id: "close", name: "递物", start: 12, end: 24 }], actions: [], dialogue: [] }, diagnostics: [], lookFrames: [], assetReferences: [{ objectIds: ["actor"], name: "蓝衣高个", status: "unbound" }], aspectRatio: "16:9", previsMode: "required" });
beforeEach(() => {
    queryClient.clear(); vi.clearAllMocks(); localStorage.clear(); mocks.version = 1;
    mocks.api.segmentPlans.mockResolvedValue({ items: designs, total: designs.length });
    mocks.api.previs.mockImplementation(async (_project, id) => previs(id));
    mocks.api.previsRenders.mockResolvedValue({ items: [] });
    mocks.api.file.mockResolvedValue({ content: "真实视频提示词", hash: "prompt-hash" });
    mocks.api.referenceImage.mockResolvedValue({ fileId: "ref", name: "蓝衣高个" });
    mocks.api.referenceVideo.mockResolvedValue({ fileId: "previs-video" });
    mocks.api.updateMarkdownFile.mockResolvedValue({ hash: "saved" });
    mocks.api.state.mockResolvedValue(state);
    mocks.api.videoSegmentPreflight.mockResolvedValue({ blockedReasons: [], warnings: [] });
});
afterEach(cleanup);

it("逐帧和定位后只插入分镜段引用，并带时刻及选中对象", async () => {
    render(<SequenceWorkspace {...props} />);
    await screen.findByRole("button", { name: "预演对象" });
    fireEvent.change(screen.getByLabelText("预演时间"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "前进一帧" }));
    fireEvent.click(screen.getByRole("button", { name: "预演对象" }));
    fireEvent.click(screen.getByRole("button", { name: "交给 Agent 修订" }));
    expect(mocks.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ entityKind: "segment-design", entityId: "a", timeSeconds: 6 + 1 / 24, objectId: "actor" }));
    expect(mocks.prepare.mock.calls[0][1].instruction).toBeUndefined();
    expect(screen.queryByText("故事板")).toBeNull();
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});

it("Agent 更新预演后保留分镜段与播放位置，刷新仍能恢复", async () => {
    const view = render(<SequenceWorkspace {...props} />);
    await screen.findByRole("button", { name: "预演对象" });
    fireEvent.click(screen.getByRole("button", { name: "选择分镜段 分镜段b" }));
    await waitFor(() => expect(mocks.api.previs).toHaveBeenCalledWith("project", "b"));
    fireEvent.change(screen.getByLabelText("预演时间"), { target: { value: "9" } });
    await queryClient.invalidateQueries({ queryKey: ["director", "project"], refetchType: "none" });
    mocks.version++; view.rerender(<SequenceWorkspace {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "预演对象" }).getAttribute("data-time")).toBe("9"));
    view.unmount(); render(<SequenceWorkspace {...props} />);
    await screen.findByRole("button", { name: "预演对象" });
    expect(screen.getByRole("button", { name: "选择分镜段 分镜段b" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("预演时间") as HTMLInputElement).value).toBe("9");
});

it("切段立即隔离旧预演，迟到请求不覆盖当前段", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.api.previs.mockImplementation((_project, id) => id === "a" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(previs(id)));
    render(<SequenceWorkspace {...props} />);
    await waitFor(() => expect(resolveOld).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "选择分镜段 分镜段b" }));
    await screen.findByRole("button", { name: "预演对象" });
    resolveOld({ ...previs("a"), plan: { ...previs("a").plan, duration: 99 } });
    await waitFor(() => expect(screen.getByLabelText("预演时间").getAttribute("max")).toBe("24"));
});

it("定妆帧标记定位时间并保留旧图待检查提示", async () => {
    mocks.api.previs.mockImplementation(async (_project, id) => ({ ...previs(id), lookFrames: [{ id: "look", time: 12, fileId: "look-file", sourceHash: "old", stale: true, useForVideo: false, prompt: "实际定妆提示", references: [] }] }));
    render(<SequenceWorkspace {...props} />);
    await screen.findByLabelText("定妆帧");
    fireEvent.click(screen.getByRole("button", { name: "00:12.00 · 定妆帧" }));
    expect((screen.getByLabelText("预演时间") as HTMLInputElement).value).toBe("12");
    expect(within(screen.getByLabelText("定妆帧")).getByText("待检查")).toBeTruthy();
    expect(screen.getByAltText("分镜段a 定妆帧").getAttribute("src")).toContain("look-file");
});

it("每段只显示一个视频，深链选择对应分镜段，实际输入不随草稿变化", async () => {
    render(<MemoryRouter initialEntries={["/studio?task=task-2"]}><ProductionWorkspace {...props} /></MemoryRouter>);
    const prompt = await screen.findByRole("textbox", { name: "最终视频提示词 制作2" });
    await waitFor(() => expect((prompt as HTMLTextAreaElement).value).toBe("真实视频提示词"));
    expect(screen.getAllByRole("article").map((node) => node.getAttribute("aria-label"))).toEqual(["制作任务 制作2"]);
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.change(prompt, { target: { value: "下次修改的提示" } });
    expect(screen.getByText("实际提示2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "预览生成" }));
    await waitFor(() => expect(mocks.api.generateVideoSegment).toHaveBeenCalledWith("task-2", 1, "preview"));
    expect(mocks.api.updateMarkdownFile).toHaveBeenCalledWith("project", "productions/task-2/video-prompt.md", "下次修改的提示", "prompt-hash");
});

it("切换分镜段保留提示草稿，空段不自动创建隐藏任务", async () => {
    render(<MemoryRouter><ProductionWorkspace {...props} state={{ ...state, videoSegments: state.videoSegments.filter((task) => task.id === "task-1") }} /></MemoryRouter>);
    const prompt = await screen.findByRole("textbox", { name: "最终视频提示词 制作1" });
    fireEvent.change(prompt, { target: { value: "尚未保存的提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "制作分镜段 分镜段b" }));
    expect(screen.getByText(/尚未准备生成提示词/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect((screen.getByRole("button", { name: "正片生成" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "制作分镜段 分镜段a" }));
    expect((screen.getByRole("textbox", { name: "最终视频提示词 制作1" }) as HTMLTextAreaElement).value).toBe("尚未保存的提示词");
    fireEvent.click(screen.getByRole("button", { name: "交给 Agent 修订" }));
    expect(mocks.prepare.mock.calls[0][1]).toMatchObject({ entityKind: "segment-design", entityId: "a", subtitle: "分镜段" });
    expect(mocks.prepare.mock.calls[0][1].instruction).toBeUndefined();
});

it("预检失败保留每个任务的问题，阻止提交", async () => {
    mocks.api.videoSegmentPreflight.mockResolvedValue({ blockedReasons: ["预演范围已变化，请重新导出"], warnings: [] });
    render(<MemoryRouter><ProductionWorkspace {...props} /></MemoryRouter>);
    const prompt = await screen.findByRole("textbox", { name: "最终视频提示词 制作1" });
    await waitFor(() => expect((prompt as HTMLTextAreaElement).value).toBe("真实视频提示词"));
    fireEvent.click(screen.getByRole("button", { name: "正片生成" }));
    await screen.findByText("预演范围已变化，请重新导出");
    expect(mocks.api.generateVideoSegment).not.toHaveBeenCalled();
});

it("本段引用素材区分待绑定和待生成，粗模仍可选中修订", async () => {
    mocks.api.previs.mockImplementation(async (_project, id) => ({ ...previs(id),
        scene: { objects: [{ id: "actor", name: "树皮分块", kind: "box" }] },
        assetReferences: [
            { objectIds: ["frog-1", "frog-2", "frog-3"], name: "青蛙", assetId: "frog", status: "ready", fileId: "frog-image" },
            { objectIds: ["owl"], name: "猫头鹰", status: "unbound" },
            { objectIds: ["tree"], name: "老杉树", assetId: "tree", status: "missing-image" },
        ],
    }));
    render(<SequenceWorkspace {...props} />);
    const references = await screen.findByLabelText("本段引用素材");
    expect(within(references).getAllByRole("button")).toHaveLength(3);
    expect(within(references).getAllByAltText("青蛙")).toHaveLength(1);
    expect(within(references).getByText("待绑定")).toBeTruthy();
    expect(within(references).getByText("待生成")).toBeTruthy();
    expect(within(references).queryByText("树皮分块")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预演对象" }));
    expect(screen.getByLabelText("当前预演对象").textContent).toContain("树皮分块 · 预演对象");
    expect(screen.getByLabelText("当前预演对象").textContent).not.toContain("待绑定");
    fireEvent.click(screen.getByRole("button", { name: "交给 Agent 修订" }));
    expect(mocks.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ objectId: "actor" }));
});


it.each([false, true])("预演只保留一个导出入口，隐藏取消与重复记录（旧版本：%s）", async (stale) => {
    const job = { segmentId: "a", kind: "video", sourceHash: stale ? "old" : "hash-1", progress: 1 };
    mocks.api.previsRenders.mockResolvedValue({ items: [
        { ...job, id: "cancelled", status: "cancelled" },
        { ...job, id: "latest", status: "succeeded", result: { fileId: "latest-video" } },
        { ...job, id: "older", status: "succeeded", result: { fileId: "older-video" } },
        { ...job, id: "frame", kind: "frame", status: "succeeded", result: { fileId: "frame-image" } },
    ] });
    render(<SequenceWorkspace {...props} />);
    const link = await screen.findByRole("link", { name: "查看导出视频" });
    expect(link.getAttribute("href")).toContain("latest-video");
    expect(screen.getAllByRole("link", { name: "查看导出视频" })).toHaveLength(1);
    expect(screen.queryByText("需重新导出") !== null).toBe(stale);
    expect(screen.queryByText("已取消")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
});

it.each(["running", "failed"])("当前导出 %s 保留操作与已有结果", async (status) => {
    const job = { segmentId: "a", kind: "video", sourceHash: "hash-1", progress: .4 };
    mocks.api.previsRenders.mockResolvedValue({ items: [
        { ...job, id: "current", status, error: "编码失败" },
        { ...job, id: "previous", status: "succeeded", result: { fileId: "previous-video" } },
    ] });
    render(<SequenceWorkspace {...props} />);
    await screen.findByText(status === "running" ? "正在导出 40%" : "导出失败：编码失败");
    expect(screen.getByRole("link", { name: "查看导出视频" }).getAttribute("href")).toContain("previous-video");
    fireEvent.click(screen.getByRole("button", { name: status === "running" ? "取消" : "重试" }));
    await waitFor(() => expect(mocks.api.controlPrevisRender).toHaveBeenCalledWith("project", "current", status === "running" ? "cancel" : "retry"));
});

it("旧版本导出失败时重试导出当前预演", async () => {
    mocks.api.previsRenders.mockResolvedValue({ items: [{ id: "failed", segmentId: "a", kind: "video", sourceHash: "old", status: "failed", error: "旧任务失败" }] });
    render(<SequenceWorkspace {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.api.renderPrevis).toHaveBeenCalledWith("project", "a", "hash-1"));
    expect(mocks.api.controlPrevisRender).not.toHaveBeenCalled();
});
