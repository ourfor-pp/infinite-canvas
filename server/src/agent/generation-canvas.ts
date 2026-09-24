import { db, parseJson } from "../database.js";
import type { AiGenerationRequest } from "../ai-adapters.js";
import type { GenerationRow } from "../generation-service.js";
import { applyCanvasOps, generationNodeInputs, generationReferenceOps, getCanvasState } from "./canvas-tools.js";

export function syncAgentGenerationCanvas(row: GenerationRow) {
    const request = parseJson<AiGenerationRequest>(row.request, {} as AiGenerationRequest);
    const context = request.params?.__agentCanvas as { projectId?: string; nodeId?: string } | undefined;
    const projectId = context?.projectId || (typeof request.metadata?.mediaProjectId === "string" ? request.metadata.mediaProjectId : undefined);
    if (!projectId) return;
    const project = db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(projectId, row.user_id) as { kind: string } | undefined;
    if (!project || project.kind === "director") return;
    const state = getCanvasState(row.user_id, projectId);
    const node = context?.nodeId ? state.nodes.find(node => node.id === context.nodeId) : state.nodes.find(node => node.metadata?.agentGenerationId === row.id);
    // A deleted task node stays deleted; updates must not recreate it.
    if (!node && (context?.nodeId || row.status !== "queued")) return;
    const prior = node?.metadata || {};
    if (prior.agentGenerationId === row.id && prior.agentGenerationStatus === row.status && prior.agentGenerationProgress === row.progress) return;
    const result = parseJson<{ text?: string; files?: Array<{ id?: string; fileId?: string; url?: string; mimeType?: string; bytes?: number }> } | null>(row.result, null);
    const file = result?.files?.[0];
    const metadata = {
        ...(!node ? generationNodeInputs(request) : {}),
        agentGenerationId: row.id, agentGenerationStatus: row.status, agentGenerationProgress: row.progress,
        status: row.status === "succeeded" ? "success" : row.status === "failed" || row.status === "canceled" ? "error" : "loading",
        errorDetails: row.error || null,
        ...(result?.text ? { content: result.text } : {}),
        ...(file ? { content: file.url, storageKey: `server:${file.id || file.fileId}`, mimeType: file.mimeType, bytes: file.bytes } : {}),
    };
    const id = node?.id || `generation-${row.id}`;
    const kind = row.kind === "transcription" ? "text" : row.kind;
    const position = { x: Math.max(0, ...state.nodes.map(node => Number(node.position?.x || 0) + Number(node.width || 320))) + 100, y: 100 };
    applyCanvasOps(row.user_id, projectId, node ? [{ type: "update_node", id, metadata }] : [
        { type: "add_node", id, nodeType: kind, title: `${({ audio: "音频", video: "视频", image: "图片", text: "文本" } as Record<string, string>)[kind] || "生成"} · ${request.prompt?.replace(/\s+/g, " ").slice(0, 32) || request.model}`, position, width: 320, height: kind === "audio" ? 120 : 200, metadata },
        ...generationReferenceOps(row.user_id, request, id, state.nodes, position),
    ], state.revision);
}
