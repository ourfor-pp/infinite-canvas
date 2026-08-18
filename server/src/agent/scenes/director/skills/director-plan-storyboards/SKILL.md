---
name: director-plan-storyboards
description: 将当前已保存剧本无损拆成 4–15 秒视频段，并为每段规划一张包含 1–3 个真实 Shot 的多宫格故事板；用于视频段编排、故事板提示修订和生成前检查。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_document, mcp__infinite_canvas__director_list_sequences, mcp__infinite_canvas__director_list_video_segments, mcp__infinite_canvas__director_get_video_segment, mcp__infinite_canvas__director_list_assets, mcp__infinite_canvas__director_create_sequences, mcp__infinite_canvas__director_update_sequence, mcp__infinite_canvas__director_create_video_segments, mcp__infinite_canvas__director_update_video_segment, mcp__infinite_canvas__director_update_video_segments, mcp__infinite_canvas__director_validate_video_segments, mcp__infinite_canvas__director_update_storyboard_prompts, mcp__infinite_canvas__director_generate_storyboard]
---

# 导演台故事板规划

先读 [剧本到视频段](references/segment-planning.md)、[故事板与 Shot](references/storyboard-language.md) 与 [连续性检查](references/continuity-qc.md)。严格分两步执行：先完成场景到视频段的内容覆盖与时长守恒，再为每个视频段设计 Shot 和画格；不得边拆剧情边随意决定镜头。

每段填写来源场次、来源节拍、该段唯一的戏剧变化、开始状态和结束状态。一个剧本节拍不得静默丢失；场次拆段后的总计划时长应接近原场次时长。内容超过 15 秒时拆成相邻视频段，不压缩对白、停顿、反应或动作过程来硬塞时长。

一张故事板对应一次视频生成：使用当前配置的图片模型发起一次请求，生成固定 `2×2`、`3×2` 或 `3×3` 整板，不逐格生图，也不把画格拆成独立生成单元。只有用户明确要求时才生成图片；模型支持图片输入时，生成前确认实际参考图包含主角色和场景。不得要求特定供应商或提示档案。

创建视频段时直接填写工具声明的来源节拍、戏剧变化、开始/结束状态、时长、边界、描述、动作、声景与素材引用字段，不构造 `assets`、`references`、`storyboard` 或任意 payload。批量匹配素材或统一修改结构时优先一次调用 `director_update_video_segments`，不要逐段重复更新。

场景、时空或主要人物组合发生明显变化时拆成新的视频段和独立故事板，不把跨场景过渡塞进同一张整板。普通相邻段使用 `cut`；只有同一动作、同一空间和同一镜头运动确实跨越段界时，下一段才使用 `continue` 并填写 `continuationFromSegmentId`。声音先于画面进入或延后退出属于时间线声桥，不因此改成首尾帧视频生成。确有溶变式形态变化、穿越遮挡物或其他必须生成的视觉桥接时，单独创建 4–6 秒 `generationIntent: transition` 视频段，并填写 `transitionFromSegmentId` 与 `transitionToSegmentId`；它不生成故事板，必须等相邻两段已有实际首尾帧后再生成。

视觉风格只约束媒介、真实程度、色彩、材质、光线和摄影质感，不得从风格描述继承“短促切镜、快节奏、蒙太奇”等剪辑指令。剪辑节奏必须由当前剧本节拍和表演需要决定。

同时为视频段填写简洁的英文 `h3VisualDescription` 与具体英文 `h3Soundscape`：前者只描述可见动作、构图和运镜，后者只描述环境声、同步动作声和非语言人声。不要继续填写旧的段落级 `dialogue`；精确对白在画格的 `dialogues` 中结构化提交。

整理已有提示词时，先批量调用 `director_validate_video_segments`，只修返回问题的视频段。按剧情段落分页读取精简提示词视图，每批最多十个视频段调用 `director_update_storyboard_prompts`：

1. 把旧 `sound` 中形如“角色：台词”的内容拆开；对白原文移入 `dialogues`，咳嗽、呼吸、脚步等才留在 `sound`。
2. 每条对白填写角色素材 ID、角色名、原文、语言、英文语气与发声方式、精确起止秒数及是否画外；对白窗口必须足够念完且默认不重叠。
3. 先按真实构图切换划分 1–3 个 Shot，再为画格连续编号；同一连续镜头中的动作推进保持同一 Shot，不能把整段机械地全标为 Shot 1。
4. 每格提交精确时间、类型、用于图片模型生成整板的画面/动作/机位/运镜，以及简洁英文 `h3Visual` 和具体英文 `sound`。`h3Visual` 只写可观察构图、主体动作、环境状态和运镜，不写标题、字段名或声音。

第一格从 0 秒开始，最后一格落在视频段结尾，时间严格递增。不要复制或覆盖整个 `storyboardSheet`；服务端会保留整板媒体、分别重编两类最终提示词并标记旧故事板与视频过期。更新一批后再次调用 `director_validate_video_segments`，确认通过再结束；除非用户明确要求生成，否则只修提示，不触发图片或视频任务。
