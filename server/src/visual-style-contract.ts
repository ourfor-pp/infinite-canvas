export type VisualStyleMediumFamily = "live_action" | "animation_2d" | "animation_3d" | "illustration" | "handmade" | "graphic";

export type VisualStyleDna = {
    mediumFamily: VisualStyleMediumFamily;
    medium: string;
    rendering: string;
    characterRendering: string;
    sceneRendering: string;
    propRendering: string;
    palette: string;
    lighting: string;
    contrast: string;
    texture: string;
    lensAndDepth: string;
    composition: string;
    postProcessing: string;
    exclusions: string[];
};

export function inferVisualStyleMediumFamily(medium: string): VisualStyleMediumFamily {
    if (/(三维|3d|CG|PBR)/i.test(medium)) return "animation_3d";
    if (/(赛璐璐|二维动画|2d animation|动态漫画)/i.test(medium)) return "animation_2d";
    if (/(水墨|水彩|插画|条漫|绘本|油画|彩铅|厚涂)/i.test(medium)) return "illustration";
    if (/(黏土|定格|剪纸|手工|木偶)/i.test(medium)) return "handmade";
    if (/(像素|孔版|丝网|平面|graphic|海报)/i.test(medium)) return "graphic";
    return "live_action";
}

export function serializeVisualStyleMarkdown(name: string, description: string, dna: Partial<VisualStyleDna>) {
    const value = (key: keyof VisualStyleDna) => String(dna[key] || "");
    const exclusions = Array.isArray(dna.exclusions) ? dna.exclusions.map((item) => String(item).trim()).filter(Boolean) : [];
    return [
        `# ${name}`,
        "## 总体风格", description,
        "## 媒介", value("medium"),
        "## 通用渲染", value("rendering"),
        "## 角色呈现", value("characterRendering"),
        "## 场景呈现", value("sceneRendering"),
        "## 道具呈现", value("propRendering"),
        "## 色彩", value("palette"),
        "## 光线", value("lighting"),
        "## 反差", value("contrast"),
        "## 材质与质感", value("texture"),
        "## 镜头与景深", value("lensAndDepth"),
        "## 构图", value("composition"),
        "## 后期处理", value("postProcessing"),
        "## 避免元素", exclusions.map((item) => `- ${item}`).join("\n"),
    ].join("\n\n");
}
