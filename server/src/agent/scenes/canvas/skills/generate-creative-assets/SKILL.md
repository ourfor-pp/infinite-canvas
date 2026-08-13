---
name: generate-creative-assets
description: 为已经完成设定的角色、场景、道具生成标准设计图、角色声音、场景环境声或道具音效；用户明确要求开始生成媒体、重试生成或制作试听时使用，不用于故事拆解或补写设定。
allowed-tools: [mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__creative_asset_generate, mcp__infinite_canvas__generation_get_status]
---

# 生成创作资产

先读取资产及最新 revision，检查描述、角色设计画像、音色和试听台词是否自洽；缺失或冲突时先说明，不直接生成。服务端负责合并风格、语义连线与固定版式。

- 角色图：纯白无影背景，胸像、正面、四分之三侧面、背面为同一角色；身份、性别表达、年龄、发型、服装与配饰一致。
- 场景图：完整空间加局部细节，严格无人、无文字。
- 道具图：纯白无影背景，同一道具的正面、侧面与细节，无人物、无文字。
- 角色声音：音色必须匹配 `designProfile.voiceGender` 与年龄段，试听台词只用于听声音。

图片生成后进入待验收状态，通过自动或人工质检后才能设为主图。任何媒体生成都不自动切换主版本。
