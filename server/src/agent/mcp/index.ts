import { createDirectorLookFrameGeneration } from "../../director-look-frame.js";
import { exposeImagePaths } from "../image-files.js";
import { createDirectorLookFrame, readDirectorPrevis } from "../../director-previs.js";
import { createPrevisRender, getPrevisRender, listPrevisRenders, cancelPrevisRender, retryPrevisRender } from "../../director-previs-render.js";
import { listPublicModels } from "../../provider-service.js";
import { validateGenerationRequest } from "../../generation-service.js";
import { executorComfyModels } from "../../media-capabilities.js";
import { listMediaCapabilities } from "../../media-capabilities.js";
import { createMediaGeneration, prepareMediaGeneration, mediaGenerationShape } from "../../media-generation.js";
import { listProjectMediaGenerations, mediaGenerationStatus, cancelProjectMedia, importMediaReference, saveMediaResult, readMediaTranscription } from "../media-tools.js";
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
  getDirectorPlaybackPlan,
  cancelDirectorRender,
  createDirectorRender,
  createDirectorVideoSegmentGeneration,

  getDirectorVideoSegmentPreflightWithFraming,
  listDirectorRenders,
  retryDirectorRender,

} from "../../director-render.js";
import { sceneTools, type AgentSceneDefinition } from "../scenes/index.js";
import { listDirectorSegmentPlans, saveDirectorSegmentPlan, reconcileDirectorProjectFiles, assertDirectorProjectValid, resolveDirectorEntityReference, trashDirectorProjectPath, validateDirectorProject } from "../../director-workspace.js";
import { createDirectorAssetGeneration } from "../../creative-asset-generation.js";
import {
  addAsset,
  applyCanvasOps,
  canvasToolSchemas,
  createAgentGeneration,
  readCanvasState,
  canvasMutationSummary,
  adoptCanvasResult,
  deleteAssets,
  generationModels,
  getCanvasState,
  listAssets,
  createAgentCreativeAssetBatch,
  deleteAgentCreativeAsset,
  getAgentCreativeAsset,
  listAgentCreativeAssets,
  updateAgentCreativeAsset,
  createAgentVisualStyle,
  defaultAgentVisualStyle,
  deleteAgentVisualStyle,
  getAgentVisualStyle,
  listAgentVisualStyleTemplates,
  listAgentVisualStyles,
  updateAgentVisualStyle,
  analyzeAgentVisualStyle,
  generateAgentVisualStyleReferences,
} from "../canvas-tools.js";
import { createDirectorMusicGeneration, directorMediaModels, directorTaskQuery, getDirectorGenerationTasks, getDirectorRenderTasks } from "../director-tools.js";
import { sampleDirectorVideo, understandDirectorAudios, prepareProjectVideoOverview, sampleProjectVideoFrames, understandProjectAudios } from "../media-understanding.js";

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
        const result = exposeImagePaths(run.userId, await handler(typedInput), context.resolveWorkspacePath);
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
          _meta: { directorRetrySafe: (error as { code?: string } | null)?.code === "DIRECTOR_STAGE_GATE" },
        };
      }
    });
  const project = (input: { projectId?: string }) => {
    if (projectId && input.projectId && input.projectId !== projectId)
      throw mcpError(403, "AGENT_PROJECT_ISOLATED", "项目会话不能操作其他项目");
    return input.projectId || projectId;
  };
  const mediaCapabilityTools = [
    call("media_list_capabilities", "读取媒体执行器的模型、输入限制、生成与续接操作及运行时可用性。可用不代表质量验收通过。", {}, () => listMediaCapabilities()),
    call("media_validate_generation", "校验中立媒体请求并返回执行计划；不创建生成任务。", mediaGenerationShape, async (input) => ({ valid: true, plan: (await prepareMediaGeneration(run.userId, input)).plan })),
    call("media_generate", "提交中立媒体任务；返回任务 ID。结果需显式保存或由项目工作流采用，不自动加入时间线。", mediaGenerationShape, (input) => createMediaGeneration(run.userId, input, projectId)),
    call("media_get_generation_status", "传 generationId 读取任务结果与执行快照；省略时分页读取当前项目持久任务摘要，用于恢复查询，不返回提示词或完整结果。", { generationId: z.string().min(1).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) }, (input: { generationId?: string; offset: number; limit: number }) => input.generationId ? mediaGenerationStatus(run.userId, projectId, input.generationId) : listProjectMediaGenerations(run.userId, projectId, input.offset, input.limit)),
    call("media_read_transcription", "按片段分页读取当前项目转写或参考文本对齐结果；完整 JSON 可用 media_save_result 保存。", { generationId: z.string().min(1), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(10) }, (input: { generationId: string; offset: number; limit: number }) => readMediaTranscription(run.userId, projectId, input.generationId, input.offset, input.limit)),
    call("media_cancel_generation", "取消当前项目的媒体任务。", { generationId: z.string().min(1) }, (input: { generationId: string }) => cancelProjectMedia(run.userId, projectId, input.generationId)),
    call("media_import_reference", "将工程内媒体文件登记为显式参考，返回 fileId。", { path: z.string().min(1).max(500) }, (input: { path: string }) => importMediaReference(run.userId, projectId, context.resolveWorkspacePath(input.path))),
    call("media_save_result", "把当前项目已完成任务的指定结果保存到工程相对路径；保留扩展名，不覆盖已有文件。", { generationId: z.string().min(1), fileId: z.string().min(1), path: z.string().min(1).max(500) }, (input: { generationId: string; fileId: string; path: string }) => ({ ...saveMediaResult(run.userId, projectId, input.generationId, input.fileId, context.resolveWorkspacePath(input.path)), path: input.path })),
  ];
  const canvasGenerationShape = { request: z.discriminatedUnion("source", [
    z.object({ source: z.literal("executor"), ...mediaGenerationShape }),
    canvasToolSchemas.generation_create.omit({ projectId: true, nodeId: true }).extend({ source: z.literal("channel"), kind: engine === "codex" ? z.enum(["text", "video", "audio"]) : canvasToolSchemas.generation_create.shape.kind }),
  ]) };
  type CanvasGenerationInput = z.infer<z.ZodObject<typeof canvasGenerationShape>>;
  const checkChannel = (request: Extract<CanvasGenerationInput["request"], { source: "channel" }>) => {
    const { source: _source, ...value } = request;
    const selection = validateGenerationRequest(run.userId, value);
    if (selection.providerId === "local-media" || (selection.comfyServerId === "media-executor" && executorComfyModels.has(selection.modelId))) throw new Error("媒体执行器模型必须选择 source=executor，提交能力目录要求的参数");
    return value;
  };
  const canvasMediaTools = [
    ...mediaCapabilityTools.filter((item) => !["media_list_capabilities", "media_validate_generation", "media_generate"].includes(item.name)),
    call("media_list_capabilities", "统一发现管理员渠道模型与中立执行器能力；提交时使用对应 source。执行器离线不影响渠道模型查询。", {}, async () => ({
      channels: listPublicModels().filter((item) => (engine !== "codex" || item.output !== "image") && !item.value.startsWith("local-media::") && ![...executorComfyModels].some((id) => item.value.endsWith(`::${id}`))).map((item) => ({ ...item, source: "channel" })),
      executor: await listMediaCapabilities().then((result) => ({ ...result, source: "executor", available: true })).catch((error: unknown) => ({ source: "executor", available: false, error: error instanceof Error ? error.message : "执行器不可用" })),
    })),
    call("media_validate_generation", "校验生成请求；request.source=channel 使用管理员模型，executor 使用中立能力参数。不会创建任务。", canvasGenerationShape,
      async ({ request }: CanvasGenerationInput) => request.source === "executor" ? { valid: true, plan: (await prepareMediaGeneration(run.userId, request)).plan } : { valid: true, request: checkChannel(request) }),
    call("media_generate", "提交当前画布生成任务。request.source 区分 channel 与 executor；查询统一用 media_get_generation_status，成功后用 canvas_adopt_result 显式采用。", canvasGenerationShape,
      ({ request }: CanvasGenerationInput) => request.source === "executor" ? createMediaGeneration(run.userId, request, projectId) : createAgentGeneration(run.userId, checkChannel(request), projectId)),
  ];
  const sharedMediaTools = engine === "codex" && scene.id === "director" ? [
    call("media_understand_audios", "理解工程内声音的语音、语气、音乐、环境声与声音事件；不提供精确逐词时间。", {
      items: z.array(z.object({ path: z.string().min(1).max(500), prompt: z.string().max(4_000).optional() })).min(1).max(8),
    }, (input) => understandDirectorAudios(run.userId, projectId, run.mediaModelRef, input as { items: Array<{ path: string; prompt?: string }> })),
    call("media_sample_video", "读取工程视频：overview 生成整片联系表，frames 按时间或均匀抽帧；返回工程内缓存图片路径，可直接用原生看图工具打开。", {
      path: z.string().min(1).max(500), mode: z.enum(["overview", "frames"]), count: z.number().int().min(1).max(16).optional(), timesSeconds: z.array(z.number().min(0)).min(1).max(16).optional(),
    }, (input) => sampleDirectorVideo(run.userId, projectId, input as { path: string; mode: "overview" | "frames"; count?: number; timesSeconds?: number[] })),
  ] : [
    call(
      "media_understand_audios",
      "使用同一个媒体理解模型批量理解音频的语音、语气、音乐、环境声和声音事件；只做声音语义，不提供精确逐词时间。",
      { items: z.array(z.object({ fileId: z.string().min(1), prompt: z.string().max(4_000).optional() })).min(1).max(8) },
      (input) => understandProjectAudios(run.userId, projectId, run.mediaModelRef, input as { items: Array<{ fileId: string; prompt?: string }> }),
    ),
    call(
      "media_prepare_video_overview",
      "使用本地 FFprobe/FFmpeg 探测视频并生成一张均匀覆盖全片的联系表，不调用模型；随后用原生看图读取返回的图片路径。",
      { fileId: z.string().min(1), frameCount: z.number().int().min(4).max(20).optional() },
      (input) => prepareProjectVideoOverview(run.userId, projectId, input as { fileId: string; frameCount?: number }),
    ),
    call(
      "media_sample_video_frames",
      "使用本地 FFmpeg 从视频均匀抽帧或按明确秒数抽帧，不调用模型；返回的每张帧图可用原生看图读取。",
      { fileId: z.string().min(1), count: z.number().int().min(1).max(16).optional(), timesSeconds: z.array(z.number().min(0)).min(1).max(16).optional() },
      (input) => sampleProjectVideoFrames(run.userId, projectId, input as { fileId: string; count?: number; timesSeconds?: number[] }),
    ),
  ];

  const canvasVideoTool = call("media_sample_video", "视频取样：overview 返回全片联系表，frames 按时间或均匀抽帧；用原生看图读取返回的图片路径。", {
    fileId: z.string().min(1), mode: z.enum(["overview", "frames"]), count: z.number().int().min(1).max(16).optional(), timesSeconds: z.array(z.number().min(0)).min(1).max(16).optional(),
  }, (input: { fileId: string; mode: "overview" | "frames"; count?: number; timesSeconds?: number[] }) => {
    if (input.mode === "overview") {
      if (input.timesSeconds || (input.count !== undefined && input.count < 4)) throw new Error("联系表至少 4 帧，不接受指定时间点");
      return prepareProjectVideoOverview(run.userId, projectId, { fileId: input.fileId, frameCount: input.count });
    }
    return sampleProjectVideoFrames(run.userId, projectId, input);
  });
  if (scene.id === "director")
    return registeredTools({
      name: "infinite_canvas",
      tools: [
        ...sharedMediaTools,
        ...mediaCapabilityTools,
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
        call("director_read_segments", "分页读取分镜段设计与文件 hash；每段可包含多个镜头，时长独立于单次生成窗口。", { offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(20).default(10) }, (input) => { const value = input as { offset: number; limit: number }; return listDirectorSegmentPlans(run.userId, projectId, value.offset, value.limit); }),
        call("director_read_previs", "按字段与分页读取当前分镜段预演、诊断和版本；修改使用工程文件，完成后校验。", { segmentId: z.string(), section: z.enum(["summary", "objects", "shots", "tracks", "actions", "attachments", "dialogue", "lookFrames"]).default("summary"), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(20).default(10) }, (input) => {
            const value = input as { segmentId: string; section: string; offset: number; limit: number }, state = readDirectorPrevis(run.userId, projectId, value.segmentId);
            const common = { segmentId: value.segmentId, hash: state.hash, aspectRatio: state.aspectRatio, previsMode: state.previsMode, diagnostics: state.diagnostics, duration: state.plan?.duration };
            if (value.section === "summary") return { ...common, counts: { objects: state.scene?.objects.length || 0, shots: state.plan?.shots.length || 0, actions: state.plan?.actions.length || 0, lookFrames: state.lookFrames.length } };
            const items = value.section === "objects" ? (state.scene?.objects || []).map((object: { id: string }) => ({ ...object, initial: state.plan?.initial[object.id] })) : value.section === "lookFrames" ? state.lookFrames : state.plan?.[value.section] || [];
            return { ...common, total: items.length, offset: value.offset, items: items.slice(value.offset, value.offset + value.limit) };
        }),
        call("director_render_previs", "导出明确时间范围的静音预演视频，返回持久任务；不能把成功导出当作生成成片。", { segmentId: z.string(), expectedHash: z.string(), start: z.number().nonnegative().default(0), end: z.number().positive().optional() }, (input) => { const { segmentId, ...request } = input as { segmentId: string; expectedHash: string }; return createPrevisRender(run.userId, projectId, segmentId, request); }),
        ...(engine === "codex" ? [] : [call("director_generate_look_frame", "原样提交定妆帧 prompt.md 与显式参考图，通过管理员图片渠道生成并保存 primary.*；expectedHash 是提示词文件哈希。", { segmentId: z.string(), frameId: z.string(), expectedHash: z.string(), model: z.string().optional() }, (input) => createDirectorLookFrameGeneration(run.userId, projectId, input))]),
        call("director_capture_look_frame", "建立可选定妆帧并提取指定时刻的预演画面；返回路径，图片生成仍按当前引擎能力完成。", { segmentId: z.string(), expectedHash: z.string(), time: z.number().nonnegative(), frameId: z.string().optional() }, (input) => {
            const value = input as { segmentId: string; expectedHash: string; time: number; frameId?: string };
            const frame = createDirectorLookFrame(run.userId, projectId, value.segmentId, value.time, value.expectedHash, value.frameId);
            return { frame, render: createPrevisRender(run.userId, projectId, value.segmentId, { expectedHash: frame.sourceHash, kind: "frame", frameId: frame.id, start: frame.time }) };
        }),
        call("director_previs_render_status", "读取或恢复预演导出状态；支持查询、取消和失败重试。", { id: z.string().optional(), segmentId: z.string().optional(), action: z.enum(["read", "cancel", "retry"]).default("read"), offset: z.number().int().nonnegative().default(0) }, (input) => {
            const value = input as { id?: string; segmentId?: string; action: string; offset: number };
            if (value.id) return value.action === "cancel" ? cancelPrevisRender(run.userId, projectId, value.id) : value.action === "retry" ? retryPrevisRender(run.userId, projectId, value.id) : getPrevisRender(run.userId, projectId, value.id);
            if (!value.segmentId || value.action !== "read") throw new Error("查询列表需要 segmentId，取消和重试需要 id");
            return listPrevisRenders(run.userId, projectId, value.segmentId, value.offset);
        }),
        call("director_read_tasks", "分页读取制作任务、覆盖镜头、当前输出及 revision。", { sequenceId: z.string().optional(), q: z.string().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(10).default(5), view: z.enum(["prompt", "full"]).default("prompt") }, (input) => listDirectorVideoSegments(run.userId, projectId, input)),
        call("director_read_edit", "读取权威剪辑 revision 和有界播放计划。实际素材时间已解析累计续接偏移。", { offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }, async (input) => { const { offset, limit } = input as { offset: number; limit: number }; const plan = await getDirectorPlaybackPlan(run.userId, projectId); return { ...plan, segments: plan.segments.slice(offset, offset + limit), audio: plan.audio.slice(offset, offset + limit), totalVideoClips: plan.segments.length, totalAudioClips: plan.audio.length, nextOffset: Math.max(plan.segments.length, plan.audio.length) > offset + limit ? offset + limit : null }; }),
        call("director_edit_timeline", "按当前 revision 保存独立视频片段与声音编排。videoClips 支持重复 taskId 和独立 id/trimIn/trimOut/linkedAudio。", { revision: z.number().int().positive(), payload: z.record(z.string(), z.unknown()) }, (input) => updateDirectorTimeline(run.userId, projectId, input)),
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
          "director_preflight_tasks",
          "只读校验制作任务的实际模型时长窗口、显式输入、最终提示与续接状态；按 segmentRanges 与预演导出范围核对，不静默拉伸或截断剧情。",
          { ...(engine === "codex" ? {} : { segmentIds: z.array(z.string().min(1)).min(1).max(100).optional() }), taskPaths: z.array(z.string().min(1)).min(1).max(100).optional() },
          async (input) => {
            reconcileDirectorProjectFiles(run.userId, projectId);
            assertDirectorProjectValid(run.userId, projectId);
            const value = input as { segmentIds?: string[]; taskPaths?: string[] };
            const ids = value.taskPaths?.map((path) => resolveDirectorEntityReference(run.userId, projectId, path, ["production-task"]).id) || value.segmentIds;
            if (!ids?.length) throw new Error("请提供 taskPaths");
            const results = [];
            for (const segmentId of ids) {
              const segment = getDirectorVideoSegment(run.userId, projectId, segmentId);
              const preflight = await getDirectorVideoSegmentPreflightWithFraming(run.userId, segmentId);
              results.push({ segmentId, title: segment.title, revision: segment.revision, ready: preflight.blockedReasons.length === 0, finalPrompt: preflight.finalPrompt, blockedReasons: preflight.blockedReasons, warnings: preflight.warnings, route: preflight.route, plan: preflight.plan, capabilities: preflight.capabilities, previsHashes: preflight.previsHashes, videoReferences: preflight.videoReferences, referenceBudget: { selected: preflight.videoSelected.map(({ name, purpose }) => ({ name, purpose })), omitted: preflight.videoOmitted.map(({ name, purpose }) => ({ name, purpose })) } });
            }
            return results;
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
          "director_generate_task",
          "读取 productions 制作任务和原样最终提示，按显式参考生成当前结果；可无故事板，成功后替换，失败保留旧媒体。续接沿用上游运行时身份与配方。优先传 taskPath。",
          {
            taskPath: engine === "codex" ? z.string().min(1) : z.string().min(1).optional(),
            ...(engine === "codex" ? {} : { segmentId: z.string().min(1).optional(), revision: z.number().int().positive().optional() }),
            model: z.string().optional(),
            qualityPreset: z.enum(["preview", "final"]).default("preview"),
            recipe: z.enum(["base", "pdd-ref8"]).optional(),
          },
          (input) => {
            const value = input as { taskPath?: string; segmentId?: string; revision?: number } & Record<string, unknown>;
            const segmentId = value.taskPath ? resolveDirectorEntityReference(run.userId, projectId, value.taskPath, ["production-task"]).id : value.segmentId;
            if (!segmentId) throw mcpError(400, "DIRECTOR_SEGMENT_REQUIRED", "请提供 taskPath");
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
        call("director_generate_music", "从工程配乐提示文件生成独立音乐；结果按任务 ID 查询并保存为独立音频，可加入时间线音乐轨。", {
          promptPath: z.string().min(1), expectedHash: z.string().min(1),
        }, (input) => {
          requireDirectorMediaStage(run.userId, projectId);
          return createDirectorMusicGeneration(run.userId, projectId, input as { promptPath: string; expectedHash: string });
        }),
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
      canvasVideoTool,
      ...canvasMediaTools,
      call("canvas_get_state", "分页读取当前画布的节点摘要、连线或指定节点正文；summary 返回统计和 revision。翻页时传 expectedRevision 防止混用版本。", canvasToolSchemas.canvas_get_state.shape,
        (input) => readCanvasState(run.userId, project(input as { projectId?: string }), input as z.infer<typeof canvasToolSchemas.canvas_get_state>)),
      call("canvas_apply_ops", "按 revision 批量新增或修改通用节点、连接节点。文本写入 metadata.content，一篇完整作品只创建一个文本节点；返回新 revision。", canvasToolSchemas.canvas_apply_ops.shape,
        (input) => { const value = input as z.infer<typeof canvasToolSchemas.canvas_apply_ops>; return canvasMutationSummary(applyCanvasOps(run.userId, project(value), value.ops, value.expectedRevision)); }),
      call("canvas_delete", "按 revision 一次删除指定节点及其关联连线、指定连线；执行前需要业务确认。", canvasToolSchemas.canvas_delete.shape,
        async (input) => {
          const value = input as z.infer<typeof canvasToolSchemas.canvas_delete>;
          if (!value.nodeIds.length && !value.connectionIds.length) throw new Error("请指定要删除的节点或连线");
          await context.requireDecision("canvas_delete", value);
          return canvasMutationSummary(applyCanvasOps(run.userId, project(value), [{ type: "delete_node", ids: value.nodeIds }, { type: "delete_connections", ids: value.connectionIds }], value.expectedRevision));
        }),
      call("canvas_adopt_result", "将当前项目已完成任务的指定媒体文件或文本结果采用到通用节点；可创建新节点或替换同类型节点。必须传最新 revision，不自动采用。", canvasToolSchemas.canvas_adopt_result.shape,
        (input) => adoptCanvasResult(run.userId, projectId, input as z.infer<typeof canvasToolSchemas.canvas_adopt_result>)),
      call(
        "assets_list",
        "分页搜索当前用户素材；keyword 匹配标题及文本正文，kind=text 可搜索已保存的提示词。",
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
      call("canvas_view", "在当前画布选择或聚焦节点；没有活动页面时返回 CLIENT_REQUIRED。", { action: z.enum(["select", "focus"]), ids: z.array(z.string()).max(200) },
        (input: { action: "select" | "focus"; ids: string[] }) => {
          if (input.action === "focus" && !input.ids.length) throw new Error("聚焦需要至少一个节点");
          return context.requestClientAction(`canvas_${input.action}_nodes`, { ids: input.ids });
        }),
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
