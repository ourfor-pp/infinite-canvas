import assert from "node:assert/strict";
import test from "node:test";

import { buildVisualStyleBoardPrompt, inferVisualStyleMediumFamily, serializeVisualStyleMarkdown } from "./visual-style-contract.js";

test("视觉风格 Markdown 使用稳定的共享章节协议", () => {
    const markdown = serializeVisualStyleMarkdown("水墨喜剧", "轻盈、有留白。", {
        medium: "二维水墨动画",
        rendering: "宣纸晕染",
        characterRendering: "清晰墨线",
        sceneRendering: "层叠山水",
        propRendering: "可读结构",
        palette: "纸白、墨黑、朱砂",
        lighting: "柔和散射光",
        contrast: "中低反差",
        texture: "宣纸纤维",
        lensAndDepth: "绘本式空间",
        composition: "大面积留白",
        postProcessing: "保留水痕",
        exclusions: ["文字", "三维塑料感"],
    });
    for (const heading of ["总体风格", "媒介", "通用渲染", "角色呈现", "场景呈现", "道具呈现", "避免元素"]) assert.match(markdown, new RegExp(`^## ${heading}$`, "m"));
    assert.match(markdown, /- 文字\n- 三维塑料感/);
});

test("视觉媒介族根据可观察媒介描述推断", () => {
    assert.equal(inferVisualStyleMediumFamily("真人都市电影摄影"), "live_action");
    assert.equal(inferVisualStyleMediumFamily("二维赛璐璐动画"), "animation_2d");
    assert.equal(inferVisualStyleMediumFamily("高品质三维 PBR 动画"), "animation_3d");
    assert.equal(inferVisualStyleMediumFamily("透明水彩绘本"), "illustration");
    assert.equal(inferVisualStyleMediumFamily("层叠手工剪纸"), "handmade");
    assert.equal(inferVisualStyleMediumFamily("复古丝网海报"), "graphic");
});

test("风格板使用各类呈现和完整视觉方案，不将动物世界强制改为人物与人造物", () => {
    const dna = { medium: "三维动画", rendering: "柔软写实材质", characterRendering: "只有森林动物，幼态体型与逆光绒毛", sceneRendering: "巨大杉树、苔藓和湿地", propRendering: "树脂、羽毛与断枝，只有自然物", palette: "苔绿与琥珀金", lighting: "黄金时刻体积光", contrast: "暗部可读", texture: "湿润树皮", lensAndDepth: "浅景深", composition: "低机位", postProcessing: "细腻颗粒", exclusions: ["人类", "衣服与背包"] };
    const prompt = buildVisualStyleBoardPrompt("森林短片", "家庭动画", dna);
    for (const value of Object.values(dna).flat()) assert.ok(prompt.includes(value), `丢失视觉方案：${value}`);
    assert.doesNotMatch(prompt, /一名.*中性人物/);
    assert.match(prompt, /物种与外形类别遵循角色呈现/);
});
