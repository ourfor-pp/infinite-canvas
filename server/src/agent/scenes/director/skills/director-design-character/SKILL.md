---
name: director-design-character
description: 为导演项目角色完善跨镜头一致的外观、身份锚点和声线设定。
allowed-tools: [mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_update_asset, mcp__infinite_canvas__director_list_styles, mcp__infinite_canvas__director_get_style]
---

# 导演台角色设计

读取角色、剧本依据和当前视觉风格，把剧情人物转化为可跨镜头复用的视觉身份与声线。剧情信息与生图信息必须严格分离。

- `payload.narrativeDescription`：保留身份、关系、身世、性格、人物弧光和剧情用途，绝不直接作为生图提示词。
- `payload.visualDescription`：只写肉眼可见且在当前基础造型中稳定不变的年龄感、体态、脸型五官、肤色、发型、服装、鞋履、配饰、材质、标志性色彩和识别特征；不写姓名、性格、关系、身世、动作、场景、情绪变化或剧情事件。
- `payload.designProfile.identityAnchor`：从视觉描述中压缩出最少但足以保持身份一致的锚点，不写前后期变化、受伤状态或情绪表演。
- 不同阶段的服装、伤势和状态应作为后续独立造型版本处理，不能用箭头或剧情顺序混入基础身份。
- `payload.mediaDrafts.image.prompt`：仅补充本角色特有、尚未被视觉描述覆盖的绘制重点；不写角色名，不复述人物小传，不重复公共四视图版式，不加入场景、镜头、戏剧光线或文字。
- `payload.mediaDrafts.audio.prompt` 与 `transcript`：分别保存声线和中性试听台词。

项目视觉风格只用于确定媒介、渲染、色彩体系和材质表现。角色设计图由图片模型一次生成正面、左侧、右侧和背面四个等高全身 A-Pose，使用中性光和纯白背景。

使用 `director_update_asset` 一次更新上述字段。完成角色设计不等于生成媒体；除非用户明确要求生成，否则不要调用生成工具。原文在性别、年龄或关键服饰上冲突时列出冲突并询问，不自行选择。
