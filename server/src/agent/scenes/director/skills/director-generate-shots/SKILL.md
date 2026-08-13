---
name: director-generate-shots
description: 为确认后的导演镜头生成首帧、尾帧、分镜图或视频片段。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_generate_shot, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台镜头生成

读取镜头、绑定资产、风格和模型能力。普通切镜使用本镜头确认首帧；连续镜头使用上一段实际尾帧或模型原生延展能力，不根据模型名称猜测参数。

生成前遵守故事板阶段门。生成完成后检查状态与首尾帧，前序变化导致的连续镜头过期必须明确指出。
