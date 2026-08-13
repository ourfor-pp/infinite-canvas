import { basename } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../../database.js";
import { storeLocalFile } from "../../file-store.js";
import {
  createDirectorSequence,
  createDirectorShot,
  deleteDirectorSequence,
  deleteDirectorShot,
  getDirectorState,
  listDirectorSourceChunks,
  updateDirectorDocument,
  updateDirectorSequence,
  updateDirectorShot,
  updateDirectorTimeline,
  updateDirectorWorkspace,
} from "../../director.js";
import {
  cancelDirectorRender,
  createDirectorRender,
  createDirectorShotGeneration,
  listDirectorRenders,
  retryDirectorRender,
} from "../../director-render.js";
import type { AgentSceneDefinition } from "../scenes/index.js";
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
  deleteAgentCanvasNodes,
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
  listAgentVisualStyleTemplates,
  listAgentVisualStyles,
  placeAgentVisualStyle,
  updateAgentVisualStyle,
  analyzeAgentVisualStyle,
  generateAgentVisualStyleReferences,
} from "../canvas-tools.js";

type AgentMcpContext = {
  session: { id: string; projectId: string };
  run: { userId: string };
  appendEvent: (
    kind: "tool_call" | "tool_result" | "artifact",
    payload: Record<string, unknown>,
  ) => unknown;
  requireDecision: (
    toolName: string,
    input: unknown,
    kind?: "approval" | "question" | "proposal",
  ) => Promise<{
    comment?: string;
    answers?: Record<string, string>;
    proposalEdits?: unknown;
  }>;
  requestClientAction: (name: string, input: unknown) => Promise<unknown>;
  resolveWorkspacePath: (path: string) => string;
  writeWorkspaceText: (
    path: string,
    content: string,
  ) => Promise<{ path: string }>;
  waitForWorkspacePath: (path: string) => Promise<void>;
};

export function buildAgentMcpServer(
  context: AgentMcpContext,
  scene: AgentSceneDefinition,
) {
  const { session, run } = context;
  const projectId = session.projectId;
  const call = <T>(
    name: string,
    description: string,
    shape: z.ZodRawShape,
    handler: (input: T) => unknown | Promise<unknown>,
  ) =>
    tool(name, description, shape, async (input) => {
      const typedInput = input as T;
      const toolId = nanoid();
      context.appendEvent("tool_call", {
        toolId,
        toolName: name,
        input: typedInput,
        startedAt: new Date().toISOString(),
      });
      try {
        const result = await handler(typedInput);
        context.appendEvent("tool_result", {
          toolId,
          toolName: name,
          output: result,
          isError: false,
          finishedAt: new Date().toISOString(),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, data: result }, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.appendEvent("tool_result", {
          toolId,
          toolName: name,
          output: message,
          isError: true,
          finishedAt: new Date().toISOString(),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    });
  const project = (input: { projectId?: string }) => {
    if (projectId && input.projectId && input.projectId !== projectId)
      throw mcpError(403, "AGENT_PROJECT_ISOLATED", "项目会话不能操作其他项目");
    return input.projectId || projectId;
  };

  if (scene.id === "director")
    return createSdkMcpServer({
      name: "infinite_canvas",
      tools: [
        call(
          "director_get_state",
          "读取导演项目的权威工作区、来源、故事、剧本、剧情段落、镜头和时间线。修改前必须调用。",
          {},
          () => getDirectorState(run.userId, projectId),
        ),
        call(
          "director_search_source",
          "分页读取或搜索小说分块；长篇改编应按需检索，禁止一次读取全书。",
          {
            sourceId: z.string().min(1),
            q: z.string().max(500).optional(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(100).optional(),
          },
          (input) => {
            const value = input as {
              sourceId: string;
              q?: string;
              offset?: number;
              limit?: number;
            };
            return listDirectorSourceChunks(run.userId, value.sourceId, value);
          },
        ),
        call(
          "director_update_workspace",
          "按 revision 更新导演项目目标时长、画幅、阶段或确认状态。",
          {
            revision: z.number().int().positive(),
            targetDurationSeconds: z.number().int().min(10).optional(),
            aspectRatio: z.enum(["16:9", "9:16", "1:1", "2.39:1"]).optional(),
            stage: z.string().optional(),
            status: z.enum(["draft", "confirmed", "locked"]).optional(),
          },
          (input) => updateDirectorWorkspace(run.userId, projectId, input),
        ),
        call(
          "director_update_document",
          "按 revision 更新 Markdown 故事或结构化 Markdown 剧本。故事写回即采用，剧本只区分草稿与已确认。",
          {
            kind: z.enum(["story", "script"]),
            revision: z.number().int().positive(),
            content: z.string().max(20_000_000).optional(),
            status: z.enum(["draft", "confirmed"]).optional(),
          },
          async (input) => {
            const value = input as {
              kind: "story" | "script";
              revision: number;
              content?: string;
              status?: string;
            };
            return updateDirectorDocument(
              run.userId,
              projectId,
              value.kind,
              value,
            );
          },
        ),
        call(
          "director_create_sequences",
          "根据已确认剧本批量创建剧情段落及 4–9 格结构化故事板。",
          {
            items: z
              .array(
                z.object({
                  title: z.string().min(1).max(300),
                  summary: z.string().max(20_000).optional(),
                  payload: z.record(z.string(), z.unknown()).optional(),
                }),
              )
              .min(1)
              .max(200),
          },
          (input) =>
            (input as { items: Array<Record<string, unknown>> }).items.map(
              (item) => createDirectorSequence(run.userId, projectId, item),
            ),
        ),
        call(
          "director_update_sequence",
          "按 revision 更新剧情段落、故事板格子、顺序或确认状态；已锁定内容需要审批。",
          {
            sequenceId: z.string().min(1),
            revision: z.number().int().positive(),
            position: z.number().int().min(0).optional(),
            title: z.string().max(300).optional(),
            summary: z.string().max(20_000).optional(),
            status: z.enum(["draft", "confirmed", "locked"]).optional(),
            payload: z.record(z.string(), z.unknown()).optional(),
          },
          async (input) => {
            const value = input as {
              sequenceId: string;
              status?: string;
            } & Record<string, unknown>;
            const current = getDirectorState(
              run.userId,
              projectId,
            ).sequences.find((item) => item.id === value.sequenceId);
            const locked =
              current?.status === "locked" &&
              ((value.status !== undefined && value.status !== "locked") ||
                Object.keys(value).some(
                  (key) => !["sequenceId", "revision", "status"].includes(key),
                ));
            if (locked)
              await context.requireDecision("director_update_sequence", value);
            return updateDirectorSequence(
              run.userId,
              value.sequenceId,
              value,
              locked,
            );
          },
        ),
        call(
          "director_delete_sequences",
          "批量删除剧情段落及其镜头，始终需要审批。",
          { ids: z.array(z.string().min(1)).min(1).max(200) },
          async (input) => {
            const value = input as { ids: string[] };
            await context.requireDecision("director_delete_sequences", value);
            return value.ids.map((id) =>
              deleteDirectorSequence(run.userId, id, true),
            );
          },
        ),
        call(
          "director_create_shots",
          "从已确认故事板批量创建独立镜头，必须保存角色、场景、道具稳定 ID 与 revision。",
          {
            items: z
              .array(
                z.object({
                  sequenceId: z.string().min(1),
                  title: z.string().min(1).max(300),
                  position: z.number().int().min(0).optional(),
                  payload: z.record(z.string(), z.unknown()).optional(),
                }),
              )
              .min(1)
              .max(500),
          },
          (input) =>
            (input as { items: Array<Record<string, unknown>> }).items.map(
              (item) => createDirectorShot(run.userId, projectId, item),
            ),
        ),
        call(
          "director_update_shot",
          "按 revision 更新镜头画面、引用、首尾帧、cut/continue 边界、媒体和确认状态；已锁定内容需要审批。",
          {
            shotId: z.string().min(1),
            revision: z.number().int().positive(),
            position: z.number().int().min(0).optional(),
            title: z.string().max(300).optional(),
            status: z.enum(["draft", "confirmed", "locked"]).optional(),
            payload: z.record(z.string(), z.unknown()).optional(),
          },
          async (input) => {
            const value = input as { shotId: string; status?: string } & Record<
              string,
              unknown
            >;
            const current = getDirectorState(run.userId, projectId).shots.find(
              (item) => item.id === value.shotId,
            );
            const locked =
              current?.status === "locked" &&
              ((value.status !== undefined && value.status !== "locked") ||
                Object.keys(value).some(
                  (key) => !["shotId", "revision", "status"].includes(key),
                ));
            if (locked)
              await context.requireDecision("director_update_shot", value);
            return updateDirectorShot(run.userId, value.shotId, value, locked);
          },
        ),
        call(
          "director_delete_shots",
          "批量删除镜头，始终需要审批。",
          { ids: z.array(z.string().min(1)).min(1).max(500) },
          async (input) => {
            const value = input as { ids: string[] };
            await context.requireDecision("director_delete_shots", value);
            return value.ids.map((id) =>
              deleteDirectorShot(run.userId, id, true),
            );
          },
        ),
        call(
          "director_generate_shot",
          "使用镜头已确认设定生成视频。根据模型声明自动路由首帧、尾帧或原生 Extend，结果直接替换镜头当前视频。",
          {
            shotId: z.string().min(1),
            revision: z.number().int().positive(),
            model: z.string().optional(),
            seconds: z.number().min(1).max(30).optional(),
            nativeExtend: z.boolean().optional(),
          },
          (input) => {
            const value = input as { shotId: string } & Record<string, unknown>;
            return createDirectorShotGeneration(
              run.userId,
              value.shotId,
              value,
            );
          },
        ),
        call(
          "director_update_timeline",
          "按 revision 编排镜头主轨与对白、旁白、环境声、音效、音乐轨。",
          {
            revision: z.number().int().positive(),
            payload: z.record(z.string(), z.unknown()),
          },
          (input) => updateDirectorTimeline(run.userId, projectId, input),
        ),
        call(
          "director_check_continuity",
          "检查镜头资产 revision、连续边界、时长、缺失视频与声音铺轨，不产生生成费用。",
          {},
          () => continuityReport(getDirectorState(run.userId, projectId)),
        ),
        call(
          "director_list_assets",
          "列出导演项目的角色、场景和道具。",
          canvasToolSchemas.creative_assets_list.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.creative_assets_list
            >;
            return listAgentCreativeAssets(
              run.userId,
              project(value),
              value.kind,
            );
          },
        ),
        call(
          "director_get_asset",
          "读取一项导演资产的权威设定、媒体和 revision。",
          canvasToolSchemas.creative_asset_get.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.creative_asset_get
            >;
            return getAgentCreativeAsset(
              run.userId,
              project(value),
              value.assetId,
            );
          },
        ),
        tool(
          "director_create_assets",
          "从已确认剧本提交角色、场景和道具候选；用户确认清单后创建导演资产，不创建任何节点。",
          { items: canvasToolSchemas.creative_assets_create_batch.shape.items },
          async (input) => {
            const value = input as {
              items: z.infer<
                typeof canvasToolSchemas.creative_assets_create_batch
              >["items"];
            };
            const toolId = nanoid();
            context.appendEvent("tool_call", {
              toolId,
              toolName: "director_create_assets",
              input: value,
              startedAt: new Date().toISOString(),
            });
            try {
              requireDirectorDocumentStatus(run.userId, projectId, "script");
              const decision = await context.requireDecision(
                "director_create_assets",
                value,
                "proposal",
              );
              const items = decision.proposalEdits || value.items;
              const output = {
                assets: createAgentCreativeAssetBatch(
                  run.userId,
                  projectId,
                  items,
                  undefined,
                  false,
                ),
              };
              context.appendEvent("tool_result", {
                toolId,
                toolName: "director_create_assets",
                output,
                isError: false,
                finishedAt: new Date().toISOString(),
              });
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({ ok: true, data: output }, null, 2),
                  },
                ],
              };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              context.appendEvent("tool_result", {
                toolId,
                toolName: "director_create_assets",
                output: message,
                isError: true,
                finishedAt: new Date().toISOString(),
              });
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({ ok: false, error: message }),
                  },
                ],
                isError: true,
              };
            }
          },
        ),
        call(
          "director_update_asset",
          "按 revision 更新导演资产；修改已锁定资产时请求审批。",
          canvasToolSchemas.creative_asset_update.shape,
          async (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.creative_asset_update
            >;
            const asset = getAgentCreativeAsset(
              run.userId,
              project(value),
              value.assetId,
            );
            if (asset.status === "locked")
              await context.requireDecision("director_update_asset", value);
            return updateAgentCreativeAsset(run.userId, project(value), value);
          },
        ),
        call(
          "director_generate_asset",
          "阶段门满足后生成并替换导演资产的当前主设计图或声音。",
          canvasToolSchemas.creative_asset_generate.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.creative_asset_generate
            >;
            requireDirectorMediaStage(run.userId, project(value));
            return generateAgentCreativeAsset(
              run.userId,
              project(value),
              value,
            );
          },
        ),
        call(
          "director_copy_asset",
          "复制导演资产为完全独立的新实体，以便保留当前方案后继续重做。",
          {
            assetId: z.string().min(1),
            name: z.string().min(1).max(200).optional(),
          },
          (input) => {
            const value = input as { assetId: string; name?: string };
            const asset = getAgentCreativeAsset(
              run.userId,
              projectId,
              value.assetId,
            );
            return createAgentCreativeAssetBatch(
              run.userId,
              projectId,
              [
                {
                  kind: asset.kind,
                  name: value.name || `${asset.name} 副本`,
                  status: "draft",
                  payload: asset.payload,
                },
              ],
              undefined,
              false,
            )[0];
          },
        ),
        call(
          "director_delete_assets",
          "批量删除导演资产，始终需要审批。",
          { ids: z.array(z.string().min(1)).min(1).max(200) },
          async (input) => {
            const value = input as { ids: string[] };
            await context.requireDecision("director_delete_assets", value);
            return {
              deleted: value.ids.map((id) =>
                deleteAgentCreativeAsset(run.userId, projectId, id),
              ),
            };
          },
        ),
        call(
          "director_list_styles",
          "列出导演项目的视觉风格。",
          canvasToolSchemas.visual_styles_list.shape,
          (input) =>
            listAgentVisualStyles(
              run.userId,
              project(input as { projectId?: string }),
            ),
        ),
        call(
          "director_list_style_templates",
          "搜索可用于导演项目的内置影视风格模板。",
          canvasToolSchemas.visual_style_templates_list.shape,
          (input) =>
            listAgentVisualStyleTemplates(
              input as z.infer<
                typeof canvasToolSchemas.visual_style_templates_list
              >,
            ),
        ),
        call(
          "director_get_style",
          "读取导演视觉风格的权威描述、参考图和 revision。",
          canvasToolSchemas.visual_style_get.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_get
            >;
            return getAgentVisualStyle(
              run.userId,
              project(value),
              value.styleId,
            );
          },
        ),
        call(
          "director_create_style",
          "创建导演项目的模板或自定义视觉风格。",
          canvasToolSchemas.visual_style_create.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_create
            >;
            return createAgentVisualStyle(run.userId, project(value), value);
          },
        ),
        call(
          "director_update_style",
          "按 revision 更新导演视觉风格。",
          canvasToolSchemas.visual_style_update.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_update
            >;
            return updateAgentVisualStyle(run.userId, project(value), value);
          },
        ),
        call(
          "director_set_active_style",
          "将指定风格设为导演项目当前风格。",
          canvasToolSchemas.visual_style_set_default.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_set_default
            >;
            return defaultAgentVisualStyle(
              run.userId,
              project(value),
              value.styleId,
            );
          },
        ),
        call(
          "director_analyze_style",
          "分析参考图并写回导演项目的 Style DNA。",
          canvasToolSchemas.visual_style_analyze.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_analyze
            >;
            return analyzeAgentVisualStyle(run.userId, project(value), value);
          },
        ),
        call(
          "director_generate_style_references",
          "生成角色、场景和道具的中性风格参考样张。",
          canvasToolSchemas.visual_style_generate_references.shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_generate_references
            >;
            return generateAgentVisualStyleReferences(
              run.userId,
              project(value),
              value,
            );
          },
        ),
        call(
          "director_delete_style",
          "删除导演视觉风格，始终需要审批。",
          canvasToolSchemas.visual_style_delete.shape,
          async (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_delete
            >;
            await context.requireDecision("director_delete_style", value);
            return deleteAgentVisualStyle(
              run.userId,
              project(value),
              value.styleId,
            );
          },
        ),
        call(
          "director_list_models",
          "列出已启用且能力匹配的生成模型。",
          canvasToolSchemas.generation_list_models.shape,
          (input) =>
            generationModels(
              input as z.infer<typeof canvasToolSchemas.generation_list_models>,
            ),
        ),
        call(
          "director_get_generation_status",
          "查询本导演项目的生成任务状态。",
          canvasToolSchemas.generation_get_status.shape,
          (input) =>
            generationStatus(
              run.userId,
              input as z.infer<typeof canvasToolSchemas.generation_get_status>,
              projectId,
            ),
        ),
        call(
          "director_list_renders",
          "列出本导演项目的成片合成任务。",
          {},
          () => listDirectorRenders(run.userId, projectId),
        ),
        call(
          "director_start_render",
          "以当前时间线 revision 发起完整 MP4 合成。",
          { timelineRevision: z.number().int().positive() },
          (input) => createDirectorRender(run.userId, projectId, input),
        ),
        call(
          "director_cancel_render",
          "取消本导演项目正在排队或运行的成片任务。",
          { renderId: z.string().min(1) },
          (input) => {
            const value = input as { renderId: string };
            assertDirectorRender(run.userId, projectId, value.renderId);
            return cancelDirectorRender(run.userId, value.renderId);
          },
        ),
        call(
          "director_retry_render",
          "重试本导演项目失败或取消的成片任务。",
          { renderId: z.string().min(1) },
          (input) => {
            const value = input as { renderId: string };
            assertDirectorRender(run.userId, projectId, value.renderId);
            return retryDirectorRender(run.userId, value.renderId);
          },
        ),
        call(
          "director_navigate",
          "让当前页面在本导演项目的顶部工作区之间跳转。",
          {
            path: z
              .string()
              .max(500)
              .regex(
                /^\/director\/[^/]+(?:\/(?:overview|story|script|assets|storyboard|studio))?$/,
                "只能在当前导演项目内跳转",
              ),
          },
          (input) => {
            const value = input as { path: string };
            if (
              decodeURIComponent(value.path.split("/")[2] || "") !== projectId
            )
              throw mcpError(
                403,
                "AGENT_PROJECT_ISOLATED",
                "不能跳转到其他导演项目",
              );
            return context.requestClientAction("site_navigate", value);
          },
        ),
        tool(
          "ask_user",
          "确有必要时向用户提出一个问题，并等待回答后继续。",
          { question: z.string().min(1) },
          async ({ question }) => {
            const result = await context.requireDecision(
              "ask_user",
              { question },
              "question",
            );
            return {
              content: [
                {
                  type: "text",
                  text:
                    result.comment ||
                    Object.values(result.answers || {}).join("\n") ||
                    "用户已确认",
                },
              ],
            };
          },
        ),
      ],
    });

  return createSdkMcpServer({
    name: "infinite_canvas",
    tools: [
      call(
        "canvas_list_projects",
        "列出当前会话允许访问的画布项目。项目会话只返回当前画布。",
        canvasToolSchemas.canvas_list_projects.shape,
        (input) => {
          const state = getCanvasState(run.userId, projectId);
          return [
            {
              id: state.id,
              title: state.title,
              revision: state.revision,
              updatedAt: state.updatedAt,
            },
          ];
        },
      ),
      call(
        "canvas_get_state",
        "读取画布的权威节点、连线和 revision。修改前必须先调用。",
        canvasToolSchemas.canvas_get_state.shape,
        (input) =>
          getCanvasState(run.userId, project(input as { projectId?: string })),
      ),
      call(
        "canvas_apply_ops",
        "按 revision 批量新增、更新节点或新增连线；删除必须使用独立工具。",
        canvasToolSchemas.canvas_apply_ops.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.canvas_apply_ops
          >;
          return applyCanvasOps(
            run.userId,
            project(value),
            value.ops,
            value.expectedRevision,
          );
        },
      ),
      call(
        "canvas_create_text_nodes",
        "创建一个或多个通用 Markdown 文本节点，可指定尺寸和字号。每个 item 必须是一份语义完整的文档；一篇故事的标题、章节和尾声必须放进同一个 item，禁止拆分。",
        canvasToolSchemas.canvas_create_text_nodes.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.canvas_create_text_nodes
          >;
          return createTextNodes(run.userId, project(value), value);
        },
      ),
      call(
        "canvas_delete_nodes",
        "按 revision 删除节点及关联连线；角色、场景和道具节点会同时删除其业务资产及全部视图，执行前需要业务确认。",
        canvasToolSchemas.canvas_delete_nodes.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.canvas_delete_nodes
          >;
          await context.requireDecision("canvas_delete_nodes", value);
          return deleteAgentCanvasNodes(
            run.userId,
            project(value),
            value.ids,
            value.expectedRevision,
          );
        },
      ),
      call(
        "canvas_delete_connections",
        "按 revision 删除指定连线，执行前需要业务确认。",
        canvasToolSchemas.canvas_delete_connections.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.canvas_delete_connections
          >;
          await context.requireDecision("canvas_delete_connections", value);
          return applyCanvasOps(
            run.userId,
            project(value),
            [{ type: "delete_connections", ids: value.ids }],
            value.expectedRevision,
          );
        },
      ),
      call(
        "canvas_connect_nodes",
        "按 revision 批量连接画布节点。",
        canvasToolSchemas.canvas_connect_nodes.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.canvas_connect_nodes
          >;
          return applyCanvasOps(
            run.userId,
            project(value),
            value.connections.map((item) => ({
              type: "connect_nodes",
              ...item,
            })),
            value.expectedRevision,
          );
        },
      ),
      call(
        "assets_list",
        "列出当前用户的素材。",
        canvasToolSchemas.assets_list.shape,
        (input) =>
          listAssets(
            run.userId,
            input as z.infer<typeof canvasToolSchemas.assets_list>,
          ),
      ),
      call(
        "assets_add",
        "向当前用户的素材库新增文本、图片或视频素材。",
        canvasToolSchemas.assets_add.shape,
        (input) =>
          addAsset(
            run.userId,
            input as z.infer<typeof canvasToolSchemas.assets_add>,
          ),
      ),
      call(
        "assets_delete",
        "删除当前用户的素材，执行前需要业务确认。",
        canvasToolSchemas.assets_delete.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.assets_delete
          >;
          await context.requireDecision("assets_delete", value);
          return deleteAssets(run.userId, value);
        },
      ),
      call(
        "prompts_search",
        "搜索当前用户已保存到素材库的文本提示词。",
        canvasToolSchemas.prompts_search.shape,
        (input) =>
          searchPrompts(
            run.userId,
            input as z.infer<typeof canvasToolSchemas.prompts_search>,
          ),
      ),
      call(
        "generation_list_models",
        "列出后端已启用且能力匹配的生成模型。",
        canvasToolSchemas.generation_list_models.shape,
        (input) =>
          generationModels(
            input as z.infer<typeof canvasToolSchemas.generation_list_models>,
          ),
      ),
      call(
        "generation_get_status",
        "查询当前会话范围内的生成任务状态。",
        canvasToolSchemas.generation_get_status.shape,
        (input) =>
          generationStatus(
            run.userId,
            input as z.infer<typeof canvasToolSchemas.generation_get_status>,
            projectId || undefined,
          ),
      ),
      call(
        "generation_create",
        "通过后端队列创建文本、图片、视频或音频生成任务；传 nodeId 可将状态和结果回写画布。",
        canvasToolSchemas.generation_create.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.generation_create
          >;
          return createAgentGeneration(
            run.userId,
            {
              ...value,
              ...(value.projectId || projectId
                ? { projectId: project(value) }
                : {}),
            },
            projectId || undefined,
          );
        },
      ),
      call(
        "creative_assets_list",
        "列出当前项目的角色、场景和道具设定。",
        canvasToolSchemas.creative_assets_list.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_assets_list
          >;
          return listAgentCreativeAssets(
            run.userId,
            project(value),
            value.kind,
          );
        },
      ),
      call(
        "creative_asset_get",
        "读取一项创作资产的权威设定、revision 和媒体变体。",
        canvasToolSchemas.creative_asset_get.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_asset_get
          >;
          return getAgentCreativeAsset(
            run.userId,
            project(value),
            value.assetId,
          );
        },
      ),
      tool(
        "creative_assets_create_batch",
        "把小说拆解候选提交为可编辑清单；用户确认后批量创建独立的角色、场景和道具业务卡片。",
        canvasToolSchemas.creative_assets_create_batch.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_assets_create_batch
          >;
          const toolId = nanoid();
          context.appendEvent("tool_call", {
            toolId,
            toolName: "creative_assets_create_batch",
            input: value,
            startedAt: new Date().toISOString(),
          });
          try {
            const targetProjectId = project(value);
            const decision = await context.requireDecision(
              "creative_assets_create_batch",
              value,
              "proposal",
            );
            const items = decision.proposalEdits || value.items;
            const result = createAgentCreativeAssetBatch(
              run.userId,
              targetProjectId,
              items,
              value.sourceNodeId,
            );
            const output = { assets: result };
            context.appendEvent("tool_result", {
              toolId,
              toolName: "creative_assets_create_batch",
              output,
              isError: false,
              finishedAt: new Date().toISOString(),
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ ok: true, data: output }, null, 2),
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            context.appendEvent("tool_result", {
              toolId,
              toolName: "creative_assets_create_batch",
              output: message,
              isError: true,
              finishedAt: new Date().toISOString(),
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ ok: false, error: message }),
                },
              ],
              isError: true,
            };
          }
        },
      ),
      call(
        "creative_asset_update",
        "按 revision 更新角色、场景或道具的文字设定及图片、音频媒体草稿；修改已确认或锁定设定时请求审批。",
        canvasToolSchemas.creative_asset_update.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_asset_update
          >;
          const targetProjectId = project(value);
          const asset = getAgentCreativeAsset(
            run.userId,
            targetProjectId,
            value.assetId,
          );
          if (asset.status !== "draft")
            await context.requireDecision("creative_asset_update", value);
          return updateAgentCreativeAsset(run.userId, targetProjectId, value);
        },
      ),
      call(
        "creative_asset_place",
        "把已有创作资产重新放到画布，不复制实体。",
        canvasToolSchemas.creative_asset_place.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_asset_place
          >;
          return placeAgentCreativeAsset(run.userId, project(value), value);
        },
      ),
      call(
        "creative_asset_generate",
        "使用创作资产已保存的媒体草稿生成设计图、角色声音、环境声或道具音效；结果会直接替换该资产的当前主媒体。",
        canvasToolSchemas.creative_asset_generate.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_asset_generate
          >;
          return generateAgentCreativeAsset(run.userId, project(value), value);
        },
      ),
      call(
        "creative_asset_set_primary",
        "选择创作资产的主图片或主声音；已确认或锁定资产执行前需要业务确认。",
        canvasToolSchemas.creative_asset_set_primary.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_asset_set_primary
          >;
          const targetProjectId = project(value);
          const asset = getAgentCreativeAsset(
            run.userId,
            targetProjectId,
            value.assetId,
          );
          if (asset.status !== "draft")
            await context.requireDecision("creative_asset_set_primary", value);
          return setAgentCreativeAssetPrimary(
            run.userId,
            targetProjectId,
            value,
          );
        },
      ),
      call(
        "creative_asset_delete",
        "永久删除创作资产、全部画布视图和引用，执行前需要业务确认。",
        canvasToolSchemas.creative_asset_delete.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.creative_asset_delete
          >;
          await context.requireDecision("creative_asset_delete", value);
          return deleteAgentCreativeAsset(
            run.userId,
            project(value),
            value.assetId,
          );
        },
      ),
      call(
        "visual_styles_list",
        "列出当前项目的视觉风格。",
        canvasToolSchemas.visual_styles_list.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_styles_list
          >;
          return listAgentVisualStyles(run.userId, project(value));
        },
      ),
      call(
        "visual_style_templates_list",
        "搜索可直接使用的内置影视视觉风格模板及完整 Style DNA。",
        canvasToolSchemas.visual_style_templates_list.shape,
        (input) =>
          listAgentVisualStyleTemplates(
            input as z.infer<
              typeof canvasToolSchemas.visual_style_templates_list
            >,
          ),
      ),
      call(
        "visual_style_get",
        "读取视觉风格的权威描述、参考图和 revision。",
        canvasToolSchemas.visual_style_get.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_get
          >;
          return getAgentVisualStyle(run.userId, project(value), value.styleId);
        },
      ),
      call(
        "visual_style_create",
        "创建模板或自定义视觉风格实体。",
        canvasToolSchemas.visual_style_create.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_create
          >;
          return createAgentVisualStyle(run.userId, project(value), value);
        },
      ),
      call(
        "visual_style_update",
        "按 revision 更新视觉风格描述，可用于分析参考图后写回风格。",
        canvasToolSchemas.visual_style_update.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_update
          >;
          return updateAgentVisualStyle(run.userId, project(value), value);
        },
      ),
      call(
        "visual_style_place",
        "将已有视觉风格放到画布。",
        canvasToolSchemas.visual_style_place.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_place
          >;
          return placeAgentVisualStyle(run.userId, project(value), value);
        },
      ),
      call(
        "visual_style_set_default",
        "将视觉风格设为当前项目默认风格。",
        canvasToolSchemas.visual_style_set_default.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_set_default
          >;
          return defaultAgentVisualStyle(
            run.userId,
            project(value),
            value.styleId,
          );
        },
      ),
      call(
        "visual_style_analyze",
        "使用支持图片理解的默认文本模型分析风格来源图并写回 Style DNA。",
        canvasToolSchemas.visual_style_analyze.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_analyze
          >;
          return analyzeAgentVisualStyle(run.userId, project(value), value);
        },
      ),
      call(
        "visual_style_generate_references",
        "生成角色、场景和道具三类中性风格参考样张。",
        canvasToolSchemas.visual_style_generate_references.shape,
        (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_generate_references
          >;
          return generateAgentVisualStyleReferences(
            run.userId,
            project(value),
            value,
          );
        },
      ),
      call(
        "visual_style_delete",
        "永久删除视觉风格及全部画布视图，执行前需要业务确认。",
        canvasToolSchemas.visual_style_delete.shape,
        async (input) => {
          const value = input as z.infer<
            typeof canvasToolSchemas.visual_style_delete
          >;
          await context.requireDecision("visual_style_delete", value);
          return deleteAgentVisualStyle(
            run.userId,
            project(value),
            value.styleId,
          );
        },
      ),
      call(
        "site_navigate",
        "让当前已登录页面在本画布项目内跳转；没有活动页面时返回 CLIENT_REQUIRED。",
        {
          path: z
            .string()
            .max(500)
            .regex(/^\/canvas\/[^/]+(?:\/.*)?$/, "只能在当前画布项目内跳转"),
        },
        (input) => {
          const value = input as { path: string };
          const targetProjectId = decodeURIComponent(
            value.path.split("/")[2] || "",
          );
          if (targetProjectId !== projectId)
            throw mcpError(
              403,
              "AGENT_PROJECT_ISOLATED",
              "不能跳转到其他画布项目",
            );
          return context.requestClientAction("site_navigate", value);
        },
      ),
      call(
        "canvas_select_nodes",
        "在当前已打开画布页面选择节点。",
        { ids: z.array(z.string()).max(200) },
        (input) => context.requestClientAction("canvas_select_nodes", input),
      ),
      call(
        "canvas_focus_nodes",
        "让当前已打开画布页面聚焦节点。",
        { ids: z.array(z.string()).min(1).max(200) },
        (input) => context.requestClientAction("canvas_focus_nodes", input),
      ),
      call(
        "workspace_write_text",
        "在当前项目共享工作空间中原子写入 UTF-8 文本产物；同一路径会顺序完成。",
        {
          path: z.string().min(1).max(500),
          content: z.string().max(2_000_000),
        },
        ({ path, content }: { path: string; content: string }) =>
          context.writeWorkspaceText(path, content),
      ),
      call(
        "artifact_publish",
        "将项目共享工作空间中的文件发布为项目产物。",
        {
          path: z.string().min(1).max(500),
          title: z.string().min(1).max(200),
          mimeType: z.string().max(200).optional(),
        },
        async ({
          path,
          title,
          mimeType,
        }: {
          path: string;
          title: string;
          mimeType?: string;
        }) => {
          await context.waitForWorkspacePath(path);
          const stored = storeLocalFile(
            run.userId,
            context.resolveWorkspacePath(path),
            basename(path),
            mimeType || "application/octet-stream",
          );
          db.prepare(
            "INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id) VALUES(?, ?, 'agent_project', ?)",
          ).run(stored.id, run.userId, projectId);
          context.appendEvent("artifact", {
            title,
            fileId: stored.id,
            name: stored.name,
            mimeType: stored.mimeType,
            bytes: stored.bytes,
            url: stored.url,
          });
          return stored;
        },
      ),
      tool(
        "ask_user",
        "确有必要时向用户提出一个问题，并等待回答后继续。",
        { question: z.string().min(1) },
        async ({ question }) => {
          const result = await context.requireDecision(
            "ask_user",
            { question },
            "question",
          );
          return {
            content: [
              {
                type: "text",
                text:
                  result.comment ||
                  Object.values(result.answers || {}).join("\n") ||
                  "用户已确认",
              },
            ],
          };
        },
      ),
    ],
  });
}

function mcpError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

function continuityReport(state: ReturnType<typeof getDirectorState>) {
  const shotIds = new Set(state.shots.map((shot) => shot.id));
  const payload = (value: unknown) => value as Record<string, unknown>;
  return {
    staleSequences: state.sequences
      .filter((sequence) => payload(sequence.payload).needsReview)
      .map((sequence) => sequence.id),
    staleShots: state.shots
      .filter(
        (shot) =>
          payload(shot.payload).needsReview || payload(shot.payload).videoStale,
      )
      .map((shot) => shot.id),
    missingVideos: state.shots
      .filter((shot) => !payload(shot.payload).videoFileId)
      .map((shot) => shot.id),
    brokenContinuations: state.shots
      .filter(
        (shot) =>
          payload(shot.payload).boundary === "continue" &&
          (!payload(shot.payload).continuationFromShotId ||
            !shotIds.has(String(payload(shot.payload).continuationFromShotId))),
      )
      .map((shot) => shot.id),
  };
}

function requireDirectorDocumentStatus(
  userId: string,
  projectId: string,
  kind: "story" | "script",
) {
  const document = getDirectorState(userId, projectId).documents.find(
    (item) => item.kind === kind,
  );
  if (!document || !["confirmed", "locked"].includes(document.status))
    throw mcpError(
      409,
      "DIRECTOR_STAGE_GATE",
      `请先确认${kind === "script" ? "剧本" : "故事"}`,
    );
}

function requireDirectorMediaStage(userId: string, projectId: string) {
  requireDirectorDocumentStatus(userId, projectId, "script");
  if (
    !listAgentVisualStyles(userId, projectId).some(
      (style) => style.status === "confirmed",
    )
  )
    throw mcpError(409, "DIRECTOR_STAGE_GATE", "请先确认视觉风格");
}

function assertDirectorRender(
  userId: string,
  projectId: string,
  renderId: string,
) {
  if (
    !listDirectorRenders(userId, projectId).some(
      (render) => render.id === renderId,
    )
  )
    throw mcpError(
      404,
      "DIRECTOR_RENDER_NOT_FOUND",
      "成片任务不存在或不属于当前导演项目",
    );
}
