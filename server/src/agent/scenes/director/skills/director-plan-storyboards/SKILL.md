---
name: director-plan-storyboards
description: 按完整场景设计观看顺序、调度、主镜头、反应与补充覆盖，建立不受生成窗口限制的文字分镜，并规划镜头与制作任务的多对多关系。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_shots, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_validate]
---

# 镜头规划

先读 [v2 文件格式](references/file-format.md)、[场景与制作规划](references/segment-planning.md) 和 [镜头语言](references/storyboard-language.md)。按需分页读取当前剧本、制作拆解、导演规则和视觉风格；不要一次读全工程。

先为完整场景设计观看顺序、人物调度、视线、画面、动作、对白、声音和衔接，再规划主画面、必要反应与补充覆盖。保留表演的铺垫、停顿、转折和后果，不为模型窗口截短文字镜头。素材未齐也能完成全部文字设计。

镜头写入 `storyboards/<场景>/shot-<ID>/shot.md`，所属场景保留 `sequence.md`。镜头记录来源场次与节拍、叙事目的、人物调度、摄影、动作、对白、声音、预计时长和开始/结束状态。预计时长表达创作意图，没有 4–15 秒限制。

一个镜头可由多个制作任务实现，一个任务也可覆盖多个镜头。素材可重复覆盖同一段戏，为后期提供不同视角；不要求生成总时长等于成片时长。需要安排生成时组合视频生成 Skill，在 `productions/` 另建任务，不把生成参数放进镜头设计。

参考图片是可选输入：可使用单张画面或任意数量结构化关键时刻的多宫格说明，不要求每个镜头先生成图片，也不固定每张参考图的格数。整张参考图仍作为一个媒体文件操作。普通图片使用宿主原生生图能力，遵循工程落盘与索引约定。

视觉风格约束媒介、真实程度、色彩、材质、光线和摄影质感。剪辑节奏由剧本与表演需要决定，不从风格说明继承无依据的快切或蒙太奇。

修改前读取当前文件哈希；保存后运行 `director_validate`。已有任务受镜头变化影响时标记待检查；未经授权不重生成。计划时点只是意图，实际切点必须查看生成视频才能确定。
