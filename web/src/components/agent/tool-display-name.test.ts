import { describe, expect, it } from "vitest";

import { formatAgentToolName } from "./tool-display-name";

describe("formatAgentToolName", () => {
    it.each(["ToolSearch", "tool_search", "toolSearch"])("将 %s 显示为搜索可用工具", (name) => {
        expect(formatAgentToolName(name)).toBe("搜索可用工具");
    });

    it("移除应用 MCP 前缀并显示中文名称", () => {
        expect(formatAgentToolName("mcp__infinite_canvas__visual_style_create")).toBe("创建视觉风格");
        expect(formatAgentToolName("mcp__infinite_canvas__media_prepare_video_overview")).toBe("生成视频联系表");
    });
});
