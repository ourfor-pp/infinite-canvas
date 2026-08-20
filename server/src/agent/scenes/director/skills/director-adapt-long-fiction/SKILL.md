---
name: director-adapt-long-fiction
description: 将长篇小说按分块检索与分层理解改编为可直接阅读的章节式故事正文；用于压缩、合并或重组原作叙事，不用于只输出故事总纲。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_validate]
---

# 导演台长篇改编

先读 [长篇改编方法](references/adaptation-craft.md)。读取 `project.yaml` 与 `sources/*/source.md`，再用 Glob/Grep 按卷、章节、人物或关键词分批检索 `sources/*/chapters/*.md`；不要要求一次读取整部小说。

在内部建立来源证据、人物动机、主要冲突、因果链和结局的改编地图，根据目标时长收束主线并决定支线的合并或删除。改编地图只用于推理，不写入最终文档。

最终以自然章节写成可连续阅读的文学故事正文，让保留的关键事件通过场景、行动、对白和叙述实际发生。不得以故事总纲、章节摘要、人物表、改编说明或项目分析代替正文，也不得混入场次、镜头和生成参数。

把改编正文写入 `story/index.md` 和必要的 `story/chapters/chapter-NNN.md`；更新前重新读取目标文件并保留稳定 ID。保留原作核心关系、因果与用户指定结局；必须改动关键结局时先明确说明原因并征得用户同意。
