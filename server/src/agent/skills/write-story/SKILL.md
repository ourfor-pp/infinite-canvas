---
name: write-story
description: 创作、改写、扩写或续写小说、短篇故事、剧本故事正文和章节内容，并把完整作品保存为单张 Markdown 故事卡；用户要求写故事、写小说、续写正文、润色故事或将故事放到画布时使用。
allowed-tools: [mcp__infinite_canvas__canvas_get_state, mcp__infinite_canvas__canvas_create_text_nodes, mcp__infinite_canvas__canvas_apply_ops]
---

# 故事创作

先理解主题、受众、体量和已有角色设定；信息不足时可作出克制的创作选择，不要用一连串追问阻断创作。

## 创作流程

1. 读取当前画布、用户引用和创作资产；只复用已有角色或设定，不覆盖资产实体。
2. 在内部确定主题、冲突、转折和结局，再写完整正文。长内容使用 Markdown `##` 章节标题组织，但章节仍属于同一篇文档。
3. 使用适合阅读的 Markdown：作品名用一级标题，章节用二级标题，对话和叙述用普通段落；仅在确有意义时使用引用、分隔线或强调。
4. 调用通用的 `canvas_create_text_nodes`，只提交一个 item，将全文一次性保存为一个文本节点；建议尺寸为 520 × 680、字号为 15。
5. 简要说明故事已经写入画布以及可以继续做什么，不要在回复中再次粘贴全文。

## 卡片规则

- 一篇独立故事只能对应一张故事卡片。
- 禁止按标题、章节、场次、段落或尾声拆成多个文字节点。
- 禁止把标题、章节、场次、段落或尾声拆成 `canvas_create_text_nodes` 的多个 item。
- 用户明确要求多篇独立故事时，每篇对应一个 item。
- 续写或修改现有故事时，优先读取并更新原故事卡，不得新增一组章节卡片。

```text
canvas_create_text_nodes({
  "expectedRevision": 12,
  "items": [{
    "title": "小雨的伞",
    "text": "# 小雨的伞\n\n## 一\n\n……\n\n## 尾声\n\n……",
    "width": 520,
    "height": 680,
    "fontSize": 15
  }]
})
```
