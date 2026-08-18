---
name: director-breakdown-assets
description: 从当前剧本整理并提交角色、场景、道具候选资产。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_document, mcp__infinite_canvas__director_list_assets, mcp__infinite_canvas__director_create_assets]
---

# 导演台资产拆解

只从当前已保存剧本提取会实际出镜或发声的角色、场景和道具。先读取现有资产，按稳定身份合并同一实体。

角色候选必须区分剧情信息与视觉信息：

- `payload.narrativeDescription` 保存身份、关系、首次出现、剧情用途和人物弧光，不作为生图提示词。
- `payload.visualDescription` 只保存剧本已经明确的稳定可见特征；没有依据时留空，交给角色设计阶段补充。
- 拆解阶段不要把“清秀、俊朗、美女、剑眉星目”等类型化套话当成面部身份；详细面部结构与阵容差异由 `director-design-character` 完成。
- `payload.description` 只写一行便于卡片浏览的摘要，不把人物小传伪装成视觉描述。
- 角色名称只作为业务标识，不写进 `payload.mediaDrafts.image.prompt`。

通过 `director_create_assets` 批量提交候选；不要用名称相近但身份不同的实体相互覆盖，也不要创建纯气氛词或抽象概念资产。
