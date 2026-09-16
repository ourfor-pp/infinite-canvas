# v2 工程格式

- `storyboards/scene-001/sequence.md`：场景容器，稳定 id、kind: sequence、name、order。
- `storyboards/scene-001/shot-001/shot.md`：镜头设计，参见 [镜头样例](examples/shot.md)。
- 每个 `shot.md` 是一个列表项，正文可容纳同一叙事段落的多个板内画面；它们共享一张板时不另建重复条目。一个输出图片只放在其所属条目，不分发到多个镜头目录。
- 镜头故事板：在 `shot.md` 同目录保存 `storyboard.png`（也支持 jpg/jpeg/webp/gif，每页只保留一个图片文件）和 `prompt.md`；多页放在 `boards/page-001/`、`boards/page-002/`，每页同样保存图片与提示词。界面按当前镜头读取这些文件，不读取制作任务的旧故事板。
- `prompt.md` 正文为本页实际提示词，必须区分导演规则确定的单格画幅、本页行列布局与整板比例；Frontmatter 的 `references` 显式列出输入图片的工程相对路径 `path`、用途 `purpose`（`identity_reference`、`style_reference`、`wardrobe_reference`、`composition_reference` 或 `reference_input`）和可选名称 `label`；不要把输出故事板当作自身输入。引用图与提示词跟随所在页面显示。
- `productions/task-001/task.md`：制作任务，参见 [任务样例](examples/task.md)。
- 任务最终提示：同目录 `video-prompt.md`，正文原样发送给模型。
- 可选参考说明：同目录 `storyboard.yaml`；图片可命名 `storyboard.png`，但只有列入任务 `referenceImages` 才会提交。
- 当前视频仍命名 `preview.mp4` 或 `final.mp4`，原声为 `model-audio.wav`。它们由服务端写入，不手工修改原生状态。
- `timeline/timeline.json` 使用独立片段的 `videoClips` 和声音 `tracks`，参见时间线 Skill。

镜头与任务的 ID 均稳定。`shotIds` 只引用本工程镜头 ID；`sequenceId` 对应本工程场景。任务 `durationSeconds` 是这次生成目标，镜头 `estimatedSeconds` 是创作估计，成片片段 `trimIn/trimOut` 是实际素材时间，三者不混用。

故事板结构如 [参考说明样例](examples/storyboard.yaml)，允许单图 `layout: single` 或多宫格版式。结构化时点是计划，不自动生成时间线裁切。
