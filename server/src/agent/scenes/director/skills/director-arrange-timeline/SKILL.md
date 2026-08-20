---
name: director-arrange-timeline
description: 按视频段顺序编排导演项目的视频、模型原声与独立声音轨。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_validate]
---

# 导演台时间线编排

以视频段为主轨，按叙事顺序设置时长、裁切、音量、静音、循环和 `cut`/`continue` 边界。保留默认启用的模型原声轨，并根据剧本与资产引用铺设对白、旁白、环境声、道具音效和背景音乐；可建议静音模型原声，但不得自动删除。需要 J-cut 或 L-cut 时让声音轨跨越视频段边界，不要因此把普通画面切换改成首尾帧视频生成。

直接维护 `timeline/timeline.json`。写入前检查缺失视频、重叠声音和连续性问题，写完调用 `director_validate`；不把可选声音缺失误报为视频阻塞。
