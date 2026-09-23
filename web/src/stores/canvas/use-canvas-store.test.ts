import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serverApi } from "@/services/api/server";
import { prepareProjectServerMutation, cancelProjectServerMutation, useCanvasStore, type CanvasProject } from "./use-canvas-store";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/api/server", () => ({ serverApi: { updateProject: vi.fn(), createProject: vi.fn() }, ServerApiError: class extends Error {} }));

let project: CanvasProject;
beforeEach(() => {
    vi.useFakeTimers();
    project = { id: "save-test", kind: "canvas", title: "测试", revision: 1, createdAt: "", updatedAt: "", nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
    useCanvasStore.setState({ projects: [project] });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); cancelProjectServerMutation(project.id); });

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
    useCanvasStore.getState().updateProject(project.id, { showImageInfo: true });
    expect(useCanvasStore.getState().applyServerProject({ ...project, revision: 2 })).toBe(false);
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().openProject(project.id)?.showImageInfo).toBe(true);
    window.removeEventListener("infinite-canvas:project-conflict", conflict);
});
