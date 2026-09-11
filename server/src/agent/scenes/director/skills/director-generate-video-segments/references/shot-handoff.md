# H3 视频段交接

以 `director_validate_video_segments` 的当前结果为准；本页描述创作与接口关系，不固定执行器配方。

- `capabilities.nativeState`：原生状态续接是否可用。为真且本段为 `continue` 时加载前段状态，隐藏重叠由后端管理；为假时按 `route` 使用参考音视频续接，不能称作确定性原生延展。
- `durationLimits`：当前段允许的计划时长。普通段和原生续接窗口可能不同，超限应按戏剧变化拆段。
- `nativeWindow`：预计新增帧数、隐藏重叠和实际输出秒数；时间线使用实际媒体时长，不能按计划秒数截掉对齐尾帧。
- `usesStoryboardStartGuide`：后端是否在整板之外附加首格引导。Agent 保持整张故事板，不手动裁格。
- `referenceBudget.selected/omitted`：本次选用及省略的素材；有重要身份参考被省略时先修订本段引用。
- `previewAudioPolicy`：预览声音策略，遵循服务端选择，不为追求速度覆盖有对白或声音设计的稳定配方。

## 提交与结果

普通段提交整张故事板。只有独立视觉过渡使用已生成的前段尾帧与后段首帧。`qualityPreset` 为 `preview` 或 `final`，后者表示视频段质量，不代表已完成整片合成。

`director_generate_video_segment({ segmentPath, qualityPreset })` 读取工程文件；不提供数据库 ID 或 revision。只提交一次，再按任务 ID 查询状态。产物检查使用返回的工程路径或`videos/seg-<segmentId>/preview.mp4`、`final.mp4` 和 `model-audio.wav`（segmentId 为工程稳定 ID）；首尾帧通过视频取样获得。原生累计画面与原声由后端合成链处理，不自行拼接累计视频与重复段。

提示内容只展开已确定的动作与摄影，中文对白原文保留在唯一 `<d>` 来源。先修正预检阻断项，再按用户授权范围生成；接口校验通过不等于连续性和声音质量已经通过。
