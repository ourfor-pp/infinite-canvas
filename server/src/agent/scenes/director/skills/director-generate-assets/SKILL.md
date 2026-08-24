---
name: director-generate-assets
description: 在导演阶段门满足后生成角色、场景和道具的图像或声音结果。
allowed-tools: [Read, Glob, Grep, LS, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_generate_asset, mcp__infinite_canvas__director_get_generation_status]
---

# 导演台资产生成

先读 [图片生成规范](references/gpt-image-2.md) 与 [资产验收清单](references/asset-qc.md)。确认当前剧本已有正文且项目已经选择当前风格，再读取资产目录、所需媒体和可用模型。导演风格不需要额外确认；按资产类型生成所需图像或声音，复用当前设定、风格和引用，不在生成时暗改资产身份。使用当前配置的兼容模型，不要求特定供应商。

图像生成只读取目标工作区自己的 `prompt.md` 和 `inputs/`：角色基础设计位于 `identity/`，场景和道具基础设计位于 `design/`，变体位于其 `variants/var-NNN-slug/`。角色基础设计每次只生成一张横版 16:9 三栏身份板，图内依次为完整正面全身、完整背面全身和放大的正面头肩面部近景；结果统一写为 `identity/primary.*`，不得按视角拆成三次请求或三个媒体文件。提示词只描述可观察特征，不得加入姓名、人物小传、剧情事件或完整电影镜头语言。

声音生成只读取 `voice/sound.md` 或 `sound/sound.md`；角色试听文本来自 Frontmatter `sampleText`。一个声音工作区最多使用一个 `reference.*`，生成结果覆盖当前 `primary.*`，不得把主档、导演声音规则或内部编译上下文重复写进声音提示词。

生成工具必须传目标工作区工程相对路径和提交时提示词哈希。旧任务完成时若哈希已变化，只保留任务历史，不覆盖当前结果。生成后检查自动验收状态并简要报告失败项，不因检查失败自动重抽；媒体产物必须写回目标素材目录并由工程索引接管。
