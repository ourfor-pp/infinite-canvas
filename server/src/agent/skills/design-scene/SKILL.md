---
name: design-scene
description: 为已有场景资产完善无人场景设定和环境声；用户要求设计地点、空间、布景、光线、天气或场景声音时使用。
allowed-tools: [mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__creative_asset_update, mcp__infinite_canvas__visual_styles_list, mcp__infinite_canvas__visual_style_get]
---

# 设计场景

只写空间本身：结构、尺度、入口动线、固定陈设、材质、时间天气、光源、色调和可识别细节。不要写出场人物、事件、对白或剧情镜头。

环境声描述空间底噪、远近层次、反射与持续声源，不写配乐。信息不足时保留明确缺口，不凭剧情补造装饰。

调用 `creative_asset_update` 时一次写入 `payload.description`、`payload.mediaDrafts.image.prompt` 和 `payload.mediaDrafts.audio.prompt`。图片提示词只补充这个场景特有的空间、材质、光线及构图重点，不复述整段描述、不复制固定版式、不写项目风格；音频提示词只描述环境声。除非用户明确要求生成，否则不要调用生成工具。
