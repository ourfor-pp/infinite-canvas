---
name: design-character
description: 为已有角色资产完善可跨镜头复用的外观、身份锚点、声音画像和试听台词；用户要求设计角色、修正性别或年龄不一致、补角色描述或声音设定时使用。
allowed-tools: [mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__creative_asset_update, mcp__infinite_canvas__visual_styles_list, mcp__infinite_canvas__visual_style_get]
---

# 设计角色

先读取角色与项目风格。只描述可见、可听、可复现的稳定特征，不复述性格、关系、身世、行动或剧情。

- 描述年龄感、体态、脸型五官、肤色、发型、服装、鞋履、配饰和标志性色彩。
- `designProfile` 保存外观性别、声音性别、年龄段、身份一致性锚点和待确认缺口。
- 音色必须与声音性别、年龄和体态一致；试听台词不承担剧情推进。
- 不加入背景、情节、文字、标注、Logo 或 UI。

调用 `creative_asset_update` 时一次写入：

- `payload.description`：完整但精炼的角色可视设定。
- `payload.designProfile`：身份一致性画像。
- `payload.mediaDrafts.image.prompt`：可在调图面板直接看到和修改的生图补充提示词。它只写本角色特有的绘制重点与跨视图一致性要求，不复述整段描述、不复制固定四视图版式、不写项目风格。
- `payload.mediaDrafts.audio.prompt` 与 `transcript`：音色描述和一句中性试听台词。

完成设定不等于生成媒体；除非用户明确要求生成，否则不要调用生成工具。

原文冲突时列出冲突并询问，不自行选择性别、年龄或关键服饰。
