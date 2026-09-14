---
name: director-generate-video-segments
description: 将镜头需求转换为独立制作任务，按实际能力选择单镜、多镜、原生续接或首尾帧过渡，预检后生成并检查当前结果。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_shots, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_preflight_tasks, mcp__infinite_canvas__director_generate_task, mcp__infinite_canvas__director_get_generation_status]
---

# 视频制作任务

先使用 `media-generation` Skill 了解当前媒体能力和官方提示规则，再读 [任务交接](references/shot-handoff.md)。按需读取镜头设计、素材、导演规则和当前能力，把拍摄需求转换为 `productions/<任务ID>/task.md`。任务用 `shotIds` 声明覆盖镜头，可多对多；镜头的预计时长不因此改变。

选择单镜生成、多镜生成、同镜头原生续接或已有首尾帧过渡。单次窗口以预检返回的 plan 为准。普通参考图可留空、可为单图或多宫格，采用的图片必须在 `referenceImages` 显式列出。声音参考仍写 `audioReferences`（工程相对 path、purpose、英文 description；音色/对白参考还需 speakerAssetId）。程序不自动选角色图或风格板，不隐藏添加创作语义。

最终提示写入同目录 `video-prompt.md`，正文就是原样发送给模型的文本。核对预检返回的路径、hash、引用顺序和数量；无需故事板结构即可写最终提示，不把标题和剧情摘要当作可观察的表演。官方格式要求英文描述时，中文只保留在对白原文、歌词或画面文字中。

生成前调用 `director_preflight_tasks`。模型限制仅约束任务；超出能力时拆分任务或改变生成方式，不截断镜头意图。不同任务允许提供重叠时间的覆盖；不要求生成时长总和等于成片长度。

续接任务声明 `boundary: continue` 与 `continuationFromSegmentId`（值为制作任务 ID），沿用原生状态与配方身份。隐藏重叠由执行器处理，不自行修改权重、状态和路径。前序重做只标记下游待检查，不自动重做。

首尾帧过渡声明 `generationIntent: transition`、`transitionFromSegmentId`、`transitionToSegmentId`；使用两端任务的实际尾帧与首帧。J-cut/L-cut 是独立声音编排，不因此生成画面过渡。

预检通过后调用 `director_generate_task`，默认先生成预览；要求交付或最终质量时选择 final。生成沿用执行器预检给出的配方，recipe=base 表示用户显式选择基础版重做。按生成 ID 查询状态，未知或运行中结果不得重复提交。

成功且校验媒体后替换任务当前结果；失败、取消和生成中保留旧媒体。替换后旧裁切超出新结果会明确报错，需要重新选片。没有候选版本管理；需要保留旧方案时先按用户意图另建任务。

生成完成不自动进入时间线。实际观看或取样检查身份、表演、实际切点、音频和可用区间，再组合连续性检查与时间线 Skill。计划镜头切点不能视为准确素材分界。
