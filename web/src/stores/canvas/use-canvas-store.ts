import { create } from "zustand";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { ServerApiError, serverApi } from "@/services/api/server";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    defaultVisualStyleId: string | null;
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
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const serverMutationProjects = new Set<string>();

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
    hydrated: false,
    projects: [],
    setHydrated: (hydrated) => set({ hydrated }),
    createProject: (title = i18n.t("canvas.project.untitled")) => {
        const now = new Date().toISOString();
        const project: CanvasProject = {
            id: nanoid(),
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
            defaultVisualStyleId: null,
            viewport: initialViewport,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        void serverApi.createProject(project as unknown as Record<string, unknown>).then((saved) => mergeSavedProject(saved as unknown as CanvasProject, project.updatedAt)).catch(reportServerError);
        return project.id;
    },
    importProject: (source) => {
        const now = new Date().toISOString();
        const project: CanvasProject = {
            id: nanoid(),
            title: source.title || i18n.t("canvas.project.imported"),
            createdAt: source.createdAt || now,
            updatedAt: now,
            revision: 1,
            nodes: source.nodes || [],
            connections: source.connections || [],
            chatSessions: source.chatSessions || [],
            activeChatId: source.activeChatId || null,
            backgroundMode: source.backgroundMode || "lines",
            showImageInfo: source.showImageInfo || false,
            defaultVisualStyleId: source.defaultVisualStyleId || null,
            viewport: source.viewport || initialViewport,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        void serverApi.createProject(project as unknown as Record<string, unknown>).then((saved) => mergeSavedProject(saved as unknown as CanvasProject, project.updatedAt)).catch(reportServerError);
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
    replaceProjects: (projects) => set({ projects }),
    applyServerProject: (project) => {
        const current = get().projects.find((item) => item.id === project.id);
        if (current && current.revision >= project.revision) return false;
        if (serverMutationProjects.delete(project.id)) {
            replaceSavedProject(project);
            return true;
        }
        if (saveTimers.has(project.id)) {
            window.dispatchEvent(new CustomEvent("infinite-canvas:project-conflict", { detail: { id: project.id } }));
            return false;
        }
        replaceSavedProject(project);
        return true;
    },
    resolveConflict: async (id, strategy) => {
        if (strategy === "reload") {
            const current = (await serverApi.project(id)) as unknown as CanvasProject;
            replaceSavedProject(current);
            return;
        }
        const project = get().projects.find((item) => item.id === id);
        if (!project) return;
        replaceSavedProject((await serverApi.updateProject(id, project as unknown as Record<string, unknown>, true)) as unknown as CanvasProject);
    },
    updateProject: (id, patch) => {
        set((state) => ({ projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)) }));
        queueProjectSave(id);
    },
}));

export async function prepareProjectServerMutation(id: string) {
    const timer = saveTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        saveTimers.delete(id);
        const project = useCanvasStore.getState().projects.find((item) => item.id === id);
        if (project) replaceSavedProject((await serverApi.updateProject(id, project as unknown as Record<string, unknown>)) as unknown as CanvasProject);
    }
    serverMutationProjects.add(id);
    window.setTimeout(() => serverMutationProjects.delete(id), 5_000);
}

export function cancelProjectServerMutation(id: string) {
    serverMutationProjects.delete(id);
}

function queueProjectSave(id: string) {
    const current = saveTimers.get(id);
    if (current) clearTimeout(current);
    saveTimers.set(
        id,
        setTimeout(async () => {
            saveTimers.delete(id);
            const project = useCanvasStore.getState().projects.find((item) => item.id === id);
            if (!project) return;
            try {
                mergeSavedProject((await serverApi.updateProject(id, project as unknown as Record<string, unknown>)) as unknown as CanvasProject, project.updatedAt);
            } catch (error) {
                if (error instanceof ServerApiError && error.code === "PROJECT_CONFLICT") {
                    window.dispatchEvent(new CustomEvent("infinite-canvas:project-conflict", { detail: { id } }));
                    return;
                }
                reportServerError(error);
            }
        }, 500),
    );
}

function replaceSavedProject(project: CanvasProject) {
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === project.id ? project : item)) }));
}

function mergeSavedProject(project: CanvasProject, submittedUpdatedAt: string) {
    const current = useCanvasStore.getState().projects.find((item) => item.id === project.id);
    if (!current || current.updatedAt === submittedUpdatedAt) {
        replaceSavedProject(project);
        return;
    }
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === project.id ? { ...item, revision: project.revision } : item)) }));
    queueProjectSave(project.id);
}

function reportServerError(error: unknown) {
    window.dispatchEvent(new CustomEvent("infinite-canvas:server-error", { detail: error instanceof Error ? error.message : "服务保存失败" }));
}
