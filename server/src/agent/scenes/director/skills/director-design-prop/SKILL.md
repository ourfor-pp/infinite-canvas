---
name: director-design-prop
description: 为导演项目道具完善造型、材质、尺度、交互和动作音效设定。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS]
---

# 导演台道具设计

读取道具的剧本用途与当前风格，并先读 [道具生产规范](references/prop-production.md)。描述固定轮廓、比例、材质、结构、基础磨损、持握尺度、关键细节、连续性锚点及动作音效。

破损、沾染、开启或能量变化等持续剧情状态写入同一道具目录下的 `variants/`，不污染道具母档。直接维护 `assets/props/prop-NNN-*/prop.md`，不添加与剧情无关的装饰功能。

结构母板提示词写入 `design/prompt.md`，输入参考放 `design/inputs/`，当前母板位于 `design/` 根目录。动作音效提示词只写入 `sound/sound.md` 正文，最多保留一个 `sound/reference.*`，当前结果为 `sound/primary.*`。状态变体使用 `variants/var-NNN-slug/variant.md`、`prompt.md`、`inputs/` 和 `primary.*`，不要为每个视角或一次性状态建立变体。
