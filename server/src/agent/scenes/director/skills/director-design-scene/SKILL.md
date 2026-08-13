---
name: director-design-scene
description: 为导演项目场景完善空间结构、光线、材质和环境声设定。
allowed-tools: [mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_update_asset, mcp__infinite_canvas__director_list_styles, mcp__infinite_canvas__director_get_style]
---

# 导演台场景设计

读取场景的剧本依据和当前风格，明确空间布局、年代地域、材质、光线、天气、可进入区域、稳定视觉锚点与环境声。区分同一地点的不同时间或状态，但避免无意义重复。

使用 `director_update_asset` 保存能被后续镜头稳定复用的设定。
