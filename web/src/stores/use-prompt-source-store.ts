import { create } from "zustand";

import { DEFAULT_PROMPT_SOURCES, createPromptSource, type PromptSource } from "@/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 30,
    lastFetchedAt: "",
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440];

type PromptSourceStore = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    removeSource: (id: string) => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
    hydrateFromServer: (sources?: PromptSource[], schedule?: Partial<PromptSourceSchedule>) => void;
};

export const usePromptSourceStore = create<PromptSourceStore>()((set) => ({
            sources: DEFAULT_PROMPT_SOURCES,
            schedule: defaultSchedule,
            addSource: () => createPromptSource(),
            saveSource: (source) =>
                set((state) => {
                    return { sources: state.sources.some((item) => item.id === source.id)
                        ? state.sources.map((item) => (item.id === source.id && !item.builtIn ? createPromptSource(source) : item))
                        : [...state.sources, createPromptSource(source)] };
                }),
            removeSource: (id) => set((state) => {
                return { sources: state.sources.filter((item) => item.id !== id || item.builtIn) };
            }),
            toggleSource: (id, enabled) => set((state) => {
                return { sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) };
            }),
            updateSchedule: (key, value) => set((state) => {
                return { schedule: { ...state.schedule, [key]: value } };
            }),
            hydrateFromServer: (savedSources = [], savedSchedule = {}) => {
                const enabledById = new Map(savedSources.map((source) => [source.id, source.enabled]));
                const builtIn = DEFAULT_PROMPT_SOURCES.map((source) => ({ ...source, enabled: enabledById.get(source.id) ?? source.enabled }));
                const custom = savedSources.filter((source) => !source.builtIn).map((source) => createPromptSource(source));
                set({ sources: [...builtIn, ...custom], schedule: { ...defaultSchedule, ...savedSchedule } });
            },
        }));
