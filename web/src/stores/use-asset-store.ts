import { create } from "zustand";
import { nanoid } from "nanoid";

import { serverApi } from "@/services/api/server";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    setHydrated: (hydrated: boolean) => void;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    assets: [],
    setHydrated: (hydrated) => set({ hydrated }),
    addAsset: (asset) => {
        const now = new Date().toISOString();
        const next = { ...asset, id: nanoid(), createdAt: now, updatedAt: now } as Asset;
        set((state) => ({ assets: [next, ...state.assets] }));
        void serverApi.createAsset(next as unknown as Record<string, unknown>).catch(reportServerError);
        return next.id;
    },
    updateAsset: (id, patch) => {
        set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)) }));
        const current = saveTimers.get(id);
        if (current) clearTimeout(current);
        saveTimers.set(id, setTimeout(() => {
            saveTimers.delete(id);
            const asset = get().assets.find((item) => item.id === id);
            if (asset) void serverApi.updateAsset(id, asset as unknown as Record<string, unknown>).catch(reportServerError);
        }, 300));
    },
    removeAsset: (id) => {
        const timer = saveTimers.get(id);
        if (timer) clearTimeout(timer);
        saveTimers.delete(id);
        set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
        void serverApi.deleteAsset(id).catch(reportServerError);
    },
    replaceAssets: (assets) => set({ assets }),
    cleanupImages: () => undefined,
}));

function reportServerError(error: unknown) {
    window.dispatchEvent(new CustomEvent("infinite-canvas:server-error", { detail: error instanceof Error ? error.message : "素材保存失败" }));
}
