---
name: director-write-story
description: 将原创构思、对话简报或现有故事草稿写成可直接阅读的章节式文学故事正文；用于新写、扩写或修订导演项目的 story 文档，不用于大纲、分场剧本或镜头设计。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_validate]
---

# 导演台故事创作

先读 [章节式故事写作](references/literary-story-craft.md)，再读 `project.yaml`、`story/index.md` 与按需存在的 `story/chapters/*.md`。在内部确定人物欲望、阻力、因果推进、关键转折和结局代价，但不要把这份规划写入故事文档。

直接交付可连续阅读的文学正文：以自然章节组织场景、行动、对白、感受和必要的内心活动，让关键变化在叙事中发生。短故事可以只有一章；较长故事按真正的情境或目标变化分章，不按镜头、场次或固定字数机械切分。

最终 `story` 不得是人物表、大纲、节拍表、制作说明或项目分析，也不要混入场次 ID、镜头术语、素材 ID、时长和模型参数。除非用户明确只要策划，否则不得用“先给方案”代替正文。

短篇可原子写回 `story/index.md`；长篇以 `story/index.md` 保存总览和阅读顺序，各章写入稳定命名的 `story/chapters/chapter-NNN.md`。修改前重新读取目标文件，保留 Frontmatter 的稳定 ID。保留用户已经确定的题材、人物关系、核心事件与结局，修订时只改变用户要求的范围。
