---
name: director-generate-shots
description: 为已有整张故事板的视频段选择 MiniMax H3 模式并生成带原生声音的视频。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_update_video_segment, mcp__infinite_canvas__director_generate_video_segment, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台视频段生成

先读 [H3 交接与提示结构](references/shot-handoff.md)。读取视频段、整张故事板、资产、风格和声明的模型能力。让服务端自动选择 H3 模式；只有用户明确要求时才覆盖。

`FL2VA` 使用首尾画格锚点；`Ref2VA` 使用整张故事板与资产参考。`continue` 使用上一段实际尾帧作为下一段首帧，不冒充确定性原生 Extend。生成后检查视频、实际首尾帧和模型原声；前序变化只标记依赖段过期，不自动重生成。
