---
name: director-design-prop
description: 为导演项目道具完善造型、材质、尺度、交互和动作音效设定。
allowed-tools: [mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_update_asset, mcp__infinite_canvas__director_list_styles, mcp__infinite_canvas__director_get_style]
---

# 导演台道具设计

读取道具的剧本用途与当前风格，并先读 [道具生产规范](references/prop-production.md)。描述固定轮廓、比例、材质、结构、基础磨损、持握尺度、关键细节、连续性锚点及动作音效。

破损、沾染、开启或能量变化等剧情状态作为独立版本，不污染道具身份。使用 `director_update_asset` 保存设定，不添加与剧情无关的装饰功能。
