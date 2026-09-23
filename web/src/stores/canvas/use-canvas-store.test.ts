import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serverApi, ServerApiError } from "@/services/api/server";
import { prepareProjectServerMutation, useCanvasStore, type CanvasProject } from "./use-canvas-store";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/api/server", () => ({ serverApi: { updateProject: vi.fn(), createProject: vi.fn(), project: vi.fn() }, ServerApiError: class extends Error { constructor(message: string, public code: string, public status: number, public details?: unknown) { super(message); } } }));

let project: CanvasProject;
let projectIndex = 0;
beforeEach(() => {
    vi.useFakeTimers();
    project = { id: `save-test-${++projectIndex}`, kind: "canvas", title: "测试", revision: 1, createdAt: "", updatedAt: "", nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
    useCanvasStore.getState().replaceProjects([project]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); });

it("慢保存期间连续编辑只串行提交，并使用上一笔返回的 revision", async () => {
    let finish!: (saved: CanvasProject) => void;
    vi.mocked(serverApi.updateProject).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 3 }));
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    await vi.advanceTimersByTimeAsync(500);
    useCanvasStore.getState().updateProject(project.id, { backgroundMode: "dots" });
    await vi.advanceTimersByTimeAsync(500);
    const callsBeforeFinish = vi.mocked(serverApi.updateProject).mock.calls.length;
    finish({ ...project, showImageInfo: true, revision: 2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(callsBeforeFinish).toBe(1);
    expect(serverApi.updateProject).toHaveBeenCalledTimes(2);
    expect(vi.mocked(serverApi.updateProject).mock.calls[1][1]).toMatchObject({ revision: 2, showImageInfo: true, backgroundMode: "dots" });
    expect(useCanvasStore.getState().openProject(project.id)?.revision).toBe(3);
});

it("节点服务端操作等待在途保存并提交后续编辑", async () => {
    let finish!: (saved: CanvasProject) => void;
    vi.mocked(serverApi.updateProject).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 3 }));
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    await vi.advanceTimersByTimeAsync(500);
    useCanvasStore.getState().updateProject(project.id, { backgroundMode: "dots" });
    const pending = prepareProjectServerMutation(project.id);
    await Promise.resolve();
    const callsBeforeFinish = vi.mocked(serverApi.updateProject).mock.calls.length;
    finish({ ...project, showImageInfo: true, revision: 2 });
    await pending;
    expect(callsBeforeFinish).toBe(1);
    expect(useCanvasStore.getState().openProject(project.id)).toMatchObject({ revision: 3, backgroundMode: "dots" });
});

it("同一毫秒的新修改不会被旧保存响应覆盖", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let finish!: (saved: CanvasProject) => void;
    vi.mocked(serverApi.updateProject).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 3 }));
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    const submitted = useCanvasStore.getState().openProject(project.id)!;
    const pending = prepareProjectServerMutation(project.id);
    useCanvasStore.getState().updateProject(project.id, { backgroundMode: "dots" });
    expect(useCanvasStore.getState().openProject(project.id)?.updatedAt).toBe(submitted.updatedAt);
    finish({ ...submitted, revision: 2 });
    await pending;
    expect(useCanvasStore.getState().openProject(project.id)).toMatchObject({ revision: 3, backgroundMode: "dots" });
});

it("新建请求完成后才保存编辑", async () => {
    let finish!: (saved: Record<string, unknown>) => void;
    vi.mocked(serverApi.createProject).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(serverApi.updateProject).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 2 }));
    const id = useCanvasStore.getState().createProject("新画布");
    useCanvasStore.getState().updateProject(id, { showImageInfo: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(serverApi.updateProject).not.toHaveBeenCalled();
    finish(vi.mocked(serverApi.createProject).mock.calls[0][0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(useCanvasStore.getState().openProject(id)).toMatchObject({ revision: 2, showImageInfo: true });
});

it("有未保存修改时仍报告真实远程冲突并保留本地内容", () => {
    const conflict = vi.fn();
    window.addEventListener("infinite-canvas:project-conflict", conflict);
    useCanvasStore.getState().renameProject(project.id, "本地改名");
    expect(useCanvasStore.getState().applyServerProject({ ...project, title: "远程改名", revision: 2 })).toBe(false);
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().openProject(project.id)?.title).toBe("本地改名");
    window.removeEventListener("infinite-canvas:project-conflict", conflict);
});

it("服务端内容重新显示不触发无变化保存", async () => {
    useCanvasStore.getState().updateProject(project.id, { nodes: [], connections: [], viewport: { ...project.viewport } });
    await vi.advanceTimersByTimeAsync(500);
    expect(serverApi.updateProject).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().applyServerProject({ ...project, title: "Agent 更新", revision: 2 })).toBe(true);
});

it("缩放尚未保存时接收 Agent 更新，保留两边修改", async () => {
    const viewport = { x: 10, y: 20, k: 2 };
    useCanvasStore.getState().updateProject(project.id, { viewport });
    expect(useCanvasStore.getState().applyServerProject({ ...project, title: "Agent 更新", revision: 2 })).toBe(true);
    expect(useCanvasStore.getState().openProject(project.id)).toMatchObject({ title: "Agent 更新", viewport, revision: 2 });
    vi.mocked(serverApi.updateProject).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 3 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(serverApi.updateProject).mock.calls[0][1]).toMatchObject({ title: "Agent 更新", viewport, revision: 2 });
});

it("保存途中先到的更新等待回包，不降低 revision 或覆盖后续编辑", async () => {
    let finish!: (saved: CanvasProject) => void;
    vi.mocked(serverApi.updateProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 4 }));
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    await vi.advanceTimersByTimeAsync(500);
    useCanvasStore.getState().updateProject(project.id, { viewport: { x: 10, y: 0, k: 1 } });
    expect(useCanvasStore.getState().applyServerProject({ ...project, showImageInfo: true, title: "Agent 更新", revision: 3 })).toBe(false);
    finish({ ...project, showImageInfo: true, revision: 2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(useCanvasStore.getState().openProject(project.id)).toMatchObject({ revision: 4, title: "Agent 更新", showImageInfo: true, viewport: { x: 10 } });
});

it("409 中不重叠的更新使用服务端版本重试，不强制覆盖", async () => {
    vi.mocked(serverApi.updateProject).mockRejectedValueOnce(new ServerApiError("冲突", "PROJECT_CONFLICT", 409, { current: { ...project, title: "Agent 更新", revision: 2 } })).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 3 }));
    useCanvasStore.getState().updateProject(project.id, { viewport: { x: 10, y: 0, k: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(serverApi.updateProject).mock.calls[1][1]).toMatchObject({ revision: 2, title: "Agent 更新", viewport: { x: 10 } });
    expect(vi.mocked(serverApi.updateProject).mock.calls[1][2]).toBeUndefined();
});

it("冲突期间暂停自动保存，重新加载通知画布更新后可继续编辑", async () => {
    const remote = { ...project, title: "远程改名", revision: 2 };
    useCanvasStore.getState().renameProject(project.id, "本地改名");
    expect(useCanvasStore.getState().applyServerProject(remote)).toBe(false);
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(serverApi.updateProject).not.toHaveBeenCalled();
    vi.mocked(serverApi.project).mockResolvedValueOnce(remote);
    const listener = vi.fn();
    window.addEventListener("infinite-canvas:project-updated", listener);
    await useCanvasStore.getState().resolveConflict(project.id, "reload");
    expect(listener.mock.calls[0][0].detail).toEqual(remote);
    window.removeEventListener("infinite-canvas:project-updated", listener);
    vi.mocked(serverApi.updateProject).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 3 }));
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(serverApi.updateProject).mock.calls[0][1]).toMatchObject({ title: "远程改名", revision: 2, showImageInfo: true });
});

it("真实 409 冲突只提示一次，不自动覆盖远程内容", async () => {
    vi.mocked(serverApi.updateProject).mockRejectedValueOnce(new ServerApiError("冲突", "PROJECT_CONFLICT", 409, { current: { ...project, title: "远程改名", revision: 2 } }));
    const conflict = vi.fn();
    window.addEventListener("infinite-canvas:project-conflict", conflict);
    useCanvasStore.getState().renameProject(project.id, "本地改名");
    await vi.advanceTimersByTimeAsync(500);
    useCanvasStore.getState().updateProject(project.id, { viewport: { x: 10, y: 0, k: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(serverApi.updateProject).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().openProject(project.id)?.title).toBe("本地改名");
    window.removeEventListener("infinite-canvas:project-conflict", conflict);
});

it("覆盖保存期间继续编辑也等待回包，再用新版本保存", async () => {
    useCanvasStore.getState().renameProject(project.id, "本地改名");
    useCanvasStore.getState().applyServerProject({ ...project, title: "远程改名", revision: 2 });
    let finish!: (saved: CanvasProject) => void;
    vi.mocked(serverApi.updateProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementationOnce(async (_id, value) => ({ ...value, revision: 4 }));
    const resolving = useCanvasStore.getState().resolveConflict(project.id, "overwrite");
    await Promise.resolve();
    useCanvasStore.getState().updateProject(project.id, { viewport: { x: 10, y: 0, k: 1 } });
    await vi.advanceTimersByTimeAsync(500);
    expect(serverApi.updateProject).toHaveBeenCalledTimes(1);
    finish({ ...project, title: "本地改名", revision: 3 });
    await resolving;
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(serverApi.updateProject).mock.calls[1][1]).toMatchObject({ revision: 3, viewport: { x: 10 } });
    expect(vi.mocked(serverApi.updateProject).mock.calls[1][2]).toBeUndefined();
});
