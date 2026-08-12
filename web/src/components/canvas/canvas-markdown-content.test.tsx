import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasMarkdownContent } from "./canvas-markdown-content";

describe("CanvasMarkdownContent", () => {
    it("把故事标题、章节和强调内容渲染为 Markdown 语义元素", () => {
        const html = renderToStaticMarkup(
            <CanvasMarkdownContent fontSize={15} color="#111">
                {"# 山海回声\n\n## 第一章\n\n这是**同一张故事卡**。"}
            </CanvasMarkdownContent>,
        );

        expect(html).toContain("<h1");
        expect(html).toContain("山海回声</h1>");
        expect(html).toContain("<h2");
        expect(html).toContain("第一章</h2>");
        expect(html).toContain('data-streamdown="strong">同一张故事卡</span>');
        expect(html).toContain('data-canvas-no-zoom="true"');
    });
});
