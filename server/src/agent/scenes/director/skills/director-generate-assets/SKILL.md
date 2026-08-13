---
name: director-generate-assets
description: 在导演阶段门满足后生成角色、场景和道具的图像或声音结果。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_generate_asset, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台资产生成

先确认剧本与当前风格满足阶段要求，再读取资产设定和可用模型。按资产类型生成所需图像或声音；复用当前设定、风格和引用，不在生成时暗改资产身份。

生成后检查任务状态并简要报告失败项。用户要求重抽时直接替换当前主结果；要保留旧方案应先复制资产。
