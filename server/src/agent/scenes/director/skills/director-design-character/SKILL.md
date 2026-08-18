---
name: director-design-character
description: 为导演项目角色完善可跨镜头复用且与同项目其他人物明确区分的外观、面部身份、身份锚点和声线设定。
allowed-tools: [mcp__infinite_canvas__director_list_assets, mcp__infinite_canvas__director_get_asset, mcp__infinite_canvas__director_update_asset, mcp__infinite_canvas__director_list_styles, mcp__infinite_canvas__director_get_style]
---

# 导演台角色设计

读取当前角色、同项目其他角色和视觉风格，把剧情人物转化为可跨镜头复用且不会脸盲的视觉身份与声线。先读 [角色生产规范](references/character-production.md)。

- `payload.narrativeDescription`：保留身份、关系、身世、性格、人物弧光和剧情用途，绝不直接作为生图提示词。
- `payload.visualDescription`：只写肉眼可见且在当前基础造型中稳定不变的年龄感、体态、脸型五官、肤色、发型、服装、鞋履、配饰、材质、标志性色彩和识别特征；不写姓名、性格、关系、身世、动作、场景、情绪变化或剧情事件。
- `payload.designProfile.identityAnchor`：从视觉描述中压缩出最少但足以保持身份一致的锚点，不写前后期变化、受伤状态或情绪表演。
- `visibleAgeCues`、`bodySilhouette`、`posture`：分别保存可见年龄纹理、远景全身剪影和稳定姿态，不能互相替代。
- `distinctivenessSummary`：说明该角色相对当前阵容最有辨识度的脸部、体态和造型组合，不写性格标签。
- `payload.designProfile.facialIdentity`：结构化保存脸型、骨相、眉眼、鼻唇、肤色、发际线和非对称识别点；未知项留空，不用审美套话补齐。
- 不同阶段的服装、伤势和状态应作为后续独立造型版本处理，不能用箭头或剧情顺序混入基础身份。
- 不在 `payload.mediaDrafts.image.prompt` 决定真人、动画、水墨、三维等媒介，也不写摄影、线稿、渲染、光线或后期；这些全部由当前视觉风格负责。角色图片提示只使用上述结构化身份字段。
- `payload.mediaDrafts.audio.prompt` 与 `transcript`：分别保存声线和中性试听台词。

先列出全部角色并做阵容对照，确保主要角色在脸型骨相、体态比例、发型轮廓、服装剪影、年龄痕迹与自然识别点中至少三组明显不同，再使用 `director_update_asset` 更新上述字段。人脸与人体差异是所有媒介的通用身份规则；毛孔、真实相机、线稿、色块或三维材质不是角色身份，只能来自风格。完成角色设计不等于生成媒体；除非用户明确要求生成，否则不要调用生成工具。原文在性别、年龄或关键服饰上冲突时列出冲突并询问，不自行选择。
