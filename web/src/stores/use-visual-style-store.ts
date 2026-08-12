import { create } from "zustand";

import { serverApi } from "@/services/api/server";
import type { VisualStyle, VisualStyleTemplate } from "@/types/visual-style";

type StyleEvent = VisualStyle | { id: string; projectId: string; deleted: true };
type VisualStyleStore = {
    styles: VisualStyle[];
    templates: VisualStyleTemplate[];
    load: (projectId: string) => Promise<void>;
    apply: (style: StyleEvent) => void;
    create: (projectId: string, input: Record<string, unknown>) => Promise<VisualStyle>;
    update: (id: string, patch: Record<string, unknown>) => Promise<VisualStyle>;
    remove: (id: string) => Promise<void>;
};

export const useVisualStyleStore = create<VisualStyleStore>((set, get) => ({
    styles: [],
    templates: [],
    load: async (projectId) => {
        const [styles, templates] = await Promise.all([serverApi.visualStyles(projectId), get().templates.length ? Promise.resolve(get().templates) : serverApi.visualStyleTemplates()]);
        set({ styles, templates });
    },
    apply: (style) => set((state) => "deleted" in style ? { styles: state.styles.filter((item) => item.id !== style.id) } : { styles: [style, ...state.styles.filter((item) => item.id !== style.id)] }),
    create: async (projectId, input) => { const style = await serverApi.createVisualStyle(projectId, input); get().apply(style); return style; },
    update: async (id, patch) => { const current = get().styles.find((item) => item.id === id); if (!current) throw new Error("视觉风格不存在"); const style = await serverApi.updateVisualStyle(id, { ...patch, revision: current.revision }); get().apply(style); return style; },
    remove: async (id) => { await serverApi.deleteVisualStyle(id); set((state) => ({ styles: state.styles.filter((item) => item.id !== id) })); },
}));
