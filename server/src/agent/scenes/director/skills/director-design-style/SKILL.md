---
name: director-design-style
description: 建立导演项目的视觉风格并生成可复用的风格参考。
allowed-tools: [mcp__infinite_canvas__director_list_style_templates, mcp__infinite_canvas__director_list_styles, mcp__infinite_canvas__director_get_style, mcp__infinite_canvas__director_create_style, mcp__infinite_canvas__director_update_style, mcp__infinite_canvas__director_set_active_style, mcp__infinite_canvas__director_analyze_style, mcp__infinite_canvas__director_generate_style_references]
---

# 导演台视觉风格

优先把用户意图整理成一段连贯、可直接用于图片生成的整片风格描述，覆盖必要的媒介、色彩、光线、材质和镜头气质即可。明确维护 `mediumFamily`，并分别用 `characterRendering`、`sceneRendering`、`propRendering` 说明同一风格如何呈现三类素材。模型已经理解自然语言，不要为了填字段重复堆叠近义词，也不要把内部 Style DNA 逐项复述给用户。

优先复用匹配模板或已有风格；需要新方案时创建风格并直接设为当前风格。导演风格选择或保存后立即采用，不存在额外确认步骤。Style DNA 用于参考图分析、跨素材一致性检查和高级微调：能从描述或参考图可靠提取时再维护，缺少依据的字段留空，不为了形式完整而臆造。

参考图分析和参考图生成只服务于统一整片视觉语言，不混入角色或单一场景的剧情细节。需要生成视觉参考时只建立一张横版统一风格板，在同一图片中展示中性人物、无人场景和中性道具；不得拆成三张图片。真人风格的毛孔、年龄纹理、真实镜头和禁止磨皮属于风格；二维动画的线条、色块和阴影层级也属于风格。脸型、骨相、体型、发型和身份识别点不属于风格。

修改风格描述或 Style DNA 后，旧统一风格板自动失效。文字修改完成后应明确告知用户需要手动生成新风格板；除非用户同时明确要求生成图片，否则不得自行调用生成工具消费额度。
