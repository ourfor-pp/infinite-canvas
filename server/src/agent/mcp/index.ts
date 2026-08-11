import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
    listProjects,
    searchPrompts,
} from "../canvas-tools.js";

const toolNames = ["canvas_list_projects", "canvas_get_state", "canvas_apply_ops", "canvas_create_text_nodes", "canvas_delete_nodes", "canvas_connect_nodes", "assets_list", "assets_add", "assets_delete", "prompts_search", "generation_list_models", "generation_get_status", "generation_create", "site_navigate", "canvas_select_nodes", "canvas_focus_nodes", "workspace_write_text", "artifact_publish", "ask_user"] as const;

export const agentAllowedTools = [...toolNames.map((name) => `mcp__infinite_canvas__${name}`), "Read"];

type AgentMcpContext = {
    session: { id: string; ownerType: "project" | "workspace"; ownerId: string };
    run: { userId: string };
    appendEvent: (kind: "tool_call" | "tool_result" | "artifact", payload: Record<string, unknown>) => unknown;
    requireDecision: (toolName: string, input: unknown, kind?: "approval" | "question") => Promise<{ comment?: string; answers?: Record<string, string> }>;
    requestClientAction: (name: string, input: unknown) => Promise<unknown>;
    resolveWorkspacePath: (path: string) => string;
};

export function buildAgentMcpServer(context: AgentMcpContext) {
    const { session, run } = context;
    const projectId = session.ownerType === "project" ? session.ownerId : "";
    const call = <T>(name: string, description: string, shape: z.ZodRawShape, handler: (input: T) => unknown | Promise<unknown>, needsApproval: boolean | ((input: T) => boolean) = false) => tool(name, description, shape, async (input) => {
        const typedInput = input as T;
        const toolId = nanoid();
        context.appendEvent("tool_call", { toolId, toolName: name, input: typedInput, startedAt: new Date().toISOString() });
        try {
            if (typeof needsApproval === "function" ? needsApproval(typedInput) : needsApproval) await context.requireDecision(name, typedInput);
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
        return input.projectId || projectId || (() => { throw mcpError(400, "PROJECT_REQUIRED", "当前会话未绑定画布，请提供 projectId"); })();
    };

    return createSdkMcpServer({ name: "infinite_canvas", tools: [
        call("canvas_list_projects", "列出当前会话允许访问的画布项目。项目会话只返回当前画布。", canvasToolSchemas.canvas_list_projects.shape, (input) => {
            if (!projectId) return listProjects(run.userId, input as z.infer<typeof canvasToolSchemas.canvas_list_projects>);
            const state = getCanvasState(run.userId, projectId);
            return [{ id: state.id, title: state.title, revision: state.revision, updatedAt: state.updatedAt }];
        }),
        call("canvas_get_state", "读取画布的权威节点、连线和 revision。修改前必须先调用。", canvasToolSchemas.canvas_get_state.shape, (input) => getCanvasState(run.userId, project(input as { projectId?: string }))),
        call("canvas_apply_ops", "按 revision 批量新增、更新、删除节点或连线。", canvasToolSchemas.canvas_apply_ops.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_apply_ops>; return applyCanvasOps(run.userId, project(value), value.ops, value.expectedRevision); }, (input) => (input as z.infer<typeof canvasToolSchemas.canvas_apply_ops>).ops.some((op) => op.type === "delete_node" || op.type === "delete_connections")),
        call("canvas_create_text_nodes", "批量创建文本节点。", canvasToolSchemas.canvas_create_text_nodes.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_create_text_nodes>; return createTextNodes(run.userId, project(value), value); }),
        call("canvas_delete_nodes", "按 revision 删除节点及关联连线，执行前需要用户审批。", canvasToolSchemas.canvas_delete_nodes.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_delete_nodes>; return applyCanvasOps(run.userId, project(value), [{ type: "delete_node", ids: value.ids }], value.expectedRevision); }, true),
        call("canvas_connect_nodes", "按 revision 批量连接画布节点。", canvasToolSchemas.canvas_connect_nodes.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_connect_nodes>; return applyCanvasOps(run.userId, project(value), value.connections.map((item) => ({ type: "connect_nodes", ...item })), value.expectedRevision); }),
        call("assets_list", "列出当前用户的素材。", canvasToolSchemas.assets_list.shape, (input) => listAssets(run.userId, input as z.infer<typeof canvasToolSchemas.assets_list>)),
        call("assets_add", "向当前用户的素材库新增文本、图片或视频素材。", canvasToolSchemas.assets_add.shape, (input) => addAsset(run.userId, input as z.infer<typeof canvasToolSchemas.assets_add>)),
        call("assets_delete", "删除当前用户的素材，执行前需要用户审批。", canvasToolSchemas.assets_delete.shape, (input) => deleteAssets(run.userId, input as z.infer<typeof canvasToolSchemas.assets_delete>), true),
        call("prompts_search", "搜索当前用户已保存到素材库的文本提示词。", canvasToolSchemas.prompts_search.shape, (input) => searchPrompts(run.userId, input as z.infer<typeof canvasToolSchemas.prompts_search>)),
        call("generation_list_models", "列出后端已启用且能力匹配的生成模型。", canvasToolSchemas.generation_list_models.shape, (input) => generationModels(input as z.infer<typeof canvasToolSchemas.generation_list_models>)),
        call("generation_get_status", "查询当前会话范围内的生成任务状态。", canvasToolSchemas.generation_get_status.shape, (input) => generationStatus(run.userId, input as z.infer<typeof canvasToolSchemas.generation_get_status>, projectId || undefined)),
        call("generation_create", "通过后端队列创建文本、图片、视频或音频生成任务；传 nodeId 可将状态和结果回写画布。", canvasToolSchemas.generation_create.shape, (input) => { const value = input as z.infer<typeof canvasToolSchemas.generation_create>; return createAgentGeneration(run.userId, { ...value, ...(value.projectId || projectId ? { projectId: project(value) } : {}) }, projectId || undefined); }),
        call("site_navigate", "让当前已登录页面跳转到非管理区的应用内路径；没有活动页面时返回 CLIENT_REQUIRED。", { path: z.string().max(500).regex(/^\/(?!\/|admin(?:\/|$))/, "只能跳转到非管理区的应用内路径") }, (input) => context.requestClientAction("site_navigate", input)),
        call("canvas_select_nodes", "在当前已打开画布页面选择节点。", { ids: z.array(z.string()).max(200) }, (input) => context.requestClientAction("canvas_select_nodes", input)),
        call("canvas_focus_nodes", "让当前已打开画布页面聚焦节点。", { ids: z.array(z.string()).min(1).max(200) }, (input) => context.requestClientAction("canvas_focus_nodes", input)),
        call("workspace_write_text", "在当前会话沙箱中写入 UTF-8 文本产物。", { path: z.string().min(1).max(500), content: z.string().max(2_000_000) }, ({ path, content }: { path: string; content: string }) => {
            const target = context.resolveWorkspacePath(path);
            mkdirSync(resolve(target, ".."), { recursive: true });
            writeFileSync(target, content, "utf8");
            return { path };
        }),
        call("artifact_publish", "将会话沙箱中的文件发布为可下载产物。", { path: z.string().min(1).max(500), title: z.string().min(1).max(200), mimeType: z.string().max(200).optional() }, ({ path, title, mimeType }: { path: string; title: string; mimeType?: string }) => {
            const stored = storeLocalFile(run.userId, context.resolveWorkspacePath(path), basename(path), mimeType || "application/octet-stream");
            db.prepare("INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id) VALUES(?, ?, 'agent_session', ?)").run(stored.id, run.userId, session.id);
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
