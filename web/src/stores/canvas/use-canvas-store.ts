import { create, type StateCreator } from "zustand";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { ServerApiError, serverApi } from "@/services/api/server";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    kind: "canvas";
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodes: CanvasNodeData[];
    agentNodeNumbers?: Record<string, { kind: string; index: number }>; 
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    setHydrated: (hydrated: boolean) => void;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    applyServerProject: (project: CanvasProject) => boolean;
    resolveConflict: (id: string, strategy: "reload" | "overwrite") => Promise<void>;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "agentNodeNumbers" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
// Vite can reevaluate this module while React keeps the mounted canvas alive.
// Keep one store and one save queue across those module instances.
const hotData = import.meta.hot?.data;
const hotState = hotData?.canvasState as {
    store: ReturnType<typeof createCanvasStore>;
    saveTimers: Map<string, ReturnType<typeof setTimeout>>;
    pendingSaves: Map<string, Promise<void>>;
    savedProjects: Map<string, CanvasProject>;
    deferredProjects: Map<string, CanvasProject>;
    conflictedProjects: Set<string>;
} | undefined;
const saveTimers = hotState?.saveTimers ?? new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaves = hotState?.pendingSaves ?? new Map<string, Promise<void>>();
const savedProjects = hotState?.savedProjects ?? new Map<string, CanvasProject>();
const deferredProjects = hotState?.deferredProjects ?? new Map<string, CanvasProject>();
const conflictedProjects = hotState?.conflictedProjects ?? new Set<string>();
const editableFields = ["agentNodeNumbers", "title", "nodes", "connections", "chatSessions", "activeChatId", "backgroundMode", "showImageInfo", "viewport"] as const;
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const createCanvasState: StateCreator<CanvasStore> = (set, get) => ({
    hydrated: false,
    projects: [],
    setHydrated: (hydrated) => set({ hydrated }),
    createProject: (title = i18n.t("canvas.project.untitled")) => {
        const now = new Date().toISOString();
        const project: CanvasProject = {
            id: nanoid(),
            kind: "canvas",
            title,
            createdAt: now,
            updatedAt: now,
            revision: 1,
            nodes: [],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines",
            showImageInfo: false,
            viewport: initialViewport,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        trackProjectSave(project.id, serverApi.createProject(project as unknown as Record<string, unknown>).then((saved) => mergeSavedProject(saved as unknown as CanvasProject, project))).catch(reportServerError);
        return project.id;
    },
    importProject: (source) => {
        const now = new Date().toISOString();
        const project: CanvasProject = {
            id: nanoid(),
            kind: "canvas",
            title: source.title || i18n.t("canvas.project.imported"),
            createdAt: source.createdAt || now,
            updatedAt: now,
            revision: 1,
            nodes: source.nodes || [],
            agentNodeNumbers: source.agentNodeNumbers,
            connections: source.connections || [],
            chatSessions: source.chatSessions || [],
            activeChatId: source.activeChatId || null,
            backgroundMode: source.backgroundMode || "lines",
            showImageInfo: source.showImageInfo || false,
            viewport: source.viewport || initialViewport,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        trackProjectSave(project.id, serverApi.createProject(project as unknown as Record<string, unknown>).then((saved) => mergeSavedProject(saved as unknown as CanvasProject, project))).catch(reportServerError);
        return project.id;
    },
    openProject: (id) => get().projects.find((item) => item.id === id) || null,
    renameProject: (id, title) => {
        set((state) => ({ projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)) }));
        queueProjectSave(id);
    },
    deleteProjects: (ids) => {
        ids.forEach((id) => {
            const timer = saveTimers.get(id);
            if (timer) clearTimeout(timer);
            saveTimers.delete(id);
        });
        set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) }));
        void Promise.all(ids.map((id) => serverApi.deleteProject(id))).catch(reportServerError);
    },
    replaceProjects: (projects) => {
        savedProjects.clear();
        projects.forEach((project) => savedProjects.set(project.id, project));
        set({ projects });
    },
    applyServerProject: (project) => {
        if (project.kind !== "canvas") return false;
        const current = get().projects.find((item) => item.id === project.id);
        if (current && current.revision >= project.revision) return false;
        if (pendingSaves.has(project.id)) {
            const deferred = deferredProjects.get(project.id);
            if (!deferred || deferred.revision < project.revision) deferredProjects.set(project.id, project);
            return false;
        }
        return reconcileServerProject(project);
    },
    resolveConflict: async (id, strategy) => {
        conflictedProjects.add(id);
        clearProjectSaveTimer(id);
        await pendingSaves.get(id)?.catch(() => {});
        clearProjectSaveTimer(id);
        if (strategy === "reload") {
            const current = (await serverApi.project(id)) as unknown as CanvasProject;
            deferredProjects.delete(id);
            savedProjects.set(id, current);
            replaceSavedProject(current);
            conflictedProjects.delete(id);
            publishProjectUpdate(current);
            return;
        }
        const project = get().projects.find((item) => item.id === id);
        if (!project) return;
        await trackProjectSave(id, serverApi.updateProject(id, project as unknown as Record<string, unknown>, true)
            .then((saved) => mergeSavedProject(saved as unknown as CanvasProject, project)));
        conflictedProjects.delete(id);
        if (get().projects.find((item) => item.id === id) !== savedProjects.get(id)) queueProjectSave(id);
    },
    updateProject: (id, patch) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current || Object.entries(patch).every(([key, value]) => sameValue(current[key as keyof CanvasProject], value))) return;
        if (!savedProjects.has(id)) savedProjects.set(id, current);
        set((state) => ({ projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)) }));
        queueProjectSave(id);
    },
});

function createCanvasStore() {
    return create<CanvasStore>()(createCanvasState);
}

export const useCanvasStore = hotState?.store ?? createCanvasStore();
if (hotData) {
    if (hotState) {
        const { hydrated, projects, openProject } = useCanvasStore.getState();
        useCanvasStore.setState({ ...createCanvasState(useCanvasStore.setState, useCanvasStore.getState, useCanvasStore), hydrated, projects, openProject });
    }
    hotData.canvasState = { store: useCanvasStore, saveTimers, pendingSaves, savedProjects, deferredProjects, conflictedProjects };
}

export async function prepareProjectServerMutation(id: string) {
    if (!useCanvasStore.getState().openProject(id)) throw new Error("画布状态尚未加载，请刷新页面后重试");
    if (conflictedProjects.has(id)) throw new Error("画布存在尚未处理的版本冲突，请先选择重新加载或覆盖保存");
    await flushProjectSave(id);
}

function clearProjectSaveTimer(id: string) {
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.delete(id);
}

function trackProjectSave(id: string, save: Promise<void>) {
    const pending = save.finally(() => {
        if (pendingSaves.get(id) === pending) pendingSaves.delete(id);
        const deferred = deferredProjects.get(id);
        deferredProjects.delete(id);
        if (deferred && useCanvasStore.getState().applyServerProject(deferred)) {
            publishProjectUpdate(useCanvasStore.getState().openProject(id)!);
        }
    });
    pendingSaves.set(id, pending);
    return pending;
}

async function flushProjectSave(id: string): Promise<void> {
    // A later save must read the revision returned by the previous request.
    while (pendingSaves.has(id)) await pendingSaves.get(id);
    if (conflictedProjects.has(id) || !saveTimers.has(id)) return;
    clearProjectSaveTimer(id);
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (!project) return;
    await trackProjectSave(id, serverApi.updateProject(id, project as unknown as Record<string, unknown>)
        .then((saved) => mergeSavedProject(saved as unknown as CanvasProject, project)));
    if (saveTimers.has(id)) await flushProjectSave(id);
}

function queueProjectSave(id: string) {
    clearProjectSaveTimer(id);
    if (conflictedProjects.has(id)) return;
    saveTimers.set(id, setTimeout(() => {
        void flushProjectSave(id).catch((error) => {
            clearProjectSaveTimer(id);
            if (error instanceof ServerApiError && error.code === "PROJECT_CONFLICT") {
                const remote = (error.details as { current?: CanvasProject } | undefined)?.current;
                if (remote && reconcileServerProject(remote)) {
                    publishProjectUpdate(useCanvasStore.getState().openProject(id)!);
                    return;
                }
                reportProjectConflict(id);
                return;
            }
            reportServerError(error);
        });
    }, 500));
}

function replaceSavedProject(project: CanvasProject) {
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === project.id ? project : item)) }));
}

function mergeSavedProject(project: CanvasProject, submitted: CanvasProject) {
    savedProjects.set(project.id, project);
    const current = useCanvasStore.getState().projects.find((item) => item.id === project.id);
    if (!current || current === submitted) {
        replaceSavedProject(project);
        return;
    }
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === project.id ? { ...item, revision: project.revision } : item)) }));
    queueProjectSave(project.id);
}

function reportServerError(error: unknown) {
    window.dispatchEvent(new CustomEvent("infinite-canvas:server-error", { detail: error instanceof Error ? error.message : "服务保存失败" }));
}

function publishProjectUpdate(project: CanvasProject) {
    window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: project }));
}

function reportProjectConflict(id: string) {
    clearProjectSaveTimer(id);
    if (conflictedProjects.has(id)) return;
    conflictedProjects.add(id);
    window.dispatchEvent(new CustomEvent("infinite-canvas:project-conflict", { detail: { id } }));
}

function reconcileServerProject(remote: CanvasProject) {
    if (conflictedProjects.has(remote.id)) return false;
    const local = useCanvasStore.getState().openProject(remote.id);
    const base = savedProjects.get(remote.id);
    if (base && base.revision > remote.revision) remote = base;
    const merged = { ...remote };
    let dirty = false;
    if (local && (saveTimers.has(remote.id) || base && editableFields.some((key) => !sameValue(local[key], base[key])))) {
        if (!base) { reportProjectConflict(remote.id); return false; }
        for (const key of editableFields) {
            if (sameValue(local[key], base[key]) || sameValue(local[key], remote[key])) continue;
            if (!sameValue(remote[key], base[key])) { reportProjectConflict(remote.id); return false; }
            Object.assign(merged, { [key]: local[key] });
            dirty = true;
        }
    }
    savedProjects.set(remote.id, remote);
    clearProjectSaveTimer(remote.id);
    replaceSavedProject(dirty ? merged : remote);
    if (dirty) queueProjectSave(remote.id);
    return true;
}
