import { h3RuntimeCatalogSchema, type H3RuntimeCatalog } from "./h3-state-context.js";
import { z } from "zod";
import { config } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { db } from "./database.js";
import { COMFY_MODELS } from "./comfy-workflows.js";

const schema = z.object({
    url: z.string().trim().url().or(z.literal("")),
    token: z.string().trim(),
    stableAudio3LicenseAccepted: z.boolean().default(false),
});
export type MediaExecutorSettings = z.infer<typeof schema>;
export type MediaExecutorModel = { engine?: string; [key: string]: unknown };
export type MediaExecutorHealth = { h3Runtime?: H3RuntimeCatalog; h3PddRuntime?: H3RuntimeCatalog; available: boolean; models: Record<string, MediaExecutorModel>; runtimes: Record<string, boolean>; comfyFeatures: { temporalGuides: boolean; turboPreview: boolean; nativeState?: boolean; pddRef8?: boolean } };

const emptyCatalog = (): MediaExecutorHealth => ({ available: false, models: {}, runtimes: {}, comfyFeatures: { temporalGuides: false, turboPreview: false } });
let catalog: MediaExecutorHealth = emptyCatalog();

export function getMediaExecutorSettings(): MediaExecutorSettings {
    const row = db.prepare("SELECT encrypted_payload FROM media_executor_settings WHERE id=1").get() as { encrypted_payload: string } | undefined;
    if (row) return schema.parse(decryptJson(row.encrypted_payload, config.appSecret));
    return { url: config.mediaExecutorUrl, token: config.mediaExecutorToken, stableAudio3LicenseAccepted: config.stableAudio3LicenseAccepted };
}

export function saveMediaExecutorSettings(input: unknown) {
    const current = getMediaExecutorSettings();
    const value = schema.parse(input);
    const next = { ...value, token: value.token || current.token };
    db.prepare("INSERT INTO media_executor_settings(id,encrypted_payload,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at")
        .run(encryptJson(next, config.appSecret), new Date().toISOString());
    syncMediaExecutorComfyServer(next);
    catalog = emptyCatalog();
    return publicMediaExecutorSettings(next);
}

export function getMediaExecutorCatalog() {
    return catalog;
}

export function isMediaExecutorModelAvailable(id: string) {
    const model = catalog.models[id];
    return Boolean(model && (!model.engine || catalog.runtimes[model.engine]));
}

export async function refreshMediaExecutorCatalog(value = getMediaExecutorSettings()) {
    if (!value.url || !value.token) return catalog = emptyCatalog();
    try {
        const response = await fetch(`${value.url}/health`, { headers: { Authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(5000), redirect: "error" });
        if (!response.ok) return catalog = emptyCatalog();
        const health = await response.json() as Partial<MediaExecutorHealth>;
        const runtimes = health.runtimes && typeof health.runtimes === "object" ? health.runtimes : {};
        const models = Object.fromEntries(Object.entries(health.models && typeof health.models === "object" ? health.models : {}).filter(([, model]) => !model.engine || runtimes[model.engine]));
        const features = health.comfyFeatures && typeof health.comfyFeatures === "object" ? health.comfyFeatures : { temporalGuides: false, turboPreview: false };
        const h3Runtime = h3RuntimeCatalogSchema.safeParse(health.h3Runtime);
        const h3PddRuntime = h3RuntimeCatalogSchema.safeParse(health.h3PddRuntime);
        return catalog = { ...(h3Runtime.success && !h3Runtime.data.modelRevision.includes(":pdd-ref8:") ? { h3Runtime: h3Runtime.data } : {}), ...(h3PddRuntime.success && h3PddRuntime.data.modelRevision.includes(":pdd-ref8:") ? { h3PddRuntime: h3PddRuntime.data } : {}), available: true, models, runtimes, comfyFeatures: { temporalGuides: Boolean(features.temporalGuides), turboPreview: Boolean(features.turboPreview), nativeState: Boolean(features.nativeState), pddRef8: Boolean(features.pddRef8) } };
    } catch {
        return catalog = emptyCatalog();
    }
}

export function publicMediaExecutorSettings(value = getMediaExecutorSettings()) {
    return { url: value.url, tokenConfigured: Boolean(value.token), stableAudio3LicenseAccepted: value.stableAudio3LicenseAccepted };
}

export function syncMediaExecutorComfyServer(value = getMediaExecutorSettings()) {
    const now = new Date().toISOString();
    if (!value.url || !value.token) return;
    db.transaction(() => {
        db.prepare("DELETE FROM comfy_servers WHERE id='development'").run();
        db.prepare("INSERT INTO comfy_servers(id,name,encrypted_url,enabled,models,created_at,updated_at) VALUES('media-executor','本地媒体执行器',?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,encrypted_url=excluded.encrypted_url,enabled=1,models=excluded.models,updated_at=excluded.updated_at")
            .run(encryptJson({ url: `${value.url.replace(/\/+$/, "")}/v1/comfy` }, config.appSecret), JSON.stringify(COMFY_MODELS), now, now);
    })();
}
