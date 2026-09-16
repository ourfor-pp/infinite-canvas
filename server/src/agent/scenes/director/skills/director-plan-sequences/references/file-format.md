# 导演工程 v3

`project.yaml` 使用 `version: 3`。旧格式不支持导入，不添加自动转换。

- `scenes/<场景>/scene.json`：`version: 1`、稳定 `id`、`name`、`order`、`summary` 与 `objects`。场景物体与身份由多段共享。
- `scenes/<场景>/segments/<分镜段>/segment.md`：Frontmatter 为 `id`、`kind: segment-design`、`name`、`sequenceId`（场景 ID）、从 1 开始的 `order`、`estimatedSeconds`、`previsMode: required | skip`；可写 `sourceSceneId`、`sourceBeatIds`、`purpose`、`staging`、`camera`、`action`、`dialogue`、`sound`、`openingState`、`endingState`、`connection`。正文补充完整叙事。
- 同目录 `previs.json`：唯一的动作与摄影时间定义，格式见 `director-stage-previs` Skill。禁止生成可执行脚本。
- 同目录 `look-frames/<ID>/`：可选 `frame.json`、`prompt.md`、`inputs/previs.png`、`primary.png`；用提取工具建立目录与版本信息，不自行猜测来源 hash。
- 同目录 `previs-exports/<ID>.mp4` 和同名 `.json`：后台导出的静音参考视频与范围/版本记录；两者一同保留。
- `productions/<任务ID>/task.md`：`id`、`kind: production-task`、`name`、`sequenceId`、`order`、`durationSeconds`、`segmentRanges: [{segmentId, start, end}]`；`referenceImages` 显式列出采用图片路径；`videoReferences` 显式列出 `{path, purpose, includeAudio: false, segmentId, sourceHash, start, end}`。预演必需时必须提供与覆盖范围和当前 hash 完全相符的导出参考。
- 同目录 `video-prompt.md` 正文是实际提交文本；`runs/` 保存不可变的提示与输入快照。任务失败保留已采用的视频。
- `timeline/timeline.json` 使用独立 `videoClips`：`id`、`taskId`、`trimIn`、`trimOut`、`linkedAudio`，按实际素材时间裁切。生成完成不自动入轨。

时间全部以秒为单位；范围为左闭右开。场景对象、分镜段、段内镜头和制作任务分别使用稳定 ID。
