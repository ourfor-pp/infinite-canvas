import { create } from "zustand";

import { serverApi, type CreativeAssetGenerationPreview, type ServerGeneration } from "@/services/api/server";
import type { CreativeAsset } from "@/types/creative-asset";

type CreativeAssetStore = {
    projectId: string;
    loading: boolean;
    assets: CreativeAsset[];
    activeGenerations: Record<string, Partial<Record<"image" | "audio", { id: string; status: ServerGeneration["status"]; progress: number }>>>;
    load: (projectId: string) => Promise<void>;
    apply: (asset: CreativeAsset | { id: string; projectId: string; deleted: true }) => void;
    applyGeneration: (generation: ServerGeneration) => void;
    update: (id: string, patch: Record<string, unknown>) => Promise<CreativeAsset>;
    remove: (id: string) => Promise<void>;
    place: (id: string, position?: { x?: number; y?: number }) => Promise<{ nodeId: string; projectId: string }>;
    generate: (id: string, input: Record<string, unknown>) => Promise<void>;
    previewGeneration: (id: string, input: Record<string, unknown>) => Promise<CreativeAssetGenerationPreview>;
    setPrimary: (id: string, variantId: string) => Promise<void>;
    reviewVariant: (id: string, variantId: string, accepted: boolean, setPrimary?: boolean) => Promise<void>;
};

export const useCreativeAssetStore = create<CreativeAssetStore>((set, get) => ({
    projectId: "",
    loading: false,
    assets: [],
    activeGenerations: {},
    load: async (projectId) => {
        const sameProject = get().projectId === projectId;
        set({ projectId, loading: true, assets: sameProject ? get().assets : [], activeGenerations: sameProject ? get().activeGenerations : {} });
        try {
            const [assets, generations] = await Promise.all([serverApi.creativeAssets(projectId), serverApi.generations()]);
            const activeGenerations: CreativeAssetStore["activeGenerations"] = {};
            generations.filter((generation) => ["queued", "running"].includes(generation.status)).forEach((generation) => {
                const target = (generation.request.params as { __creativeAsset?: { projectId?: string; assetId?: string } } | undefined)?.__creativeAsset;
                if (target?.projectId === projectId && target.assetId && (generation.kind === "image" || generation.kind === "audio")) activeGenerations[target.assetId] = { ...activeGenerations[target.assetId], [generation.kind]: { id: generation.id, status: generation.status, progress: generation.progress } };
            });
            if (get().projectId === projectId) set({ assets, activeGenerations });
        }
        finally { if (get().projectId === projectId) set({ loading: false }); }
    },
    apply: (asset) => set((state) => {
        if (asset.projectId !== state.projectId) return state;
        if ("deleted" in asset) return { assets: state.assets.filter((item) => item.id !== asset.id) };
        const exists = state.assets.some((item) => item.id === asset.id);
        return { assets: exists ? state.assets.map((item) => item.id === asset.id ? asset : item) : [asset, ...state.assets] };
    }),
    applyGeneration: (generation) => set((state) => {
        const target = (generation.request.params as { __creativeAsset?: { projectId?: string; assetId?: string } } | undefined)?.__creativeAsset;
        if (!target?.assetId || target.projectId !== state.projectId) return state;
        const activeGenerations = { ...state.activeGenerations };
        if (generation.kind !== "image" && generation.kind !== "audio") return state;
        const current = { ...activeGenerations[target.assetId] };
        if (["queued", "running"].includes(generation.status)) current[generation.kind] = { id: generation.id, status: generation.status, progress: generation.progress };
        else delete current[generation.kind];
        if (Object.keys(current).length) activeGenerations[target.assetId] = current;
        else delete activeGenerations[target.assetId];
        return { activeGenerations };
    }),
    update: async (id, patch) => {
        const current = get().assets.find((item) => item.id === id);
        if (!current) throw new Error("创作资产不存在");
        const updated = await serverApi.updateCreativeAsset(id, { ...patch, revision: current.revision });
        get().apply(updated);
        return updated;
    },
    remove: async (id) => { await serverApi.deleteCreativeAsset(id); set((state) => ({ assets: state.assets.filter((item) => item.id !== id) })); },
    place: (id, position) => serverApi.placeCreativeAsset(id, position || {}),
    generate: async (id, input) => {
        const current = get().assets.find((item) => item.id === id);
        if (!current) throw new Error("创作资产不存在");
        await serverApi.generateCreativeAsset(id, { ...input, revision: current.revision });
    },
    previewGeneration: async (id, input) => {
        const current = get().assets.find((item) => item.id === id);
        if (!current) throw new Error("创作资产不存在");
        return serverApi.previewCreativeAssetGeneration(id, { ...input, revision: current.revision });
    },
    setPrimary: async (id, variantId) => {
        const current = get().assets.find((item) => item.id === id);
        if (!current) throw new Error("创作资产不存在");
        get().apply(await serverApi.setCreativeAssetPrimary(id, variantId, current.revision));
    },
    reviewVariant: async (id, variantId, accepted, setPrimary) => {
        const current = get().assets.find((item) => item.id === id);
        if (!current) throw new Error("创作资产不存在");
        get().apply(await serverApi.reviewCreativeAssetVariant(id, variantId, { revision: current.revision, accepted, setPrimary }));
    },
}));
