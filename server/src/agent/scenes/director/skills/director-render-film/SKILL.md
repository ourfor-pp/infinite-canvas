---
name: director-render-film
description: 检查导演时间线并发起、查看、取消或重试完整 MP4 成片合成。
allowed-tools: [Read, Glob, Grep, LS, mcp__infinite_canvas__director_validate, mcp__infinite_canvas__director_list_renders, mcp__infinite_canvas__director_start_render, mcp__infinite_canvas__director_cancel_render, mcp__infinite_canvas__director_retry_render]
---

# 导演台成片合成

导出前读取 `timeline/timeline.json` 并调用 `director_validate`，确认全部视频段具有可用视频，同时报告缺失的可选声音。只有相关范围没有 error 且视频主轨完整时才调用 `director_start_render`。

合成过程中可查询、取消或重试任务。失败重试不得覆盖最近一次成功成片；完成后返回可下载的 MP4 状态。
