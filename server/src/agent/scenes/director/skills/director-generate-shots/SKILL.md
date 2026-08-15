---
name: director-generate-shots
description: 为已有整张故事板的视频段规划时序锚点，选择预览或成片并生成带原生声音的视频。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_update_video_segment, mcp__infinite_canvas__director_generate_video_segment, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台视频段生成

先读 [MiniMax H3 官方提示规则](references/official-h3-prompt.md)，再读 [H3 交接与提示结构](references/shot-handoff.md)。读取视频段、整张故事板、资产、风格和服务端声明的能力。默认先生成快速预览；用户要求交付、定稿或最终质量时生成最终成片。让服务端自动选择生成模式，只有用户明确要求时才覆盖。

生成前检查每个真实 Shot 是否有英文构图、主体位置、环境、动作、状态变化和自然运镜描述。不得拿视频段标题或剧情摘要代替画面动作；不得把标题、人物名、Shot 标签、时间点或提示词说明写成可朗读内容。中文只保留在对白、歌词和明确可见的画面文字中，对白原文不得改写。

每段最多启用四个视频锚点，优先首格、末格、切镜开始、关键动作或剧情转折；其余画格继续作为语义提示。`continue` 使用上一段实际成片尾部及原声续接，不冒充确定性原生延展。生成后检查视频、实际首尾帧和模型原声；前序变化只标记依赖段过期，不自动重生成。

面向用户只解释“快速预览 / 最终成片、视频锚点、素材参考、连续段”，不得展示底层权重、插件节点、采样器、调度器或注意力实现。
