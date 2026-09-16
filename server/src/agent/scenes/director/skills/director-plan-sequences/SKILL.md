---
name: director-plan-sequences
description: 将剧本组织为按场景分组的分镜段，设计每段戏的叙事目的、完整表演、时间预算和多个连续镜头，交接三维预演与制作任务。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_segments, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_validate]
---

# 分镜段设计

先读当前剧本与制作拆解、导演规则和 [v3 文件格式](references/file-format.md)。按需分页读取相关场景，不一次读取全工程。

列表中一项是一段完整的戏，可以包含多个机位、主镜头、反应和必要细节。先确定动作因果、人物关系的变化、观看顺序与空间关系，再设计切镜。保留铺垫、停顿、转折和后果；不按单次生成窗口截短表演，不把每次切镜拆成一个列表项。

将文字设计写入 `scenes/<场景>/segments/<分镜段>/segment.md`。记录来源节拍、叙事目的、调度、摄影、动作、对白、声音、开始状态、结束状态、衔接与总时间预算。稳定 ID 不随名称改变。一个场景使用一份共享 `scene.json`；每段的 `previs.json` 独立声明初始状态与完整时间定义。

默认组合 `director-stage-previs` 先完成可播放的粗模预演，素材图片缺失不阻止编排。预演用于验证调度、遮挡、视线与切镜；可选定妆帧用于具体视觉效果，不设确认门槛。超出基础动作范围时明确诊断，简化设计或按用户意图在 `segment.md` 设置 `previsMode: skip`，不得伪装已完成精确动作。

需要生产时组合视频制作 Skill。任务以 `segmentRanges` 指定一个或多个分镜段的时间范围，一段可跨任务，也可为后期安排重叠覆盖。制作任务和时间线独立，计划切点必须经过实际生成视频检查后才能作为剪接依据。

完成前调用 `director_validate`，核对剧情完整性、预计时长、镜头覆盖、跨段空间与身份连续性。校验通过不等于创作或视频质量通过。
