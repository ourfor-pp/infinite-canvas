import { db } from "../../database.js";
import { canvasSystemPrompt } from "./canvas/prompt.js";
import { directorSystemPrompt } from "./director/prompt.js";

export type AgentSceneId = "canvas" | "director";
export type AgentReferenceKind = "canvas" | "asset" | "style" | "director";
export type AgentToolPolicy = "auto" | "policy" | "always";
export type AgentToolDefinition = { id: string; policy: AgentToolPolicy };
export type AgentSceneDefinition = {
    id: AgentSceneId;
    projectKind: AgentSceneId;
    systemPrompt: (projectId: string) => string;
    skillIds: readonly string[];
    tools: readonly AgentToolDefinition[];
    referenceKinds: readonly AgentReferenceKind[];
  composer: { placeholder: string; referenceLabel: string; emptyTitle: string; emptyDescription: string; suggestions: readonly string[] };
};

const canvasToolIds = [
    "canvas_list_projects", "canvas_get_state", "canvas_apply_ops", "canvas_create_text_nodes", "canvas_delete_nodes", "canvas_delete_connections", "canvas_connect_nodes",
    "assets_list", "assets_add", "assets_delete", "prompts_search", "generation_list_models", "generation_get_status", "generation_create",
    "creative_assets_list", "creative_asset_get", "creative_assets_create_batch", "creative_asset_update", "creative_asset_place", "creative_asset_generate", "creative_asset_set_primary", "creative_asset_delete",
    "visual_styles_list", "visual_style_templates_list", "visual_style_get", "visual_style_create", "visual_style_update", "visual_style_place", "visual_style_set_default", "visual_style_analyze", "visual_style_generate_references", "visual_style_delete",
    "site_navigate", "canvas_select_nodes", "canvas_focus_nodes", "workspace_write_text", "artifact_publish", "media_understand_images", "media_understand_audios", "media_prepare_video_overview", "media_sample_video_frames", "ask_user",
] as const;
const canvasPolicy = new Set(["canvas_delete_nodes", "canvas_delete_connections", "assets_delete", "creative_asset_set_primary", "creative_asset_delete", "visual_style_delete"]);

const directorToolIds = [
    "director_validate",
    "director_trash",
    "director_generate_asset", "director_analyze_style", "director_generate_style_references",
    "director_generate_storyboard", "director_validate_video_segments", "director_generate_video_segment",
    "director_list_models", "director_get_generation_status", "director_list_renders", "director_start_render", "director_cancel_render", "director_retry_render", "director_navigate", "media_understand_images", "media_understand_audios", "media_prepare_video_overview", "media_sample_video_frames", "ask_user",
] as const;

const definitions = {
    canvas: {
        id: "canvas", projectKind: "canvas", systemPrompt: canvasSystemPrompt,
        skillIds: ["write-story", "extract-story-assets", "design-character", "design-scene", "design-prop", "design-visual-style", "generate-creative-assets", "review-creative-asset"],
        tools: canvasToolIds.map((id) => ({ id, policy: canvasPolicy.has(id) ? "policy" as const : "auto" as const })),
        referenceKinds: ["canvas", "asset", "style"],
        composer: { placeholder: "描述任务，输入 / 调用 Skill，@ 引用节点…", referenceLabel: "引用画布内容", emptyTitle: "和画布一起思考", emptyDescription: "Agent 已绑定当前项目，可以理解节点、修改画布并调用生成任务。", suggestions: ["拆解小说中的角色、场景和道具", "根据选中节点继续创作", "检查画布结构并给出建议"] },
    },
    director: {
        id: "director", projectKind: "director", systemPrompt: directorSystemPrompt,
        skillIds: ["director-write-story", "director-adapt-long-fiction", "director-write-screenplay", "director-breakdown-screenplay", "director-breakdown-assets", "director-design-character", "director-design-scene", "director-design-prop", "director-design-style", "director-generate-assets", "director-plan-storyboards", "director-generate-shots", "director-check-continuity", "director-arrange-timeline", "director-render-film"],
        tools: directorToolIds.map((id) => ({ id, policy: "auto" as const })),
        referenceKinds: ["director", "asset", "style"],
        composer: { placeholder: "描述导演任务，输入 / 调用 Skill，@ 引用故事、视频段或素材…", referenceLabel: "引用导演台内容", emptyTitle: "和导演台一起创作", emptyDescription: "Agent 已绑定当前导演项目，可以创作或改编章节式故事、编写剧本并推进素材、分镜和成片。", suggestions: ["把创意写成可直接阅读的章节式故事", "从故事改写可拍摄的分场剧本", "规划下一组视频段与故事板"] },
    },
} satisfies Record<AgentSceneId, AgentSceneDefinition>;

const sharedSkillIds = ["media-understand"] as const;

export const agentScenes = definitions;

export function getAgentScene(id: AgentSceneId) { return definitions[id]; }

export function resolveAgentScene(userId: string, projectId: string) {
    const row = db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { kind: string } | undefined;
    if (!row) throw sceneError(404, "AGENT_PROJECT_NOT_FOUND", "项目不存在或无权访问");
    if (row.kind !== "canvas" && row.kind !== "director") throw sceneError(409, "AGENT_SCENE_UNSUPPORTED", "当前项目类型没有可用的 Agent 场景");
    return definitions[row.kind];
}

export function sceneToolName(id: string) { return `mcp__infinite_canvas__${id}`; }
export function sceneRegisteredTools(scene: AgentSceneDefinition) { return scene.tools.map((item) => sceneToolName(item.id)); }
export function sceneAutoAllowedTools(scene: AgentSceneDefinition) {
    const native = scene.id === "director" ? ["Read", "Write", "Edit", "Glob", "Grep", "LS"] : [];
    return [...native, ...scene.tools.filter((item) => item.policy === "auto").map((item) => sceneToolName(item.id))];
}
export function sceneSkillIds(scene: AgentSceneDefinition) { return [...sharedSkillIds, ...scene.skillIds]; }
export function sceneHasSkill(scene: AgentSceneDefinition, skillId: string) { return sceneSkillIds(scene).includes(skillId); }
export function sceneHasReference(scene: AgentSceneDefinition, kind: AgentReferenceKind) { return scene.referenceKinds.includes(kind); }

export function validateAgentScenes() {
    const skillIds = Object.values(definitions).flatMap((scene) => scene.skillIds);
    const duplicates = skillIds.filter((id, index) => skillIds.indexOf(id) !== index);
    if (duplicates.length) throw new Error(`Agent 场景 Skill ID 重复：${Array.from(new Set(duplicates)).join("、")}`);
    for (const scene of Object.values(definitions)) {
        const toolIds = scene.tools.map((item) => item.id);
        if (new Set(toolIds).size !== toolIds.length) throw new Error(`Agent 场景 ${scene.id} Tool ID 重复`);
    }
}

function sceneError(status: number, code: string, message: string) { return Object.assign(new Error(message), { status, code }); }
