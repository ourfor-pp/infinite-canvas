import { describe, expect, it } from "vitest";

import { filterVisualStyleTemplates } from "./visual-style-templates";
import type { VisualStyleTemplate } from "@/types/visual-style";

const dna = { mediumFamily: "live_action" as const, medium: "真人电影", rendering: "写实", characterRendering: "写实演员", sceneRendering: "写实场景", propRendering: "写实道具", palette: "暖灰", lighting: "窗光", contrast: "低反差", texture: "胶片", lensAndDepth: "50mm", composition: "留白", postProcessing: "暖调", exclusions: ["文字"] };
const templates = [
    { id: "natural", name: "克制当代电影", category: "cinematic", tags: ["都市", "家庭"], tagline: "都市与家庭叙事", description: "自然主义", preview: "visual-styles/natural.webp", colors: ["#000", "#777", "#fff"], dna },
    { id: "ink", name: "水墨动画", category: "handmade", tags: ["东方", "水墨"], tagline: "东方寓言", description: "宣纸与墨色", preview: "visual-styles/ink.webp", colors: ["#000", "#777", "#fff"], dna: { ...dna, mediumFamily: "illustration" } },
] satisfies VisualStyleTemplate[];

describe("内置视觉风格筛选", () => {
    it("按谱系和名称、题材、描述搜索", () => {
        expect(filterVisualStyleTemplates(templates, "illustration", "").map((item) => item.id)).toEqual(["ink"]);
        expect(filterVisualStyleTemplates(templates, "all", "家庭").map((item) => item.id)).toEqual(["natural"]);
        expect(filterVisualStyleTemplates(templates, "all", "宣纸").map((item) => item.id)).toEqual(["ink"]);
    });

    it("可以搜索标签和 Style DNA", () => {
        expect(filterVisualStyleTemplates(templates, "all", "家庭").map((item) => item.id)).toEqual(["natural"]);
        expect(filterVisualStyleTemplates(templates, "all", "水墨").map((item) => item.id)).toEqual(["ink"]);
    });
});
