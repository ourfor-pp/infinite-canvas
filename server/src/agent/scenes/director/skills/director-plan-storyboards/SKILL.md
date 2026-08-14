---
name: director-plan-storyboards
description: 将已确认剧本规划为剧情段落及每段 4–9 格的结构化故事板。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_list_assets, mcp__infinite_canvas__director_create_sequences, mcp__infinite_canvas__director_update_sequence, mcp__infinite_canvas__director_generate_storyboard_panel, mcp__infinite_canvas__director_generate_storyboard, mcp__infinite_canvas__director_create_shots]
---

# 导演台故事板规划

先读 [故事板镜头语言](references/storyboard-language.md) 与 [连续性检查](references/continuity-qc.md)。按剧情段落建立 sequence，每段规划 4–9 格，覆盖建立、推进、转折和收束。每格明确叙事目的、画面动作、对白或旁白、景别、机位、运镜和时长，并绑定角色、场景、道具稳定 ID 与 revision。

先创建或更新结构化故事板。只有用户明确要求时才逐格或批量生成图片；每格是独立图片，前端组合成大卡，绝不生成不可拆分的巨型位图。故事板确认后才拆成独立镜头，并完整复制镜头语言、资产引用、时长和首帧。
