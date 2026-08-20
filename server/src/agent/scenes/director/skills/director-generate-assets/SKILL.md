---
name: director-generate-assets
description: 在导演阶段门满足后生成角色、场景和道具的图像或声音结果。
allowed-tools: [Read, Glob, Grep, LS, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_generate_asset, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台资产生成

先读 [图片生成规范](references/gpt-image-2.md) 与 [资产验收清单](references/asset-qc.md)。确认当前剧本已有正文且项目已经选择当前风格，再读取资产目录、所需媒体和可用模型。导演风格不需要额外确认；按资产类型生成所需图像或声音，复用当前设定、风格和引用，不在生成时暗改资产身份。使用当前配置的兼容模型，不要求特定供应商。

主要角色按 `character.md` 中的需求分别生产 `identity/face-closeup`、`identity/body-front` 和 `identity/body-back`；配角按出镜需求缩减，路人不强制三件套。每次生成前读取角色稳定身份、当前变体和目标媒体用途，提示词只描述可观察特征，不得加入姓名、人物小传、剧情事件或完整电影镜头语言。换装、伤势和变身等持续变化写入 `variants/`，不得复制成另一个角色。

生成工具优先传素材主档或变体目录的工程相对路径。生成后检查自动验收状态并简要报告失败项，不因检查失败自动重抽；媒体产物必须写回目标素材目录并由工程索引接管。
