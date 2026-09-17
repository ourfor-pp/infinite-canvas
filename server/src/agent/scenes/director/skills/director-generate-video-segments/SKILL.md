---
name: director-generate-video-segments
description: 将镜头需求转换为独立制作任务，按实际能力选择单镜、多镜、原生续接或首尾帧过渡，预检后生成并检查当前结果。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_segments, mcp__infinite_canvas__director_read_tasks, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_preflight_tasks, mcp__infinite_canvas__director_generate_task, mcp__infinite_canvas__director_get_generation_status]
---

# 视频制作任务

素材需求以本次完整分镜段的稳定身份和连续性为准，不遍历 `scene.json.objects` 逐个生图。地面、树干分块、内壁、定位面等预演部件无 `assetId` 不代表缺图；普通部件复用整体场景设计。同一素材的多个实例复用同一身份，按素材与变体去重。实际参与表演但未绑定的角色先复用或建立身份；已明确引用且没有图片才补图，身份存在但未绑定时不得重复创建。只为有独立连续性要求的变化建立变体。

先使用 `media-generation` Skill 了解当前媒体能力和官方提示规则，再读 [任务交接](references/shot-handoff.md)。按需读取镜头设计、素材、导演规则和当前能力，把拍摄需求转换为 `productions/<任务ID>/task.md`。每段只用一份制作记录，以 `segmentId` 关联整个分镜段，不写 durationSeconds、videoModel 或 segmentRanges；时长和模型来自分镜。预览、正片和重做均生成完整段，不追加第二份任务。模型时长不满足时回到分镜重新编排。默认用 `director-stage-previs` 导出该段 0–estimatedSeconds，并将返回的路径、sourceHash 和完整范围写入 `videoReferences`，includeAudio 默认为 false。只有 segment.md 明确设置 previsMode: skip 才允许缺少预演参考。

输出方向与宽高比沿用 `direction/directing-rules.md` 摄影章节的成片画幅，不从角色身份板或模型默认尺寸推断。预检时核对计划的实际输出尺寸是否匹配；能力不支持时说明限制，不静默换横竖版。生成后验证实际视频宽高与构图，未经用户修改方案不得按场景改变画幅。

选择单镜生成、多镜生成、同镜头原生续接或已有首尾帧过渡。单次窗口以预检返回的 plan 为准。进入视频制作前，按本段核对实际出场角色、需要保持一致的场景和关键道具。用户说“生成几段视频／样片”已经授权这些目标必要的素材准备：组合 `director-breakdown-assets`、对应设计 Skill 和 `director-generate-assets`，先复用可用主图，再生成当前目标缺少的图片，实际查看后继续视频制作；不再等待用户单独要求“生成素材”。粗模预演只给位置、动作和摄影，不能作为角色身份图；统一风格板也不能代替具体角色身份。图片生成失败时报告明确缺口，不能自行降级为文字造型样片。

没有需要固定身份的主体、已有视频足以保留身份，或用户明确只验粗模调度／不用图片时，图片可留空；普通背景细节不必单独生图，不批量生成无关段素材。角色图和选中的定妆帧必须在 `referenceImages` 显式列出，与相应预演对象逐一对应。不得静默丢弃人物参考或把一个人物图号当作声音图号。声音参考仍写 `audioReferences`（工程相对 path、purpose、英文 description；音色/对白参考还需 speakerAssetId）。程序不自动选角色图或风格板，不隐藏添加创作语义。

最终提示写入同目录 `video-prompt.md`，正文就是原样发送给模型的文本。核对预检返回的路径、hash、引用顺序和数量；预演时间和动作是提示依据，不把标题和剧情摘要当作可观察的表演。官方格式要求英文描述时，中文只保留在对白原文、歌词或画面文字中。

生成前调用 `director_preflight_tasks`。模型窗口在分镜阶段落实；超出能力时回到分镜重新编排，不拆成多个制作任务，不静默拉伸预演或裁掉剧情。一次生成覆盖本段 0–estimatedSeconds，并核对 plan 中实际帧数与输出时长。独立剪辑允许重复来源与裁切，不要求生成时长总和等于成片长度。

续接任务声明 `boundary: continue` 与 `continuationFromSegmentId`（值为制作任务 ID），沿用原生状态与配方身份。隐藏重叠由执行器处理，不自行修改权重、状态和路径。前序重做只标记下游待检查，不自动重做。

首尾帧过渡声明 `generationIntent: transition`、`transitionFromSegmentId`、`transitionToSegmentId`；使用两端任务的实际尾帧与首帧。J-cut/L-cut 是独立声音编排，不因此生成画面过渡。

预检通过后调用 `director_generate_task`，默认先生成预览；要求交付或最终质量时选择 final。生成沿用执行器预检给出的配方，recipe=base 表示用户显式选择基础版重做。按生成 ID 查询状态，未知或运行中结果不得重复提交。

成功且校验媒体后替换任务当前结果；失败、取消和生成中保留旧媒体。替换后旧裁切超出新结果会明确报错，需要重新选片。重做沿用本段同一制作记录，历史生成与提交快照保留，不能为同段另建任务。

生成完成不自动进入时间线。实际观看或取样检查身份、表演、实际切点、音频和可用区间，再组合连续性检查与时间线 Skill。计划镜头切点不能视为准确素材分界。
