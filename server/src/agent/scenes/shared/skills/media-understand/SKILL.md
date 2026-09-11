---
name: media-understand
description: 描述、比较或检查项目中的图片、音频和视频画面；视频先生成联系表或抽帧，再进行图片理解。
allowed-tools: [mcp__infinite_canvas__media_understand_images, mcp__infinite_canvas__media_understand_audios, mcp__infinite_canvas__media_prepare_video_overview, mcp__infinite_canvas__media_sample_video_frames]
---

# 媒体理解

- 图片：遵循当前会话引擎的图片理解能力，先实际打开图片再描述；同组图片按顺序比较，细节不清时查看原图。不能用文件名或文本描述替代可见证据。
- 声音：使用当前注册的声音理解工具，按实际接口传入媒体。Codex 导演工程用相对 `path`，其他场景按工具定义提供文件引用。只报告可听证据，不能把语义理解当作精确 ASR 或逐词时间。
- 视频：先取均匀覆盖全片的联系表，再针对明确接点或动作时间取原始帧。Codex 的合并取样工具使用 `mode: overview|frames`，输入工程 `path`，输出 `.cache/media-inspection/` 图片路径供原生看图；其他场景按各自取样工具的返回媒体继续理解。
- 输出区分观察、推断与不确定项，并保留源路径及时间点。联系表不能证明所有中间帧正常，首尾图不能证明运动流畅。不要用文本文件读取工具读取二进制媒体。
