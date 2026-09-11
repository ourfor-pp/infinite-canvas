import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getDirectorStateProjection } from "./director.js";
import { ensureDirectorProjectWorkspace, reconcileDirectorProjectFiles } from "./director-workspace.js";
import { listCreativeAssets } from "./creative-assets.js";
import { listVisualStyles } from "./visual-styles.js";
import { generationResponse, type GenerationRow } from "./generation-service.js";
import { listDirectorRenders } from "./director-render.js";
import { directorGenerationProjectSql, directorResources, getDirectorSyncVersion } from "./director-sync.js";

const requestedResources = z.array(z.enum(directorResources)).min(1).max(directorResources.length);
export function getDirectorSyncSnapshot(userId: string, projectId: string, requested: unknown, refresh = false) {
    const resources = requestedResources.parse(requested);
    const project = db.prepare("SELECT id,kind,title,revision,created_at,updated_at FROM projects WHERE user_id=? AND id=? AND kind='director'").get(userId, projectId) as { id: string; kind: string; title: string; revision: number; created_at: string; updated_at: string } | undefined;
    if (!project) throw Object.assign(new Error("导演项目不存在或已删除"), { status: 404, code: "DIRECTOR_PROJECT_NOT_FOUND" });
    ensureDirectorProjectWorkspace(userId, projectId);
    if (refresh) reconcileDirectorProjectFiles(userId, projectId);
    const indexed = db.prepare("SELECT diagnostics FROM director_sync_versions WHERE user_id=? AND project_id=?").get(userId, projectId) as { diagnostics: string } | undefined;
    const diagnostics = parseJson<ReturnType<typeof reconcileDirectorProjectFiles>>(indexed?.diagnostics, []);
    // Reads are synchronous: no mutation can interleave with this projected snapshot.
    const state = getDirectorStateProjection(userId, projectId, resources);
    const currentProject = resources.includes("project") ? db.prepare("SELECT title,revision,updated_at FROM projects WHERE user_id=? AND id=?").get(userId, projectId) as { title: string; revision: number; updated_at: string } : undefined;
    const data = {
        state,
        ...(currentProject ? { project: { id: project.id, kind: project.kind, title: currentProject.title, revision: currentProject.revision, createdAt: project.created_at, updatedAt: currentProject.updated_at } } : {}),
        ...(resources.includes("assets") ? { assets: listCreativeAssets(userId, projectId) } : {}),
        ...(resources.includes("direction") ? { styles: listVisualStyles(userId, projectId) } : {}),
        ...(resources.includes("generations") ? { generations: (db.prepare(`SELECT * FROM generations WHERE user_id=? AND ${directorGenerationProjectSql}=? ORDER BY created_at DESC,id DESC LIMIT 100`).all(userId, projectId) as GenerationRow[]).map(generationResponse) } : {}),
        ...(resources.includes("renders") ? { renders: listDirectorRenders(userId, projectId) } : {}),
        ...(resources.includes("validation") ? { validation: { projectId, scope: ".", valid: !diagnostics.some((item) => item.severity === "error"), diagnostics } } : {}),
        ...(resources.includes("media") ? { mediaVersions: Object.fromEntries((db.prepare(`SELECT f.id, json_extract(f.metadata,'$.sha256') AS hash FROM stored_files f
            JOIN director_file_index i ON i.user_id=f.user_id AND i.project_id=? AND i.path=json_extract(f.metadata,'$.directorPath')
            WHERE f.user_id=? AND json_extract(f.metadata,'$.directorProjectId')=? AND (f.mime_type LIKE 'image/%' OR f.mime_type LIKE 'audio/%' OR f.mime_type LIKE 'video/%')`).all(projectId, userId, projectId) as Array<{ id: string; hash: string }>).map((row) => [row.id, row.hash])) } : {}),
    };
    return { projectId, version: getDirectorSyncVersion(userId, projectId), resources, data };
}
