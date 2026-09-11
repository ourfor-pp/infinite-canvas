import { h3AudioReferencesInput } from "../../h3-prompt.js";
import { basename } from "node:path";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../../database.js";
import { storeLocalFile } from "../../file-store.js";
import {
  createDirectorSequence,
  createDirectorVideoSegment,
  deleteDirectorSequence,
  deleteDirectorVideoSegment,
  getDirectorAgentOverview,
  getDirectorDocumentExcerpt,
  getDirectorScreenplayBreakdown,
  getDirectorState,
  getDirectorVideoSegment,
  listDirectorSequenceSummaries,
  listDirectorSourceChunks,
  listDirectorVideoSegments,
  updateDirectorDocument,
  updateDirectorScreenplayBreakdown,
  updateDirectorSequence,
  updateDirectorVideoSegment,
  updateDirectorTimeline,
  updateDirectorWorkspace,
} from "../../director.js";
import {
  cancelDirectorRender,
  createDirectorRender,
  createDirectorVideoSegmentGeneration,
  createDirectorStoryboardGeneration,
  getDirectorVideoSegmentPreflight,
  listDirectorRenders,
  retryDirectorRender,
  updateDirectorStoryboardPrompts,
} from "../../director-render.js";
import { sceneTools, type AgentSceneDefinition } from "../scenes/index.js";
import { reconcileDirectorProjectFiles, assertDirectorProjectValid, resolveDirectorEntityReference, trashDirectorProjectPath, validateDirectorProject } from "../../director-workspace.js";
import { createDirectorAssetGeneration } from "../../creative-asset-generation.js";
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
import { directorMediaModels, directorTaskQuery, getDirectorGenerationTasks, getDirectorRenderTasks } from "../director-tools.js";
import { sampleDirectorVideo, understandDirectorAudios, prepareProjectVideoOverview, sampleProjectVideoFrames, understandProjectAudios, understandProjectImages } from "../media-understanding.js";

type AgentMcpContext = {
  session: { id: string; projectId: string };
  run: { userId: string; mediaModelRef: string };
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

const askUserShape = {
  summary: z.string().max(240).optional(),
  questions: z.array(z.object({
    id: z.string().min(1).max(80).optional(),
    header: z.string().max(40).optional(),
    question: z.string().min(1).max(500),
    type: z.enum(["text", "single_choice", "multiple_choice"]),
    allowCustomInput: z.boolean().optional(),
    customInputPlaceholder: z.string().max(160).optional(),
    options: z.array(z.object({ label: z.string().min(1).max(120), description: z.string().max(240).optional() })).max(6).optional(),
  })).min(1).max(3),
};

const directorAssetRefSchema = z.object({ id: z.string().min(1), revision: z.number().int().positive(), variantId: z.string().min(1).optional() });
const directorVideoSegmentPayloadShape = {
  durationSeconds: z.number().int().min(4).max(15),
  sourceSceneId: z.string().min(1).max(80),
  sourceBeatIds: z.array(z.string().min(1).max(80)).min(1).max(20),
  sourceDurationSeconds: z.number().min(1).max(3_600),
  dramaticBeat: z.string().min(1).max(2_000),
  openingState: z.string().min(1).max(4_000),
  endingState: z.string().min(1).max(4_000),
  boundary: z.enum(["cut", "continue"]).default("cut"),
  continuationFromSegmentId: z.string().min(1).optional(),
  generationIntent: z.enum(["storyboard", "transition"]).optional(),
  transitionFromSegmentId: z.string().min(1).optional(),
  transitionToSegmentId: z.string().min(1).optional(),
  description: z.string().max(8_000).optional(),
  action: z.string().max(8_000).optional(),
  dialogue: z.string().max(8_000).optional(),
  narration: z.string().max(8_000).optional(),
  audioReferences: h3AudioReferencesInput.optional(),
  soundDesign: z.string().max(4_000).optional(),
  h3VisualDescription: z.string().max(12_000).optional(),
  h3Soundscape: z.string().max(4_000).optional(),
  h3NonDiegeticMusic: z.string().max(2_000).optional(),
  storyboardFrameCount: z.union([z.literal(4), z.literal(6), z.literal(9)]).optional(),
  characterRefs: z.array(directorAssetRefSchema).max(20).default([]),
  sceneRefs: z.array(directorAssetRefSchema).max(20).default([]),
  propRefs: z.array(directorAssetRefSchema).max(20).default([]),
};

function directorVideoSegmentPayload(value: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(directorVideoSegmentPayloadShape).filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function normalizeAskUserInput(input: { summary?: string; questions: Array<{ id?: string; header?: string; question: string; type: "text" | "single_choice" | "multiple_choice"; allowCustomInput?: boolean; customInputPlaceholder?: string; options?: Array<{ label: string; description?: string }> }> }) {
  return {
    summary: input.summary,
    questions: input.questions.map((question, index) => ({
      ...question,
      id: question.id || `q${index + 1}`,
      allowCustomInput: question.allowCustomInput ?? true,
      options: question.options || [],
    })),
  };
}

export type AgentToolDefinition = { name: string; description: string; inputSchema: z.ZodRawShape; handler: (input: Record<string, unknown>, extra?: unknown) => Promise<CallToolResult> };
function tool<S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, handler: (input: z.output<z.ZodObject<S>>) => Promise<CallToolResult>): AgentToolDefinition { return { name, description, inputSchema, handler: (input) => handler(z.object(inputSchema).parse(input)) }; }
export function buildAgentMcpServer(context: AgentMcpContext, scene: AgentSceneDefinition) {
  return createSdkMcpServer({ name: "infinite_canvas", tools: buildAgentToolDefinitions(context, scene) });
}

export function buildAgentToolDefinitions(
  context: AgentMcpContext,
  scene: AgentSceneDefinition,
  engine: "builtin" | "codex" = "builtin",
) {
  const allowed = new Set(sceneTools(scene, engine).map((item) => item.id));
  const registeredTools = (server: { name: string; tools: AgentToolDefinition[] }) => server.tools.filter((item) => allowed.has(item.name));
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
  const sharedMediaTools = engine === "codex" ? [
    call("media_understand_audios", "理解工程内声音的语音、语气、音乐、环境声与声音事件；不提供精确逐词时间。", {
      items: z.array(z.object({ path: z.string().min(1).max(500), prompt: z.string().max(4_000).optional() })).min(1).max(8),
    }, (input) => understandDirectorAudios(run.userId, projectId, run.mediaModelRef, input as { items: Array<{ path: string; prompt?: string }> })),
    call("media_sample_video", "读取工程视频：overview 生成整片联系表，frames 按时间或均匀抽帧；返回工程内缓存图片路径，可直接用原生看图工具打开。", {
      path: z.string().min(1).max(500), mode: z.enum(["overview", "frames"]), count: z.number().int().min(1).max(16).optional(), timesSeconds: z.array(z.number().min(0)).min(1).max(16).optional(),
    }, (input) => sampleDirectorVideo(run.userId, projectId, input as { path: string; mode: "overview" | "frames"; count?: number; timesSeconds?: number[] })),
  ] : [
    call(
      "media_understand_images",
      "使用管理员配置的媒体理解模型分析一组图片。适合描述、比较、识别可见文字、检查风格或质量；同组图片共享上下文。",
      { fileIds: z.array(z.string().min(1)).min(1).max(8), prompt: z.string().max(4_000).optional(), detail: z.enum(["low", "high", "xhigh"]).optional() },
      (input) => understandProjectImages(run.userId, projectId, run.mediaModelRef, input as { fileIds: string[]; prompt?: string; detail?: "low" | "high" | "xhigh" }),
    ),
    call(
      "media_understand_audios",
      "使用同一个媒体理解模型批量理解音频的语音、语气、音乐、环境声和声音事件；只做声音语义，不提供精确逐词时间。",
      { items: z.array(z.object({ fileId: z.string().min(1), prompt: z.string().max(4_000).optional() })).min(1).max(8) },
      (input) => understandProjectAudios(run.userId, projectId, run.mediaModelRef, input as { items: Array<{ fileId: string; prompt?: string }> }),
    ),
    call(
      "media_prepare_video_overview",
      "使用本地 FFprobe/FFmpeg 探测视频并生成一张均匀覆盖全片的联系表，不调用模型；随后可把 contactSheet.fileId 交给图片理解工具。",
      { fileId: z.string().min(1), frameCount: z.number().int().min(4).max(20).optional() },
      (input) => prepareProjectVideoOverview(run.userId, projectId, input as { fileId: string; frameCount?: number }),
    ),
    call(
      "media_sample_video_frames",
      "使用本地 FFmpeg 从视频均匀抽帧或按明确秒数抽帧，不调用模型；返回的每张帧图可继续交给图片理解工具。",
      { fileId: z.string().min(1), count: z.number().int().min(1).max(16).optional(), timesSeconds: z.array(z.number().min(0)).min(1).max(16).optional() },
      (input) => sampleProjectVideoFrames(run.userId, projectId, input as { fileId: string; count?: number; timesSeconds?: number[] }),
    ),
  ];

  if (scene.id === "director")
    return registeredTools({
      name: "infinite_canvas",
      tools: [
        ...sharedMediaTools,
        call(
          "director_validate",
          "检查当前文件工程或指定相对目录的结构、Frontmatter、引用和媒体依赖；校验会更新索引，不改创作正文，也不代表画面或叙事质量验收通过。",
          { scope: z.string().max(500).optional() },
          (input) => validateDirectorProject(run.userId, projectId, String((input as { scope?: string }).scope || "")),
        ),
        call(
          "director_trash",
          "将当前导演工程中的创作文件或实体目录移入可恢复的 .trash；禁止移动工程清单和必要入口文件。",
          { path: z.string().min(1).max(500) },
          (input) => trashDirectorProjectPath(run.userId, projectId, String((input as { path: string }).path)),
        ),
        call(
          "director_get_state",
          "读取导演项目的轻量权威概览、revision 和实体数量。具体正文、剧情段落或视频段必须再调用对应读取工具。",
          {},
          () => getDirectorAgentOverview(run.userId, projectId),
        ),
        call(
          "director_get_document",
          "按类型分页读取故事或剧本正文及最新 revision；长文必须根据 hasMore 继续分页，不要一次读取全文。",
          { kind: z.enum(["story", "script"]), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100_000).optional() },
          (input) => { const value = input as { kind: "story" | "script"; offset?: number; limit?: number }; return getDirectorDocumentExcerpt(run.userId, projectId, value.kind, value); },
        ),
        call(
          "director_get_screenplay_breakdown",
          "读取当前剧本的结构化制作拆解、预计时长和是否已因剧本 revision 变化而过期。剧本正文仍应使用 director_get_document 读取。",
          {},
          () => getDirectorScreenplayBreakdown(run.userId, projectId),
        ),
        call(
          "director_list_sequences",
          "分页读取剧情段落清单、摘要和最新 revision，不返回重型故事板内容。",
          { offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional() },
          (input) => listDirectorSequenceSummaries(run.userId, projectId, input),
        ),
        call(
          "director_list_video_segments",
          "按剧情段落或标题分页读取视频段完整内容；需要批量处理时逐页读取，不要调用更新工具探测 revision。",
          {
            sequenceId: z.string().min(1).optional(),
            q: z.string().max(300).optional(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(10).optional(),
            view: z.enum(["prompt", "full"]).optional(),
          },
          (input) => listDirectorVideoSegments(run.userId, projectId, input),
        ),
        call(
          "director_get_video_segment",
          "按 ID 读取一个视频段的完整内容、故事板、提示词和最新 revision。",
          { segmentId: z.string().min(1) },
          (input) => getDirectorVideoSegment(run.userId, projectId, (input as { segmentId: string }).segmentId),
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
          "按 revision 更新导演项目目标时长、画幅、阶段或项目级导演规则。视觉风格不写入这里。",
          {
            revision: z.number().int().positive(),
            targetDurationSeconds: z.number().int().min(10).optional(),
            aspectRatio: z.enum(["16:9", "9:16", "1:1", "2.39:1"]).optional(),
            stage: z.string().optional(),
            status: z.enum(["draft", "confirmed", "locked"]).optional(),
            directingRules: z.object({
              positioning: z.string().max(10_000),
              intent: z.string().max(10_000),
              photography: z.string().max(10_000),
              performance: z.string().max(10_000),
              pacing: z.string().max(10_000),
              sound: z.string().max(10_000),
              prohibitions: z.string().max(10_000),
            }).partial().optional(),
          },
          (input) => updateDirectorWorkspace(run.userId, projectId, input),
        ),
        call(
          "director_update_document",
          "按 revision 更新 Markdown 小说或标准分场剧本正文。保存后即作为当前采用版本，不存在额外确认状态；生产拆解不得写入正文。",
          {
            kind: z.enum(["story", "script"]),
            revision: z.number().int().positive(),
            content: z.string().max(20_000_000).optional(),
          },
          async (input) => {
            const value = input as {
              kind: "story" | "script";
              revision: number;
              content?: string;
            };
            return updateDirectorDocument(
              run.userId,
              projectId,
              value.kind,
              { revision: value.revision, ...(value.content === undefined ? {} : { content: value.content }) },
            );
          },
        ),
        call(
          "director_update_screenplay_breakdown",
          "按剧本 revision 保存独立制作拆解。只写场次、表演节拍、素材候选和预计时长，不得改写剧本正文。",
          {
            revision: z.number().int().positive(),
            scriptRevision: z.number().int().positive(),
            scenes: z.array(z.object({
              id: z.string().min(1).max(128), heading: z.string().min(1).max(500), title: z.string().min(1).max(300),
              location: z.string().min(1).max(300), timeOfDay: z.string().min(1).max(100), interiorExterior: z.enum(["interior", "exterior", "mixed"]),
              characterNames: z.array(z.string().min(1).max(200)).max(100), propNames: z.array(z.string().min(1).max(200)).max(100),
              openingState: z.string().max(2_000), endingState: z.string().max(2_000), dramaticTurn: z.string().max(2_000),
              requiredDialogue: z.array(z.string().min(1).max(2_000)).max(100),
              beats: z.array(z.object({ id: z.string().min(1).max(128), summary: z.string().min(1).max(2_000), estimatedSeconds: z.number().int().min(1).max(3_600) })).min(1).max(100),
              estimatedSeconds: z.number().int().min(1).max(86_400),
            })).max(1_000),
            reviewIssues: z.array(z.object({
              type: z.enum(["duration", "repetition", "causality", "scene_function", "coverage"]),
              sceneIds: z.array(z.string().min(1).max(128)).max(100), summary: z.string().min(1).max(2_000), suggestion: z.string().min(1).max(2_000),
            })).max(500),
          },
          (input) => updateDirectorScreenplayBreakdown(run.userId, projectId, input),
        ),
        call(
          "director_create_sequences",
          "根据当前未过期的剧本制作拆解批量创建剧情段落及结构化故事板规划。",
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
          (input) => {
            requireDirectorScreenplayReady(run.userId, projectId);
            return (input as { items: Array<Record<string, unknown>> }).items.map(
              (item) => createDirectorSequence(run.userId, projectId, item),
            );
          },
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
          "批量删除剧情段落及其视频段，始终需要审批。",
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
          "director_generate_storyboard",
          "读取视频段工程目录，为一个 4–15 秒视频段生成一张包含 4、6 或 9 个画格的完整故事板；用户必须显式发起。优先传 segmentPath。",
          { segmentPath: z.string().min(1).optional(), segmentId: z.string().min(1).optional(), revision: z.number().int().positive().optional(), model: z.string().optional() },
          (input) => {
            const value = input as { segmentPath?: string; segmentId?: string; revision?: number } & Record<string, unknown>;
            const segmentId = value.segmentPath ? resolveDirectorEntityReference(run.userId, projectId, value.segmentPath, ["video-segment"]).id : value.segmentId;
            if (!segmentId) throw mcpError(400, "DIRECTOR_SEGMENT_REQUIRED", "请提供 segmentPath");
            const segment = getDirectorVideoSegment(run.userId, projectId, segmentId);
            return createDirectorStoryboardGeneration(run.userId, segmentId, { ...value, revision: value.revision ?? segment.revision });
          },
        ),
        call(
          "director_create_video_segments",
          "根据剧本场次与表演节拍批量规划 4–15 秒视频段。必须填写来源场次、来源节拍、承接时长、唯一戏剧变化和开始/结束状态；不得压缩或静默丢失剧本内容。",
          {
            items: z
              .array(
                z.object({
                  sequenceId: z.string().min(1),
                  title: z.string().min(1).max(300),
                  position: z.number().int().min(0).optional(),
                  ...directorVideoSegmentPayloadShape,
                }),
              )
              .min(1)
              .max(500),
          },
          (input) => (input as { items: Array<Record<string, unknown>> }).items.map((item) => createDirectorVideoSegment(run.userId, projectId, {
            sequenceId: item.sequenceId,
            title: item.title,
            position: item.position,
            payload: directorVideoSegmentPayload(item),
          })),
        ),
        call(
          "director_update_video_segment",
          "按 revision 更新单个视频段结构和素材引用。批量匹配素材或统一修订时使用 director_update_video_segments；故事板画格提示使用专用工具。",
          {
            segmentId: z.string().min(1),
            revision: z.number().int().positive(),
            position: z.number().int().min(0).optional(),
            title: z.string().max(300).optional(),
            status: z.enum(["draft", "confirmed", "locked"]).optional(),
            ...Object.fromEntries(Object.entries(directorVideoSegmentPayloadShape).map(([key, schema]) => [key, schema.optional()])),
          },
          async (input) => {
            const value = input as { segmentId: string; status?: string } & Record<
              string,
              unknown
            >;
            const current = getDirectorState(run.userId, projectId).videoSegments.find(
              (item) => item.id === value.segmentId,
            );
            const locked =
              current?.status === "locked" &&
              ((value.status !== undefined && value.status !== "locked") ||
                Object.keys(value).some(
                  (key) => !["segmentId", "revision", "status"].includes(key),
                ));
            if (locked)
              await context.requireDecision("director_update_video_segment", value);
            return updateDirectorVideoSegment(run.userId, value.segmentId, {
              revision: value.revision,
              position: value.position,
              title: value.title,
              status: value.status,
              payload: directorVideoSegmentPayload(value),
            }, locked);
          },
        ),
        call(
          "director_update_video_segments",
          "按各自 revision 批量更新最多 100 个视频段的结构和角色、场景、道具引用；用于素材匹配和统一规划，避免逐段重复调用。故事板画格提示仍使用专用工具。",
          {
            items: z.array(z.object({
              segmentId: z.string().min(1),
              revision: z.number().int().positive(),
              position: z.number().int().min(0).optional(),
              title: z.string().max(300).optional(),
              status: z.enum(["draft", "confirmed", "locked"]).optional(),
              ...Object.fromEntries(Object.entries(directorVideoSegmentPayloadShape).map(([key, schema]) => [key, schema.optional()])),
            })).min(1).max(100),
          },
          async (input) => {
            const items = (input as { items: Array<Record<string, unknown>> }).items;
            const current = new Map(getDirectorState(run.userId, projectId).videoSegments.map((item) => [item.id, item]));
            const locked = items.some((item) => current.get(String(item.segmentId))?.status === "locked");
            if (locked) await context.requireDecision("director_update_video_segments", input);
            return items.map((item) => updateDirectorVideoSegment(run.userId, String(item.segmentId), {
              revision: item.revision,
              position: item.position,
              title: item.title,
              status: item.status,
              payload: directorVideoSegmentPayload(item),
            }, locked));
          },
        ),
        call(
          "director_validate_video_segments",
          "只读校验最多 100 个视频段的来源节拍、时长守恒、故事板 Shot 结构、素材、H3 英文视觉描述、结构化对白和声景是否可生成；不创建任务、不消费额度。",
          { ...(engine === "codex" ? {} : { segmentIds: z.array(z.string().min(1)).min(1).max(100).optional() }), segmentPaths: z.array(z.string().min(1)).min(1).max(100).optional() },
          (input) => {
            reconcileDirectorProjectFiles(run.userId, projectId);
            assertDirectorProjectValid(run.userId, projectId);
            const value = input as { segmentIds?: string[]; segmentPaths?: string[] };
            const ids = value.segmentPaths?.map((path) => resolveDirectorEntityReference(run.userId, projectId, path, ["video-segment"]).id) || value.segmentIds;
            if (!ids?.length) throw new Error("请提供 segmentPaths");
            return ids.map((segmentId) => {
              const segment = getDirectorVideoSegment(run.userId, projectId, segmentId);
              const preflight = getDirectorVideoSegmentPreflight(run.userId, segmentId);
              return { segmentId, title: segment.title, revision: segment.revision, ready: preflight.blockedReasons.length === 0, blockedReasons: preflight.blockedReasons, warnings: preflight.warnings, route: preflight.route, capabilities: preflight.capabilities, nativeWindow: preflight.nativeWindow, durationLimits: { minSeconds: 4, maxSeconds: preflight.capabilities.nativeState && (segment.payload as Record<string, unknown>).boundary === "continue" ? 340 / 24 : 15 }, usesStoryboardStartGuide: Boolean(preflight.storyboardStartGuide), referenceBudget: { selected: preflight.videoSelected.map(({ name, purpose }) => ({ name, purpose })), omitted: preflight.videoOmitted.map(({ name, purpose }) => ({ name, purpose })) }, previewAudioPolicy: preflight.previewAudioPolicy };
            });
          },
        ),
        call(
          "director_update_storyboard_prompts",
          "安全更新最多 10 个视频段的整板时序语义。对白必须绑定角色素材、原文、语言、英文语气及起止时间；声音字段只允许英文环境声、动作声和非语言人声。服务端保留整张故事板媒体并标记旧结果过期。",
          {
            items: z.array(z.object({
              segmentId: z.string().min(1),
              revision: z.number().int().positive(),
              frames: z.array(z.object({
                id: z.string().min(1),
                shotNumber: z.number().int().min(1).max(3),
                timeSeconds: z.number().min(0).max(15),
                kind: z.enum(["shot-start", "keyframe", "shot-end"]),
                description: z.string().max(4_000),
                action: z.string().max(4_000),
                cameraAngle: z.string().max(1_000),
                cameraMove: z.string().max(1_000),
                h3Visual: z.string().min(1).max(6_000),
                dialogues: z.array(z.object({
                  speakerAssetId: z.string().min(1),
                  speakerName: z.string().min(1).max(120),
                  text: z.string().min(1).max(2_000),
                  language: z.string().min(1).max(40).default("Chinese"),
                  delivery: z.string().min(1).max(1_000),
                  startSeconds: z.number().min(0).max(15),
                  endSeconds: z.number().positive().max(15),
                  offScreen: z.boolean().optional(),
                })).max(8).default([]),
                sound: z.string().max(2_000),
              })).min(1).max(9),
            })).min(1).max(10),
          },
          async (input) => {
            const value = input as { items: Array<{ segmentId: string }> };
            const locked = value.items.some((item) => getDirectorVideoSegment(run.userId, projectId, item.segmentId).status === "locked");
            if (locked) await context.requireDecision("director_update_storyboard_prompts", value);
            return updateDirectorStoryboardPrompts(run.userId, projectId, input, locked);
          },
        ),
        call(
          "director_delete_video_segments",
          "批量删除视频段，始终需要审批。",
          { ids: z.array(z.string().min(1)).min(1).max(500) },
          async (input) => {
            const value = input as { ids: string[] };
            await context.requireDecision("director_delete_video_segments", value);
            return value.ids.map((id) =>
              deleteDirectorVideoSegment(run.userId, id, true),
            );
          },
        ),
        call(
          "director_generate_video_segment",
          "读取视频段工程目录并锁定当前故事板快照，以完整故事板和素材参考生成带原生声音的视频段；已就绪的普通 Ref2VA 图片参考默认使用加速配方，recipe=base 显式使用基础版。续接沿用前段配方，切换配方需从连续镜头首段重做。优先传 segmentPath。",
          {
            segmentPath: engine === "codex" ? z.string().min(1) : z.string().min(1).optional(),
            ...(engine === "codex" ? {} : { segmentId: z.string().min(1).optional(), revision: z.number().int().positive().optional() }),
            model: z.string().optional(),
            qualityPreset: z.enum(["preview", "final"]).default("preview"),
            recipe: z.enum(["base", "pdd-ref8"]).optional(),
          },
          (input) => {
            const value = input as { segmentPath?: string; segmentId?: string; revision?: number } & Record<string, unknown>;
            const segmentId = value.segmentPath ? resolveDirectorEntityReference(run.userId, projectId, value.segmentPath, ["video-segment"]).id : value.segmentId;
            if (!segmentId) throw mcpError(400, "DIRECTOR_SEGMENT_REQUIRED", "请提供 segmentPath");
            const segment = getDirectorVideoSegment(run.userId, projectId, segmentId);
            return createDirectorVideoSegmentGeneration(
              run.userId,
              segmentId,
              { ...value, revision: value.revision ?? segment.revision },
            );
          },
        ),
        call(
          "director_update_timeline",
          "按 revision 编排视频段主轨、模型原声与对白、旁白、环境声、音效、音乐轨。",
          {
            revision: z.number().int().positive(),
            payload: z.record(z.string(), z.unknown()),
          },
          (input) => updateDirectorTimeline(run.userId, projectId, input),
        ),
        call(
          "director_check_continuity",
          "检查视频段资产 revision、连续边界、4–15 秒时长、缺失视频与声音铺轨，不产生生成费用。",
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
          "根据剧本正文与当前未过期制作拆解创建角色、场景和道具导演素材，不创建任何画布节点；素材无需额外确认即可继续后续设计。",
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
              requireDirectorScreenplayReady(run.userId, projectId);
              const output = {
                assets: createAgentCreativeAssetBatch(
                  run.userId,
                  projectId,
                  value.items,
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
          engine === "codex" ? "director_generate_sound" : "director_generate_asset",
          engine === "codex" ? "按素材工程目录中的声音提示词与目标哈希生成声音；图片使用 Codex 原生生图。" : "按素材工程目录中的提示词、输入媒体与目标哈希生成主形象、指定变体或声音。",
          {
            assetPath: z.string().min(1),
            ...(engine === "codex" ? {} : { target: z.enum(["primary-visual", "variant-visual", "sound"]), variantId: z.string().min(1).max(128).optional() }),
            expectedHash: z.string().min(1),
          },
          (input) => {
            const value = input as { assetPath: string; target: "primary-visual" | "variant-visual" | "sound"; variantId?: string; expectedHash: string };
            reconcileDirectorProjectFiles(run.userId, projectId);
            const assetId = resolveDirectorEntityReference(run.userId, projectId, value.assetPath, ["character", "scene", "prop"]).id;
            requireDirectorMediaStage(run.userId, projectId);
            return createDirectorAssetGeneration(run.userId, assetId, engine === "codex" ? { assetPath: value.assetPath, expectedHash: value.expectedHash, target: "sound" } : value);
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
          "创建并立即采用导演项目的模板或自定义视觉风格。",
          canvasToolSchemas.visual_style_create.omit({ status: true }).shape,
          (input) => {
            const value = input as z.infer<
              typeof canvasToolSchemas.visual_style_create
            >;
            const projectId = project(value);
            const style = createAgentVisualStyle(run.userId, projectId, value);
            defaultAgentVisualStyle(run.userId, projectId, style.id);
            return style;
          },
        ),
        call(
          "director_update_style",
          "按 revision 更新当前采用的导演视觉风格。",
          canvasToolSchemas.visual_style_update.omit({ status: true }).shape,
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
          "生成一张同时展示角色、场景和道具视觉语言的统一风格板。",
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
          engine === "codex" ? { kind: z.enum(["audio", "video"]).optional() } : canvasToolSchemas.generation_list_models.shape,
          (input) => engine === "codex" ? directorMediaModels(input as { kind?: "audio" | "video" }) :
            generationModels(
              input as z.infer<typeof canvasToolSchemas.generation_list_models>,
            ),
        ),
        call(
          "director_get_generation_status",
          "查询本导演项目的生成任务状态。",
          directorTaskQuery.shape,
          (input) => getDirectorGenerationTasks(run.userId, projectId, input),
        ),
        call(
          "director_list_renders",
          "分页查询本项目成片任务，或按 id 查询单个任务；只返回状态、进度、警告和工程产物路径。",
          directorTaskQuery.shape,
          (input) => getDirectorRenderTasks(run.userId, projectId, input),
        ),
        call(
          "director_start_render",
          "校验工程并以当前文件时间线发起完整 MP4 合成；成功后归档到 renders/。",
          { timelineRevision: z.number().int().positive().optional() },
          (input) => {
            reconcileDirectorProjectFiles(run.userId, projectId);
            assertDirectorProjectValid(run.userId, projectId);
            const state = getDirectorState(run.userId, projectId);
            return createDirectorRender(run.userId, projectId, { timelineRevision: (input as { timelineRevision?: number }).timelineRevision ?? state.timeline.revision });
          },
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
          "重试失败或取消的成片任务；仅允许原时间线 revision，使用该时间线当前有效媒体。时间线改变后请新建合成任务。",
          { renderId: z.string().min(1) },
          (input) => {
            const value = input as { renderId: string };
            reconcileDirectorProjectFiles(run.userId, projectId);
            assertDirectorProjectValid(run.userId, projectId);
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
                /^\/director\/[^/]+(?:\/(?:overview|story|script|style|assets|storyboard|studio))?$/,
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
          "向用户提出最少必要问题并等待回答。有建议方案时，将唯一推荐项的 label 追加 ` (Recommended)` 并排在第一位，不得代用户预选。",
          askUserShape,
          async (input) => {
            const normalized = normalizeAskUserInput(input);
            const result = await context.requireDecision(
              "ask_user",
              normalized,
              "question",
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ ok: true, answers: result.answers || {} }, null, 2),
                },
              ],
            };
          },
        ),
      ],
    });

  return registeredTools({
    name: "infinite_canvas",
    tools: [
      ...sharedMediaTools,
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
        "生成一张同时展示角色、场景和道具视觉语言的统一风格板。",
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
        "向用户提出最少必要问题并等待回答。有建议方案时，将唯一推荐项的 label 追加 ` (Recommended)` 并排在第一位，不得代用户预选。",
        askUserShape,
        async (input) => {
          const normalized = normalizeAskUserInput(input);
          const result = await context.requireDecision(
            "ask_user",
            normalized,
            "question",
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, answers: result.answers || {} }, null, 2),
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
  const segmentIds = new Set(state.videoSegments.map((segment) => segment.id));
  const payload = (value: unknown) => value as Record<string, unknown>;
  return {
    staleSequences: state.sequences
      .filter((sequence) => payload(sequence.payload).needsReview)
      .map((sequence) => sequence.id),
    staleVideoSegments: state.videoSegments
      .filter(
        (segment) =>
          payload(segment.payload).needsReview || payload(segment.payload).videoStale,
      )
      .map((segment) => segment.id),
    missingVideos: state.videoSegments
      .filter((segment) => !payload(segment.payload).videoFileId)
      .map((segment) => segment.id),
    brokenContinuations: state.videoSegments
      .filter(
        (segment) =>
          payload(segment.payload).boundary === "continue" &&
          (!payload(segment.payload).continuationFromSegmentId ||
            !segmentIds.has(String(payload(segment.payload).continuationFromSegmentId))),
      )
      .map((segment) => segment.id),
  };
}

function requireDirectorDocumentContent(
  userId: string,
  projectId: string,
  kind: "story" | "script",
) {
  const document = getDirectorState(userId, projectId).documents.find(
    (item) => item.kind === kind,
  );
  if (!document?.content.trim())
    throw mcpError(
      409,
      "DIRECTOR_STAGE_GATE",
      `请先完成${kind === "script" ? "剧本" : "故事"}`,
    );
}

function requireDirectorScreenplayReady(userId: string, projectId: string) {
  requireDirectorDocumentContent(userId, projectId, "script");
  const breakdown = getDirectorScreenplayBreakdown(userId, projectId);
  if (breakdown.stale || breakdown.payload.review.status === "not_run")
    throw mcpError(409, "DIRECTOR_SCREENPLAY_BREAKDOWN_REQUIRED", "请先运行最新剧本的制作拆解");
  if (breakdown.payload.review.status === "needs_revision")
    throw mcpError(409, "DIRECTOR_SCREENPLAY_NEEDS_REVISION", "制作拆解发现剧本仍需修订，请先处理诊断问题");
}

function requireDirectorMediaStage(userId: string, projectId: string) {
  requireDirectorDocumentContent(userId, projectId, "script");
  const state = getDirectorState(userId, projectId);
  if (!state.activeStyleId || !listAgentVisualStyles(userId, projectId).some((style) => style.id === state.activeStyleId))
    throw mcpError(409, "DIRECTOR_STAGE_GATE", "请先选择当前视觉风格");
}

function assertDirectorRender(
  userId: string,
  projectId: string,
  renderId: string,
) {
  if (!db.prepare("SELECT 1 FROM director_renders WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, renderId))
    throw mcpError(
      404,
      "DIRECTOR_RENDER_NOT_FOUND",
      "成片任务不存在或不属于当前导演项目",
    );
}
