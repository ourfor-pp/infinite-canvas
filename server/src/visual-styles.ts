import { nanoid } from "nanoid";
import { z } from "zod";

import { db, parseJson } from "./database.js";
import { syncFileRefs } from "./file-store.js";
import { publishAgentProject } from "./agent/project-events.js";

export const VISUAL_STYLE_TEMPLATES = [
    { id: "live-premium-drama", name: "电影质感短剧", category: "live", colors: ["#201c1a", "#9c7657", "#d5c3a9"], description: "电影级真人短剧质感，自然肤色，克制的暖灰色调，柔和方向性光线，真实材质，浅景深，精致但不过度磨皮。" },
    { id: "live-cinematic-ancient", name: "东方古装电影", category: "live", colors: ["#182521", "#6f7557", "#c5aa78"], description: "东方古装电影美学，沉静青绿与温润金色，天然织物和木石质感，薄雾层次，柔和轮廓光，构图庄重。" },
    { id: "live-neon-noir", name: "霓虹黑色电影", category: "live", colors: ["#111523", "#265f80", "#d24b78"], description: "现代霓虹黑色电影风格，深蓝阴影与洋红高光，潮湿反射，强烈明暗对比，低调照明，都市夜景氛围。" },
    { id: "live-natural-documentary", name: "自然纪实", category: "live", colors: ["#5a5847", "#999276", "#d7ceb1"], description: "自然纪实影像，真实环境光，中性低饱和色彩，轻微胶片颗粒，克制构图，保留皮肤与材质细节。" },
    { id: "live-romantic-kdrama", name: "清透浪漫剧", category: "live", colors: ["#c5bbb4", "#ead8cf", "#f7eee4"], description: "清透浪漫剧质感，柔亮高调光线，低对比奶油色调，细腻肤色，空气感背景和浅景深。" },
    { id: "live-wuxia-ink", name: "写意武侠", category: "live", colors: ["#242926", "#727a70", "#d9d6c7"], description: "写意武侠电影风格，水墨般灰绿层次，山雾与留白，飘逸织物，逆光轮廓，动作构图富有张力。" },
    { id: "anim-cn-3d", name: "国风三维动画", category: "anim", colors: ["#25374a", "#9c6046", "#d9bb84"], description: "高品质国风三维动画，清晰轮廓，精细材质，东方配色，电影级体积光，人物比例自然，画面层次丰富。" },
    { id: "anim-ink", name: "水墨动画", category: "anim", colors: ["#292b29", "#758177", "#e8e3d4"], description: "东方水墨动画，宣纸肌理，墨色晕染，有限但有韵律的色彩，留白构图，柔和漫射光。" },
    { id: "anim-papercut", name: "剪纸绘本", category: "anim", colors: ["#7d1e24", "#d89436", "#e6d4a7"], description: "手工剪纸绘本风格，层叠纸张边缘，平面化造型，民俗红金配色，柔和投影，装饰性构图。" },
    { id: "anim-clay", name: "黏土定格", category: "anim", colors: ["#704c39", "#bb825f", "#dfc49c"], description: "黏土定格动画风格，可见手工塑形纹理，柔和棚拍光，微缩景观质感，温暖低饱和配色。" },
    { id: "anim-webtoon", name: "彩色条漫", category: "anim", colors: ["#41365e", "#a5678c", "#ead4de"], description: "精致彩色条漫风格，干净线稿，清晰色块，柔和渐变阴影，人物表情突出，画面通透。" },
    { id: "anim-retro", name: "九十年代复古动画", category: "anim", colors: ["#263052", "#a24855", "#d7aa69"], description: "九十年代手绘动画质感，赛璐璐阴影，略带褪色的胶片配色，清晰墨线，颗粒与轻微色偏。" },
] as const;

export type VisualStyleStatus = "draft" | "confirmed";
export type VisualStyleReferenceRole = "source" | "character" | "scene" | "prop";
export type VisualStyleDna = {
    medium: string;
    rendering: string;
    palette: string;
    lighting: string;
    contrast: string;
    texture: string;
    lensAndDepth: string;
    composition: string;
    postProcessing: string;
    exclusions: string[];
};
export type VisualStyleReferences = Partial<Record<VisualStyleReferenceRole, string>>;
type StyleRow = { id: string; user_id: string; project_id: string; name: string; mode: "template" | "custom"; template_id: string | null; description: string; reference_file_id: string | null; status: VisualStyleStatus; dna: string; reference_files: string; revision: number; created_at: string; updated_at: string };
type ProjectPayload = Record<string, unknown> & { nodes: Array<Record<string, unknown> & { id?: string; metadata?: Record<string, unknown> }>; connections: Array<Record<string, unknown> & { fromNodeId?: string; toNodeId?: string }>; defaultVisualStyleId?: string | null };
const id = z.string().trim().min(1).max(128);
const emptyDna: VisualStyleDna = { medium: "", rendering: "", palette: "", lighting: "", contrast: "", texture: "", lensAndDepth: "", composition: "", postProcessing: "", exclusions: [] };
const dnaSchema = z.object({
    medium: z.string().max(500).default(""),
    rendering: z.string().max(500).default(""),
    palette: z.string().max(500).default(""),
    lighting: z.string().max(500).default(""),
    contrast: z.string().max(500).default(""),
    texture: z.string().max(500).default(""),
    lensAndDepth: z.string().max(500).default(""),
    composition: z.string().max(500).default(""),
    postProcessing: z.string().max(500).default(""),
    exclusions: z.array(z.string().max(300)).max(30).default([]),
});
const referencesSchema = z.object({ source: id.optional(), character: id.optional(), scene: id.optional(), prop: id.optional() }).default({});
const inputSchema = z.object({
    name: z.string().trim().min(1).max(200),
    mode: z.enum(["template", "custom"]),
    templateId: id.nullable().optional(),
    description: z.string().max(20_000).default(""),
    status: z.enum(["draft", "confirmed"]).default("draft"),
    dna: dnaSchema.default(emptyDna),
    references: referencesSchema,
});
const updateSchema = z.object({
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(200).optional(),
    mode: z.enum(["template", "custom"]).optional(),
    templateId: id.nullable().optional(),
    description: z.string().max(20_000).optional(),
    status: z.enum(["draft", "confirmed"]).optional(),
    dna: dnaSchema.optional(),
    references: z.object({ source: id.optional(), character: id.optional(), scene: id.optional(), prop: id.optional() }).optional(),
});
let emitStyle: (userId: string, style: unknown) => void = () => undefined;
export function setVisualStyleEmitter(emitter: typeof emitStyle) { emitStyle = emitter; }

export function listVisualStyleTemplates() { return VISUAL_STYLE_TEMPLATES; }
export function listVisualStyles(userId: string, projectId: string) {
    assertProject(userId, projectId);
    return (db.prepare("SELECT * FROM visual_styles WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as StyleRow[]).map(styleResponse);
}
export function getVisualStyle(userId: string, styleId: string) {
    const row = styleRow(userId, styleId);
    if (!row) throw styleError(404, "VISUAL_STYLE_NOT_FOUND", "视觉风格不存在或无权访问");
    return styleResponse(row);
}
export function createVisualStyle(userId: string, projectId: string, raw: unknown) {
    assertProject(userId, projectId);
    const input = resolveTemplate(inputSchema.parse(raw));
    assertStyleReady(input);
    assertStyleReferences(userId, input.references);
    const styleId = nanoid();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO visual_styles(id,user_id,project_id,name,mode,template_id,description,reference_file_id,status,dna,reference_files,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,1,?,?)")
        .run(styleId, userId, projectId, input.name, input.mode, input.templateId || null, input.description, input.status, JSON.stringify(input.dna), JSON.stringify(input.references), now, now);
    syncStyleRefs(userId, styleId, input.references);
    return publishStyle(userId, styleRow(userId, styleId)!);
}
export function updateVisualStyle(userId: string, styleId: string, raw: unknown) {
    const current = styleRow(userId, styleId);
    if (!current) throw styleError(404, "VISUAL_STYLE_NOT_FOUND", "视觉风格不存在或无权访问");
    const patch = updateSchema.parse(raw);
    const input = resolveTemplate({ name: patch.name ?? current.name, mode: patch.mode ?? current.mode, templateId: patch.templateId === undefined ? current.template_id : patch.templateId, description: patch.description ?? current.description, status: patch.status ?? current.status, dna: patch.dna ?? dnaSchema.parse(parseJson(current.dna, {})), references: patch.references ?? referencesSchema.parse(parseJson(current.reference_files, {})) });
    assertStyleReady(input);
    assertStyleReferences(userId, input.references);
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE visual_styles SET name=?,mode=?,template_id=?,description=?,status=?,dna=?,reference_files=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?")
        .run(input.name, input.mode, input.templateId || null, input.description, input.status, JSON.stringify(input.dna), JSON.stringify(input.references), now, styleId, userId, patch.revision);
    if (!result.changes) throw styleError(409, "VISUAL_STYLE_CONFLICT", "视觉风格已在其他页面更新", { current: styleResponse(styleRow(userId, styleId)!) });
    syncStyleRefs(userId, styleId, input.references);
    return publishStyle(userId, styleRow(userId, styleId)!);
}
export function deleteVisualStyle(userId: string, styleId: string) {
    const current = getVisualStyle(userId, styleId);
    const project = projectPayload(userId, current.projectId);
    project.nodes = project.nodes.filter((node) => node.metadata?.visualStyleId !== styleId);
    const nodeIds = new Set(project.nodes.map((node) => String(node.id || "")));
    project.connections = project.connections.filter((connection) => nodeIds.has(String(connection.fromNodeId || "")) && nodeIds.has(String(connection.toNodeId || "")));
    if (project.defaultVisualStyleId === styleId) project.defaultVisualStyleId = null;
    db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='visual_style' AND owner_id=?").run(userId, styleId);
        db.prepare("DELETE FROM visual_styles WHERE id=? AND user_id=?").run(styleId, userId);
        saveProject(userId, current.projectId, project);
    })();
    emitStyle(userId, { id: styleId, projectId: current.projectId, deleted: true });
    return { id: styleId, projectId: current.projectId };
}
export function placeVisualStyle(userId: string, styleId: string, position: { x?: number; y?: number }) {
    const style = getVisualStyle(userId, styleId);
    const project = projectPayload(userId, style.projectId);
    const nodeId = `visual-style-${nanoid()}`;
    project.nodes.push({ id: nodeId, type: "visual-style", title: style.name, position: { x: position.x ?? 0, y: position.y ?? 0 }, width: 380, height: 620, metadata: { visualStyleId: style.id } });
    saveProject(userId, style.projectId, project);
    return { nodeId, projectId: style.projectId };
}
export function setDefaultVisualStyle(userId: string, styleId: string) {
    const style = getVisualStyle(userId, styleId);
    if (style.status !== "confirmed") throw styleError(409, "VISUAL_STYLE_NOT_CONFIRMED", "请先确认视觉风格，再设为项目默认");
    const project = projectPayload(userId, style.projectId);
    project.defaultVisualStyleId = styleId;
    saveProject(userId, style.projectId, project);
    return style;
}
export function resolveVisualStyleForNode(userId: string, projectId: string, nodeId?: string) {
    const project = projectPayload(userId, projectId);
    const linked = nodeId ? project.connections.find((connection) => connection.toNodeId === nodeId && connection.toPortId === "style") : null;
    const source = linked ? project.nodes.find((node) => node.id === linked.fromNodeId) : null;
    const styleId = String(source?.metadata?.visualStyleId || project.defaultVisualStyleId || "");
    if (!styleId) return null;
    const style = getVisualStyle(userId, styleId);
    if (style.projectId !== projectId) throw styleError(404, "VISUAL_STYLE_NOT_FOUND", "视觉风格不属于当前项目");
    return style;
}
export function resolveCreativeAssetNodeInputs(userId: string, projectId: string, assetId: string, nodeId?: string) {
    const project = projectPayload(userId, projectId);
    const target = nodeId ? project.nodes.find((node) => node.id === nodeId && node.metadata?.assetId === assetId) : null;
    if (nodeId && !target) throw styleError(404, "CREATIVE_ASSET_NODE_NOT_FOUND", "创作资产节点不存在或不属于当前资产");
    const inbound = target ? project.connections.filter((connection) => connection.toNodeId === target.id) : [];
    const source = (connection: (typeof inbound)[number]) => project.nodes.find((node) => node.id === connection.fromNodeId);
    const texts = inbound.filter((item) => item.toPortId === "setting").map(source).filter((node) => node?.type === "text").map((node) => String(node?.metadata?.content || node?.metadata?.prompt || "").trim()).filter(Boolean);
    const imageNodes = project.nodes.filter((node) => node.type === "image" && serverFileId(node.metadata?.storageKey));
    const audioNodes = project.nodes.filter((node) => node.type === "audio" && serverFileId(node.metadata?.storageKey));
    const imageReferences = inbound.filter((item) => item.toPortId === "reference-image").map(source).filter((node) => node?.type === "image").map((node) => ({ nodeId: String(node?.id), fileId: serverFileId(node?.metadata?.storageKey), label: `图片${imageNodes.findIndex((item) => item.id === node?.id) + 1}`, title: String(node?.title || "画布图片") })).filter((value) => Boolean(value.fileId));
    const audioReferences = inbound.filter((item) => item.toPortId === "reference-audio").map(source).filter((node) => node?.type === "audio").map((node) => ({ nodeId: String(node?.id), fileId: serverFileId(node?.metadata?.storageKey), label: `音频${audioNodes.findIndex((item) => item.id === node?.id) + 1}`, title: String(node?.title || "画布音频") })).filter((value) => Boolean(value.fileId));
    const imageFileIds = imageReferences.map((item) => item.fileId);
    const audioFileIds = audioReferences.map((item) => item.fileId);
    imageFileIds.forEach((fileId) => assertReferenceKind(userId, fileId, "image/"));
    audioFileIds.forEach((fileId) => assertReferenceKind(userId, fileId, "audio/"));
    return { texts, imageFileIds, audioFileIds, imageReferences, audioReferences, style: resolveVisualStyleForNode(userId, projectId, nodeId) };
}

export function syncVisualStyleGeneration(row: { id: string; user_id: string; status: string; request: string; result: string | null }) {
    if (row.status !== "succeeded") return;
    const request = parseJson<{ params?: { __visualStyleReference?: { styleId?: string; role?: Exclude<VisualStyleReferenceRole, "source"> } } }>(row.request, {});
    const analysis = (request.params as Record<string, unknown> | undefined)?.__visualStyleAnalysis as { styleId?: string } | undefined;
    if (analysis?.styleId) {
        const text = String(parseJson<{ text?: string }>(row.result, {}).text || "");
        const value = parseStyleAnalysis(text);
        if (!value) return;
        const style = getVisualStyle(row.user_id, analysis.styleId);
        updateVisualStyle(row.user_id, style.id, { revision: style.revision, mode: "custom", templateId: null, description: value.description, dna: value.dna });
        return;
    }
    const target = request.params?.__visualStyleReference;
    if (!target?.styleId || !target.role) return;
    const files = parseJson<{ files?: Array<{ fileId?: string; id?: string }> }>(row.result, {}).files || [];
    const fileId = String(files[0]?.fileId || files[0]?.id || "");
    if (!fileId) return;
    const style = getVisualStyle(row.user_id, target.styleId);
    if (style.references[target.role] === fileId) return;
    updateVisualStyle(row.user_id, style.id, { revision: style.revision, references: { ...style.references, [target.role]: fileId } });
}

function parseStyleAnalysis(value: string) {
    try {
        const json = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const result = z.object({ description: z.string().min(1).max(20_000), dna: dnaSchema }).parse(JSON.parse(json));
        return result;
    } catch { return null; }
}

function resolveTemplate<T extends { mode: string; templateId?: string | null; description: string }>(input: T) {
    if (input.mode !== "template") return input;
    const template = VISUAL_STYLE_TEMPLATES.find((item) => item.id === input.templateId);
    if (!template) throw styleError(400, "VISUAL_STYLE_TEMPLATE_INVALID", "视觉风格模板不存在");
    return { ...input, description: input.description.trim() || template.description };
}
function assertStyleReady(style: { status: VisualStyleStatus; description: string }) { if (style.status === "confirmed" && !style.description.trim()) throw styleError(400, "VISUAL_STYLE_DESCRIPTION_REQUIRED", "确认视觉风格前请先填写风格描述"); }
function styleRow(userId: string, styleId: string) { return db.prepare("SELECT * FROM visual_styles WHERE id=? AND user_id=?").get(styleId, userId) as StyleRow | undefined; }
function styleResponse(row: StyleRow) { const references = referencesSchema.parse(parseJson(row.reference_files, {})); return { id: row.id, projectId: row.project_id, name: row.name, mode: row.mode, templateId: row.template_id, description: row.description, status: row.status, dna: dnaSchema.parse(parseJson(row.dna, {})), references, referenceFileId: references.source || null, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function publishStyle(userId: string, row: StyleRow) { const style = styleResponse(row); emitStyle(userId, style); return style; }
function assertProject(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=?").get(projectId, userId)) throw styleError(404, "PROJECT_NOT_FOUND", "画布不存在或无权访问"); }
function assertReferenceKind(userId: string, fileId: string, prefix: string) { const row = db.prepare("SELECT mime_type FROM stored_files WHERE id=? AND user_id=?").get(fileId, userId) as { mime_type: string } | undefined; if (!row || !row.mime_type.startsWith(prefix)) throw styleError(400, "CANVAS_REFERENCE_TYPE_INVALID", "连接文件类型与语义端口不匹配"); }
function assertStyleReferences(userId: string, references: VisualStyleReferences) { Object.values(references).forEach((fileId) => fileId && assertReferenceKind(userId, fileId, "image/")); }
function syncStyleRefs(userId: string, styleId: string, references: VisualStyleReferences) { syncFileRefs(userId, "visual_style", styleId, references); }
function serverFileId(value: unknown) { const key = String(value || ""); return key.startsWith("server:") ? key.slice(7) : ""; }
function projectPayload(userId: string, projectId: string) { const row = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { payload: string } | undefined; if (!row) throw styleError(404, "PROJECT_NOT_FOUND", "画布不存在或无权访问"); const project = parseJson<ProjectPayload>(row.payload, { nodes: [], connections: [] }); project.nodes = Array.isArray(project.nodes) ? project.nodes : []; project.connections = Array.isArray(project.connections) ? project.connections.filter((item) => typeof item.fromPortId === "string" && typeof item.toPortId === "string") : []; return project; }
function saveProject(userId: string, projectId: string, project: ProjectPayload) { const now = new Date().toISOString(); db.prepare("UPDATE projects SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...project, updatedAt: now }), now, projectId, userId); syncFileRefs(userId, "project", projectId, project); const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string }; publishAgentProject(userId, { ...parseJson<Record<string, unknown>>(row.payload, {}), id: row.id, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }); }
function styleError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }
