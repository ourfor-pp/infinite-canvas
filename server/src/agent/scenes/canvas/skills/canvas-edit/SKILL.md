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
