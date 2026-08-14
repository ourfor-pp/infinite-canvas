---
name: director-design-scene
description: 为导演项目场景完善空间结构、光线、材质和环境声设定。
allowed-tools: [mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_update_asset, mcp__infinite_canvas__director_list_styles, mcp__infinite_canvas__director_get_style]
---

# 导演台场景设计

读取场景的剧本依据和当前风格，并先读 [场景生产规范](references/scene-production.md)。明确固定空间结构、年代地域、材质、基础光线、可拍摄区域、稳定视觉锚点与环境声。

人物动作、单场剧情、天气变化、破坏状态和临时陈设不得污染场景母版；它们应留给故事板或独立状态版本。使用 `director_update_asset` 保存能被后续镜头稳定复用的设定。
