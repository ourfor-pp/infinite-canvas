# 时间线文件契约

完整样例见 [timeline.json](timeline.json)。所有时间单位为秒；音频路径从工程根目录解析。示例的 `model-audio.wav` 必须由视频生成获得或替换为已有声音路径，不能伪造空文件。

`segmentOrder` 按叙事顺序列出 segment.md 稳定 ID，不得重复；省略时使用工程段落与视频段顺序。`tracks` 可省略或为空。每轨必填唯一 `id`、`kind`、`clips`。kind 为 dialogue / narration / ambient / sfx / music / model-original。

每个 clip 必填全时间线唯一 `id`、全片起点 `start >= 0`、`duration > 0`；可选所属 `segmentId`、声音文件 `path`、素材裁切起点 `trimIn >= 0`、`volume >= 0`、`muted`、`loop`。duration 控制实际使用长度，`trimOut` 保留界面数据但当前合成器不读取，请勿依赖它进行裁切。无 path 的草稿片段给出 warning，指定了不存在的文件则为 error。不要填写数据库 fileId。

各声音轨允许重叠和跨段声桥。视频段的 boundary / durationSeconds 写在 segment.md，时间线不重复定义视频生成模式或段时长。写完运行 director_validate；模型原声默认启用，不自动删除。

声音片段可设置 `fadeIn`、`fadeOut`（非负秒数，各自不超过 `duration`）；淡入从片段开始，淡出在片段结束前执行，均使用裁取后局部时间。省略时保持原固定音量行为。
