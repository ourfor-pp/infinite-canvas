import { queryClient } from "@/lib/query-client";
import { create } from "zustand";
import { nanoid } from "nanoid";
import { replaceEqualDeep } from "@tanstack/react-query";
import { directorApi } from "@/services/api/director";
import { DirectorSync } from "@/lib/director-sync";
import { DIRECTOR_RESOURCES, type DirectorProjectChanged, type DirectorResource, type DirectorSyncSnapshot } from "@/types/director-sync";
import type { DirectorProject, DirectorState } from "@/types/director";

export type DirectorProjectData = Omit<DirectorSyncSnapshot["data"], "state" | "project"> & { version: number; epochs: Partial<Record<DirectorResource, number>>; error?: string; deleted?: boolean; ready?: boolean };
type DirectorStore = {
    projects: DirectorProject[];
    states: Record<string, DirectorState>;
    data: Record<string, DirectorProjectData>;
    loading: boolean;
    loadProjects: () => Promise<void>;
    watchProjects: () => () => void;
    createProject: (title: string) => Promise<DirectorProject>;
    deleteProject: (id: string) => Promise<void>;
    loadState: (id: string) => Promise<DirectorState>;
    retainProject: (id: string, resources: readonly DirectorResource[]) => () => void;
    projectChanged: (event: DirectorProjectChanged) => void;
    reconnect: () => void;
    applyState: (id: string, state: DirectorState) => void;
    mutateState: (id: string, mutation: (state: DirectorState) => DirectorState) => void;
};
let projectListUsers = 0;
let projectListRequest: Promise<void> | undefined;
let projectListDirty = false;

export const useDirectorStore = create<DirectorStore>((set, get) => ({
    projects: [], states: {}, data: {}, loading: false,
    loadProjects: () => {
        projectListDirty = true;
        if (projectListRequest) return projectListRequest;
        set({ loading: !get().projects.length });
        projectListRequest = (async () => {
            do { projectListDirty = false; const projects = await directorApi.projects(); if (!projectListDirty) set((state) => ({ projects: replaceEqualDeep(state.projects, projects) })); } while (projectListDirty);
        })().finally(() => { projectListRequest = undefined; set({ loading: false }); });
        return projectListRequest;
    },
    watchProjects: () => { projectListUsers++; return () => { projectListUsers--; }; },
    createProject: async (title) => {
        const project = await directorApi.createProject(title, nanoid());
        set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)] }));
        return project;
    },
    deleteProject: async (id) => {
        await directorApi.deleteProject(id);
        set((state) => ({ projects: state.projects.filter((item) => item.id !== id), states: Object.fromEntries(Object.entries(state.states).filter(([key]) => key !== id)), data: { ...state.data, [id]: { version: state.data[id]?.version || 0, epochs: {}, deleted: true } } }));
    },
    loadState: async (id) => { await directorSync.refresh(id); return get().states[id]; },
    retainProject: (id, resources) => directorSync.retain(id, resources),
    projectChanged: (event) => {
        directorSync.changed(event);
        if (projectListUsers && event.changes.some((change) => change.resource === "project")) void get().loadProjects().catch(() => undefined);
    },
    reconnect: () => { directorSync.reconnect(); if (projectListUsers) void get().loadProjects().catch(() => undefined); },
    applyState: (id, state) => set((current) => ({ states: { ...current.states, [id]: replaceEqualDeep(current.states[id], state) } })),
    mutateState: (id, mutation) => set((current) => current.states[id] ? { states: { ...current.states, [id]: mutation(current.states[id]) } } : current),
}));

const stateFields: Partial<Record<DirectorResource, Array<keyof DirectorState>>> = {
    project: ["workspace", "activeStyleId"], direction: ["workspace", "activeStyleId"], sources: ["sources"], story: ["documents"], script: ["documents", "screenplayBreakdown"], segments: ["sequences", "videoSegments"], timeline: ["timeline"],
};
const dataFields = { assets: "assets", direction: "styles", generations: "generations", renders: "renders", validation: "validation", media: "mediaVersions" } as const;

export const directorSync = new DirectorSync({
    read: directorApi.sync,
    apply: (snapshot, resources) => { useDirectorStore.setState((current) => {
        if (!resources.length) return current;
        const id = snapshot.projectId;
        const previous = current.data[id] || { version: 0, epochs: {} };
        const data: DirectorProjectData = { ...previous, version: Math.max(previous.version, snapshot.version), error: undefined, deleted: false, epochs: { ...previous.epochs } };
        const nextState = { ...current.states[id] };
        for (const resource of resources) {
            data.epochs[resource] = (data.epochs[resource] || 0) + 1;
            for (const field of stateFields[resource] || []) {
                const value = snapshot.data.state[field];
                if (value === undefined) continue;
                if (field === "documents") {
                    const kind = resource === "story" ? "story" : "script";
                    nextState.documents = [...(nextState.documents || []).filter((document) => document.kind !== kind), ...snapshot.data.state.documents!.filter((document) => document.kind === kind)].sort((a, b) => a.kind.localeCompare(b.kind));
                } else Object.assign(nextState, { [field]: value });
            }
            const field = dataFields[resource as keyof typeof dataFields];
            if (field && snapshot.data[field] !== undefined) Object.assign(data, { [field]: replaceEqualDeep(previous[field], snapshot.data[field]) });
        }
        data.ready = DIRECTOR_RESOURCES.every((resource) => Boolean(data.epochs[resource]));
        const project = resources.includes("project") ? snapshot.data.project : undefined;
        return { data: { ...current.data, [id]: data }, states: { ...current.states, [id]: replaceEqualDeep(current.states[id], nextState) }, projects: project ? replaceEqualDeep(current.projects, [project, ...current.projects.filter((item) => item.id !== id)]) : current.projects };
    });
        const queries = new Set<DirectorResource>(resources);
        if (["assets", "direction", "segments", "sources"].some((resource) => queries.has(resource as DirectorResource))) queries.add("project");
        if (queries.has("segments")) { queries.add("assets"); queries.add("timeline"); }
        if (queries.has("media")) { queries.add("assets"); queries.add("segments"); queries.add("timeline"); }
        for (const resource of queries) void queryClient.invalidateQueries({ queryKey: ["director", snapshot.projectId, resource], refetchType: "none" });
    },
    failed: (id, error) => useDirectorStore.setState((current) => {
        const deleted = (error as { status?: number; code?: string })?.status === 404 || (error as { code?: string })?.code === "DIRECTOR_PROJECT_NOT_FOUND";
        return { data: { ...current.data, [id]: { ...(current.data[id] || { version: 0, epochs: {} }), deleted, error: error instanceof Error ? error.message : "项目同步失败，请重试" } }, ...(deleted ? { projects: current.projects.filter((item) => item.id !== id) } : {}) };
    }),
});
