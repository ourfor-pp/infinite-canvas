---
name: director-generate-assets
description: 在导演阶段门满足后生成角色、场景和道具的图像或声音结果。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_generate_asset, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台资产生成

先读 [GPT‑Image‑2 生成规范](references/gpt-image-2.md) 与 [资产验收清单](references/asset-qc.md)。确认剧本与当前风格满足阶段要求，再读取资产设定和可用模型。按资产类型生成所需图像或声音；复用当前设定、风格和引用，不在生成时暗改资产身份。

角色图片由当前配置的图片模型生成一张横版四视图设定图，单张图片内并排包含同一角色的正面、左侧、右侧和背面，不得拆成四张图片。角色必须先有纯视觉的 `visualDescription` 和稳定身份锚点；提示词只描述同一个角色的可见特征及四视图布局，不得加入姓名、人物小传、剧情事件或完整电影镜头语言。

生成后检查自动验收状态并简要报告失败项，不因检查失败自动重抽。用户要求重抽时直接替换当前主结果；要保留旧方案应先复制资产。
