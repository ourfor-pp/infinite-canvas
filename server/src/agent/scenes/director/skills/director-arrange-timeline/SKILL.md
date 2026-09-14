---
name: director-arrange-timeline
description: 编排视频段与声音轨、检查实际时长和声桥，并提交、查看或重试整片 MP4 导出。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_generate_music, mcp__infinite_canvas__director_get_generation_status, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_validate, mcp__infinite_canvas__director_list_renders, mcp__infinite_canvas__director_start_render, mcp__infinite_canvas__director_cancel_render, mcp__infinite_canvas__director_retry_render]
---

# 导演台时间线编排

先读 [文件格式与完整样例](references/file-format.md)。

以视频段为主轨，按叙事顺序设置时长、裁切、音量、静音、循环和 `cut`/`continue` 边界。保留默认启用的模型原声轨，并根据剧本与资产引用铺设对白、旁白、环境声、道具音效和背景音乐；可建议静音模型原声，但不得自动删除。需要 J-cut 或 L-cut 时让声音轨跨越视频段边界，不要因此把普通画面切换改成首尾帧视频生成。

需要独立配乐时，先阅读 [配乐工程与生成](references/music.md)，按故事的情绪变化和对白留白设计音乐；不要为配乐创建伪角色、场景或道具。

直接维护 `timeline/timeline.json`。写入前检查缺失视频、重叠声音和连续性问题，写完调用 `director_validate`；不把可选声音缺失误报为视频阻塞。

导出前或处理合成任务时阅读 [成片提交与验收](references/rendering.md)。时间线使用实际媒体时长，保留原生帧对齐尾部；累计视频与原声的连续链由后端解析，不能把累计画面与其前段再次拼接。
