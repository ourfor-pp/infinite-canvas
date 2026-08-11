import { db, parseJson } from "../database.js";
import { syncFileRefs } from "../file-store.js";
import type { GenerationRow } from "../generation-service.js";
import { publishAgentProject } from "./project-events.js";

type ProjectRow = { id: string; user_id: string; payload: string; revision: number };
type ProjectPayload = Record<string, unknown> & { id: string; nodes: Array<{ id: string; metadata?: Record<string, unknown> }> };

export function syncAgentGenerationCanvas(row: GenerationRow) {
    const request = parseJson<{ params?: { __agentCanvas?: { projectId?: string; nodeId?: string | null } | null } }>(row.request, {});
    const context = request.params?.__agentCanvas;
    if (!context?.projectId || !context.nodeId) return;
    const result = parseJson<{ text?: string; files?: Array<{ id?: string; fileId?: string; url?: string; mimeType?: string; bytes?: number }> } | null>(row.result, null);
    const updated = db.transaction(() => {
        const project = db.prepare("SELECT id, user_id, payload, revision FROM projects WHERE id=? AND user_id=?").get(context.projectId, row.user_id) as ProjectRow | undefined;
        if (!project) return null;
        const payload = parseJson<ProjectPayload>(project.payload, { id: project.id, nodes: [] });
        const node = payload.nodes.find((item) => item.id === context.nodeId);
        if (!node) return null;
        const prior = node.metadata || {};
        if (prior.agentGenerationId === row.id && prior.agentGenerationStatus === row.status && !["succeeded", "failed", "canceled"].includes(row.status)) return null;
        const file = result?.files?.[0];
        node.metadata = {
            ...prior,
            agentGenerationId: row.id,
            agentGenerationStatus: row.status,
            status: row.status === "succeeded" ? "success" : row.status === "failed" || row.status === "canceled" ? "error" : "loading",
            errorDetails: row.error || undefined,
            ...(result?.text ? { content: result.text } : {}),
            ...(file ? { content: file.url, storageKey: `server:${file.id || file.fileId}`, mimeType: file.mimeType, bytes: file.bytes } : {}),
        };
        const revision = project.revision + 1;
        const now = new Date().toISOString();
        const saved = db.prepare("UPDATE projects SET payload=?, revision=?, updated_at=? WHERE id=? AND user_id=? AND revision=?").run(JSON.stringify(payload), revision, now, project.id, row.user_id, project.revision);
        if (!saved.changes) return null;
        syncFileRefs(row.user_id, "project", project.id, payload);
        return { ...payload, revision, updatedAt: now };
    })();
    if (updated) publishAgentProject(row.user_id, updated);
}
