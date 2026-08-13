---
name: director-arrange-timeline
description: 按镜头顺序编排导演项目的视频与对白、旁白、环境声、音效和音乐轨。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_check_continuity, mcp__infinite_canvas__director_update_timeline]
---

# 导演台时间线编排

以镜头为主轨，按叙事顺序设置时长、裁切、音量、静音、循环和 `cut`/`continue` 边界。根据剧本与资产引用铺设对白、旁白、环境声、道具音效和背景音乐。

写入前检查缺失视频、重叠声音和连续性问题；不把可选声音缺失误报为视频阻塞。
