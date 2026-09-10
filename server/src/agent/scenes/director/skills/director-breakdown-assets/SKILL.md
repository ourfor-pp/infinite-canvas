---
name: director-breakdown-assets
description: 从当前剧本整理并提交角色、场景、道具候选资产。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_validate]
---

# 导演台资产拆解

只从当前已保存剧本及其制作拆解提取会实际出镜或发声的角色、场景和道具。拆解缺失、内容哈希过期或工程校验存在相关 error 时先停止并说明应修订剧本，不要从旧拆解继续创建资产。先读取现有资产，按稳定身份合并同一实体。

角色候选必须区分剧情信息与视觉信息：

- 角色主档“剧情身份”保存身份、关系、首次出现、剧情用途和人物弧光，不作为生图提示词。
- 角色主档“视觉设定”只保存剧本已经明确的稳定可见特征；没有依据时留空，交给角色设计阶段补充。
- 拆解阶段不要把“清秀、俊朗、美女、剑眉星目”等类型化套话当成面部身份；详细面部结构与阵容差异由 `director-design-character` 完成。
- Frontmatter 只保存稳定 ID、显示名称、依赖和 `requiredVariants`；正文摘要保持简短，不把人物小传伪装成视觉描述。
- 角色名称只作为业务标识，不写进生图提示词。

在 `assets/characters/`、`assets/locations/`、`assets/props/` 下按稳定 ID 建立实体文件夹和主档 Markdown，同时建立空白的基础设计 `prompt.md`、空的 `inputs/` 以及 `voice/sound.md` 或 `sound/sound.md`。`prompt.md` 正文是未来原样送模的最终提示词，拆解阶段不得把人物小传、主档摘要或旧 `mediaDrafts` 填进去；必须等对应设计 Skill 完成档案、风格、版式和参考选择后再写。只记录 `requiredVariants` 需求，不创建空白变体目录，也不自动生成媒体。不要用名称相近但身份不同的实体相互覆盖，也不要创建纯气氛词或抽象概念资产。完成后运行工程校验。
