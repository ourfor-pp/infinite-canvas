---
name: director-breakdown-screenplay
description: 将当前标准分场剧本转换为独立的结构化制作拆解；用于分析场次、表演节拍、素材候选和预计时长，不用于改写剧本、设计 Shot 或创建视频段。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_validate]
---

# 剧本制作拆解

先读 [制作拆解规则](references/breakdown-schema.md)。分页读取当前 `screenplay/` 文件和已有拆解，以文件内容哈希判断是否过期。只分析剧本正文已经明确的内容，不借拆解步骤补写剧情。

按剧本场景顺序建立稳定场次与表演节拍。记录地点、时段、出场人物、关键道具、开场状态、结尾状态、戏剧变化、必须保留的对白和合理表演时长。节拍描述动作、信息、关系或情绪的可观察变化，不包含 Shot、机位、运镜、故事板画格和生成提示词。

估算完成后与项目目标时长比较，并检查相邻场景是否重复同一冲突过程、重大决定是否缺少可观察的因果积累、场景是否没有独立功能、原故事关键事件或后果是否遗漏。只记录能由正文直接证明的问题，不因个人审美把题材惯例当成缺陷。把问题按 `duration`、`repetition`、`causality`、`scene_function`、`coverage` 写入 `reviewIssues`；没有实质问题时提交空数组。

将总览写入 `screenplay/breakdown/overview.md`，逐场拆解写入 `screenplay/breakdown/scene-NNN.md`，使用稳定场次 ID 引用 `screenplay/scenes/`。存在诊断问题时明确建议返回剧本修订，不通过缩短节拍、压缩视频段或省略内容伪造达标；完成后运行工程校验；用户仅要求拆解时交付拆解，已授权完整制作时继续组合素材与视频段规划 Skill。
