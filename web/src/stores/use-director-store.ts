import { create } from "zustand";
import { nanoid } from "nanoid";
import { directorApi } from "@/services/api/director";
import type { DirectorProject, DirectorState } from "@/types/director";

type DirectorStore = {
    projects: DirectorProject[];
    states: Record<string, DirectorState>;
    loading: boolean;
    loadProjects: () => Promise<void>;
    createProject: (title: string) => Promise<DirectorProject>;
    deleteProject: (id: string) => Promise<void>;
    loadState: (id: string) => Promise<DirectorState>;
    applyState: (id: string, state: DirectorState) => void;
    mutateState: (id: string, mutation: (state: DirectorState) => DirectorState) => void;
};

export const useDirectorStore = create<DirectorStore>((set, get) => ({
    projects: [], states: {}, loading: false,
    loadProjects: async () => {
        set({ loading: true });
        try { set({ projects: await directorApi.projects() }); } finally { set({ loading: false }); }
    },
    createProject: async (title) => {
        const project = await directorApi.createProject(title, nanoid());
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
    },
    deleteProject: async (id) => {
        await directorApi.deleteProject(id);
        set((state) => ({ projects: state.projects.filter((item) => item.id !== id), states: Object.fromEntries(Object.entries(state.states).filter(([key]) => key !== id)) }));
    },
    loadState: async (id) => {
        const state = await directorApi.state(id);
        set((current) => ({ states: { ...current.states, [id]: state } }));
        return state;
    },
    applyState: (id, state) => set((current) => ({ states: { ...current.states, [id]: state } })),
    mutateState: (id, mutation) => set((current) => current.states[id] ? { states: { ...current.states, [id]: mutation(current.states[id]) } } : current),
}));
