---
name: director-arrange-timeline
description: 按实际素材选片、裁切和排序，独立编排模型原声与声音轨，核对内容覆盖及声画衔接并导出固定媒体快照。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_read_edit, mcp__infinite_canvas__director_edit_timeline, mcp__infinite_canvas__director_generate_music, mcp__infinite_canvas__director_get_generation_status, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_validate, mcp__infinite_canvas__director_list_renders, mcp__infinite_canvas__director_start_render, mcp__infinite_canvas__director_cancel_render, mcp__infinite_canvas__director_retry_render]
---

# 选片与剪辑

先读 [文件格式](references/file-format.md)。视频主轨按 `videoClips` 顺序拼接，每个片段有独立 id、taskId、trimIn、trimOut、linkedAudio。允许同一任务重复使用不同范围，不把生成任务总时长当作成片时长。

先观看实际素材并确定剪接点，再编排。计划画格时点不能直接作为素材分界。加入视频默认 `linkedAudio: true`；需要 J-cut/L-cut 时设置 false，并把该任务原声作为独立 track clip，避免双重播放。

声音可跨画面边界，设置成片 start、素材 trimIn、duration、volume、muted、loop、fadeIn/fadeOut；独立声音可来自任务 taskId 或工程媒体 path。模型原声由任务当前输出解析，累计续接的时间偏移交给服务端播放计划，不能手工把累计偏移再次加进 taskId 片段。

保存前读取当前文件/hash 或使用当前 timeline revision，冲突时重新读取，不猜版本。保存后校验并用服务端播放计划检查实际裁切；任务替换后裁切越界必须调整，不静默缩短。

生成完成不自动加入成片。完整性按当前预期剪辑的剧情、动作、对白及反应覆盖检查，允许任务之间戏剧时间重叠。

独立配乐见 [配乐](references/music.md)。导出见 [提交与验收](references/rendering.md)：提交时固定媒体快照，后续重做不改变该次导出。浏览器预览与导出使用同一播放计划；代码测试不能替代真实声画检查。
