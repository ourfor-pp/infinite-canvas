# 时间线 v2

权威文件为 `timeline/timeline.json`，完整例子见 [timeline.json](timeline.json)。

`videoClips` 为有序数组，每项 `id` 唯一；`taskId` 可重复。`trimIn >= 0`，`trimOut > trimIn`，均为任务当前结果的实际素材秒数。`linkedAudio` 默认 true。

`tracks` 保留 id、kind、clips。声音片段用 `taskId` 引用任务当前模型原声，或用 `path` 指定工程内音视频文件；start 是成片时间，trimIn 是素材入点，duration 是采用时长，volume 是线性增益。任务原声解关联后必须关闭对应视频片段的 linkedAudio。

任务媒体尚未生成时保留引用并报告待制作；重做变短后越界会报错，不自动删片段或缩短。禁止写 segmentOrder。
