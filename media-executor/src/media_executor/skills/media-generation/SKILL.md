---
name: media-generation
description: 使用中立媒体服务查询能力、生成或续接音视频、管理生成任务并保存结果；用于视频、语音、环境声、音效和音乐制作。
allowed-tools: [mcp__infinite_canvas__media_list_capabilities, mcp__infinite_canvas__media_validate_generation, mcp__infinite_canvas__media_generate, mcp__infinite_canvas__media_get_generation_status, mcp__infinite_canvas__media_cancel_generation, mcp__infinite_canvas__media_import_reference, mcp__infinite_canvas__media_save_result]
---

# 中立媒体服务

本 Skill 是媒体服务的统一使用入口。服务维护模型、工作流、配方和执行限制；Agent 根据任务选择能力，所在项目自行组织文件、制作任务与结果采用。

## 能力发现

先调用 `media_list_capabilities`。返回目录是当前能力的权威来源，检查 available、version、modes、operations、inputs 和输入限制；只选择实际启用的能力。当前协议版本为 1，版本不匹配时说明需要更新能力包，不猜测兼容参数。

| 能力 | 服务实现 | 需要读取的说明 |
| --- | --- | --- |
| 参考视频生成、首尾帧、时间锚点、原生续接 | H3 | [视频输入与提示](references/h3.md)，其中链接官方提示规则 |
| 文本生成音乐 | Music3 | [音乐输入与提示](references/music3.md) |
| 语音合成与参考音色克隆 | Qwen TTS | 按目录选择 speech 的 generate 或 clone；克隆显式提供参考音频和 transcript |
| 环境声与音效 | MOSS SoundEffect | 按目录选择 ambient 或 sfx 的 generate |
| 音乐生成、翻唱与重混 | ACE-Step，启用时提供 | 按目录选择 music 的 generate、cover 或 remix |
| 声音生成、变换、续接与局部补全 | Stable Audio，启用时提供 | 按目录选择 ambient 或 sfx 及对应 operation |

表格说明服务已有能力范围，不保证全部在线。新增或调整的能力以查询结果为准，不为每个模型创建独立 Skill。H3、Music3 的应用模型标识见对应参考文档，其余声音模型使用 `local-media::<目录中的 id>`。

## 统一调用流程

1. 准备 kind、model、mode、operation、prompt、params 和显式 references。项目中的参考媒体先用 `media_import_reference` 登记为 fileId；不传执行器路径、凭据或项目私有执行字段。提示正文原样提交，不隐藏追加创作语义。
2. 调用 `media_validate_generation` 检查输入和执行计划。时长、尺寸、配方及续接限制以服务返回为准；需要固定结果时采用返回的 seed 和 recipe。不要自行拼接模型图或计算隐藏重叠。
3. 用 `media_generate` 提交并记录任务 ID。用 `media_get_generation_status` 查询同一任务，运行中或提交结果未知时不重复生成；取消使用 `media_cancel_generation`。
4. 成功后按返回结果选择文件。`files` 是本次输出，`cumulativeVideos` 是累计视频，`continuationStates` 是原生续接状态，`execution` 是执行快照。续接时使用来源 generationId 与状态 fileId，不用普通视频冒充状态。
5. 使用 `media_save_result` 保存到项目指定的新相对路径，保留真实扩展名。项目自己的领域工作流决定采用位置和时间线，生成成功不自动入轨。

工具完成代表执行成功。需要交付质量判断时，实际观看或试听相关输出，并明确还没有检查的部分。
