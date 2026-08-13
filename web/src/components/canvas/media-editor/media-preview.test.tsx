import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MediaPreview } from "./media-preview";

describe("MediaPreview", () => {
    it("业务节点主图只阻止画布拖动，不阻止滚轮缩放", () => {
        const html = renderToStaticMarkup(<MediaPreview kind="image" title="角色" emptyLabel="生成设计图" onEdit={vi.fn()} />);

        expect(html).toContain('data-canvas-no-pan="true"');
        expect(html).not.toContain("data-canvas-no-zoom");
    });
});
