---
name: check-continuity
description: 检查角色场景道具版本、镜头动作和 cut/continue 连续链是否一致。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_check_continuity, mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__director_update_shot]
---
# 连续性检查

先运行连续性报告，再逐项核对过期依赖、角色外观、空间方向、道具状态、动作衔接与光线。普通换镜使用 cut；只有确实需要从上一段实际尾帧续写时使用 continue，并保存前序镜头 ID。只修订未锁定的规划信息，不自动触发媒体生成。
