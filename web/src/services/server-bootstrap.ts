import localforage from "localforage";
import { randomId } from "@/lib/utils";

import { serverApi, serverFileUrl, uploadServerFile, type ServerSession } from "@/services/api/server";
import { type AiConfig, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

const MIGRATION_MARKER = "infinite-canvas:server_migration_v1";
const LEGACY_CANVAS_KEY = "infinite-canvas:canvas_store";
const LEGACY_ASSET_KEY = "infinite-canvas:asset_store";
const LEGACY_PROMPT_KEY = "infinite-canvas:prompt_source_store_v2";
const legacyKeyValueStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });

type LegacyData = {
    projects: CanvasProject[];
    assets: Asset[];
    imageLogs: Array<Record<string, unknown>>;
    videoLogs: Array<Record<string, unknown>>;
    promptSources?: { sources: PromptSource[]; schedule: PromptSourceSchedule };
};

export async function bootstrapServerState() {
    const session = await serverApi.session();
    useUserStore.getState().setSession({ id: session.user.id, username: session.user.username, displayName: session.user.username, avatarUrl: "", isAdmin: session.user.isAdmin });
    const legacy = sessionIsEmpty(session) && !migrationCompleted(session.user.id) ? await readLegacyData() : null;
    if (legacy && hasLegacyData(legacy)) return { session, legacy };
    await hydrateFromServer();
    return { session, legacy: null };
}

export async function hydrateFromServer() {
    const [summaries, rawAssets, settings, models, modelDefaults, globalSettings] = await Promise.all([serverApi.projects("canvas"), serverApi.assets(), serverApi.settings(), serverApi.aiModels(), serverApi.aiModelDefaults(), serverApi.aiGlobalSettings()]);
    const projects = await Promise.all(summaries.map((project) => serverApi.project(String(project.id)))) as unknown as CanvasProject[];
    useCanvasStore.getState().replaceProjects(projects);
    useCanvasStore.getState().setHydrated(true);
    useAssetStore.getState().replaceAssets(rawAssets as unknown as Asset[]);
    useAssetStore.getState().setHydrated(true);
    const sourceSettings = globalSettings.promptSources as { sources?: PromptSource[]; schedule?: PromptSourceSchedule };
    useConfigStore.getState().hydrateFromServer({ ...(settings?.config as Partial<AiConfig> | undefined), ...globalSettings.config, imageEditModel: (settings?.config as Partial<AiConfig> | undefined)?.imageEditModel || globalSettings.imageEditModel });
    useConfigStore.getState().hydrateModels(models, modelDefaults, globalSettings.imageEditModel);
    usePromptSourceStore.getState().hydrateFromServer(sourceSettings?.sources, sourceSettings?.schedule);
}

export async function importLegacyData(source: LegacyData) {
    const storageKeys = collectStorageKeys(source);
    const mapping = new Map<string, string>();
    await runWithConcurrency(storageKeys, 3, async (storageKey) => {
        const blob = await readLegacyBlob(storageKey);
        if (!blob) throw new Error(`旧媒体文件缺失：${storageKey}`);
        const uploaded = await uploadServerFile(blob, legacyFileName(storageKey, blob.type));
        mapping.set(storageKey, uploaded.fileId);
    });
    const converted = replaceLegacyFiles(source, mapping) as LegacyData;
    await serverApi.importBrowser({
        importId: `browser-v1-${useUserStore.getState().user?.id || "user"}`,
        projects: converted.projects,
        assets: converted.assets,
        generations: [
            ...converted.imageLogs.map((record) => ({ ...record, kind: "image" })),
            ...converted.videoLogs.map((record) => ({ ...record, kind: "video" })),
        ],
        settings: { config: {}, promptSources: converted.promptSources || {} },
    });
    try {
        localStorage.setItem(migrationMarkerKey(), "1");
    } catch {
        // The server import remains idempotent even when localStorage is unavailable.
    }
    await hydrateFromServer();
}

export function markLegacyMigrationSkipped() {
    try {
        localStorage.setItem(migrationMarkerKey(), "1");
    } catch {
        // No local fallback is required.
    }
}

async function readLegacyData(): Promise<LegacyData | null> {
    const [canvas, assets, imageLogs, videoLogs] = await Promise.all([
        readLegacyZustand<{ projects?: CanvasProject[] }>(LEGACY_CANVAS_KEY),
        readLegacyZustand<{ assets?: Asset[] }>(LEGACY_ASSET_KEY),
        readStoreRecords("image_generation_logs"),
        readStoreRecords("video_generation_logs"),
    ]);
    const promptSources = readLocalZustand<{ sources?: PromptSource[]; schedule?: PromptSourceSchedule }>(LEGACY_PROMPT_KEY);
    return {
        projects: canvas?.projects || [],
        assets: assets?.assets || [],
        imageLogs,
        videoLogs,
        promptSources: promptSources?.sources && promptSources.schedule ? { sources: promptSources.sources, schedule: promptSources.schedule } : undefined,
    };
}

async function readLegacyZustand<T>(key: string) {
    const value = await legacyKeyValueStore.getItem<string>(key);
    if (!value) return null;
    try {
        return (JSON.parse(value) as { state?: T }).state || null;
    } catch {
        return null;
    }
}

function readLocalZustand<T>(key: string) {
    try {
        const value = localStorage.getItem(key);
        return value ? (JSON.parse(value) as { state?: T }).state || null : null;
    } catch {
        return null;
    }
}

async function readStoreRecords(storeName: string) {
    const store = localforage.createInstance({ name: "infinite-canvas", storeName });
    const records: Array<Record<string, unknown>> = [];
    await store.iterate<Record<string, unknown>, void>((value) => {
        if (value && typeof value === "object") records.push(value);
    });
    return records;
}

async function readLegacyBlob(storageKey: string) {
    if (storageKey.startsWith("data:")) return fetch(storageKey).then((response) => response.blob());
    const storeName = storageKey.startsWith("image:") ? "image_files" : "media_files";
    return localforage.createInstance({ name: "infinite-canvas", storeName }).getItem<Blob>(storageKey);
}

function collectStorageKeys(value: unknown, result = new Set<string>()) {
    if (!value || typeof value !== "object") return Array.from(result);
    const record = value as Record<string, unknown>;
    if (typeof record.storageKey === "string" && !record.storageKey.startsWith("server:")) result.add(record.storageKey);
    for (const key of ["dataUrl", "url", "coverUrl"] as const) {
        if (typeof record[key] === "string" && record[key].startsWith("data:")) result.add(record[key]);
    }
    Object.values(record).forEach((child) => {
        if (Array.isArray(child)) child.forEach((item) => collectStorageKeys(item, result));
        else collectStorageKeys(child, result);
    });
    return Array.from(result);
}

function replaceLegacyFiles(value: unknown, mapping: Map<string, string>): unknown {
    if (Array.isArray(value)) return value.map((item) => replaceLegacyFiles(item, mapping));
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(source).map(([key, child]) => [key, replaceLegacyFiles(child, mapping)]));
    const legacyKey = typeof source.storageKey === "string" ? source.storageKey : "";
    const inlineKey = [source.dataUrl, source.url, source.coverUrl].find((item) => typeof item === "string" && item.startsWith("data:")) as string | undefined;
    const fileId = mapping.get(legacyKey) || (inlineKey ? mapping.get(inlineKey) : undefined);
    if (!fileId) return result;
    const url = serverFileUrl(`server:${fileId}`);
    result.storageKey = `server:${fileId}`;
    if ("dataUrl" in result) result.dataUrl = url;
    if ("url" in result) result.url = url;
    if ("coverUrl" in result && typeof result.coverUrl === "string" && (result.coverUrl.startsWith("blob:") || result.coverUrl.startsWith("data:"))) result.coverUrl = url;
    return result;
}

function hasLegacyData(data: LegacyData) {
    return Boolean(data.projects.length || data.assets.length || data.imageLogs.length || data.videoLogs.length || data.promptSources);
}

function sessionIsEmpty(session: ServerSession) {
    return session.counts.projects + session.counts.assets + session.counts.generations + session.counts.settings === 0;
}

function migrationCompleted(userId: string) {
    try {
        return localStorage.getItem(migrationMarkerKey(userId)) === "1";
    } catch {
        return false;
    }
}

function migrationMarkerKey(userId = useUserStore.getState().user?.id || "user") {
    return `${MIGRATION_MARKER}:${window.location.origin}${import.meta.env.BASE_URL}:${userId}`;
}

function legacyFileName(storageKey: string, mimeType: string) {
    const name = storageKey.startsWith("data:") ? `inline-${randomId()}` : storageKey.replace(/[^a-z0-9-]/gi, "-").slice(0, 120);
    return `${name}.${mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin"}`;
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const item = items[index++];
            await task(item);
        }
    }));
}
