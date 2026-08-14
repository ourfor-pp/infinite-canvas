import { nanoid } from "nanoid";
import { z } from "zod";

import { db, parseJson } from "./database.js";
import { syncFileRefs } from "./file-store.js";
import { publishAgentProject } from "./agent/project-events.js";

export type VisualStyleStatus = "draft" | "confirmed";
export type VisualStyleReferenceRole = "source" | "character" | "scene" | "prop";
export type VisualStyleTemplateCategory = "cinematic" | "genre" | "eastern" | "animation" | "handmade" | "graphic";
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
const templateExclusions = ["文字", "字幕", "水印", "标志", "边框", "拼贴错位", "不同画风混用"];
function template(id: string, name: string, category: VisualStyleTemplateCategory, tagline: string, colors: [string, string, string], description: string, dna: Omit<VisualStyleDna, "exclusions">) {
    return { id, name, category, tagline, colors, description, preview: `visual-styles/${id}.webp`, dna: { ...dna, exclusions: templateExclusions } };
}

export const VISUAL_STYLE_TEMPLATES = [
    template("contemporary-naturalism", "克制当代电影", "cinematic", "真实、安静、适合都市与家庭叙事", ["#302b27", "#877665", "#d8d0c5"], "当代电影自然主义，真实肤质与生活化美术，克制暖灰调，柔和窗光与细微胶片颗粒；人物、空间和道具保持同一现实材质逻辑。", { medium: "真人电影摄影", rendering: "真实材质与自然肤质，不过度磨皮", palette: "暖灰、胡桃木、低饱和红点缀", lighting: "柔和方向性窗光，高光平缓", contrast: "中低反差，阴影保留细节", texture: "细微 35mm 胶片颗粒与生活磨损", lensAndDepth: "35–50mm，自然透视，适度浅景深", composition: "观察式构图，稳定留白", postProcessing: "克制暖灰电影调色" }),
    template("luminous-romance", "清透都市浪漫", "cinematic", "明亮、柔软、适合爱情与成长", ["#b9c8ce", "#ead9ca", "#faf5e9"], "清透都市浪漫影像，高调自然光、奶油高光、低反差浅色环境与柔和空气感，保留真实五官和材质。", { medium: "真人浪漫剧摄影", rendering: "清晰自然，柔和肤质", palette: "奶油白、雾蓝、浅木色", lighting: "高调窗光与柔和反射光", contrast: "低反差，明亮阴影", texture: "轻柔光晕与极细颗粒", lensAndDepth: "50–85mm，柔和浅景深", composition: "亲密中近景，干净背景", postProcessing: "低饱和奶油色调" }),
    template("raw-documentary", "粗粝观察纪实", "cinematic", "真实、在场、适合社会与职业题材", ["#343a3b", "#7b827f", "#c6c9c3"], "手持观察式纪实影像，使用现场自然光、中性低饱和色彩、深景深和诚实的皮肤与环境纹理，允许轻微不完美。", { medium: "纪实摄影", rendering: "未经修饰的真实细节", palette: "中性灰、工业蓝、旧黄色", lighting: "现场可用光与阴天漫射光", contrast: "自然中反差", texture: "传感器噪点、雨水、工作痕迹", lensAndDepth: "28–40mm，较深景深", composition: "手持观察式与非中心构图", postProcessing: "中性去饱和" }),
    template("monochrome-noir", "经典黑白黑色电影", "genre", "冷峻、高反差、适合犯罪与悬疑", ["#090909", "#626262", "#e3e3e3"], "经典黑白黑色电影，高反差明暗、百叶窗硬光、银盐光晕与烟雾空间，使用斜线和负空间制造悬疑。", { medium: "黑白真人电影", rendering: "银盐影像与硬朗轮廓", palette: "纯黑、银灰、高光白", lighting: "低调硬光与切割光影", contrast: "极高反差", texture: "黑白胶片颗粒与轻微光晕", lensAndDepth: "35–50mm，中深景深", composition: "斜线、遮挡与大面积暗部", postProcessing: "黑白银盐调色" }),
    template("neon-tech-noir", "霓虹科技黑色", "genre", "冷蓝雨夜、适合近未来悬疑", ["#071525", "#0c7796", "#d64c91"], "近未来科技黑色电影，钴蓝阴影、克制洋红实景光、潮湿反射、城市雾气与横向镜头光晕，保持可信工业材质。", { medium: "真人科幻电影", rendering: "真实湿润材质与功能性科技", palette: "钴蓝、青色、克制洋红", lighting: "低调霓虹实景光", contrast: "高反差，深暗部", texture: "雨水、玻璃、金属与城市雾", lensAndDepth: "宽银幕变形镜头感，浅中景深", composition: "纵深走廊与反射层次", postProcessing: "冷蓝洋红分离调色" }),
    template("historical-epic", "历史史诗", "genre", "宏大、厚重、适合战争与群像", ["#30251d", "#8c6845", "#d4ae72"], "历史史诗真人影像，土色与青铜色、尘埃中的低角度阳光、真实织物与磨损金属，强调规模、纵深和庄重感。", { medium: "真人历史电影", rendering: "写实古代材质与服装", palette: "土褐、青铜、暗金", lighting: "尘埃晨光与低角度侧光", contrast: "中高反差", texture: "石、皮革、旧金属、尘土", lensAndDepth: "广角环境与长焦压缩交替", composition: "纪念碑式层次与大纵深", postProcessing: "暖土电影调色" }),
    template("frontier-western", "荒漠边境", "genre", "炙热、孤独、适合公路与冒险", ["#593d29", "#b28352", "#d9c69c"], "荒漠边境电影，日晒赭石与褪色青色、强烈自然光、开阔负空间、尘土胶片颗粒和磨损皮革。", { medium: "真人边境电影", rendering: "风化写实材质", palette: "赭石、沙金、褪色青", lighting: "强烈日光与长阴影", contrast: "中高反差", texture: "尘土、皮革、旧木与颗粒", lensAndDepth: "宽幅广角，深景深", composition: "地平线与开阔负空间", postProcessing: "日晒褪色胶片调色" }),
    template("folk-horror", "民俗幽森", "genre", "潮湿、古老、适合民俗与心理惊悚", ["#17221c", "#5b5a3d", "#b18249"], "民俗幽森真人影像，湿润苔绿、烛火琥珀和烟黑色，强调手工有机材质、阴天森林光与令人不安的秩序感。", { medium: "真人民俗惊悚", rendering: "自然主义年代细节", palette: "苔绿、烟黑、烛火琥珀", lighting: "阴天漫射光与局部烛光", contrast: "暗调中反差", texture: "潮木、编织物、泥土与烟尘", lensAndDepth: "35mm，中深景深", composition: "克制对称与封闭空间", postProcessing: "冷绿阴影与暖烛高光" }),
    template("hard-scifi", "硬核科学幻想", "genre", "可信、理性、适合太空与技术叙事", ["#202a2c", "#88979a", "#dfe5e1"], "硬科学幻想真人影像，功能性工业设计、拉丝钛与哑光陶瓷、冷白实用照明、克制信息光和清晰深焦摄影。", { medium: "真人硬科幻电影", rendering: "可信工程结构与 PBR 材质", palette: "钛灰、冷白、少量青色指示光", lighting: "冷白实用灯与环境反射", contrast: "清晰中反差", texture: "拉丝金属、陶瓷、玻璃", lensAndDepth: "24–40mm，深景深", composition: "模块化轴线与功能空间", postProcessing: "中性冷灰电影调色" }),
    template("gothic-romance", "哥特浪漫幻想", "genre", "月光、丝绒、适合暗黑爱情与奇幻", ["#0b1725", "#47243b", "#b69a76"], "哥特浪漫真人幻想，月光蓝黑石材、陈旧酒红丝绒、蜡烛金光、薄雾与优雅明暗法，气质忧郁而非血腥。", { medium: "真人哥特幻想", rendering: "精致年代材质与轻幻想写实", palette: "月光蓝黑、酒红、旧金", lighting: "月光轮廓与烛光点亮", contrast: "高反差柔边", texture: "石材、丝绒、银器与雾", lensAndDepth: "50mm，浅中景深", composition: "拱形框景与垂直线", postProcessing: "蓝黑阴影、暖金高光、柔光晕" }),
    template("dream-surrealism", "静谧超现实", "genre", "温柔、陌生、适合梦境与寓言", ["#a6c9bd", "#efc7af", "#f1e8d4"], "静谧的实景超现实主义，熟悉物体以不可能尺度和关系出现，薄荷绿与褪桃色、无影柔光、洁净对称和温和陌生感。", { medium: "真人实景超现实影像", rendering: "真实物理材质与不可能空间", palette: "薄荷绿、褪桃、奶油白", lighting: "均匀无影柔光", contrast: "低反差", texture: "光洁表面、浅水与细颗粒", lensAndDepth: "标准镜头，清晰深景", composition: "严格对称与尺度错位", postProcessing: "粉彩低对比胶片调色" }),
    template("eastern-period", "东方古装写实", "eastern", "沉静、雅正、适合历史与宅门叙事", ["#23352e", "#77735a", "#c4a875"], "东方古装写实电影，天然织物、风化木石、矿物青绿与温润赭色、山雾柔光和含蓄庄重的纵深构图。", { medium: "东方古装真人电影", rendering: "历史可信的天然材质", palette: "矿物青绿、赭石、旧木色", lighting: "雾天柔光与暖色室内实景光", contrast: "中低反差", texture: "麻、丝、木、石与铜", lensAndDepth: "40–65mm，层次化中景深", composition: "庭院框景与含蓄对称", postProcessing: "青绿暖赭平衡调色" }),
    template("poetic-wuxia", "写意武侠", "eastern", "水墨留白、适合江湖与动作叙事", ["#17191a", "#6c7370", "#a13939"], "写意武侠真人电影，墨灰山水、雾气留白和单一暗红点缀，逆光勾边、风动衣料与富有张力的斜向构图。", { medium: "真人写意武侠", rendering: "写实人物融合水墨空间层次", palette: "墨黑、雾灰、暗红点色", lighting: "强逆光与雾中散射", contrast: "高反差主体、低反差远景", texture: "湿布、岩石、芦苇与雾", lensAndDepth: "长焦山水压缩与广角动作镜头", composition: "大留白、斜向动势", postProcessing: "近单色水墨电影调色" }),
    template("contemporary-cel", "当代赛璐璐动画", "animation", "清晰、明快、适合青春与冒险", ["#26577b", "#78a773", "#f1d48a"], "当代手绘赛璐璐动画，精准有表现力的线稿、干净色块、两级阴影、明亮自然天空光与电影化场景布局。", { medium: "二维手绘赛璐璐动画", rendering: "清晰线稿、平涂与两级阴影", palette: "明快蓝绿与暖色点缀", lighting: "自然日光与图形化阴影", contrast: "清晰中高反差", texture: "轻微纸张与手绘线条质感", lensAndDepth: "动画电影镜头语言", composition: "可读轮廓与电影化布局", postProcessing: "干净色彩与轻微模拟胶片" }),
    template("retro-cel", "九十年代复古动画", "animation", "成熟、怀旧、适合都市与科幻", ["#182b34", "#a14764", "#e38265"], "九十年代手绘动画，粗细变化墨线、两级赛璐璐阴影、略褪色的青紫晚霞、模拟胶片灰尘与轻微套色偏差。", { medium: "复古二维赛璐璐动画", rendering: "手绘墨线与有限阴影层级", palette: "深青、暗紫、褪橙", lighting: "戏剧性城市暮光", contrast: "中高反差", texture: "胶片灰尘、颗粒和轻微套色偏移", lensAndDepth: "经典动画透视与长焦城市层次", composition: "成熟都市电影构图", postProcessing: "褪色模拟胶片" }),
    template("romantic-webcomic", "半写实彩色条漫", "animation", "精致、情绪化、适合人物关系", ["#292636", "#7d668b", "#e0b69e"], "半写实彩色条漫，优雅干净轮廓、受控渐变阴影、通透肤色、精细衣褶和柔和浪漫光线，形体清楚易读。", { medium: "数字彩色条漫", rendering: "半写实线稿与柔和渐变上色", palette: "暮紫、暖灰、柔肤色", lighting: "柔和轮廓光与环境光", contrast: "中低反差", texture: "光洁数字绘画与细腻发丝", lensAndDepth: "人物中近景与浅景深", composition: "情绪中心明确、背景简洁", postProcessing: "通透柔色调" }),
    template("stylized-3d", "风格化三维动画", "animation", "亲和、立体、适合家庭与奇幻", ["#283d3a", "#a76c3e", "#e4b96d"], "高品质风格化三维动画，亲和的概括比例、明确轮廓、精致物理材质、温暖反弹光和丰富但受控的色彩。", { medium: "风格化三维动画", rendering: "简化造型与精致 PBR 材质", palette: "暖木色、青绿、金色点缀", lighting: "温暖体积光与反弹光", contrast: "清晰中反差", texture: "木、铜、织物的精细材质", lensAndDepth: "电影化虚拟摄影机与浅中景深", composition: "轮廓清晰、空间层次丰富", postProcessing: "温暖动画电影调色" }),
    template("ink-wash", "水墨动画", "handmade", "留白、诗意、适合东方寓言", ["#222725", "#6f817c", "#ece7d9"], "东方水墨动画，宣纸吸水肌理、富于变化的墨线、淡矿物青绿、留白成雾和有节奏的笔触。", { medium: "水墨与淡彩动画", rendering: "渗化墨线与层叠水色", palette: "墨黑、纸白、淡青绿", lighting: "以墨色浓淡暗示漫射光", contrast: "局部墨色高反差", texture: "宣纸纤维、飞白与水痕", lensAndDepth: "散点透视与平面层次", composition: "大面积留白和诗意节奏", postProcessing: "保留纸色与自然水痕" }),
    template("clay-stop-motion", "黏土定格", "handmade", "温暖、可触、适合喜剧与童话", ["#493628", "#8c6847", "#d0ad79"], "手工黏土定格动画，可见指纹与不均匀塑形、微缩布景、暖钨丝灯、浅宏观景深和迷人的物理瑕疵。", { medium: "黏土定格动画", rendering: "手工塑形与微缩实拍质感", palette: "暖褐、旧绿、奶油黄", lighting: "微缩棚拍暖光", contrast: "柔和中反差", texture: "指纹、黏土、木材与纸", lensAndDepth: "微距摄影，浅景深", composition: "舞台式微缩布景", postProcessing: "暖色定格电影调色" }),
    template("folk-papercut", "民俗层叠剪纸", "handmade", "装饰、喜庆、适合神话与民间故事", ["#122c3a", "#b52f28", "#d7b77b"], "民俗层叠剪纸动画，可见纤维纸张切边、平面轮廓、朱红靛蓝与纸本色、层间柔影和装饰性节奏。", { medium: "层叠剪纸动画", rendering: "平面剪影与实体纸层", palette: "朱红、靛蓝、纸本色", lighting: "柔和顶光形成层间投影", contrast: "图形化高反差", texture: "手工纸纤维与切割边缘", lensAndDepth: "平面正视与浅层景深", composition: "对称装饰与连续纹样", postProcessing: "保留纸本色与手工误差" }),
    template("watercolor-storybook", "透明水彩绘本", "handmade", "轻盈、诗意、适合成长与自然", ["#768d78", "#b7c9b3", "#eee5d2"], "透明水彩绘本，湿画法晕染、细腻铅笔轮廓、柔软渗边、冷压纸纹与明亮自然色，气质温柔而诗意。", { medium: "透明水彩与铅笔绘本", rendering: "透明叠色与柔软水痕", palette: "植物绿、雾蓝、暖纸色", lighting: "明亮漫射自然光", contrast: "低反差", texture: "冷压纸纹、铅笔线与水渍", lensAndDepth: "绘本式空间层次", composition: "轻盈留白与自然视线流动", postProcessing: "保留水彩透明度和纸色" }),
    template("graphic-noir", "黑白图像小说", "graphic", "锐利、压迫、适合犯罪与动作", ["#050505", "#55585d", "#eeeeea"], "黑白图像小说，粗犷黑色笔刷、锐利白色负空间、稀疏灰色网点、倾斜构图与干刷纸纹，强调紧张和力量。", { medium: "黑白图像小说", rendering: "粗笔刷、硬边墨块与网点", palette: "黑、白、冷灰", lighting: "图形化极端明暗", contrast: "极高反差", texture: "干刷、油墨与印刷网点", lensAndDepth: "夸张透视与近景压迫", composition: "斜向切割和负空间", postProcessing: "单色印刷质感" }),
    template("cinematic-pixel", "电影化像素艺术", "graphic", "复古、精确、适合互动叙事", ["#111426", "#563854", "#db6e36"], "十六位电影化像素艺术，精确像素簇、有限暮色调色板、清楚剪影、环境格块细节和选择性高光，不使用平滑抗锯齿。", { medium: "16 位像素艺术", rendering: "手工像素簇与无抗锯齿边缘", palette: "深蓝紫、暗粉、橙色高光", lighting: "像素化暮光与局部灯光", contrast: "清晰高反差", texture: "像素网格与有限色阶", lensAndDepth: "侧视或轻透视叙事场景", composition: "轮廓优先的横向分层", postProcessing: "严格最近邻像素表现" }),
    template("editorial-gouache", "编辑水粉", "graphic", "现代、概括、适合都市寓言", ["#4a5628", "#ce7657", "#efe1bd"], "现代编辑水粉插画，不透明哑光笔触、概括几何形、橄榄绿珊瑚色与奶油色、可见纸纹和大胆明暗分组。", { medium: "不透明水粉插画", rendering: "概括形体与平涂笔触", palette: "橄榄绿、珊瑚、奶油白", lighting: "图形化块面光", contrast: "中高反差", texture: "哑光颜料与纸张齿纹", lensAndDepth: "扁平化空间与轻透视", composition: "现代编辑式大形分组", postProcessing: "保持哑光颜料色" }),
    template("two-color-risograph", "双色孔版印刷", "graphic", "大胆、年轻、适合音乐与实验短片", ["#173a77", "#ff625f", "#e8d7bc"], "双色孔版印刷，以荧光珊瑚和深靛蓝叠印，明显网点、轻微套印偏差、粗纸纹和扁平图形轮廓。", { medium: "双色孔版印刷", rendering: "双色分版、网点与套印", palette: "荧光珊瑚、深靛蓝、纸本色", lighting: "由网点密度表达明暗", contrast: "图形化高反差", texture: "油墨颗粒、粗纸与套印偏差", lensAndDepth: "平面海报式空间", composition: "大胆裁切与重复图形", postProcessing: "模拟双色 Riso 印刷" }),
] as const;
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
    const semanticChange = ["name", "mode", "templateId", "description", "dna", "references"].some((key) => key in patch);
    const projectKind = (db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(current.project_id, userId) as { kind?: string } | undefined)?.kind;
    const nextStatus = projectKind === "director" && semanticChange && patch.status === undefined ? "draft" : patch.status ?? current.status;
    const input = resolveTemplate({ name: patch.name ?? current.name, mode: patch.mode ?? current.mode, templateId: patch.templateId === undefined ? current.template_id : patch.templateId, description: patch.description ?? current.description, status: nextStatus, dna: patch.dna ?? dnaSchema.parse(parseJson(current.dna, {})), references: patch.references ?? referencesSchema.parse(parseJson(current.reference_files, {})) });
    assertStyleReady(input);
    assertStyleReferences(userId, input.references);
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE visual_styles SET name=?,mode=?,template_id=?,description=?,status=?,dna=?,reference_files=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?")
        .run(input.name, input.mode, input.templateId || null, input.description, input.status, JSON.stringify(input.dna), JSON.stringify(input.references), now, styleId, userId, patch.revision);
    if (!result.changes) throw styleError(409, "VISUAL_STYLE_CONFLICT", "视觉风格已在其他页面更新", { current: styleResponse(styleRow(userId, styleId)!) });
    syncStyleRefs(userId, styleId, input.references);
    if (projectKind === "director" && semanticChange) markDirectorStyleDependents(userId, current.project_id, styleId, current.revision + 1);
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
    project.nodes.push({ id: nodeId, type: "visual-style", title: style.name, position: { x: position.x ?? 0, y: position.y ?? 0 }, width: 420, height: 615, metadata: { visualStyleId: style.id } });
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

function markDirectorStyleDependents(userId: string, projectId: string, styleId: string, revision: number) {
    const now = new Date().toISOString();
    const mark = (table: "director_sequences" | "director_shots", rows: Array<{ id: string; payload: string }>) => {
        const statement = db.prepare(`UPDATE ${table} SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?`);
        rows.forEach((row) => {
            const payload = parseJson<Record<string, unknown>>(row.payload, {});
            const dependency = (payload.dependencies as { style?: { id?: string; revision?: number } } | undefined)?.style;
            if (dependency?.id === styleId && dependency.revision !== revision) statement.run(JSON.stringify({ ...payload, needsReview: true, staleReason: `视觉风格已更新到 revision ${revision}` }), now, row.id, userId);
        });
    };
    mark("director_sequences", db.prepare("SELECT id,payload FROM director_sequences WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>);
    mark("director_shots", db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>);
    const assets = db.prepare("SELECT id,payload FROM creative_assets WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const updateAsset = db.prepare("UPDATE creative_assets SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?");
    assets.forEach((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        const dependency = (payload.dependencies as { style?: { id?: string; revision?: number } } | undefined)?.style;
        if (dependency?.id === styleId && dependency.revision !== revision) updateAsset.run(JSON.stringify({ ...payload, needsReview: true, staleReason: `视觉风格已更新到 revision ${revision}` }), now, row.id, userId);
    });
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

function resolveTemplate<T extends { mode: string; templateId?: string | null; description: string; dna: VisualStyleDna }>(input: T) {
    if (input.mode !== "template") return input;
    const template = VISUAL_STYLE_TEMPLATES.find((item) => item.id === input.templateId);
    if (!template) throw styleError(400, "VISUAL_STYLE_TEMPLATE_INVALID", "视觉风格模板不存在");
    const hasDna = Object.entries(input.dna).some(([key, value]) => key === "exclusions" ? (value as string[]).length > 0 : String(value).trim());
    return { ...input, description: input.description.trim() || template.description, dna: hasDna ? input.dna : { ...template.dna, exclusions: [...template.dna.exclusions] } };
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
