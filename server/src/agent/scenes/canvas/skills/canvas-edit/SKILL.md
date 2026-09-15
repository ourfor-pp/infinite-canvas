---
name: canvas-edit
description: 在当前画布读取、创作和编辑通用文本、图片、音频、视频节点，连接内容或采用生成结果；用于画布内容创作与编排。
allowed-tools: [mcp__infinite_canvas__canvas_get_state, mcp__infinite_canvas__canvas_apply_ops, mcp__infinite_canvas__canvas_adopt_result, mcp__infinite_canvas__canvas_view, mcp__infinite_canvas__assets_list]
---

# 画布编辑

## 读取与修改

- 服务端画布是权威数据源，工作区文件不能替代节点。先用 `canvas_get_state` 读取节点摘要与 revision；有 nextOffset 时继续翻页，并携带 expectedRevision，冲突时重新读取。
- `view: connections` 读取连线；`view: content` 配合仅含一个 ID 的 nodeIds 分段读取正文，用 contentOffset/nextContentOffset 接续。续写或编辑前先读完整相关正文。
- `canvas_apply_ops` 批量创建、修改和连接节点，修改必须携带最新 expectedRevision。文本正文在 metadata.content；连接使用 input/output 端口。尽量一次提交相关修改；返回新 revision，不返回全画布。
- 删除节点与连线统一用 `canvas_delete`，保留工具内业务确认。`canvas_view` 的 action=select/focus 用于选择或聚焦。
- `assets_list` 支持 kind、keyword、offset、limit；kind=text 同时搜索标题和已保存正文，无独立提示词库。

## 完整文档与故事

理解主题、体量、人物、冲突和结局后直接写可修改草稿，信息不足时合理决定，不用连续追问阻断创作。
一篇作品的标题、章节、场次与尾声必须写入同一个 Markdown 文本节点。续写优先更新原节点；仅多篇独立作品可分别建节点。正文使用清晰的 Markdown 层级，回复简述保存位置，不重复粘贴全文。

```json
{"expectedRevision":12,"ops":[{"type":"add_node","id":"story-draft","nodeType":"text","title":"故事标题","position":{"x":420,"y":0},"width":520,"height":680,"metadata":{"content":"# 故事标题\n\n## 第一章\n\n正文……","fontSize":15,"status":"success"}}]}
```

## 生成与采用

1. 使用 media-generation Skill 的领域规则。`media_list_capabilities` 同时返回 channels 和 executor；先选择可用能力。
2. 画布的 `media_validate_generation` / `media_generate` 接收 `{request: {source, ...}}`。管理员模型用 source=channel，字段为 kind、model、prompt、references；中立媒体用 source=executor，字段为 kind、model、mode、operation、prompt、params、references、continuation。不能用 channel 绕过执行器参数校验。
3. 记录任务 ID，以 `media_get_generation_status` 查询；不要重复提交。成功后用 `canvas_adopt_result` 传 generationId、fileId 和最新 expectedRevision，创建节点或用 nodeId 替换同类型节点；文本结果不传 fileId。生成成功不会自动改变节点。
4. 使用 `media_import_reference` 登记工程内媒体，再作为显式 fileId 引用。原生生图或其他本地图片可登记后用 `canvas_apply_ops` 创建 image 节点，metadata.content 使用返回的 url、storageKey 使用 server:<fileId>。
5. Codex 使用原生文件工具和原生提问；内置 Agent 保留 workspace_write_text 与 ask_user。媒体质量须实际看图、观看或试听后判断。

## 视频制作与参考复刻

- 用户要求参考或复刻时，先实际检查原片的镜头、表演、声音和字幕；ASR 仅为初稿，核对对白原文、说话人、停顿与切点，不把识别或对齐结果当成准确表演时间。
- 在一个通用文本节点中维护制作计划：原片时间范围、真实切点、出场角色、动作起止状态、对白与停顿、参考 fileId 及用途、任务 ID、采用节点和检查结论。沿用已有计划节点，不为每镜创建故事文档，也不新增总控 Skill。
- 先按真实摄影切换和完整动作确定镜头，再适配模型窗口。同机位长动作可分任务原生续接；密集切镜可分别生成后剪辑，不为凑时长合并或压缩表演。以预检返回的实际时长安排裁切与声音，不能把请求秒数当作准确输出秒数。
- 从原片或素材库优先选取本镜所需参考：身份易混时用清晰角色图，构图要求严格时用关键帧，动作与节奏用相应视频片段，声音按目标采用原声或参考音轨。参考不是越多越好；不得把未出场角色或整片素材一律塞进每次请求。H3 的具体格式、映射与模式选择读取 media-generation 的 H3 文档。
- 对尚未验证的制作方法，先选能暴露主要风险的小样（例如多角色互动或关键切镜），实际检查后再扩展批量。已有通过且条件相同的小样可复用；用户明确只要粗预览时按其范围交付。自动检查和授权范围内修订不需要逐段询问用户；出现同类失败时先修改提示、参考或拆分方案，不原样反复提交，不无限重试或自行扩大生成预算。
- 检查身份与人数、动作顺序和结果、构图与切点、对白/口型和停顿、跨段连续性。抽帧只能证明取样画面，不能替代运动和听音检查；缺失关键镜头或角色错误不得标记通过。用户要看失败样本时可入画布，但计划与标题需注明待修订。
- 原声后期合成与模型声音参考分别记录。替换音轨前核对实际时长和口型，不承诺贴回原声即可同步；整片交付还须检查镜头接缝、音轨、字幕和完整播放。放大到 1080p 只代表输出尺寸。

## 任务恢复与结果入画布

提交后立即记录任务 ID 与镜头对应关系。服务端持久队列负责已提交任务的执行与状态；不要启动临时后台脚本代替项目任务管理，或宣称退出对话后 Agent 会自动审片、提交后续任务和入画布。

续聊或中断恢复时，先读取制作计划；任务 ID 不全时，用 `media_get_generation_status` 不传 generationId，按 offset/limit 与 nextOffset 找回当前项目任务摘要，再按 ID 读取结果。结合 `canvas_get_state` 中 agentGenerationId 和 storageKey 核对已采用媒体，避免重复提交或重复建节点。服务端状态是权威，计划中的状态只是检查记录。

已完成媒体检查后，用 `canvas_adopt_result` 显式采用，随后把返回 nodeId 更新到计划。请求结果不明确或 revision 冲突时重新读取画布再决定是否重试。需要结束当前回合时，准确报告已检查、待检查、已采用和仍排队的部分，不把排队任务当成已交付。
