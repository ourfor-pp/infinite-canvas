---
name: director-generate-video-segments
description: 依据已规划的故事板与后端能力生成视频段，处理预览、最终质量和连续续接；整片剪辑与导出由时间线能力处理。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_validate_video_segments, mcp__infinite_canvas__director_generate_video_segment, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台视频段生成

生成 H3 视频时阅读 [H3 提示规则](references/official-h3-prompt.md) 与 [H3 交接与提示结构](references/shot-handoff.md)。读取视频段、整张故事板、资产、视觉风格、`direction/directing-rules.md` 和服务端声明的能力。导演规则约束摄影、表演、节奏与声画处理，视觉风格只约束画面呈现；不得互相代替。默认先生成快速预览；用户要求交付、定稿或最终质量时使用视频段最终质量；它仍是单个视频段，整片导出属于时间线阶段。普通视频段统一使用整张故事板参考生成，不要求用户选择底层模式。最终提示写入 `videos/seg-<segment.md中的id>/video-prompt.md`，文件只保存要原样发送的官方格式正文；服务器不会再从画格重新编译或补写。提交前核对预检返回的 `finalPrompt.path/hash`，生成后核对实际请求与文件内容一致。

生成前必须调用 `director_validate_video_segments`。有阻断项时先按 `director-plan-storyboards` 修订视频段或画格，再重新校验；不得用一次失败的媒体生成充当校验。校验必须通过来源节拍、开始/结束状态、时长、Shot 边界、同镜头摄影连续性、对白窗口和英文声景，不能只检查字段是否非空。

每个真实 Shot 必须有英文构图、主体位置、环境、动作、状态变化和自然运镜描述。同一 Shot 的多个画格编译为连续动作，不得产生隐含切镜；只有 Shot 编号变化时才能写 `hard cut`。不得拿视频段标题或剧情摘要代替画面动作；不得把标题、人物名、Shot 标签、时间点或提示词说明写成可朗读内容。中文只保留在结构化对白、歌词和明确可见的画面文字中，对白原文不得改写。

每条对白必须绑定已采用的角色素材，并具有稳定说话人、准确起止时间、英文语气和唯一的 `<d>` 原文来源。把每格其他声音意图整理成具体英文声景，明确环境声、可见动作同步声和非语言人声；不要用“自然环境音”替代具体声音，也不要把对白重复写进声景。生成配方遵循当前预检的 `acceleration` 与 `recipes`，不根据“含对白”自行认定必须基础版。原生生成对白与独立音频参考是不同输入条件，不能互相推广速度或音色结论。

完整故事板始终作为一个媒体文件提交，不自行裁格或拆成逐格生成。后端可按实际能力附加首格引导，以预检的 `usesStoryboardStartGuide` 为准。有 `guideFraming` 时按[视频段交接](references/shot-handoff.md)检查实际裁切后的构图，再决定是否生成。`continue` 的方式由 `capabilities.nativeState` 和 `route` 决定：支持原生状态时复用前段状态，隐藏重叠不计入新段正文；否则使用参考音视频续接，不承诺确定性无缝延展。按 `durationLimits`、`nativeWindow` 和引用预算安排本段，不把普通 15 秒上限机械用于所有续接。不得自行设置执行器或状态文件。

独立 `generationIntent: transition` 仅使用前段实际尾帧和后段实际首帧，不生成或读取故事板。生成后使用媒体取样能力检查画面、实际接点和原声；前序变化只标记相关依赖待检查，不自动重生成。

面向用户解释“快速预览 / 最终质量、加速生成 / 基础版重做、完整故事板、素材参考、连续段”，不得展示底层权重、插件节点、采样器、调度器或注意力实现。

使用音频参考时，直接在 `segment.md` Frontmatter 写入 `audioReferences`（最多 3 项）：工程相对 `path`、`purpose`（voice / dialogue / sound / music）、英文 `description`，音色与对白参考还必须填写本段说话角色的 `speakerAssetId`。先读取官方规则中的音频参考说明；参考的声音特征与最终对白原文分别维护，不把参考音频里的词自动加入剧本。

调用校验和生成工具时优先传 `segmentPaths` / `segmentPath`，服务端读取当前文件和 revision，不猜测数据库版本。字段见 [视频段文件格式](../director-plan-storyboards/references/file-format.md)。

按返回的任务 ID 查询 `director_get_generation_status({ id })`，不要重复提交；列表查询使用 `limit/offset` 并沿 `nextOffset` 继续。用户授权的后续制作可以继续组合其他 Skill，不因本 Skill 结束而中断完整任务。
