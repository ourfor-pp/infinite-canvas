import { markDirectorProjectChanged } from "./director-sync.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { db, parseJson } from "./database.js";
import { syncDirectorDirectionFiles } from "./director-workspace.js";
import { getStoredFile, storeLocalFile, syncFileRefs } from "./file-store.js";
import { publishAgentProject } from "./agent/project-events.js";
import { inferVisualStyleMediumFamily, type VisualStyleDna, type VisualStyleMediumFamily } from "./visual-style-contract.js";

export type { VisualStyleDna, VisualStyleMediumFamily } from "./visual-style-contract.js";

export type VisualStyleStatus = "draft" | "confirmed";
export type VisualStyleReferenceRole = "source" | "board";
export type VisualStyleTemplateCategory = "cinematic" | "genre" | "eastern" | "animation" | "handmade" | "graphic";
const templateExclusions = ["文字", "字幕", "水印", "标志", "边框", "拼贴错位", "不同画风混用"];
const templateTags: Record<string, string[]> = {
    "contemporary-naturalism": ["都市", "家庭", "生活流"], "luminous-romance": ["都市", "爱情", "成长"], "raw-documentary": ["纪实", "职业", "社会"],
    "monochrome-noir": ["犯罪", "悬疑", "黑白"], "neon-tech-noir": ["科幻", "悬疑", "雨夜"], "historical-epic": ["历史", "战争", "群像"],
    "frontier-western": ["公路", "冒险", "荒漠"], "folk-horror": ["民俗", "惊悚", "心理"], "hard-scifi": ["科幻", "太空", "工业"],
    "gothic-romance": ["暗黑", "爱情", "奇幻"], "dream-surrealism": ["梦境", "寓言", "超现实"], "eastern-period": ["东方", "古装", "宅门"],
    "poetic-wuxia": ["东方", "武侠", "动作"], "contemporary-cel": ["青春", "冒险", "明快"], "retro-cel": ["都市", "科幻", "怀旧"],
    "romantic-webcomic": ["爱情", "人物关系", "条漫"], "stylized-3d": ["家庭", "奇幻", "三维"], "ink-wash": ["东方", "寓言", "水墨"],
    "clay-stop-motion": ["童话", "喜剧", "定格"], "folk-papercut": ["神话", "民间", "剪纸"], "watercolor-storybook": ["成长", "自然", "绘本"],
    "graphic-noir": ["犯罪", "动作", "黑白"], "cinematic-pixel": ["互动", "复古", "像素"], "editorial-gouache": ["都市", "寓言", "水粉"],
    "two-color-risograph": ["音乐", "实验", "印刷"], "workplace-comedy": ["职场", "喜剧", "都市"], "nostalgic-nineties": ["年代", "家庭", "怀旧"],
    "urban-thriller": ["悬疑", "犯罪", "都市"], "warm-family": ["家庭", "儿童", "温暖"], "eastern-xianxia": ["东方", "仙侠", "奇幻"],
    "eastern-zhiguai": ["东方", "志怪", "悬疑"], "tang-opulence": ["东方", "盛唐", "历史"], "republican-era": ["东方", "民国", "年代"],
    "chibi-ink": ["东方", "Q版", "水墨"], "chinese-myth-3d": ["东方", "神话", "三维"], "chibi-3d": ["Q版", "喜剧", "三维"],
    "children-3d": ["儿童", "家庭", "三维"], "painterly-2d-fantasy": ["奇幻", "冒险", "二维"], "oil-storybook": ["童话", "油画", "绘本"],
    "retro-screenprint": ["复古", "海报", "丝网印刷"],
};
type TemplateDnaInput = Omit<VisualStyleDna, "exclusions" | "mediumFamily" | "characterRendering" | "sceneRendering" | "propRendering"> & Partial<Pick<VisualStyleDna, "mediumFamily" | "characterRendering" | "sceneRendering" | "propRendering">>;
function template(id: string, name: string, category: VisualStyleTemplateCategory, tagline: string, colors: [string, string, string], description: string, dna: TemplateDnaInput) {
    const mediumFamily = dna.mediumFamily || templateMediumFamily(id, category);
    return { id, name, category, tags: templateTags[id] || [], tagline, colors, description, preview: `visual-styles/${id}.webp`, dna: { ...dna, mediumFamily, characterRendering: dna.characterRendering || dna.rendering, sceneRendering: dna.sceneRendering || dna.rendering, propRendering: dna.propRendering || dna.rendering, exclusions: templateExclusions } };
}

type ExpandedTemplateSpec = {
    id: string; name: string; category: VisualStyleTemplateCategory; family: VisualStyleMediumFamily; tags: readonly string[]; tagline: string; colors: readonly [string, string, string]; description: string;
    medium: string; rendering: string; palette: string; lighting: string; contrast: string; texture: string; lens: string; composition: string; post: string;
};
const familyRendering: Record<VisualStyleMediumFamily, { character: string; scene: string; prop: string }> = {
    live_action: { character: "真实人物身份、肤质、体态和服装剪影清楚", scene: "空间结构可信，建筑、陈设和环境材质遵循真实尺度", prop: "结构、尺度、磨损和材质反应真实可信" },
    animation_2d: { character: "角色线稿、比例、剪影和上色体系稳定", scene: "场景透视、线稿、色块与角色保持同一二维语言", prop: "道具轮廓和功能清楚，线稿与上色规则统一" },
    animation_3d: { character: "角色建模比例、轮廓、表情和材质系统稳定", scene: "空间、建模精度、材质和虚拟摄影统一", prop: "道具建模结构、尺度和表面材质清楚" },
    illustration: { character: "人物形体、剪影和绘画笔触稳定", scene: "空间层次与绘画媒介统一，保留环境叙事细节", prop: "轮廓、结构和材质由同一绘画技法表达" },
    handmade: { character: "角色保留可见手工结构、材料接缝和稳定剪影", scene: "布景遵循同一实体工艺和微缩尺度", prop: "道具保留真实制作结构、材料触感和尺度" },
    graphic: { character: "人物以清晰剪影、有限图形和稳定识别点呈现", scene: "空间由统一几何、色块和图形层级建立", prop: "道具功能与轮廓优先，严格遵循同一图形系统" },
};
function expandedTemplate(spec: ExpandedTemplateSpec) {
    const defaults = familyRendering[spec.family];
    return { ...template(spec.id, spec.name, spec.category, spec.tagline, [...spec.colors] as [string, string, string], spec.description, { mediumFamily: spec.family, medium: spec.medium, rendering: spec.rendering, characterRendering: `${defaults.character}；${spec.rendering}`, sceneRendering: `${defaults.scene}；${spec.rendering}`, propRendering: `${defaults.prop}；${spec.rendering}`, palette: spec.palette, lighting: spec.lighting, contrast: spec.contrast, texture: spec.texture, lensAndDepth: spec.lens, composition: spec.composition, postProcessing: spec.post }), tags: [...spec.tags] };
}

const expandedTemplateSpecs = [
    { id: "sixteen-mm-indie", name: "16mm 独立电影", category: "cinematic", family: "live_action", tags: ["胶片", "独立", "纪实"], tagline: "粗粝、亲密、保留现场的不完美", colors: ["#394038", "#8a6d57", "#d1c4aa"], description: "16mm 独立电影摄影，颗粒明显、曝光轻微游移、色彩克制，人物与环境保留未经商业修饰的真实触感。", medium: "16mm 真人胶片电影", rendering: "自然肤质与旧物磨损，不过度精修", palette: "暗橄榄、褪砖红、烟灰、暖白", lighting: "现场可用光与阴天窗光", contrast: "中低反差，高光自然滚降", texture: "有机粗颗粒、轻微曝光波动与灰尘", lens: "24–50mm 手持或肩扛，自然中景深", composition: "贴近人物的观察式构图", post: "低饱和光化学胶片调色" },
    { id: "classic-35mm", name: "35mm 经典胶片", category: "cinematic", family: "live_action", tags: ["胶片", "经典", "叙事"], tagline: "均衡、耐看、适合传统电影叙事", colors: ["#303b43", "#8b765f", "#d6c9ac"], description: "经典 35mm 叙事电影，色彩均衡、颗粒细腻、高光柔和，具有稳定而不过时的电影质感。", medium: "35mm 真人胶片电影", rendering: "真实材质、自然肤色与细腻胶片响应", palette: "暖中性色、褪蓝、旧木与奶油白", lighting: "柔和方向光与可信实景光", contrast: "中等反差，明暗层次完整", texture: "细腻 35mm 颗粒与轻微光晕", lens: "35–65mm 经典电影镜头，中等景深", composition: "平衡稳定的传统叙事构图", post: "自然光化学色彩与柔和高光" },
    { id: "large-format-epic", name: "大画幅史诗摄影", category: "cinematic", family: "live_action", tags: ["大画幅", "史诗", "空间"], tagline: "宏阔、清晰、强调人物与世界尺度", colors: ["#6e6455", "#af8b55", "#c7d0cf"], description: "大画幅史诗电影摄影，空间清晰、空气透视细腻、人物与宏大环境尺度关系明确，质感庄重克制。", medium: "65mm 大画幅真人电影", rendering: "极高空间清晰度与细腻自然材质", palette: "石灰、土赭、天空蓝、古金", lighting: "宽广自然天光与雕塑感云层", contrast: "中高反差，远近层次丰富", texture: "岩石、织物、金属与细微大画幅颗粒", lens: "大画幅广角与中焦，深景深", composition: "纪念碑式空间和人物尺度对照", post: "克制宏大的大画幅电影调色" },
    { id: "anamorphic-widescreen", name: "变形宽银幕电影", category: "cinematic", family: "live_action", tags: ["宽银幕", "变形镜头", "电影感"], tagline: "横向张力、椭圆焦外与克制光晕", colors: ["#14202d", "#8a603f", "#7f3037"], description: "变形宽银幕摄影，横向空间关系强，具有椭圆焦外、轻微横向光晕和真实材质，适合强调人物与环境的戏剧张力。", medium: "真人变形宽银幕电影", rendering: "真实人物和材质，保留镜头边缘特性", palette: "深海军蓝、钨丝琥珀、暗红、炭黑", lighting: "低调实景光与克制横向光晕", contrast: "中高反差，暗部深而有层次", texture: "玻璃光晕、细颗粒和真实表面", lens: "变形宽银幕镜头、椭圆焦外、浅中景深", composition: "横向层次、前景遮挡和宽幅负空间", post: "冷暖分离但不过度的电影调色" },
    { id: "hong-kong-neon-action", name: "港式霓虹动作", category: "cinematic", family: "live_action", tags: ["港风", "动作", "霓虹"], tagline: "潮湿、凌厉、充满城市动能", colors: ["#07131a", "#087fa0", "#c52238"], description: "港式夜景动作电影，湿街反射、混合实景光、烟气纵深与动态城市构图并存，色彩强烈但保持物理可信。", medium: "港式真人动作电影", rendering: "真实人物、湿润街面与磨损城市材质", palette: "电青、宝石红、钠灯琥珀与黑", lighting: "霓虹实景光、硬背光与潮湿空气散射", contrast: "高反差，局部饱和高光", texture: "雨水、烟气、旧招牌材质与胶片颗粒", lens: "广角运动镜头与长焦压缩交替", composition: "斜向动势、纵深街巷和前景穿越", post: "浓郁但受控的港式夜景调色" },
    { id: "hong-kong-street-film", name: "港式市井胶片", category: "cinematic", family: "live_action", tags: ["港风", "市井", "胶片"], tagline: "密集、潮湿、富有人间烟火", colors: ["#2e4b45", "#9a654f", "#d0b989"], description: "港式市井电影摄影，密集街巷、旧楼与荧光灯形成生活纵深，使用褪色胶片色和手持亲密距离记录真实城市肌理。", medium: "港式真人市井胶片电影", rendering: "生活化人物、老旧建筑与真实街头物件", palette: "玉绿、褪红、暖灰、旧米色", lighting: "阴天、旧荧光灯与店铺钨丝光混合", contrast: "中等反差，暗部保留生活细节", texture: "湿墙、瓷砖、旧金属和胶片颗粒", lens: "28–50mm 手持观察，中深景深", composition: "密集层次、门店框景和街巷纵深", post: "略褪色的港式光化学调色" },
    { id: "japanese-observational", name: "日式静观电影", category: "cinematic", family: "live_action", tags: ["静观", "生活", "留白"], tagline: "安静、耐心、关注日常空间", colors: ["#6f7666", "#b6aa90", "#d9d8cf"], description: "日式静观电影，以耐心固定机位、普通生活空间、自然季节细节和克制表演建立平静而深长的影像。", medium: "日式真人静观电影", rendering: "自然人物、朴素陈设与细微季节质感", palette: "柔米色、苔绿、浅蓝灰、深木色", lighting: "柔和窗光与阴天环境光", contrast: "低至中反差", texture: "木、纸、织物与轻微胶片颗粒", lens: "40–65mm 固定观察，中深景深", composition: "低机位、门框层次和充足负空间", post: "清淡自然、不过度暖化的电影调色" },
    { id: "korean-genre-cinema", name: "韩式冷峻类型片", category: "cinematic", family: "live_action", tags: ["韩式", "冷峻", "类型片"], tagline: "精确、克制、具有空间压迫感", colors: ["#20292c", "#5e6c68", "#8c5c59"], description: "韩式冷峻类型电影，写实美术、精确空间调度、受控冷色反差和有动机的实景光共同形成紧张而不夸张的视觉。", medium: "韩式真人类型电影", rendering: "真实人物与精确生产设计，不做偶像精修", palette: "炭灰、冷绿灰、水泥米色、暗酒红", lighting: "阴天外景与硬质有动机室内光", contrast: "中高反差，阴影边界明确", texture: "混凝土、玻璃、旧织物和自然肤质", lens: "35–85mm，长焦压缩与稳定建立镜头", composition: "轴线严谨、遮挡和空间压迫", post: "冷中性、局部暖色克制的类型片调色" },
    { id: "nordic-naturalism", name: "北欧冷调自然主义", category: "cinematic", family: "live_action", tags: ["北欧", "自然主义", "冬日"], tagline: "清冷、极简、保留材质温度", colors: ["#6d7f82", "#b0a98d", "#d7d7cf"], description: "北欧自然主义电影，冬季日光、极简生活空间和诚实人物质感并存，冷静却不失木材与织物的触感。", medium: "北欧真人自然主义电影", rendering: "真实皮肤、羊毛、浅木与石材", palette: "雾蓝、桦木色、石灰、暗锈色", lighting: "低角度冬日阳光与宽阔冷窗光", contrast: "低至中反差", texture: "羊毛、浅木、石材与自然肤质", lens: "35–65mm，稳定中景深", composition: "简洁秩序、水平线和冷静留白", post: "低饱和冷灰中保留温暖材质" },
    { id: "mediterranean-sunlight", name: "南欧暖阳写实", category: "cinematic", family: "live_action", tags: ["南欧", "阳光", "写实"], tagline: "明亮、粗粝、充满自然热度", colors: ["#f0e3c3", "#b76842", "#4e8794"], description: "南欧暖阳现实电影，粉墙、陶土、海风和强烈日照形成鲜明生活质感，人物自然、不带广告式精修。", medium: "南欧真人现实电影", rendering: "日晒皮肤、白墙、陶土与生活磨损真实", palette: "粉笔白、陶土、褪青蓝、橄榄绿", lighting: "强烈高日光与白墙反射光", contrast: "明亮中高反差，硬阴影清楚", texture: "石灰墙、陶器、亚麻和晒褪表面", lens: "28–50mm，深中景深", composition: "开放街巷、明暗块面与自然群像", post: "暖阳高亮但保留真实色彩" },
    { id: "mockumentary-handheld", name: "观察式伪纪录", category: "cinematic", family: "live_action", tags: ["伪纪录", "手持", "现场"], tagline: "即时、朴素、带有真实尴尬感", colors: ["#68747c", "#d8d4c8", "#8d6c56"], description: "观察式伪纪录摄影，以响应式肩扛、现场照明、较深景深和不刻意完美的构图建立真实在场感。", medium: "真人伪纪录片摄影", rendering: "未经修饰的现场人物与办公或家庭环境", palette: "中性灰、纸白、褪蓝、少量暖色", lighting: "平实环境光和现场实景光", contrast: "自然中低反差", texture: "数字噪点、普通墙面和日常物件", lens: "24–45mm 响应式手持，较深景深", composition: "略显偶然的取景、视线偏差和群像反应", post: "中性纪录片色彩，不做电影化过度修饰" },
    { id: "vhs-home-video", name: "VHS 家用录像", category: "cinematic", family: "live_action", tags: ["VHS", "录像带", "怀旧"], tagline: "柔软、失真、具有私人记忆感", colors: ["#346c74", "#a6695b", "#d2c2a5"], description: "晚期模拟家用录像影像，具有隔行柔化、色度溢出、轻微磁带噪声和随手拍摄的私人记忆感。", medium: "VHS 模拟家用录像", rendering: "人物和物体受模拟信号限制但身份可辨", palette: "褪青、暖肤色、暗红、视频黑", lighting: "机顶可用光与家庭实景灯", contrast: "低反差，黑位略抬起", texture: "扫描线、色度溢出、跟踪噪点与磁带抖动", lens: "家用摄像机变焦，深景深", composition: "随手居中、轻微倾斜和家庭记录感", post: "模拟 VHS 信号衰减与时间痕迹" },
    { id: "anime-feature-detailed", name: "精细二维动画电影", category: "animation", family: "animation_2d", tags: ["二维", "动画电影", "精细"], tagline: "手绘细腻、背景丰富、具有电影空间", colors: ["#477a91", "#829a63", "#d19a5f"], description: "精细二维动画电影，角色线稿富于表现力，背景绘制层次丰富，赛璐璐阴影与空气透视共同形成电影化空间。", medium: "高精度二维手绘动画电影", rendering: "精准线稿、细腻背景和受控赛璐璐阴影", palette: "天空蓝、森林绿、暖赭与柔白", lighting: "手绘自然光与空气透视", contrast: "清晰中反差", texture: "手绘线条、纸感和细腻背景笔触", lens: "动画电影虚拟摄影机，中深景深", composition: "角色动作清楚、背景纵深丰富", post: "统一色脚本与轻微模拟胶片" },
    { id: "limited-tv-animation", name: "有限帧电视动画", category: "animation", family: "animation_2d", tags: ["二维", "有限帧", "电视动画"], tagline: "经济、清晰、依靠关键姿态表达", colors: ["#1f3b5c", "#b1503d", "#d8bd79"], description: "有限帧电视动画，以经济线稿、平涂色块、两级阴影和强关键姿态保证叙事可读性，避免假装高帧精细动画。", medium: "有限帧二维电视动画", rendering: "简洁线稿、平涂和两级阴影", palette: "海军蓝、暖奶油、砖红、暗青", lighting: "以简化阴影块表达实景光", contrast: "清晰中高反差", texture: "轻微手绘线抖和简单背景笔触", lens: "传统电视动画景别与复用背景", composition: "轮廓优先、构图经济、动作重点突出", post: "干净有限色上色" },
    { id: "adult-realist-2d", name: "成人写实二维动画", category: "animation", family: "animation_2d", tags: ["二维", "成人", "写实"], tagline: "成熟、克制、关注真实人物与城市", colors: ["#374958", "#81766b", "#b78a58"], description: "成人写实二维动画，人物结构扎实、表情克制、环境带绘画纹理，以成熟色彩和观察式镜头呈现现实生活。", medium: "成人向写实二维动画", rendering: "解剖扎实、表情克制、背景质感成熟", palette: "烟蓝、水泥灰、自然肤色、暗琥珀", lighting: "低调绘制自然光与实景光", contrast: "中等反差", texture: "铅笔线、粗糙墙面和数字绘画纹理", lens: "35–65mm 动画电影景别，中景深", composition: "观察式中景、城市遮挡和人物关系", post: "低饱和成熟色脚本" },
    { id: "kinetic-action-2d", name: "热血动作二维动画", category: "animation", family: "animation_2d", tags: ["二维", "动作", "动势"], tagline: "强动作线、关键姿态与速度张力", colors: ["#173a77", "#c9332d", "#dba548"], description: "热血动作二维动画，以动态透视、强关键姿态、方向性速度线和干净赛璐璐渲染构建爆发力，保持画面可读。", medium: "高动势二维动作动画", rendering: "锐利轮廓、夸张透视和清楚动作阶段", palette: "深钴蓝、朱红、炭黑、淡金", lighting: "硬方向光和高能轮廓高光", contrast: "高反差、主体高度清楚", texture: "手绘墨线、冲击笔触和受控特效", lens: "超广角冲击与长焦压缩交替", composition: "斜向动作线、前后层穿越和强关键姿态", post: "高能但不糊成光污染的动作调色" },
    { id: "shojo-soft-color", name: "少女柔彩二维动画", category: "animation", family: "animation_2d", tags: ["二维", "柔彩", "浪漫"], tagline: "细线、通透色与柔和情绪光", colors: ["#b89fb8", "#dfb7b2", "#edf0df"], description: "少女柔彩二维动画，使用优雅细线、透明色层和轻盈氛围表现人物关系，五官保持差异，避免模板化同脸。", medium: "柔彩二维人物动画", rendering: "细腻线稿、透明渐层和优雅衣料细节", palette: "灰粉、淡紫、珍珠白、浅鼠尾草", lighting: "柔和逆光与空气感粉彩阴影", contrast: "低至中反差", texture: "轻纸纹、细发丝和透明色层", lens: "人物中近景与柔和浅景深", composition: "人物关系明确、留白轻盈", post: "通透柔色与克制光晕" },
    { id: "american-expressive-cartoon", name: "美式夸张卡通", category: "animation", family: "animation_2d", tags: ["二维", "美式", "夸张"], tagline: "弹性造型、强姿态与明快节奏", colors: ["#258e98", "#d7a52b", "#dc5540"], description: "美式夸张二维卡通，以弹性形体、变化墨线和强姿态语言表达动作和喜剧，场景与道具保持同一图形逻辑。", medium: "美式表现性二维卡通", rendering: "大胆弹性形体、变化线条和清楚挤压拉伸", palette: "绿松石、芥末黄、番茄红、墨黑", lighting: "明快图形光与大块阴影", contrast: "清晰高反差", texture: "手绘墨线和轻微纸感", lens: "夸张卡通透视与快速景别变化", composition: "姿态优先、轮廓清楚和节奏性错位", post: "明快平涂与受控动画特效" },
    { id: "rubber-hose-vintage", name: "复古橡皮管动画", category: "animation", family: "animation_2d", tags: ["二维", "复古", "橡皮管"], tagline: "弹性、手绘、带有早期动画胶片感", colors: ["#171717", "#8b8172", "#e7dcc4"], description: "三十年代橡皮管动画，黑色墨线、派切眼、弹性肢体和手绘抖动置于灰度胶片纹理中，强调舞台式节奏。", medium: "复古黑白橡皮管二维动画", rendering: "手工墨线、弹性肢体与简化圆形结构", palette: "墨黑、纸白、烟灰与淡褐", lighting: "灰度舞台式平光", contrast: "高反差黑白", texture: "胶片灰尘、线条抖动和旧纸感", lens: "正面舞台视角与早期动画透视", composition: "中心舞台、重复节奏和清楚剪影", post: "复古黑白胶片闪烁" },
    { id: "european-line-art", name: "欧洲清线动画", category: "animation", family: "animation_2d", tags: ["二维", "清线", "欧洲漫画"], tagline: "精确、平净、建筑与物件高度可读", colors: ["#24579b", "#aa4e3d", "#d5bd8f"], description: "欧洲清线动画，使用均匀精确轮廓、平整分色和清楚建筑透视，人物表情克制，空间与道具信息高度可读。", medium: "欧洲清线二维动画", rendering: "均匀轮廓、平涂色和清楚结构", palette: "钴蓝、砖红、沙色、净白", lighting: "清澈日光与最少图形阴影", contrast: "中高反差，边界清晰", texture: "干净纸面与少量印刷感", lens: "清楚建筑透视和标准动画景别", composition: "秩序空间、轮廓分离和信息清晰", post: "平净色块与轻微印刷质感" },
    { id: "indie-rough-line", name: "独立粗线动画", category: "animation", family: "animation_2d", tags: ["二维", "独立", "粗线"], tagline: "生动、不完美、保留创作者手感", colors: ["#424247", "#6f8296", "#bd704f"], description: "独立粗线二维动画，以活着的铅笔和墨线、稀疏色洗、纸张纹理和亲密观察表现人物，保留有意义的不完美。", medium: "粗线手绘独立二维动画", rendering: "不均匀铅笔墨线、局部色洗和真实手绘边缘", palette: "石墨、褪蓝、锈橙、纸白", lighting: "用松散排线和色洗表达柔光", contrast: "局部中高反差", texture: "纸齿、擦痕、铅笔粉和干笔", lens: "亲密中近景与观察式环境镜头", composition: "非中心、呼吸感强的手绘构图", post: "保留线稿抖动与纸色" },
    { id: "flat-vector-motion", name: "扁平矢量动画", category: "animation", family: "graphic", tags: ["矢量", "扁平", "动态图形"], tagline: "几何、模块化、适合清晰现代叙事", colors: ["#394a92", "#e0645c", "#76b8a5"], description: "扁平矢量动态图形，以精确几何、模块化形状、极少渐变和清楚轮廓建立现代叙事语言。", medium: "扁平矢量动态图形动画", rendering: "精确几何、平涂和最少渐变", palette: "靛蓝、珊瑚、薄荷绿、暖白", lighting: "由叠加色面表达抽象光线", contrast: "图形化中高反差", texture: "干净矢量边缘与轻微纸感", lens: "平面层级和简化透视", composition: "模块网格、几何节奏和清楚负空间", post: "清洁矢量输出与受控渐变" },
    { id: "photoreal-cg-film", name: "写实 CG 电影", category: "animation", family: "animation_3d", tags: ["三维", "写实", "CG"], tagline: "物理可信、电影级、避免塑料与恐怖谷", colors: ["#39434a", "#7c746b", "#b2764d"], description: "写实 CG 电影，以物理可信的人体、材质、环境和电影光照建立高质量虚拟影像，强调自然细节而非塑料式光洁。", medium: "写实三维 CG 电影", rendering: "生产级建模、真实皮肤次表面与物理材质", palette: "中性肤色、钢蓝、实景琥珀、自然土色", lighting: "物理电影面积光与真实反弹光", contrast: "中高反差，高光受控", texture: "皮肤、织物、金属和环境微磨损", lens: "虚拟电影摄影机，真实焦距与景深", composition: "真人电影式调度和空间层次", post: "写实电影调色，避免游戏塑料感" },
    { id: "realistic-game-cinematic", name: "写实游戏过场", category: "animation", family: "animation_3d", tags: ["三维", "游戏", "过场"], tagline: "实时高细节、戏剧光与清楚动作调度", colors: ["#30383a", "#49605c", "#b36b3e"], description: "写实实时游戏过场，高细节角色和环境资产配合戏剧化体积光、虚拟摄影机和动作调度，保持材质可读。", medium: "写实实时三维游戏过场", rendering: "高细节实时建模、清晰材质与可信动作", palette: "枪灰、森林绿、焦橙、冷灰", lighting: "戏剧体积光与有动机实景光", contrast: "中高反差，主体轮廓清楚", texture: "金属、皮革、石材和环境磨损", lens: "实时虚拟摄影机与动态景深", composition: "任务动线清楚、动作空间完整", post: "电影化实时渲染调色" },
    { id: "cel-shaded-3d", name: "三渲二赛璐璐", category: "animation", family: "animation_3d", tags: ["三渲二", "赛璐璐", "三维"], tagline: "三维结构、二维线条与色块表现", colors: ["#1c3154", "#bc3e32", "#d5af59"], description: "三渲二赛璐璐动画，将雕塑化三维形体转译为清楚墨线、两级色块阴影和图形化环境，兼顾结构稳定与二维观感。", medium: "赛璐璐渲染三维动画", rendering: "三维模型配合墨线轮廓与两段色阶", palette: "深海军蓝、朱红、淡金、奶油白", lighting: "方向光转译为精确赛璐璐阴影", contrast: "清晰图形化高反差", texture: "干净色块、受控线宽和少量笔触", lens: "三维虚拟摄影机配合二维构图", composition: "轮廓清楚、透视稳定和动作可读", post: "严格保持二维赛璐璐观感" },
    { id: "low-poly-animation", name: "低多边形动画", category: "animation", family: "animation_3d", tags: ["三维", "低多边形", "几何"], tagline: "简化、清晰、以面结构表达体积", colors: ["#466751", "#b96545", "#9eb5bd"], description: "低多边形三维动画，以刻意可见的几何切面、强简化剪影和哑光材质建立优雅、经济而统一的世界。", medium: "低多边形三维动画", rendering: "可见切面、简化建模和哑光材质", palette: "松绿、陶橙、雾蓝、沙色", lighting: "柔和方向光突出几何切面", contrast: "中等反差", texture: "低面数几何、哑光表面和少量纹理", lens: "虚拟广角与中景深", composition: "大形优先、层次简洁和清楚剪影", post: "干净低多边形色彩" },
    { id: "miniature-diorama-3d", name: "微缩景观三维", category: "animation", family: "animation_3d", tags: ["三维", "微缩", "景观"], tagline: "小尺度世界、模型感与电影照明", colors: ["#455b45", "#97724f", "#71899c"], description: "微缩景观三维动画，强调模型制作逻辑、小尺度地形、倾斜移轴景深和细小实景灯，形成可触摸的电影世界。", medium: "微缩景观三维动画", rendering: "模型级细节、缩微尺度与可见制作逻辑", palette: "苔绿、暖木、灰蓝、微小琥珀灯光", lighting: "柔和棚顶光和微缩实景灯", contrast: "柔和中反差", texture: "微缩植被、木、纸、土和模型磨损", lens: "移轴微距与浅景深", composition: "桌面景观层次和微缩动线", post: "保留模型摄影和轻移轴质感" },
    { id: "toy-plastic-animation", name: "玩具塑料动画", category: "animation", family: "animation_3d", tags: ["三维", "玩具", "塑料"], tagline: "明快、模块化、具有收藏玩具质感", colors: ["#24559c", "#dc685c", "#e5c64f"], description: "设计师玩具式三维动画，使用清楚的收藏玩具比例、磨砂与半透明塑料、精确接缝和模块化空间。", medium: "设计师玩具三维动画", rendering: "收藏玩具比例、注塑接缝和受控塑料反射", palette: "钴蓝、珊瑚、奶油黄、暖白", lighting: "大型柔光箱与清楚玩具高光", contrast: "明快中高反差", texture: "磨砂塑料、透明件、金属小部件", lens: "产品摄影式虚拟镜头与中浅景深", composition: "清楚单元、模块化背景和轮廓展示", post: "明快干净但不廉价的玩具调色" },
    { id: "dark-fantasy-cg", name: "暗黑幻想三维", category: "animation", family: "animation_3d", tags: ["三维", "暗黑", "幻想"], tagline: "风化、古老、具有克制超自然感", colors: ["#202322", "#4f5a48", "#8b623c"], description: "暗黑幻想三维动画，以风化雕塑化角色、有机盔甲、远古废墟和克制超自然辉光构建厚重世界。", medium: "暗黑幻想三维动画", rendering: "风化雕塑、真实布皮骨石和受控幻想细节", palette: "炭灰、去饱和绿、旧铜、余烬红", lighting: "低调体积月光与稀疏余烬高光", contrast: "高反差，暗部保留形体", texture: "旧石、皮革、骨、铁锈和灰尘", lens: "广角废墟与中长焦角色交替", composition: "压迫垂直结构、深层暗部和人物尺度", post: "冷暗重质感、余烬暖点调色" },
    { id: "hard-surface-scifi-3d", name: "硬表面科幻三维", category: "animation", family: "animation_3d", tags: ["三维", "科幻", "硬表面"], tagline: "功能明确、工程可信、材质精确", colors: ["#3d474c", "#d6d8d5", "#d87833"], description: "硬表面科幻三维动画，强调功能工程结构、可读面板逻辑、金属陶瓷材质和模块化建筑，磨损真实而不过度。", medium: "硬表面科幻三维动画", rendering: "精确工程建模、PBR 金属陶瓷和功能磨损", palette: "钛灰、冷白、警示橙、克制青", lighting: "冷工业实景光与清楚反射", contrast: "清晰中高反差", texture: "拉丝金属、陶瓷、玻璃与划痕", lens: "24–50mm 虚拟镜头，深中景深", composition: "模块轴线、功能动线和尺度参照", post: "中性冷灰工业调色" },
    { id: "classical-oil-painting", name: "古典油画叙事", category: "handmade", family: "illustration", tags: ["油画", "古典", "明暗法"], tagline: "温润、严谨、具有博物馆绘画层次", colors: ["#463426", "#596044", "#c4aa7d"], description: "古典叙事油画，使用罩染层、严谨素描、温润暗部和精细织物木材表现，人物、空间和器物如同一幅完整历史画。", medium: "古典罩染油画", rendering: "严谨造型、透明罩染和柔边塑形", palette: "棕褐、深橄榄、象牙白、暗朱红", lighting: "柔和窗光明暗法与暖反射光", contrast: "中高反差，暗部温润", texture: "画布纹、透明油层和局部厚涂高光", lens: "古典绘画空间和稳定中景层次", composition: "三角构图、人物群组和深层室内", post: "保留油彩层次与清漆温度" },
    { id: "romantic-oil-drama", name: "浪漫主义油画", category: "handmade", family: "illustration", tags: ["油画", "浪漫主义", "戏剧"], tagline: "宏阔、动荡、强调自然与情感力量", colors: ["#29415b", "#9a5338", "#c7a65c"], description: "浪漫主义戏剧油画，以扫动笔触、崇高自然、透亮空气和情绪性色彩呈现人物与环境的强烈关系。", medium: "浪漫主义厚薄结合油画", rendering: "动态笔触、戏剧形体和发光色层", palette: "风暴蓝、焦赭、旧金、云白", lighting: "破云光、地平辉光和强明暗运动", contrast: "高反差、空气层次丰富", texture: "画布、厚涂、刮擦与透明色层", lens: "大景观透视和近景动作交替", composition: "涡旋动势、斜线和崇高尺度", post: "保留油彩亮度与戏剧色温" },
    { id: "graphite-pencil", name: "石墨铅笔动画", category: "handmade", family: "illustration", tags: ["铅笔", "素描", "黑白"], tagline: "精确、柔和、保留纸面呼吸", colors: ["#3a3a3d", "#888783", "#e6e1d7"], description: "石墨铅笔动画，以变化线重、排线、擦抹灰调和纸张齿纹构建人物、空间与道具，保持优雅单色层次。", medium: "石墨铅笔与纸本动画", rendering: "精确铅笔结构、排线和柔和擦调", palette: "石墨灰、纸白、暖灰、深黑", lighting: "完全由铅笔明度和排线密度塑造", contrast: "柔和中反差，局部深黑", texture: "纸齿、石墨粉、橡皮擦痕和笔锋", lens: "素描式透视与中深景层次", composition: "线性视线流动与大面积纸白", post: "保留石墨反光和真实纸色" },
    { id: "charcoal-pastel", name: "炭笔粉彩", category: "handmade", family: "illustration", tags: ["炭笔", "粉彩", "表现"], tagline: "有力、粉质、强调形体与情绪", colors: ["#242426", "#a87865", "#b18a4b"], description: "炭笔与软粉彩插画，以大胆炭黑块、粉末性色彩、擦抹边缘和厚纸纹表现人物与空间的力量。", medium: "炭笔与软粉彩纸本动画", rendering: "大胆炭块、粉彩叠色和擦抹塑形", palette: "炭黑、灰粉、赭黄、冷灰纸", lighting: "由炭黑与粉彩大明暗塑造侧光", contrast: "高反差、边缘松动", texture: "炭粉、粉彩颗粒、擦痕和厚纸", lens: "近景形体压迫与松散环境层次", composition: "大块黑白、重心偏移和手势线", post: "保留粉末、落粉和手工擦抹" },
    { id: "gongbi-color", name: "东方工笔重彩", category: "eastern", family: "illustration", tags: ["工笔", "重彩", "东方"], tagline: "精谨、典雅、矿物色层次丰富", colors: ["#315d84", "#a33e35", "#5e8264"], description: "东方工笔重彩，以精确墨线、层层矿物色和典雅平面空间呈现人物衣饰、建筑与器物细节。", medium: "工笔重彩绢本动画", rendering: "细劲墨线、层染矿物色和严谨纹样", palette: "石青、朱砂、石绿、绢本色", lighting: "均匀绢本光与细腻层染明度", contrast: "中等反差、线色分明", texture: "绢纹、矿物颗粒、金线和墨线", lens: "散点透视与层叠平面空间", composition: "秩序人物、装饰层次和留白", post: "保留矿物色哑光与绢本温度" },
    { id: "mineral-mural", name: "岩彩壁画", category: "eastern", family: "illustration", tags: ["岩彩", "壁画", "矿物色"], tagline: "古朴、厚重、具有岁月风化感", colors: ["#31558a", "#9c5b34", "#a1342f"], description: "岩彩壁画视觉，以哑光矿物颜料、风化墙面、概括神圣形体和装饰性云气建筑构建古老叙事。", medium: "矿物岩彩壁画动画", rendering: "哑光矿物色、概括轮廓和风化壁面", palette: "青金、赭石、朱砂、沙白", lighting: "象征性平光与颜料自然斑驳", contrast: "中高反差、色块厚重", texture: "灰泥裂纹、矿物颗粒、脱落与旧金", lens: "壁画式平面层次与连续叙事", composition: "带状叙事、对称神像和装饰边缘", post: "保留风化、裂纹和矿物哑光" },
    { id: "copperplate-etching", name: "铜版蚀刻", category: "graphic", family: "illustration", tags: ["蚀刻", "铜版", "版画"], tagline: "精密、深邃、由线密度塑造世界", colors: ["#3f3329", "#7d7468", "#e2d4b9"], description: "铜版蚀刻插画，以精细交叉排线、严谨轮廓、古纸墨色和复杂建筑细节建立深邃单色世界。", medium: "铜版蚀刻印刷动画", rendering: "精细刻线、交叉排线和墨色密度塑形", palette: "棕黑、古纸象牙、冷灰、氧化褐", lighting: "完全由线密度建立明暗法", contrast: "高反差但灰阶丰富", texture: "刻线、压痕、油墨和古纸纤维", lens: "古典透视和深景建筑层次", composition: "严谨透视、密集细节和暗部框景", post: "保留版压、油墨不均和旧纸色" },
    { id: "woodcut-print", name: "表现主义木刻", category: "graphic", family: "illustration", tags: ["木刻", "版画", "表现主义"], tagline: "强烈、粗粝、依靠刀痕与黑白大形", colors: ["#151515", "#9f3f2e", "#c89646"], description: "表现主义木刻动画，以雕刻黑形、可见刀痕、角形剪影和有限套色建立力量感强的统一世界。", medium: "手工木刻版画动画", rendering: "雕刻黑块、刀痕和有限套色", palette: "墨黑、砖红、赭黄、宣纸白", lighting: "光线转译为高反差雕刻形状", contrast: "极高图形反差", texture: "木纹、刀痕、油墨和套印误差", lens: "夸张透视与正面版画空间", composition: "斜向切割、大黑形和强剪影", post: "保留手印油墨与木板纹理" },
    { id: "puppet-stop-motion", name: "布偶定格", category: "handmade", family: "handmade", tags: ["布偶", "定格", "手工"], tagline: "可触、戏剧化、具有真实舞台质感", colors: ["#294b4c", "#8e4c3e", "#9c794f"], description: "布偶定格动画，使用可动织物与树脂偶、微缩实景、可见手工结构和电影棚拍光，保留材料的真实触感。", medium: "布偶微缩定格动画", rendering: "可动偶结构、织物服装和微缩实拍", palette: "深青、旧红、胡桃木、暖奶油", lighting: "微缩钨丝实景灯与柔和电影主光", contrast: "中高反差", texture: "布、线、树脂、旧木和指纹制作痕迹", lens: "微距摄影与浅中景深", composition: "舞台式布景、清楚走位和前景层次", post: "温暖定格电影调色" },
    { id: "felt-craft-animation", name: "毛毡手工动画", category: "handmade", family: "handmade", tags: ["毛毡", "织物", "手工"], tagline: "柔软、温暖、纤维与缝线清晰可见", colors: ["#71836c", "#c59138", "#b96659"], description: "毛毡与织物手工动画，层叠羊毛毡、缝边、刺绣细节和填充形体统一角色、场景与道具。", medium: "毛毡织物手工动画", rendering: "羊毛纤维、缝线、填充形体和布层", palette: "鼠尾草绿、芥末黄、灰珊瑚、原羊毛色", lighting: "柔和桌面漫射光突出纤维", contrast: "低至中反差", texture: "羊毛毡、刺绣线、棉布和柔软填充", lens: "微距与轻浅景深", composition: "层叠布景、亲切轮廓和清楚手工结构", post: "保持纤维色和柔软阴影" },
    { id: "shadow-puppet", name: "传统皮影动画", category: "handmade", family: "handmade", tags: ["皮影", "剪影", "传统"], tagline: "透光、雕刻、依靠关节和影幕叙事", colors: ["#17120e", "#b05a32", "#d39b46"], description: "传统皮影动画，以透光雕刻皮革、可动关节、精细镂空和暖色背光幕形成装饰性强的影像。", medium: "传统皮影戏动画", rendering: "雕刻皮革剪影、关节结构和透光彩绘", palette: "墨黑、琥珀、朱砂、靛蓝", lighting: "羊皮纸幕后的强暖背光", contrast: "极高清晰剪影反差", texture: "皮革、镂空、染色和幕布纤维", lens: "正面影幕视角与浅层空间", composition: "横向舞台、连续纹样和关节动作", post: "保留透光皮革色与幕布温度" },
    { id: "sand-animation", name: "沙画动画", category: "handmade", family: "handmade", tags: ["沙画", "玻璃", "手工"], tagline: "流动、颗粒、以负空间不断变形", colors: ["#7d5a3b", "#b79163", "#e0b86c"], description: "玻璃台沙画动画，以颗粒剪影、手扫渐变、指绘边缘和不断变化的负空间构成流动叙事。", medium: "沙画玻璃台动画", rendering: "沙粒堆积、手扫渐层和指绘轮廓", palette: "暖沙、深褐、炭黑、淡琥珀", lighting: "玻璃台下单一发光底光", contrast: "高反差轮廓与柔和沙粒灰阶", texture: "细沙、刮痕、指痕和玻璃透光", lens: "正俯视平面空间", composition: "连续变形、负空间和颗粒流向", post: "保留沙粒边缘和底光渐变" },
    { id: "paint-on-glass", name: "玻璃油彩动画", category: "handmade", family: "handmade", tags: ["玻璃油彩", "流动画", "手工"], tagline: "湿润、发光、笔触持续变形", colors: ["#245493", "#bd613d", "#7b5076"], description: "玻璃油彩动画，湿润发光的油彩在玻璃上持续变形，透明混色与柔软笔缘使人物、空间和器物如梦流动。", medium: "玻璃上油彩动画", rendering: "湿油彩、透明叠色和连续变形笔缘", palette: "群青、焦橙、烟紫、乳白", lighting: "透过玻璃和湿颜料的发光底光", contrast: "中高反差、边缘柔化", texture: "湿笔触、刮痕、混色和玻璃光", lens: "绘画式平面层次与流动景深", composition: "形体溶解、色流引导和梦境空间", post: "保留湿颜料发光与连续涂改痕迹" },
    { id: "mixed-paper-collage", name: "混合纸张拼贴", category: "handmade", family: "handmade", tags: ["拼贴", "纸张", "实验"], tagline: "层叠、撕边、不同纸质形成空间", colors: ["#294d72", "#b8873f", "#a6473f"], description: "混合纸张拼贴动画，以裁切照片纸、绘画纸和无可读文字的印刷纸层叠，保留撕边、浅影和手工合成感。", medium: "混合纸张拼贴动画", rendering: "裁切纸片、撕边、叠层和浅投影", palette: "深蓝、赭黄、暗红、旧纸色", lighting: "柔和顶光产生浅纸层阴影", contrast: "图形化中高反差", texture: "摄影纸、绘画纸、旧纸和胶痕", lens: "平面拼贴与浅层视差", composition: "不规则裁切、层叠节奏和大胆尺度", post: "保留纸张色差和手工边缘" },
    { id: "paper-sculpture", name: "纸雕立体书", category: "handmade", family: "handmade", tags: ["纸雕", "立体书", "手工"], tagline: "洁净、折叠、以纸层建立戏剧空间", colors: ["#ece9df", "#9eb9cc", "#bb4d3e"], description: "纸雕立体书动画，以折叠、切割、压痕和层叠弹出结构构成角色、建筑与道具，空间精确而富有舞台感。", medium: "纸雕立体书动画", rendering: "折纸、切纸、压痕和层叠弹出结构", palette: "纸白、浅蓝、朱红、暖灰", lighting: "侧向净光产生清楚折纸阴影", contrast: "明亮中反差", texture: "纸纤维、折痕、切边和胶接", lens: "微距正面与轻俯视，浅中景深", composition: "舞台层次、弹出结构和纸面留白", post: "保持纸白和真实折痕阴影" },
    { id: "ceramic-figure-stop-motion", name: "陶瓷偶定格", category: "handmade", family: "handmade", tags: ["陶瓷", "定格", "釉色"], tagline: "温润、坚实、保留窑烧的不规则", colors: ["#7ea79e", "#a7553c", "#e7dfd1"], description: "陶瓷偶定格动画，以手工施釉人物、窑烧不均和微缩陶瓷场景形成坚实而温润的可触世界。", medium: "手工陶瓷偶定格动画", rendering: "陶瓷造型、釉面变化、接缝和微缩布景", palette: "青瓷、铁红、瓷白、窑黑", lighting: "柔和展陈主光与小型实景高光", contrast: "中等反差", texture: "釉裂、窑斑、粗陶、瓷面和指痕", lens: "微距摄影与中浅景深", composition: "陶偶舞台、器物尺度对照和安定构图", post: "保留釉面反射和窑烧色差" },
    { id: "american-halftone-comic", name: "美式半调漫画", category: "graphic", family: "graphic", tags: ["漫画", "半调", "美式"], tagline: "大胆、锐利、机械网点与动作框架", colors: ["#168ba4", "#c82e35", "#d9ab39"], description: "美式半调漫画动画，以粗墨轮廓、机械网点、有限专色和戏剧画框呈现人物、城市和标志道具。", medium: "美式半调印刷漫画动画", rendering: "粗墨线、机械网点和平面专色", palette: "印刷青、漫画红、芥末黄、黑", lighting: "硬图形光、墨影和半调灰阶", contrast: "极高图形反差", texture: "印刷网点、油墨、粗纸和轻套印偏差", lens: "夸张漫画透视与动态近景", composition: "对角动作、强裁切和清楚轮廓", post: "模拟四色漫画印刷" },
    { id: "pulp-comic", name: "复古纸浆漫画", category: "graphic", family: "graphic", tags: ["纸浆", "复古", "漫画"], tagline: "浓烈、粗印刷、充满旧冒险气息", colors: ["#941f22", "#49613a", "#8b6237"], description: "复古纸浆漫画视觉，以无标题的纸浆封面绘画感、戏剧透视、老化颜料和粗糙印刷纹理构成高张力世界。", medium: "复古纸浆彩绘漫画动画", rendering: "粗绘形体、硬轮廓和旧印刷色层", palette: "血红、沼泽绿、烟草褐、黄纸色", lighting: "舞台硬光与绘制轮廓高光", contrast: "高反差、暗部浓重", texture: "廉价纸、粗网点、掉墨和老化折痕", lens: "夸张近景与强透视", composition: "中心危机、斜线和巨大负形", post: "褪色纸浆印刷与边缘磨损" },
    { id: "art-deco-cinema", name: "装饰艺术电影", category: "graphic", family: "graphic", tags: ["Art Deco", "装饰艺术", "几何"], tagline: "流线、对称、金属与都市奢华", colors: ["#14233b", "#b4974e", "#e2d6ba"], description: "装饰艺术电影视觉，以流线几何、阶梯形建筑、金属点缀和严格对称统一人物服饰、城市与奢华器物。", medium: "装饰艺术图形动画", rendering: "流线几何、金属细节和精确对称", palette: "午夜蓝、古金、象牙白、祖母绿", lighting: "雕塑感上照光和清楚几何阴影", contrast: "高反差、金属高光克制", texture: "抛光金属、漆面、石材和丝绒", lens: "正面轴线与高耸垂直透视", composition: "严格对称、放射线和阶梯轮廓", post: "深色金属感装饰艺术调色" },
    { id: "bauhaus-motion", name: "包豪斯几何动画", category: "graphic", family: "graphic", tags: ["包豪斯", "几何", "现代主义"], tagline: "理性、非对称、以基础形组织叙事", colors: ["#1759a7", "#d43c30", "#e4b429"], description: "包豪斯几何动画，以基础形、严格网格、非对称平衡和原色体系转译人物、空间与物件，不依赖文字。", medium: "包豪斯几何动态图形", rendering: "基础几何、原色平面和模块网格", palette: "钴蓝、朱红、芥末黄、黑、奶油白", lighting: "平面色层和透明叠片表达光", contrast: "清晰图形高反差", texture: "平涂色、纸张和少量印刷颗粒", lens: "正交平面与简化透视", composition: "非对称网格、圆方三角节奏和负空间", post: "严格现代主义平面输出" },
    { id: "minimal-vector", name: "极简矢量叙事", category: "graphic", family: "graphic", tags: ["极简", "矢量", "留白"], tagline: "少形、精准、用最大留白表达故事", colors: ["#17233d", "#d94a42", "#eeeae1"], description: "极简矢量叙事，以极少精确形状、数学化轮廓、平涂色和大面积负空间表达人物与环境关系。", medium: "极简矢量叙事动画", rendering: "少量精准几何、平涂和干净轮廓", palette: "墨蓝、暖白、信号红、浅灰", lighting: "纯平面明度分离", contrast: "高反差但视觉元素稀少", texture: "无纹理或极轻纸感", lens: "平面正交与简化空间", composition: "大留白、单一视觉重心和清楚比例", post: "纯净矢量边缘与有限色输出" },
    { id: "synthwave-neon", name: "合成波霓虹图形", category: "graphic", family: "graphic", tags: ["合成波", "霓虹", "复古未来"], tagline: "夜色、渐变、复古未来的电子浪漫", colors: ["#711184", "#f52c9a", "#10c7df"], description: "合成波霓虹图形，以复古未来地平线、克制网格、喷绘铬色渐变和暗剪影统一人物、空间与科技器物。", medium: "合成波复古未来图形动画", rendering: "霓虹渐变、铬色喷绘和清楚暗剪影", palette: "电洋红、青色、午夜紫、铬银", lighting: "霓虹轮廓光与发光渐变夕阳", contrast: "极高霓虹反差", texture: "模拟喷绘、CRT 辉光和光栅颗粒", lens: "超宽地平线与中心消失点", composition: "地平线、透视网格和单一英雄剪影", post: "模拟八十年代电子辉光但无文字" },
    { id: "y2k-digital", name: "Y2K 数码视觉", category: "graphic", family: "graphic", tags: ["Y2K", "数码", "千禧"], tagline: "透明、铬色、充满早期数字乐观感", colors: ["#b8e9ef", "#b8c5c8", "#9ccf42"], description: "Y2K 数码视觉，以无文字的半透明界面形、液态光泽、铬色和冰蓝渐变建立早期数字时代的乐观未来感。", medium: "Y2K 数码图形动画", rendering: "半透明层、液态几何、铬面和净亮渐变", palette: "冰蓝、铬银、酸绿点缀、珍珠白", lighting: "明亮数字棚光与透明反射", contrast: "明亮中反差", texture: "液态塑形、玻璃、铬面和细像素辉光", lens: "干净产品式透视与漂浮层次", composition: "漂浮界面形、圆角几何和大量净白", post: "千禧数码高亮与轻色散" },
    { id: "analog-glitch", name: "模拟故障影像", category: "graphic", family: "graphic", tags: ["故障", "模拟信号", "实验"], tagline: "信号衰减、错位，但主体仍然可读", colors: ["#10131a", "#0c9bb3", "#a7367b"], description: "模拟故障影像，以受控扫描线位移、色彩分离、磁带噪声和断裂信号处理人物、空间和物件，同时保持关键轮廓可读。", medium: "模拟视频故障实验影像", rendering: "扫描位移、色差、磁带噪声和信号断裂", palette: "视频黑、电子青、洋红、脏白", lighting: "电子辉光和不稳定信号高光", contrast: "高反差，局部信号丢失", texture: "扫描线、磁带噪点、色带和像素撕裂", lens: "视频监视器视角与断裂空间", composition: "主体仍可识别的错位层和信号切片", post: "受控模拟故障，不遮蔽主体身份" },
] as const satisfies readonly ExpandedTemplateSpec[];
const expandedVisualStyleTemplates = expandedTemplateSpecs.map(expandedTemplate);

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
    template("workplace-comedy", "明快职场喜剧", "cinematic", "轻盈、有节奏、适合办公室群像", ["#d7e3e8", "#7391a1", "#ef7d5c"], "明快的当代职场喜剧摄影，真实办公室材质、清爽日光与少量活泼暖色，人物表情自然，空间关系清楚，避免广告棚拍感。", { medium: "真人职场喜剧摄影", rendering: "真实人物与办公材质，轻喜剧而不夸张", palette: "清爽蓝灰、纸白、珊瑚橙点缀", lighting: "大面积窗光与明亮室内实景光", contrast: "清晰中低反差", texture: "玻璃、金属、纸张与真实肤质", lensAndDepth: "28–50mm，中等景深，群像关系清楚", composition: "秩序构图中保留人物错位和喜剧节奏", postProcessing: "干净自然的都市调色" }),
    template("nostalgic-nineties", "九十年代生活电影", "cinematic", "朴素、温暖、适合年代与家庭叙事", ["#315d68", "#b06f43", "#d8c39c"], "九十年代生活电影质感，褪色青绿、暖木与旧塑料，日光灯和窗光并存，真实旧物磨损与温和胶片颗粒。", { medium: "真人年代电影摄影", rendering: "朴素生活化人物与可信旧物", palette: "褪色青绿、暖棕、米灰", lighting: "日光灯、窗光与傍晚钨丝光", contrast: "中低反差", texture: "旧木、印花布、搪瓷与胶片颗粒", lensAndDepth: "35–50mm，自然中景深", composition: "家庭相册般稳定但不摆拍", postProcessing: "轻微褪色的年代胶片调色" }),
    template("urban-thriller", "冷峻都市惊疑", "genre", "克制、锋利、适合现实悬疑与追查", ["#18242b", "#667982", "#b8a899"], "现实都市悬疑电影，冷灰街面与潮湿玻璃，局部硬光、深层遮挡和长焦压缩制造监视感，不依赖夸张霓虹。", { medium: "真人现实悬疑电影", rendering: "可信城市细节与克制人物表演", palette: "冷灰、暗青、旧米色", lighting: "阴天漫射光与局部硬质实景光", contrast: "中高反差，暗部有层次", texture: "湿地、玻璃、混凝土与皮肤细节", lensAndDepth: "50–100mm 长焦压缩与少量广角建立镜头", composition: "遮挡、反射和视线外空间", postProcessing: "冷中性低饱和调色" }),
    template("warm-family", "温暖家庭童趣", "cinematic", "自然、亲密、适合家庭与儿童故事", ["#79a9a4", "#e3b77c", "#f2e5ca"], "温暖而真实的家庭电影，儿童视角高度、柔和自然光、可信家居细节和轻微明亮色点缀，保留生活凌乱与真实肤质。", { medium: "真人家庭电影摄影", rendering: "自然人物、儿童友好且不过度甜美", palette: "浅木色、湖绿、柔和橙黄", lighting: "柔和窗光与温暖室内实景光", contrast: "低至中反差", texture: "棉麻、木材、玩具磨损与真实肤质", lensAndDepth: "28–50mm，儿童视角和适度景深", composition: "亲密群像与生活化前景", postProcessing: "暖而克制的自然调色" }),
    template("eastern-xianxia", "云海仙侠电影", "eastern", "空灵、壮阔、适合仙门与东方奇幻", ["#314c58", "#89aaa8", "#d6c6a5"], "东方仙侠真人电影，云海山门、冷青玉石与淡金法器，写实人物和材质置于空灵大景，法术光克制并遵循环境照明。", { mediumFamily: "live_action", medium: "东方仙侠真人电影", rendering: "写实人物与可信东方奇幻材质", palette: "冷青、玉白、淡金", lighting: "云海漫射光与克制法术辉光", contrast: "中反差，远景低反差", texture: "丝织、玉石、古木、云雾", lensAndDepth: "广角山水与长焦人物交替", composition: "纵深山门、大留白与人物尺度对比", postProcessing: "青白淡金的空灵电影调色" }),
    template("eastern-zhiguai", "东方志怪夜谈", "eastern", "幽微、古朴、适合志怪与民间悬疑", ["#172925", "#6f5c3d", "#c18a4c"], "东方志怪真人影像，湿暗古巷、纸灯暖光、旧木与烟雾，异象潜伏于现实细节中，克制诡谲而不堆砌恐怖特效。", { mediumFamily: "live_action", medium: "东方志怪真人电影", rendering: "年代可信的现实质感与克制异象", palette: "墨绿、烟黑、灯笼暖橙", lighting: "低照度月光与纸灯实景光", contrast: "暗调中高反差", texture: "湿石、旧纸、木漆与薄雾", lensAndDepth: "35–65mm，中深景深", composition: "门窗框景、暗处留白与局部遮挡", postProcessing: "冷暗环境与暖灯分离调色" }),
    template("tang-opulence", "盛唐华章", "eastern", "丰盛、明艳、适合宫廷与盛世群像", ["#8f2e32", "#c7963e", "#284f59"], "盛唐题材真人电影，朱红、石青与鎏金形成丰盛层次，丝绸、漆器和宫殿结构考究，光线明亮庄重而不廉价艳俗。", { mediumFamily: "live_action", medium: "盛唐历史真人电影", rendering: "考据感服饰建筑与真实贵重材质", palette: "朱红、石青、鎏金、象牙白", lighting: "明亮天光与宫灯暖光", contrast: "中高反差，色彩层次清楚", texture: "丝绸、金属、漆木与石材", lensAndDepth: "32–65mm，宫殿纵深与人物群像", composition: "礼制轴线、华盖层次与流动群像", postProcessing: "饱满但受控的历史电影调色" }),
    template("republican-era", "民国都市旧影", "eastern", "克制、摩登、适合年代爱情与悬疑", ["#253a42", "#85644e", "#c7b99c"], "民国都市电影质感，青灰石库门、旧木家具与克制旗袍色，薄雾街灯和室内窗影兼具年代感与现实质地。", { mediumFamily: "live_action", medium: "民国年代真人电影", rendering: "真实年代人物、服装与城市材质", palette: "青灰、烟褐、暗酒红", lighting: "阴天街景、窗棂硬光与暖台灯", contrast: "中高反差", texture: "旧木、呢料、砖墙与胶片颗粒", lensAndDepth: "40–85mm，经典人物景别", composition: "门廊框景、街巷纵深与克制对称", postProcessing: "低饱和青灰年代调色" }),
    template("chibi-ink", "Q版彩墨神话", "eastern", "灵动、可爱、适合神话喜剧与合家欢", ["#282f2a", "#c6623e", "#e8dcc0"], "Q版彩墨动画，大头小身但保留角色身份，渗化墨线、矿物彩色和宣纸留白统一角色、山水场景与法器道具。", { mediumFamily: "illustration", medium: "Q版彩墨二维动画", rendering: "灵动墨线、淡彩渗化与清楚Q版轮廓", characterRendering: "大头小身、表情清楚、身份特征稳定的Q版彩墨角色", sceneRendering: "水墨山水层次、留白与淡矿物色场景", propRendering: "简化但结构可辨的彩墨法器与生活道具", palette: "墨色、纸白、朱砂与淡矿物青绿", lighting: "以墨色浓淡和局部暖色表达光线", contrast: "主体清楚、远景柔和", texture: "宣纸纤维、飞白、水痕与细墨线", lensAndDepth: "绘本式散点透视与动画景别", composition: "大留白、清晰剪影与喜剧节奏", postProcessing: "保留纸色、墨痕与手绘不均匀" }),
    template("chinese-myth-3d", "东方神话三维", "animation", "宏阔、瑰丽、适合神话与史诗冒险", ["#183d43", "#a95632", "#d4b36a"], "高品质东方神话三维动画，以青铜、玉石、云气和古代织物建立可信幻想世界，角色造型概括有力，材质精致但不塑料。", { mediumFamily: "animation_3d", medium: "东方神话三维动画", rendering: "造型化角色与高质量物理材质", characterRendering: "明确东方轮廓、真实布料层次与克制面部材质", sceneRendering: "宏阔神话建筑、云海与体积空间", propRendering: "青铜、玉石和木质法器的清楚结构与尺度", palette: "深青、赤陶、古金、玉白", lighting: "体积天光与局部神性辉光", contrast: "中高反差", texture: "青铜锈、玉石、织物与岩层", lensAndDepth: "动画电影虚拟摄影机与大纵深", composition: "纪念碑式空间与人物尺度对照", postProcessing: "厚重青金东方奇幻调色" }),
    template("chibi-3d", "Q版三维喜剧", "animation", "活泼、圆润、适合喜剧与轻冒险", ["#237c85", "#e38746", "#f1d28b"], "精致Q版三维动画，圆润比例、清楚表情和柔软材质，角色、场景与道具共享玩具般但可信的物理世界。", { mediumFamily: "animation_3d", medium: "Q版三维动画", rendering: "圆润概括造型与精致非塑料PBR材质", characterRendering: "大头短身、表情清楚、轮廓差异鲜明", sceneRendering: "尺度友好的圆角建筑与丰富生活细节", propRendering: "轮廓夸张、结构清楚的可交互道具", palette: "湖蓝、暖橙、奶油黄", lighting: "柔和棚拍式体积光与暖反弹光", contrast: "清晰中反差", texture: "软布、磨砂木、陶瓷与轻微磨损", lensAndDepth: "动画电影镜头与柔和浅中景深", composition: "角色优先、层次清楚的喜剧构图", postProcessing: "明快温暖的动画电影调色" }),
    template("children-3d", "柔光儿童三维", "animation", "温柔、安全、适合成长与学龄故事", ["#74a9b4", "#d8a96d", "#eee2c7"], "柔光儿童三维动画，亲切比例、自然表情和触感柔和的材质，色彩丰富但不刺眼，空间清晰安全。", { mediumFamily: "animation_3d", medium: "儿童三维动画", rendering: "亲切造型与柔和细腻材质", characterRendering: "年龄清楚、表情自然、剪影易辨的儿童友好角色", sceneRendering: "明亮、安全、可探索的生活与自然空间", propRendering: "圆角、真实尺度和易读功能的道具", palette: "天空蓝、暖木、柔和珊瑚与奶油白", lighting: "大面积柔光与温暖反弹光", contrast: "低至中反差", texture: "织物、木材、纸张与磨砂塑料", lensAndDepth: "儿童视角虚拟摄影机，中等景深", composition: "清楚动线、亲密距离与适量留白", postProcessing: "柔和明亮、不过曝的动画调色" }),
    template("painterly-2d-fantasy", "厚涂二维幻想", "animation", "浓郁、动势、适合冒险与战斗", ["#26354a", "#7c4d55", "#d8a65b"], "电影化厚涂二维动画，富有方向的笔触、明确明暗大形和浓郁环境色，角色动作、幻想空间与关键道具保持统一绘制语言。", { mediumFamily: "animation_2d", medium: "数字厚涂二维动画", rendering: "有力笔触、清楚明暗分组与手绘边缘", characterRendering: "结构准确、轮廓鲜明、服装材质用概括笔触表达", sceneRendering: "层次丰富的幻想空间与环境色透视", propRendering: "结构清楚、受光统一的绘制道具", palette: "深蓝、暗紫、暖金与环境色", lighting: "戏剧性方向光与浓郁环境反射", contrast: "中高反差", texture: "可见数字画笔、粗糙岩石与织物笔触", lensAndDepth: "动画电影景别与强纵深", composition: "斜向动势、清晰动作线和大形节奏", postProcessing: "保留绘画笔触与浓郁色彩" }),
    template("oil-storybook", "油画童话绘本", "handmade", "厚润、梦幻、适合童话与寓言", ["#314f47", "#a85d48", "#d3b87a"], "传统油画童话绘本，厚薄相间的笔触、温润暗部、旧金和森林绿，人物、场景与道具像同一本精装故事书中的连续插页。", { mediumFamily: "illustration", medium: "传统油画绘本插画", rendering: "可见油画笔触、柔边塑形与厚涂高光", characterRendering: "形体清楚、表情含蓄、服装由油画笔触统一概括", sceneRendering: "层叠森林、室内暖光与古典空间空气感", propRendering: "厚润材质和清楚轮廓的古典道具", palette: "森林绿、旧金、砖红、亚麻色", lighting: "古典窗光与柔和明暗法", contrast: "中反差、暗部温润", texture: "画布纹、油彩堆叠与刮擦", lensAndDepth: "绘本式古典空间层次", composition: "中心叙事与环绕环境细节", postProcessing: "保留油彩层次与温暖清漆感" }),
    template("retro-screenprint", "复古丝网海报", "graphic", "强烈、粗粝、适合音乐与都市实验", ["#173b55", "#cf4d36", "#e5cf9b"], "复古丝网印刷视觉，以深蓝、锈红和纸本色分版，粗颗粒网点、套色偏移和大胆剪影统一人物、城市空间与标志性道具。", { mediumFamily: "graphic", medium: "复古丝网印刷海报动画", rendering: "有限色分版、粗网点与硬边剪影", characterRendering: "高识别剪影与少量面部网点", sceneRendering: "由色块、透视线和颗粒建立城市空间", propRendering: "轮廓优先、局部套色错位的图形道具", palette: "深蓝、锈红、纸本色", lighting: "用色块和网点密度表达明暗", contrast: "图形化高反差", texture: "丝网油墨、粗纸、套色偏移与磨损", lensAndDepth: "海报式平面透视与夸张裁切", composition: "大胆对角线、重复图形与负空间", postProcessing: "严格保留三色丝网印刷质感" }),
    ...expandedVisualStyleTemplates,
] as const;
export type VisualStyleReferences = Partial<Record<VisualStyleReferenceRole, string>>;
type StyleRow = { id: string; user_id: string; project_id: string; name: string; mode: "template" | "custom"; template_id: string | null; description: string; reference_file_id: string | null; status: VisualStyleStatus; dna: string; reference_files: string; revision: number; created_at: string; updated_at: string };
type ProjectPayload = Record<string, unknown> & { nodes: Array<Record<string, unknown> & { id?: string; metadata?: Record<string, unknown> }>; connections: Array<Record<string, unknown> & { fromNodeId?: string; toNodeId?: string }>; defaultVisualStyleId?: string | null };
const id = z.string().trim().min(1).max(128);
const emptyDna: VisualStyleDna = { mediumFamily: "live_action", medium: "", rendering: "", characterRendering: "", sceneRendering: "", propRendering: "", palette: "", lighting: "", contrast: "", texture: "", lensAndDepth: "", composition: "", postProcessing: "", exclusions: [] };
const dnaSchema = z.object({
    mediumFamily: z.enum(["live_action", "animation_2d", "animation_3d", "illustration", "handmade", "graphic"]).default("live_action"),
    medium: z.string().max(500).default(""),
    rendering: z.string().max(500).default(""),
    characterRendering: z.string().max(500).default(""),
    sceneRendering: z.string().max(500).default(""),
    propRendering: z.string().max(500).default(""),
    palette: z.string().max(500).default(""),
    lighting: z.string().max(500).default(""),
    contrast: z.string().max(500).default(""),
    texture: z.string().max(500).default(""),
    lensAndDepth: z.string().max(500).default(""),
    composition: z.string().max(500).default(""),
    postProcessing: z.string().max(500).default(""),
    exclusions: z.array(z.string().max(300)).max(30).default([]),
});
const referencesSchema = z.object({ source: id.optional(), board: id.optional() }).default({});
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
    references: z.object({ source: id.optional(), board: id.optional() }).optional(),
});
let sendStyle: (userId: string, style: unknown) => void = () => undefined;
export function setVisualStyleEmitter(emitter: typeof sendStyle) { sendStyle = emitter; }
function emitStyle(userId: string, style: unknown) {
    const projectId = (style as { projectId?: string }).projectId;
    if (projectId) markDirectorProjectChanged(userId, projectId, ["direction", "segments", "media"]);
    sendStyle(userId, style);
}

export function listVisualStyleTemplates() { return VISUAL_STYLE_TEMPLATES; }
export function listVisualStyles(userId: string, projectId: string) {
    assertProject(userId, projectId);
    return (db.prepare("SELECT * FROM visual_styles WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as StyleRow[]).map((row) => styleResponse(ensureStoredTemplateBoard(userId, row)));
}
export function getVisualStyle(userId: string, styleId: string) {
    const row = styleRow(userId, styleId);
    if (!row) throw styleError(404, "VISUAL_STYLE_NOT_FOUND", "视觉风格不存在或无权访问");
    return styleResponse(ensureStoredTemplateBoard(userId, row));
}
export function createVisualStyle(userId: string, projectId: string, raw: unknown) {
    assertProject(userId, projectId);
    const input = materializeTemplateBoard(userId, resolveTemplate(inputSchema.parse(raw)));
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
    const replacesTemplate = patch.mode === "template" && patch.templateId !== undefined && (patch.templateId !== current.template_id || current.mode !== "template");
    const projectKind = (db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(current.project_id, userId) as { kind?: string } | undefined)?.kind;
    const nextStatus = patch.status ?? current.status;
    const customizesTemplate = projectKind === "director" && current.mode === "template" && patch.mode === undefined && (patch.description !== undefined || patch.dna !== undefined);
    const nextMode = customizesTemplate ? "custom" : patch.mode ?? current.mode;
    // A Director project may customize the local Markdown while still retaining
    // the built-in template as its provenance. Custom mode prevents the board
    // from being rematerialized; template_id remains useful for the picker and
    // for explaining where the local style started.
    const nextTemplateId = patch.templateId === undefined ? current.template_id : patch.templateId;
    const currentReferences = referencesSchema.parse(parseJson(current.reference_files, {}));
    const nextReferences = patch.references ?? (replacesTemplate ? { ...currentReferences, board: undefined } : currentReferences);
    const input = materializeTemplateBoard(userId, resolveTemplate({ name: patch.name ?? current.name, mode: nextMode, templateId: nextTemplateId, description: patch.description ?? current.description, status: nextStatus, dna: patch.dna ?? parseStyleDna(current.dna, current.template_id), references: nextReferences }));
    assertStyleReady(input);
    assertStyleReferences(userId, input.references);
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE visual_styles SET name=?,mode=?,template_id=?,description=?,status=?,dna=?,reference_files=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?")
        .run(input.name, input.mode, input.templateId || null, input.description, input.status, JSON.stringify(input.dna), JSON.stringify(input.references), now, styleId, userId, patch.revision);
    if (!result.changes) throw styleError(409, "VISUAL_STYLE_CONFLICT", "视觉风格已在其他页面更新", { current: styleResponse(styleRow(userId, styleId)!) });
    syncStyleRefs(userId, styleId, input.references);
    if (projectKind === "director" && semanticChange) markDirectorStyleDependents(userId, current.project_id, styleId, current.revision + 1);
    if (projectKind === "director") syncDirectorDirectionFiles(userId, current.project_id);
    return publishStyle(userId, styleRow(userId, styleId)!);
}
export function deleteVisualStyle(userId: string, styleId: string) {
    const current = getVisualStyle(userId, styleId);
    const project = projectPayload(userId, current.projectId);
    if (project.defaultVisualStyleId === styleId) project.defaultVisualStyleId = null;
    db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='visual_style' AND owner_id=?").run(userId, styleId);
        db.prepare("DELETE FROM visual_styles WHERE id=? AND user_id=?").run(styleId, userId);
        saveProject(userId, current.projectId, project);
    })();
    emitStyle(userId, { id: styleId, projectId: current.projectId, deleted: true });
    return { id: styleId, projectId: current.projectId };
}
export function setDefaultVisualStyle(userId: string, styleId: string) {
    const style = getVisualStyle(userId, styleId);
    const kind = (db.prepare("SELECT kind FROM projects WHERE id=? AND user_id=?").get(style.projectId, userId) as { kind?: string } | undefined)?.kind;
    if (kind !== "director" && style.status !== "confirmed") throw styleError(409, "VISUAL_STYLE_NOT_CONFIRMED", "请先确认视觉风格，再设为项目默认");
    const project = projectPayload(userId, style.projectId);
    project.defaultVisualStyleId = styleId;
    saveProject(userId, style.projectId, project);
    if (kind === "director") syncDirectorDirectionFiles(userId, style.projectId);
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
export function resolveProjectVisualStyle(userId: string, projectId: string) {
    const project = projectPayload(userId, projectId);
    const styleId = String(project.defaultVisualStyleId || "");
    if (!styleId) return null;
    const style = getVisualStyle(userId, styleId);
    if (style.projectId !== projectId) throw styleError(404, "VISUAL_STYLE_NOT_FOUND", "视觉风格不属于当前项目");
    return style;
}

export function syncVisualStyleGeneration(row: { id: string; user_id: string; status: string; request: string; result: string | null }) {
    if (row.status !== "succeeded") return;
    const request = parseJson<{ params?: { __visualStyleBoard?: { styleId?: string; styleRevision?: number } } }>(row.request, {});
    const analysis = (request.params as Record<string, unknown> | undefined)?.__visualStyleAnalysis as { styleId?: string } | undefined;
    if (analysis?.styleId) {
        const text = String(parseJson<{ text?: string }>(row.result, {}).text || "");
        const value = parseStyleAnalysis(text);
        if (!value) return;
        const style = getVisualStyle(row.user_id, analysis.styleId);
        updateVisualStyle(row.user_id, style.id, { revision: style.revision, mode: "custom", templateId: null, description: value.description, dna: value.dna });
        return;
    }
    const target = request.params?.__visualStyleBoard;
    if (!target?.styleId) return;
    const files = parseJson<{ files?: Array<{ fileId?: string; id?: string }> }>(row.result, {}).files || [];
    const fileId = String(files[0]?.fileId || files[0]?.id || "");
    if (!fileId) return;
    const style = getVisualStyle(row.user_id, target.styleId);
    if (style.revision !== target.styleRevision) return;
    if (style.references.board === fileId) return;
    updateVisualStyle(row.user_id, style.id, { revision: style.revision, references: { ...style.references, board: fileId } });
}

function parseStyleAnalysis(value: string) {
    try {
        const json = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const result = z.object({ description: z.string().min(1).max(20_000), dna: dnaSchema }).parse(JSON.parse(json));
        return result;
    } catch { return null; }
}

function templateMediumFamily(id: string, category: VisualStyleTemplateCategory): VisualStyleMediumFamily {
    if (id === "stylized-3d") return "animation_3d";
    if (id === "contemporary-cel" || id === "retro-cel") return "animation_2d";
    if (id === "romantic-webcomic" || id === "ink-wash" || id === "watercolor-storybook") return "illustration";
    if (category === "handmade") return "handmade";
    if (category === "graphic") return "graphic";
    return "live_action";
}

function parseStyleDna(value: string | Record<string, unknown>, templateId?: string | null): VisualStyleDna {
    const raw = typeof value === "string" ? parseJson<Record<string, unknown>>(value, {}) : value;
    const parsed = dnaSchema.parse(raw);
    const template = templateId ? VISUAL_STYLE_TEMPLATES.find((item) => item.id === templateId) : null;
    const mediumFamily = Object.hasOwn(raw, "mediumFamily") ? parsed.mediumFamily : template?.dna.mediumFamily || inferVisualStyleMediumFamily(parsed.medium);
    return {
        ...parsed,
        mediumFamily,
        characterRendering: parsed.characterRendering || template?.dna.characterRendering || parsed.rendering,
        sceneRendering: parsed.sceneRendering || template?.dna.sceneRendering || parsed.rendering,
        propRendering: parsed.propRendering || template?.dna.propRendering || parsed.rendering,
    };
}

function resolveTemplate<T extends { mode: string; templateId?: string | null; description: string; dna: VisualStyleDna }>(input: T) {
    if (input.mode !== "template") return input;
    const template = VISUAL_STYLE_TEMPLATES.find((item) => item.id === input.templateId);
    if (!template) throw styleError(400, "VISUAL_STYLE_TEMPLATE_INVALID", "视觉风格模板不存在");
    const hasDna = Object.entries(input.dna).some(([key, value]) => key === "mediumFamily" ? false : key === "exclusions" ? (value as string[]).length > 0 : String(value).trim());
    return { ...input, description: input.description.trim() || template.description, dna: hasDna ? input.dna : { ...template.dna, exclusions: [...template.dna.exclusions] } };
}
function materializeTemplateBoard<T extends { mode: string; templateId?: string | null; references: VisualStyleReferences }>(userId: string, input: T) {
    if (input.mode !== "template" || !input.templateId) return input;
    const template = VISUAL_STYLE_TEMPLATES.find((item) => item.id === input.templateId);
    if (!template) return input;
    const originalName = `visual-style-template-${template.id}.webp`;
    const existing = db.prepare("SELECT id FROM stored_files WHERE user_id=? AND original_name=? ORDER BY created_at DESC LIMIT 1").get(userId, originalName) as { id: string } | undefined;
    if (existing && getStoredFile(userId, existing.id)) return { ...input, references: { board: existing.id } };
    const candidates = [resolve(process.cwd(), "../web/public", template.preview), resolve(process.cwd(), "web/public", template.preview)];
    const source = candidates.find((path) => existsSync(path));
    if (!source) throw styleError(500, "VISUAL_STYLE_TEMPLATE_PREVIEW_MISSING", `内置风格预览不存在：${template.id}`);
    const stored = storeLocalFile(userId, source, originalName, "image/webp");
    return { ...input, references: { board: stored.fileId } };
}
function ensureStoredTemplateBoard(userId: string, row: StyleRow) {
    const references = referencesSchema.parse(parseJson(row.reference_files, {}));
    if (row.mode !== "template" || !row.template_id || references.board) return row;
    const materialized = materializeTemplateBoard(userId, { mode: row.mode, templateId: row.template_id, references });
    const referenceFiles = JSON.stringify(materialized.references);
    db.prepare("UPDATE visual_styles SET reference_files=? WHERE id=? AND user_id=?").run(referenceFiles, row.id, userId);
    syncStyleRefs(userId, row.id, materialized.references);
    return { ...row, reference_files: referenceFiles };
}
function assertStyleReady(style: { status: VisualStyleStatus; description: string }) { if (style.status === "confirmed" && !style.description.trim()) throw styleError(400, "VISUAL_STYLE_DESCRIPTION_REQUIRED", "确认视觉风格前请先填写风格描述"); }
function styleRow(userId: string, styleId: string) { return db.prepare("SELECT * FROM visual_styles WHERE id=? AND user_id=?").get(styleId, userId) as StyleRow | undefined; }
function styleResponse(row: StyleRow) { const references = referencesSchema.parse(parseJson(row.reference_files, {})); const boardStale = isStyleBoardStale(row, references.board); return { id: row.id, projectId: row.project_id, name: row.name, mode: row.mode, templateId: row.template_id, description: row.description, status: row.status, dna: parseStyleDna(row.dna, row.template_id), references, referenceFileId: references.board || references.source || null, boardStale, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function isStyleBoardStale(row: StyleRow, boardFileId?: string) {
    if (!boardFileId || row.mode === "template") return false;
    const generations = db.prepare("SELECT request,result FROM generations WHERE user_id=? AND status='succeeded' AND result LIKE ? ORDER BY updated_at DESC LIMIT 20").all(row.user_id, `%${boardFileId}%`) as Array<{ request: string; result: string | null }>;
    const generation = generations.find((item) => (parseJson<{ files?: Array<{ fileId?: string; id?: string }> }>(item.result, {}).files || []).some((file) => String(file.fileId || file.id || "") === boardFileId));
    if (!generation) return false;
    const target = parseJson<{ params?: { __visualStyleBoard?: { styleId?: string; styleRevision?: number } } }>(generation.request, {}).params?.__visualStyleBoard;
    return target?.styleId === row.id && typeof target.styleRevision === "number" && row.revision > target.styleRevision + 1;
}
function publishStyle(userId: string, row: StyleRow) { const style = styleResponse(row); emitStyle(userId, style); return style; }
function assertProject(userId: string, projectId: string) { if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND user_id=?").get(projectId, userId)) throw styleError(404, "PROJECT_NOT_FOUND", "画布不存在或无权访问"); }
function assertReferenceKind(userId: string, fileId: string, prefix: string) { const row = db.prepare("SELECT mime_type FROM stored_files WHERE id=? AND user_id=?").get(fileId, userId) as { mime_type: string } | undefined; if (!row || !row.mime_type.startsWith(prefix)) throw styleError(400, "CANVAS_REFERENCE_TYPE_INVALID", "连接文件类型与语义端口不匹配"); }
function assertStyleReferences(userId: string, references: VisualStyleReferences) { Object.values(references).forEach((fileId) => fileId && assertReferenceKind(userId, fileId, "image/")); }
function syncStyleRefs(userId: string, styleId: string, references: VisualStyleReferences) { syncFileRefs(userId, "visual_style", styleId, references); }
function projectPayload(userId: string, projectId: string) { const row = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { payload: string } | undefined; if (!row) throw styleError(404, "PROJECT_NOT_FOUND", "画布不存在或无权访问"); const project = parseJson<ProjectPayload>(row.payload, { nodes: [], connections: [] }); project.nodes = Array.isArray(project.nodes) ? project.nodes : []; project.connections = Array.isArray(project.connections) ? project.connections.filter((item) => typeof item.fromPortId === "string" && typeof item.toPortId === "string") : []; return project; }
function saveProject(userId: string, projectId: string, project: ProjectPayload) { const now = new Date().toISOString(); db.prepare("UPDATE projects SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...project, updatedAt: now }), now, projectId, userId); syncFileRefs(userId, "project", projectId, project); const row = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { id: string; title: string; payload: string; revision: number; created_at: string; updated_at: string }; publishAgentProject(userId, { ...parseJson<Record<string, unknown>>(row.payload, {}), id: row.id, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }); }
function styleError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }
