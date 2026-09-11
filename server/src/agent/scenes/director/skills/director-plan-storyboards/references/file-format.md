# 视频段文件契约

相对路径均从工程根目录解析，ID 来自对应 Markdown 的 Frontmatter，不能填数据库 fileId 或 revision。目录名用于组织，引用使用稳定 ID。先读取本页，再复制同目录 examples/ 中的文件并改写内容；不要照抄示例 ID 到已有工程。

- `sequence.md`：必填 `id`、`kind: sequence`、`name`、从 1 开始的 `order`；正文为段落概述。
- `segment.md`：必填 `id`、`kind: video-segment`、`sequenceId`、唯一正整数 `order`、4–15 秒 `durationSeconds`。生产前必须补齐来源、戏剧变化、开始/结束状态和英文 H3 字段。
- `sourceSceneId`、`sourceBeatIds` 对应制作拆解场次及其 `beats[].id`，`sourceDurationSeconds` 是本段覆盖节拍的预计总时长。
- `references.characters/locations/props` 为稳定 ID 数组，或 `{ id, variantId }` 对象数组；角色必须引用 character，场景引用 scene，道具引用 prop。
- `boundary` 为 `cut` 或 `continue`；续接填写 `continuationFromSegmentId`。独立视觉过渡填写 `generationIntent: transition` 和 `transitionFromSegmentId` / `transitionToSegmentId`，无需故事板文件。
- `audioReferences` 最多三项，每项为工程相对 `path`、`purpose: voice|dialogue|sound|music`、英文 `description`；voice/dialogue 额外填写本段角色 `speakerAssetId`。
- `storyboard.yaml` 必填 `version: 1`、当前 `segmentId`、`layout`、`frames`。版式 2x2 / 3x2 / 3x3 分别对应 4 / 6 / 9 格。
- 每格必填 `id`、`shotNumber`（1–3）、`timeSeconds`、`kind`、`description`、`action`、`cameraAngle`、`cameraMove`、`sound`；生产前填写英文 `h3Visual`。格序为数组顺序，从 0 秒严格递增到段末；Shot 从 1 开始连续编号。
- `dialogues` 可为空；每条必填 `speakerAssetId`、`speakerName`、`text`、`language`、英文 `delivery`、`startSeconds`、`endSeconds`，可选 `offScreen`。时间为本段局部秒数，必须在本段时长内，角色必须属于本段引用。
- `storyboard-prompt.md` 是整板生图提示词；`storyboard.png` 是一次生成的完整故事板。媒体快照由服务端维护，不写进 YAML。

完整样例：[sequence.md](examples/sequence.md)、[segment.md](examples/segment.md)、[storyboard.yaml](examples/storyboard.yaml)。该例引用 [制作拆解样例](../../director-breakdown-screenplay/references/scene-example.md) 的 `scene-001/beat-001`，无对白和素材引用；文字规划可通过结构校验，媒体生成仍需补齐对应提示词和媒体。

写完调用 `director_validate`，诊断给出文件路径与具体字段。生成前调用 `director_validate_video_segments({ segmentPaths: ["storyboards/seq-001-station/seg-001-door/segment.md"] })`，它额外检查叙事、英文提示、素材和媒体是否满足生产要求。
