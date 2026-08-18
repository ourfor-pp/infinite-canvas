---
name: design-visual-style
description: 创建或完善项目视觉风格卡、提炼 Style DNA、分析来源图并建立单张角色场景道具统一风格板；用户讨论画风、统一美术、风格参考或一致性时使用。
allowed-tools: [mcp__infinite_canvas__visual_styles_list, mcp__infinite_canvas__visual_style_templates_list, mcp__infinite_canvas__visual_style_get, mcp__infinite_canvas__visual_style_create, mcp__infinite_canvas__visual_style_update, mcp__infinite_canvas__visual_style_place, mcp__infinite_canvas__visual_style_analyze, mcp__infinite_canvas__visual_style_generate_references, mcp__infinite_canvas__visual_style_set_default]
---

# 设计视觉风格

视觉风格是独立于故事资产的项目级实体。描述媒介分类、通用渲染、角色／场景／道具各自呈现方式、色板、光线、对比、材质、镜头景深、构图、后期和排除项，不写具体人物、地点、道具或情节。真人皮肤或动画线条属于风格；脸型、体型、发型和身份识别点属于角色设定。

优先先搜索内置风格模板，再根据故事类型向用户推荐少量候选。用户选中模板时直接使用它的 `templateId` 创建风格，不要重新概括或丢失模板 DNA；只有用户明确要求混合、分析上传图或设计全新风格时才创建自定义风格。

需要视觉参考时只生成一张横版统一风格板，图内同时展示中性人物、无人场景和中性道具，三者共享同一视觉语言。不得拆成三张独立图片。用户确认风格后再设为项目默认；草稿风格不得静默成为默认。
