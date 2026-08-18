---
name: director-generate-shots
description: 用完整故事板、素材和可选音频生成视频段，并处理连续续写、预览与最终成片。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_list_video_segments, mcp__infinite_canvas__director_get_video_segment, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_validate_video_segments, mcp__infinite_canvas__director_update_storyboard_prompts, mcp__infinite_canvas__director_update_video_segment, mcp__infinite_canvas__director_generate_video_segment, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台视频段生成

先读 [MiniMax H3 官方提示规则](references/official-h3-prompt.md)，再读 [H3 交接与提示结构](references/shot-handoff.md)。读取视频段、整张故事板、资产、风格和服务端声明的能力。默认先生成快速预览；用户要求交付、定稿或最终质量时生成最终成片。普通视频段统一使用整张故事板参考生成，不要求用户选择底层模式。

生成前必须调用 `director_validate_video_segments`。有阻断项时先按 `director-plan-storyboards` 修订视频段或画格，再重新校验；不得用一次失败的媒体生成充当校验。校验必须通过来源节拍、开始/结束状态、时长、Shot 边界、同镜头摄影连续性、对白窗口和英文声景，不能只检查字段是否非空。

每个真实 Shot 必须有英文构图、主体位置、环境、动作、状态变化和自然运镜描述。同一 Shot 的多个画格编译为连续动作，不得产生隐含切镜；只有 Shot 编号变化时才能写 `hard cut`。不得拿视频段标题或剧情摘要代替画面动作；不得把标题、人物名、Shot 标签、时间点或提示词说明写成可朗读内容。中文只保留在结构化对白、歌词和明确可见的画面文字中，对白原文不得改写。

每条对白必须绑定已采用的角色素材，并具有稳定说话人、准确起止时间、英文语气和唯一的 `<d>` 原文来源。把每格其他声音意图整理成具体英文声景，明确环境声、可见动作同步声和非语言人声；不要用“自然环境音”替代具体声音，也不要把对白重复写进声景。快速预览含对白、旁白或明确音效时接受服务端自动使用基础预览配方，以声音稳定为先；不要为了追求 Turbo 速度覆盖该判断。

不得裁切故事板画格作为普通视频锚点。完整故事板是一个按从左到右、从上到下读取的 Shot 规划参考；H3 只执行已经确认的表演与摄影计划，不得自行压缩剧情、增加切镜或把画格逐一变成镜头。`continue` 额外使用上一段实际成片最后 22 帧及原声续接，不冒充确定性原生延展。`generationIntent: transition` 的独立过渡段例外：它只从 `transitionFromSegmentId` 的实际尾帧过渡到 `transitionToSegmentId` 的实际首帧，不生成或读取故事板。生成后检查视频、实际首尾帧和模型原声；前序变化只标记依赖段过期，不自动重生成。

面向用户只解释“快速预览 / 最终成片、完整故事板、素材参考、连续段”，不得展示底层权重、插件节点、采样器、调度器或注意力实现。
