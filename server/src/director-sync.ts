import { db } from "./database.js";

export const directorResources = ["project", "sources", "story", "script", "direction", "assets", "segments", "timeline", "generations", "renders", "validation", "media"] as const;
export type DirectorResource = typeof directorResources[number];
export type DirectorProjectChanged = { type: "director.project.changed"; projectId: string; version: number; changes: Array<{ resource: DirectorResource }> };
const pending = new Map<string, { userId: string; projectId: string; resources: Set<DirectorResource>; timer: NodeJS.Timeout }>();
let emit: (userId: string, event: DirectorProjectChanged) => void = () => undefined;
export function setDirectorSyncEmitter(value: typeof emit) { emit = value; }
const key = (userId: string, projectId: string) => JSON.stringify([userId, projectId]);

// Mutations can originate inside a transaction. Publish and advance the sync version
// only after that transaction has committed; snapshot reads flush the same batch.
export function markDirectorProjectChanged(userId: string, projectId: string, resources: readonly DirectorResource[], deleted = false) {
    if (!resources.length || (!deleted && !db.prepare("SELECT 1 FROM projects WHERE user_id=? AND id=? AND kind='director'").get(userId, projectId))) return;
    const id = key(userId, projectId);
    const current = pending.get(id);
    if (current) { resources.forEach((resource) => current.resources.add(resource)); return; }
    const timer = setTimeout(() => flushDirectorChanges(userId, projectId), 100);
    timer.unref();
    pending.set(id, { userId, projectId, resources: new Set(resources), timer });
}

export function flushDirectorChanges(userId: string, projectId: string) {
    const id = key(userId, projectId);
    const entry = pending.get(id);
    if (!entry || !db.open || db.inTransaction) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    const row = db.prepare(`INSERT INTO director_sync_versions(user_id,project_id,version) VALUES(?,?,1)
        ON CONFLICT(user_id,project_id) DO UPDATE SET version=version+1 RETURNING version`).get(userId, projectId) as { version: number };
    emit(userId, { type: "director.project.changed", projectId, version: row.version, changes: directorResources.filter((resource) => entry.resources.has(resource)).map((resource) => ({ resource })) });
}

export function getDirectorSyncVersion(userId: string, projectId: string) {
    flushDirectorChanges(userId, projectId);
    return (db.prepare("SELECT version FROM director_sync_versions WHERE user_id=? AND project_id=?").get(userId, projectId) as { version: number } | undefined)?.version || 0;
}

export function directorResourcesForPaths(paths: readonly string[]): DirectorResource[] {
    const resources = new Set<DirectorResource>(["validation"]);
    for (const path of paths) {
        const root = path.split("/")[0];
        if (root === "project.yaml") resources.add("project");
        else if (root === "story") resources.add("story");
        else if (root === "screenplay") { resources.add("script"); resources.add("segments"); }
        else if (root === "direction") { resources.add("direction"); resources.add("segments"); }
        else if (root === "sources") resources.add("sources");
        else if (root === "assets") { resources.add("assets"); resources.add("segments"); }
        else if (root === "storyboards" || root === "videos") { resources.add("segments"); resources.add("timeline"); }
        else if (root === "timeline") resources.add("timeline");
        else if (root === "renders") resources.add("renders");
        else if (!["AGENTS.md", "README.md"].includes(path)) directorResources.forEach((resource) => resources.add(resource));
        if (/\.(png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3|m4a|aac)$/i.test(path)) resources.add("media");
    }
    return [...resources];
}

export const directorGenerationProjectSql = `COALESCE(${["__directorMusic", "__agentCanvas", "__creativeAsset", "__directorAssetTarget", "__directorShot", "__directorSegment", "__directorStoryboardSheet", "__directorStoryboardReview", "__directorCastReview"].map((name) => `NULLIF(json_extract(generations.request, '$.params.${name}.projectId'), '')`).join(",")},
    (SELECT project_id FROM creative_assets WHERE user_id=generations.user_id AND id=COALESCE(json_extract(generations.request,'$.params.__creativeAsset.assetId'),json_extract(generations.request,'$.params.__creativeAssetReview.assetId'),json_extract(generations.request,'$.params.__directorAssetTarget.assetId'))),
    (SELECT project_id FROM visual_styles WHERE user_id=generations.user_id AND id=COALESCE(json_extract(generations.request,'$.params.__visualStyle.id'),json_extract(generations.request,'$.params.__visualStyleBoard.styleId'),json_extract(generations.request,'$.params.__visualStyleAnalysis.styleId'))), '')`;
export function markDirectorGenerationChanged(userId: string, generationId: string) {
    const row = db.prepare(`SELECT ${directorGenerationProjectSql} AS projectId FROM generations WHERE user_id=? AND id=?`).get(userId, generationId) as { projectId: string } | undefined;
    if (row?.projectId) markDirectorProjectChanged(userId, row.projectId, ["generations"]);
}
