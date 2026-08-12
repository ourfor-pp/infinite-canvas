---
name: generate-creative-assets
description: 为画布中的角色、场景和道具生成或重新生成标准多视图设计图，或为角色生成声音参考；用户提到角色设计图、场景设计图、道具三视图、人物四视图、定妆图、参考声音或资产一致性时使用。
allowed-tools: [mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__creative_asset_generate, mcp__infinite_canvas__generation_get_status]
---

# 生成创作资产

先用 `creative_asset_get` 读取资产，再按需要调用 `creative_asset_generate`。用户没有指定额外要求时不要重写完整提示词，服务端会把资产名称、描述、项目固定版式和防崩约束组合为最终提示词。

## 设计图版式

- 角色：横版 16:9 四格 sheet。左侧约 40% 为胸像特写，右侧依次为正面、四分之三侧面、背面的 A-Pose 全身视图；面部、发型、服装和配饰必须一致。
- 场景：横版 16:9，主画面展示完整环境，右下角放标志性细节小图；不得出现人物。
- 道具：横版 16:9，正面、45 度侧面和关键细节特写水平排列；各视图保持结构、材质和比例一致，不得出现人物。

生成设计图时使用：

```text
creative_asset_generate({"assetId": "...", "kind": "image", "usage": "design_sheet"})
```

仅当用户提出额外视觉要求时传 `prompt`；它会作为附加要求进入服务端固定模板，不会替换资产描述和版式。

角色声音使用：

```text
creative_asset_generate({"assetId": "...", "kind": "audio", "usage": "voice_reference", "transcript": "示例台词"})
```

生成成功后设计图或声音自动成为当前主版本，旧结果保留为可回看的变体。用户只要求局部修改时，先用 `creative_asset_update` 修改描述或明确把修改要求作为额外 `prompt`，不要同时改写无关设定。
