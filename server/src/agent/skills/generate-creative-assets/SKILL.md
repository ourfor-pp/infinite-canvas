---
name: generate-creative-assets
description: 为画布中的角色、场景和道具生成标准多视图设计图、角色声音、场景环境声或道具音效；用户提到设计图、人物四视图、定妆图、参考声音、环境声、音效或资产一致性时使用。
allowed-tools: [mcp__infinite_canvas__creative_asset_get, mcp__infinite_canvas__creative_asset_generate, mcp__infinite_canvas__generation_get_status]
---

# 生成创作资产

先用 `creative_asset_get` 读取资产及最新 `revision`。媒体生成只读取资产已经保存的 `payload.mediaDrafts`；需要优化提示词时，先用 `creative_asset_update` 修改对应草稿，再使用最新 revision 调用 `creative_asset_generate`。服务端会把资产名称、描述、视觉风格、语义连线和固定版式组合为最终请求。

## 设计图版式

- 角色：横版 16:9 四格 sheet。左侧约 40% 为胸像特写，右侧依次为正面、四分之三侧面、背面的 A-Pose 全身视图；面部、发型、服装和配饰必须一致。
- 场景：横版 16:9，主画面展示完整环境，右下角放标志性细节小图；不得出现人物。
- 道具：横版 16:9，正面、45 度侧面和关键细节特写水平排列；各视图保持结构、材质和比例一致，不得出现人物。

生成设计图时使用：

```text
creative_asset_generate({"assetId": "...", "kind": "image", "revision": 3})
```

仅当用户提出额外视觉要求时更新 `payload.mediaDrafts.image.prompt`；不要把完整资产描述重复写进媒体草稿。

角色声音、场景环境声或道具音效使用：

```text
creative_asset_generate({"assetId": "...", "kind": "audio", "revision": 4})
```

角色的音频草稿使用 `audioMode: speech`，同时填写音色 `prompt` 与试听 `transcript`；场景使用 `ambient`，道具使用 `sfx`。参考音频的 `usage` 是 `reference_input`，只作为可选生成输入。生成成功只会追加候选变体，不会自动切换主图或主音频；只有用户明确要求后才能通过 `creative_asset_set_primary` 选择主版本。
