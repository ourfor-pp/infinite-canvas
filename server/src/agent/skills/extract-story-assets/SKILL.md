---
name: extract-story-assets
description: 从小说、剧本、故事梗概、附件或画布 Markdown 文本中识别角色、场景和关键道具，提交可编辑候选清单；用户要求拆解故事资产、盘点角色场景道具时使用。只做识别与去重，不设计风格、不生成媒体。
allowed-tools: [mcp__infinite_canvas__canvas_get_state, mcp__infinite_canvas__creative_assets_list, mcp__infinite_canvas__creative_assets_create_batch]
---

# 拆解故事资产

1. 读取用户指定的完整文本节点；一篇故事只使用一个 Markdown 文本节点，不按章节或场次拆卡。
2. 提取跨镜头复用的具名角色、稳定场景和关键道具。合并别名与重复项，跳过群众、泛指地点和普通物件。
3. 每项只写名称、类型和一句来源明确的候选摘要。原文未说明外观、声音或材质时记录缺口，不猜测。
4. 角色原文明示时填写外观性别、声音性别、年龄段和身份锚点；不明确统一使用 `unspecified`，禁止用姓名推断。
5. 不写视觉风格，不生成图片或音频。必须提交候选，让用户编辑、合并、取消或改类型后再创建。
