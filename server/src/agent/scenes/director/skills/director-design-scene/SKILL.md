---
name: director-design-scene
description: 为导演项目场景完善空间结构、光线、材质和环境声设定。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS]
---

# 导演台场景设计

读取场景的剧本依据和当前风格，并先读 [场景生产规范](references/scene-production.md)。明确固定空间结构、年代地域、材质、基础光线、可拍摄区域、稳定视觉锚点与环境声。

人物动作、单场剧情、天气变化、破坏状态和临时陈设不得污染场景母版；持续结构变化写入同一场景目录下的 `variants/`。直接维护 `assets/locations/loc-NNN-*/location.md`，保存能被后续视频段稳定复用的设定。
