---
name: director-check-continuity
description: 按镜头意图与实际选片核对身份、空间、视线、道具、动作、对白和可用剪接点，区分计划判断与真实声画证据。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_segments, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_read_edit, mcp__infinite_canvas__director_validate, mcp__infinite_canvas__media_prepare_video_overview, mcp__infinite_canvas__media_sample_video_frames, mcp__infinite_canvas__media_understand_audios]
---

# 连续性检查

从 `timeline/timeline.json` 的独立片段 ID 和实际入出点定位素材，再读取关联 `productions/<任务ID>/task.md`、当前视频和 `scenes/` 中的分镜段设计与预演。没有实际媒体时只能检查文字计划。

先看联系表，再在实际剪接点前后取帧并顺序观看；检查人物身份、空间轴线、视线、屏幕方向、道具状态、服装、动作阶段、对白时序和声桥。多镜头生成的计划切点不等于实际切点；单张首尾帧不能证明运动平滑。

模型原声按任务素材时间映射；解关联后可先入或后出。检查漏词、重复台词、说话人、断句和突变，不用音频语义理解冒充精确逐词对齐。

每项发现写明“片段 ID + 任务路径 + 实际秒数 + 观察证据 + 影响 + 最小修订建议”。覆盖完整性以预期剪辑是否表达剧本必要内容为准，允许素材时间重叠，不要求任务时长守恒。

只要求检查时不修改；获准修订后只调整受影响镜头、任务或裁切并校验。上游重做后逐项定位下游依赖，不默认重做全片。

预演检查包括同一时刻任意拖动后的状态、硬切前后位置、三人交叉遮挡、递物手与交接时刻、前段终点和后段初始位置。定妆帧 sourceHash 过期时标记待检查。最终视频仍需实际检查；计划镜头边界不是实际切点。
