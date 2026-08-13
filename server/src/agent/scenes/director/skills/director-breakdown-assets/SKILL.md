---
name: director-breakdown-assets
description: 从已确认剧本整理并提交角色、场景、道具候选资产。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_list_assets, mcp__infinite_canvas__director_create_assets]
---

# 导演台资产拆解

只从已确认剧本提取会实际出镜或发声的角色、场景和道具。先读取现有资产，按稳定身份合并同一实体，保留首次出现、剧情用途和一致性要求。

通过 `director_create_assets` 批量提交候选；不要用名称相近但身份不同的实体相互覆盖，也不要创建纯气氛词或抽象概念资产。
