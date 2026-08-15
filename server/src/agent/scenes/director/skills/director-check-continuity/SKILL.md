---
name: director-check-continuity
description: 检查导演项目视频段间的角色、场景、道具、动作、光线和首尾帧连续性。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_list_video_segments, mcp__infinite_canvas__director_get_video_segment, mcp__infinite_canvas__director_check_continuity, mcp__infinite_canvas__director_update_video_segment]
---

# 导演台连续性检查

按时间顺序检查资产 revision、人物站位与动作、道具状态、时空、光线、对白承接及 `continue` 边界。先报告具体冲突和受影响视频段，再对未锁定视频段作最小修订。

不得因上游变化自动触发昂贵生成；只标记需要检查或过期。
