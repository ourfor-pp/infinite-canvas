import { basename } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../../database.js";
import { storeLocalFile } from "../../file-store.js";
import {
    addAsset,
    applyCanvasOps,
    canvasToolSchemas,
    createAgentGeneration,
    createTextNodes,
    deleteAssets,
    generationModels,
    generationStatus,
    getCanvasState,
    listAssets,
    searchPrompts,
    createAgentCreativeAssetBatch,
    deleteAgentCreativeAsset,
    generateAgentCreativeAsset,
    getAgentCreativeAsset,
    listAgentCreativeAssets,
    placeAgentCreativeAsset,
    setAgentCreativeAssetPrimary,
    updateAgentCreativeAsset,
    createAgentVisualStyle,
    defaultAgentVisualStyle,
    deleteAgentVisualStyle,
    getAgentVisualStyle,
    listAgentVisualStyles,
    placeAgentVisualStyle,
    updateAgentVisualStyle,
} from "../canvas-tools.js";

const toolNames = ["canvas_list_projects", "canvas_get_state", "canvas_apply_ops", "canvas_create_text_nodes", "canvas_delete_nodes", "canvas_delete_connections", "canvas_connect_nodes", "assets_list", "assets_add", "assets_delete", "prompts_search", "generation_list_models", "generation_get_status", "generation_create", "creative_assets_list", "creative_asset_get", "creative_assets_create_batch", "creative_asset_update", "creative_asset_place", "creative_asset_generate", "creative_asset_set_primary", "creative_asset_delete", "visual_styles_list", "visual_style_get", "visual_style_create", "visual_style_update", "visual_style_place", "visual_style_set_default", "visual_style_delete", "site_navigate", "canvas_select_nodes", "canvas_focus_nodes", "workspace_write_text", "artifact_publish", "ask_user"] as const;

const policyTools = new Set(["canvas_delete_nodes", "canvas_delete_connections", "assets_delete", "creative_asset_update", "creative_asset_set_primary", "creative_asset_delete", "visual_style_delete"]);
export const agentAutoAllowedTools = [...toolNames.filter((name) => !policyTools.has(name)).map((name) => `mcp__infinite_canvas__${name}`), "Read"];

type AgentMcpContext = {
    session: { id: string; projectId: string };
    run: { userId: string };
    appendEvent: (kind: "tool_call" | "tool_result" | "artifact", payload: Record<string, unknown>) => unknown;
    requireDecision: (toolName: string, input: unknown, kind?: "question" | "proposal") => Promise<{ comment?: string; answers?: Record<string, string>; proposalEdits?: unknown }>;
    requestClientAction: (name: string, input: unknown) => Promise<unknown>;
    resolveWorkspacePath: (path: string) => string;
    writeWorkspaceText: (path: string, content: string) => Promise<{ path: string }>;
    waitForWorkspacePath: (path: string) => Promise<void>;
};

export function buildAgentMcpServer(context: AgentMcpContext) {
    const { session, run } = context;
    const projectId = session.projectId;
    const call = <T>(name: string, description: string, shape: z.ZodRawShape, handler: (input: T) => unknown | Promise<unknown>) => tool(name, description, shape, async (input) => {
        const typedInput = input as T;
        const toolId = nanoid();
        context.appendEvent("tool_call", { toolId, toolName: name, input: typedInput, startedAt: new Date().toISOString() });
        try {
            const result = await handler(typedInput);
            context.appendEvent("tool_result", { toolId, toolName: name, output: result, isError: false, finishedAt: new Date().toISOString() });
            return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data: result }, null, 2) }] };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.appendEvent("tool_result", { toolId, toolName: name, output: message, isError: true, finishedAt: new Date().toISOString() });
            return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }], isError: true };
        }
    });
    const project = (input: { projectId?: string }) => {
        if (projectId && input.projectId && input.projectId !== projectId) throw mcpError(403, "AGENT_PROJECT_ISOLATED", "项目会话不能操作其他画布");
        return input.projectId || projectId;
    };

    return createSdkMcpServer({ name: "infinite_canvas", tools: [
        call("canvas_list_projects", "列出当前会话允许访问的画布项目。项目会话只返回当前画布。", canvasToolSchemas.canvas_list_projects.shape, (input) => {
            const state = getCanvasState(run.userId, projectId);
            return [{ id: state.id, title: state.title, revision: state.revision, updatedAt: state.updatedAt }];
        }),
        call("canvas_get_state", "读取画布的权威节点、连线和 revision。修改前必须先调用。", canvasToolSchemas.canvas_get_state.shape, (input) => getCanvasState(run.userId, project(input as { projectId?: string }))),
        call("canvas_apply_ops", "按 revision 批量新增、更新节点或新增连线；删除必须使用独立工具。", canvasToolSchemas.canvas_apply_ops.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_apply_ops>; return applyCanvasOps(run.userId, project(value), value.ops, value.expectedRevision); }),
        call("canvas_create_text_nodes", "创建一个或多个通用 Markdown 文本节点，可指定尺寸和字号。每个 item 必须是一份语义完整的文档；一篇故事的标题、章节和尾声必须放进同一个 item，禁止拆分。", canvasToolSchemas.canvas_create_text_nodes.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_create_text_nodes>; return createTextNodes(run.userId, project(value), value); }),
        call("canvas_delete_nodes", "按 revision 删除节点及关联连线；此操作由 SDK 自动审核。", canvasToolSchemas.canvas_delete_nodes.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_delete_nodes>; return applyCanvasOps(run.userId, project(value), [{ type: "delete_node", ids: value.ids }], value.expectedRevision); }),
        call("canvas_delete_connections", "按 revision 删除指定连线；此操作由 SDK 自动审核。", canvasToolSchemas.canvas_delete_connections.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_delete_connections>; return applyCanvasOps(run.userId, project(value), [{ type: "delete_connections", ids: value.ids }], value.expectedRevision); }),
        call("canvas_connect_nodes", "按 revision 批量连接画布节点。", canvasToolSchemas.canvas_connect_nodes.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_connect_nodes>; return applyCanvasOps(run.userId, project(value), value.connections.map((item) => ({ type: "connect_nodes", ...item })), value.expectedRevision); }),
        call("assets_list", "列出当前用户的素材。", canvasToolSchemas.assets_list.shape, (input) => listAssets(run.userId, input as z.infer<typeof canvasToolSchemas.assets_list>)),
        call("assets_add", "向当前用户的素材库新增文本、图片或视频素材。", canvasToolSchemas.assets_add.shape, (input) => addAsset(run.userId, input as z.infer<typeof canvasToolSchemas.assets_add>)),
        call("assets_delete", "删除当前用户的素材；此操作由 SDK 自动审核。", canvasToolSchemas.assets_delete.shape, (input) => deleteAssets(run.userId, input as z.infer<typeof canvasToolSchemas.assets_delete>)),
        call("prompts_search", "搜索当前用户已保存到素材库的文本提示词。", canvasToolSchemas.prompts_search.shape, (input) => searchPrompts(run.userId, input as z.infer<typeof canvasToolSchemas.prompts_search>)),
        call("generation_list_models", "列出后端已启用且能力匹配的生成模型。", canvasToolSchemas.generation_list_models.shape, (input) => generationModels(input as z.infer<typeof canvasToolSchemas.generation_list_models>)),
        call("generation_get_status", "查询当前会话范围内的生成任务状态。", canvasToolSchemas.generation_get_status.shape, (input) => generationStatus(run.userId, input as z.infer<typeof canvasToolSchemas.generation_get_status>, projectId || undefined)),
        call("generation_create", "通过后端队列创建文本、图片、视频或音频生成任务；传 nodeId 可将状态和结果回写画布。", canvasToolSchemas.generation_create.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.generation_create>; return createAgentGeneration(run.userId, { ...value, ...(value.projectId || projectId ? { projectId: project(value) } : {}) }, projectId || undefined); }),
        call("creative_assets_list", "列出当前项目的角色、场景和道具设定。", canvasToolSchemas.creative_assets_list.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_assets_list>; return listAgentCreativeAssets(run.userId, project(value), value.kind); }),
        call("creative_asset_get", "读取一项创作资产的权威设定、revision 和媒体变体。", canvasToolSchemas.creative_asset_get.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_asset_get>; return getAgentCreativeAsset(run.userId, project(value), value.assetId); }),
        tool("creative_assets_create_batch", "把小说拆解候选提交为可编辑清单；用户确认后批量创建独立的角色、场景和道具业务卡片。", canvasToolSchemas.creative_assets_create_batch.shape, async (input) => {
            const value = input as z.infer<typeof canvasToolSchemas.creative_assets_create_batch>;
            const toolId = nanoid();
            context.appendEvent("tool_call", { toolId, toolName: "creative_assets_create_batch", input: value, startedAt: new Date().toISOString() });
            try {
                const targetProjectId = project(value);
                const decision = await context.requireDecision("creative_assets_create_batch", value, "proposal");
                const items = decision.proposalEdits || value.items;
                const result = createAgentCreativeAssetBatch(run.userId, targetProjectId, items, value.sourceNodeId);
                const voiceGenerations = result.filter((asset) => asset.kind === "character").map((asset) => {
                    if (!asset.payload.voiceDescription.trim() || !asset.payload.voiceSampleText.trim()) return { assetId: asset.id, status: "skipped", error: "缺少音色设计或试听台词" };
                    try {
                        const generation = generateAgentCreativeAsset(run.userId, targetProjectId, { assetId: asset.id, kind: "audio", usage: "voice_sample", label: "角色声音", transcript: asset.payload.voiceSampleText });
                        return { assetId: asset.id, status: "queued", generationId: generation.id };
                    } catch (error) { return { assetId: asset.id, status: "failed", error: error instanceof Error ? error.message : String(error) }; }
                });
                const output = { assets: result, voiceGenerations };
                context.appendEvent("tool_result", { toolId, toolName: "creative_assets_create_batch", output, isError: false, finishedAt: new Date().toISOString() });
                return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data: output }, null, 2) }] };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                context.appendEvent("tool_result", { toolId, toolName: "creative_assets_create_batch", output: message, isError: true, finishedAt: new Date().toISOString() });
                return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }], isError: true };
            }
        }),
        call("creative_asset_update", "按 revision 更新角色、场景或道具的文字设定；受保护设定由 SDK 自动审核。", canvasToolSchemas.creative_asset_update.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_asset_update>; return updateAgentCreativeAsset(run.userId, project(value), value); }),
        call("creative_asset_place", "把已有创作资产重新放到画布，不复制实体。", canvasToolSchemas.creative_asset_place.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_asset_place>; return placeAgentCreativeAsset(run.userId, project(value), value); }),
        call("creative_asset_generate", "为创作资产生成图片或角色声音；结果追加为媒体变体，并成为对应的当前主版本。", canvasToolSchemas.creative_asset_generate.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_asset_generate>; return generateAgentCreativeAsset(run.userId, project(value), value); }),
        call("creative_asset_set_primary", "选择创作资产的主图片或主声音；受保护设定由 SDK 自动审核。", canvasToolSchemas.creative_asset_set_primary.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_asset_set_primary>; return setAgentCreativeAssetPrimary(run.userId, project(value), value); }),
        call("creative_asset_delete", "永久删除创作资产、全部画布视图和引用；此操作由 SDK 自动审核。", canvasToolSchemas.creative_asset_delete.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.creative_asset_delete>; return deleteAgentCreativeAsset(run.userId, project(value), value.assetId); }),
        call("visual_styles_list", "列出当前项目的视觉风格。", canvasToolSchemas.visual_styles_list.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_styles_list>; return listAgentVisualStyles(run.userId, project(value)); }),
        call("visual_style_get", "读取视觉风格的权威描述、参考图和 revision。", canvasToolSchemas.visual_style_get.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_style_get>; return getAgentVisualStyle(run.userId, project(value), value.styleId); }),
        call("visual_style_create", "创建模板或自定义视觉风格实体。", canvasToolSchemas.visual_style_create.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_style_create>; return createAgentVisualStyle(run.userId, project(value), value); }),
        call("visual_style_update", "按 revision 更新视觉风格描述，可用于分析参考图后写回风格。", canvasToolSchemas.visual_style_update.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_style_update>; return updateAgentVisualStyle(run.userId, project(value), value); }),
        call("visual_style_place", "将已有视觉风格放到画布。", canvasToolSchemas.visual_style_place.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_style_place>; return placeAgentVisualStyle(run.userId, project(value), value); }),
        call("visual_style_set_default", "将视觉风格设为当前项目默认风格。", canvasToolSchemas.visual_style_set_default.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_style_set_default>; return defaultAgentVisualStyle(run.userId, project(value), value.styleId); }),
        call("visual_style_delete", "永久删除视觉风格及全部画布视图；此操作由 SDK 自动审核。", canvasToolSchemas.visual_style_delete.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.visual_style_delete>; return deleteAgentVisualStyle(run.userId, project(value), value.styleId); }),
        call("site_navigate", "让当前已登录页面在本画布项目内跳转；没有活动页面时返回 CLIENT_REQUIRED。", { path: z.string().max(500).regex(/^\/canvas\/[^/]+(?:\/.*)?$/, "只能在当前画布项目内跳转") }, (input) => {
            const value = input as { path: string };
            const targetProjectId = decodeURIComponent(value.path.split("/")[2] || "");
            if (targetProjectId !== projectId) throw mcpError(403, "AGENT_PROJECT_ISOLATED", "不能跳转到其他画布项目");
            return context.requestClientAction("site_navigate", value);
        }),
        call("canvas_select_nodes", "在当前已打开画布页面选择节点。", { ids: z.array(z.string()).max(200) }, (input) => context.requestClientAction("canvas_select_nodes", input)),
        call("canvas_focus_nodes", "让当前已打开画布页面聚焦节点。", { ids: z.array(z.string()).min(1).max(200) }, (input) => context.requestClientAction("canvas_focus_nodes", input)),
        call("workspace_write_text", "在当前项目共享工作空间中原子写入 UTF-8 文本产物；同一路径会顺序完成。", { path: z.string().min(1).max(500), content: z.string().max(2_000_000) }, ({ path, content }: { path: string; content: string }) => context.writeWorkspaceText(path, content)),
        call("artifact_publish", "将项目共享工作空间中的文件发布为项目产物。", { path: z.string().min(1).max(500), title: z.string().min(1).max(200), mimeType: z.string().max(200).optional() }, async ({ path, title, mimeType }: { path: string; title: string; mimeType?: string }) => {
            await context.waitForWorkspacePath(path);
            const stored = storeLocalFile(run.userId, context.resolveWorkspacePath(path), basename(path), mimeType || "application/octet-stream");
            db.prepare("INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id) VALUES(?, ?, 'agent_project', ?)").run(stored.id, run.userId, projectId);
            context.appendEvent("artifact", { title, fileId: stored.id, name: stored.name, mimeType: stored.mimeType, bytes: stored.bytes, url: stored.url });
            return stored;
        }),
        tool("ask_user", "确有必要时向用户提出一个问题，并等待回答后继续。", { question: z.string().min(1) }, async ({ question }) => {
            const result = await context.requireDecision("ask_user", { question }, "question");
            return { content: [{ type: "text", text: result.comment || Object.values(result.answers || {}).join("\n") || "用户已确认" }] };
        }),
    ] });
}

function mcpError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}
