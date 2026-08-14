---
name: director-plan-storyboards
description: 将已确认剧本规划为 4–15 秒视频段，并按动作节拍与切镜密度为每段规划一张 4、6 或 9 格故事板。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_list_assets, mcp__infinite_canvas__director_create_sequences, mcp__infinite_canvas__director_update_sequence, mcp__infinite_canvas__director_create_video_segments, mcp__infinite_canvas__director_update_video_segment, mcp__infinite_canvas__director_generate_storyboard]
---

# 导演台故事板规划

先读 [故事板与视频段](references/storyboard-language.md) 与 [连续性检查](references/continuity-qc.md)。按剧本建立剧情段落，再规划 4–15 秒视频段；超过 15 秒必须拆段。每段绑定角色、场景、道具和风格稳定 ID 与 revision，并按时长、独立视觉节拍和 Shot 数规划 4、6 或 9 个带时间点的画格。

一张故事板对应一次视频生成：使用一次 GPT-Image-2 请求生成固定 `2×2`、`3×2` 或 `3×3` 整板，不逐格生图，也不把画格拆成独立生成单元。只有用户明确要求时才生成图片；生成前确认实际参考图包含主角色和场景。
