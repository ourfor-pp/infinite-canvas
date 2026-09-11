---
name: director-check-continuity
description: 对照故事板、素材和实际视频取样检查身份、空间、动作接点、对白与声桥连续性，给出可定位证据和最小修订建议。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_validate, mcp__infinite_canvas__media_prepare_video_overview, mcp__infinite_canvas__media_sample_video_frames, mcp__infinite_canvas__media_understand_audios]
---

# 连续性检查

先按 `timeline/timeline.json` 定位待检查段及相邻段，再读取它们的 `segment.md`、`storyboard.yaml`、整张故事板、`videos/seg-<segmentId>/` 下实际媒体和相关素材。没有实际媒体时只能检查文字计划，不能声称画面连续性已通过。

使用当前场景的媒体取样能力先看联系表，再在明确接点前后取帧并按顺序观察。检查人物身份、屏幕方向、站位、动作阶段、道具持有与损毁、服装、时空与光线。声音使用媒体理解能力检查台词遗漏、重复、说话人、突变和声桥；语义判断不能冒充精确逐词对齐。单张首尾帧也不能证明运动平滑。

每个发现给出“文件或视频段路径 + 实际时间点 + 观察到的冲突 + 影响 + 最小修订建议”，区分确定问题与证据不足。画格仅用于对照结构，整张故事板仍作为一个文件查看与操作。

用户只要求检查时不改文件；明确要求修复时修改相关文字或时间线并校验，媒体重生成需已有授权。前段变化只标记受影响内容待检查，不默认重做全片。
