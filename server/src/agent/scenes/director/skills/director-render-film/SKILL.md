---
name: director-render-film
description: 检查导演时间线并发起、查看、取消或重试完整 MP4 成片合成。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_check_continuity, mcp__infinite_canvas__director_list_renders, mcp__infinite_canvas__director_start_render, mcp__infinite_canvas__director_cancel_render, mcp__infinite_canvas__director_retry_render]
---

# 导演台成片合成

导出前检查时间线全部镜头是否具有可用视频，并报告缺失的可选声音。只有视频主轨完整时才调用 `director_start_render`。

合成过程中可查询、取消或重试任务。失败重试不得覆盖最近一次成功成片；完成后返回可下载的 MP4 状态。
