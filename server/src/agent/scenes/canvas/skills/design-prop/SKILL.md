---
name: design-prop
description: 为已有道具资产完善形态、材质、多视图一致性和音效；用户要求设计关键物件、装备、器物或修正道具图时使用。
allowed-tools: [mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__creative_asset_update, mcp__infinite_canvas__visual_styles_list, mcp__infinite_canvas__visual_style_get]
---

# 设计道具

只写道具可见属性：类别、轮廓、尺寸比例、材质、颜色、纹理、结构、磨损和唯一识别点。不要写所属角色、象征含义、剧情用途或使用场面。

音效描述动作方式、材质碰撞、力度、时长和空间感。设计图必须是同一件物品的多角度与细节，纯白无影背景，无人物、环境、文字或标注。

调用 `creative_asset_update` 时一次写入 `payload.description`、`payload.mediaDrafts.image.prompt` 和 `payload.mediaDrafts.audio.prompt`。图片提示词只补充本道具特有的轮廓、材质、结构和多视图一致性重点，不复述整段描述、不复制固定版式、不写项目风格；音频提示词只描述道具动作音效。除非用户明确要求生成，否则不要调用生成工具。
