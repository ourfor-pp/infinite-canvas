---
name: director-generate-video-segments
description: 将镜头需求转换为独立制作任务，按实际能力选择单镜、多镜、原生续接或首尾帧过渡，预检后生成并检查当前结果。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_segments, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_preflight_tasks, mcp__infinite_canvas__director_generate_task, mcp__infinite_canvas__director_get_generation_status]
---

# 视频制作任务

先使用 `media-generation` Skill 了解当前媒体能力和官方提示规则，再读 [任务交接](references/shot-handoff.md)。按需读取镜头设计、素材、导演规则和当前能力，把拍摄需求转换为 `productions/<任务ID>/task.md`。任务用 `segmentRanges: [{segmentId,start,end}]` 声明覆盖时间，可多对多；分镜段的时间预算不因此改变。默认用 `director-stage-previs` 导出每个范围，并将返回的路径、sourceHash 和范围写入 `videoReferences`，includeAudio 默认为 false。只有 segment.md 明确设置 previsMode: skip 才允许缺少预演参考。

输出方向与宽高比沿用 `direction/directing-rules.md` 摄影章节的成片画幅，不从角色身份板或模型默认尺寸推断。预检时核对计划的实际输出尺寸是否匹配；能力不支持时说明限制，不静默换横竖版。生成后验证实际视频宽高与构图，未经用户修改方案不得按场景改变画幅。

选择单镜生成、多镜生成、同镜头原生续接或已有首尾帧过渡。单次窗口以预检返回的 plan 为准。图片可留空，角色图和选中的定妆帧必须在 `referenceImages` 显式列出；与相应预演对象逐一对应。不得静默丢弃人物参考或把一个人物图号当作声音图号。声音参考仍写 `audioReferences`（工程相对 path、purpose、英文 description；音色/对白参考还需 speakerAssetId）。程序不自动选角色图或风格板，不隐藏添加创作语义。

最终提示写入同目录 `video-prompt.md`，正文就是原样发送给模型的文本。核对预检返回的路径、hash、引用顺序和数量；预演时间和动作是提示依据，不把标题和剧情摘要当作可观察的表演。官方格式要求英文描述时，中文只保留在对白原文、歌词或画面文字中。

生成前调用 `director_preflight_tasks`。模型限制仅约束任务；超出能力时拆分任务或改变生成方式，不截断分镜段意图，不静默拉伸预演或裁掉剧情。任务时长应与覆盖范围相符，并核对 plan 中实际帧数与输出时长。不同任务允许提供重叠时间的覆盖；不要求生成时长总和等于成片长度。

续接任务声明 `boundary: continue` 与 `continuationFromSegmentId`（值为制作任务 ID），沿用原生状态与配方身份。隐藏重叠由执行器处理，不自行修改权重、状态和路径。前序重做只标记下游待检查，不自动重做。

首尾帧过渡声明 `generationIntent: transition`、`transitionFromSegmentId`、`transitionToSegmentId`；使用两端任务的实际尾帧与首帧。J-cut/L-cut 是独立声音编排，不因此生成画面过渡。

预检通过后调用 `director_generate_task`，默认先生成预览；要求交付或最终质量时选择 final。生成沿用执行器预检给出的配方，recipe=base 表示用户显式选择基础版重做。按生成 ID 查询状态，未知或运行中结果不得重复提交。

成功且校验媒体后替换任务当前结果；失败、取消和生成中保留旧媒体。替换后旧裁切超出新结果会明确报错，需要重新选片。没有候选版本管理；需要保留旧方案时先按用户意图另建任务。

生成完成不自动进入时间线。实际观看或取样检查身份、表演、实际切点、音频和可用区间，再组合连续性检查与时间线 Skill。计划镜头切点不能视为准确素材分界。
