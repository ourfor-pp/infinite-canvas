---
name: media-understand
description: 描述、比较或检查项目中的图片、音频和视频画面；视频先生成联系表或抽帧，再进行图片理解。
allowed-tools: [mcp__infinite_canvas__media_understand_images, mcp__infinite_canvas__media_understand_audios, mcp__infinite_canvas__media_prepare_video_overview, mcp__infinite_canvas__media_sample_video_frames]
---

# 媒体理解

- 图片：一组相关图片调用一次 `media_understand_images`；普通观察用 `low`，小字或精细缺陷才用 `high/xhigh`。
- 声音：调用 `media_understand_audios` 判断语音、语气、音乐、环境声与声音事件。它不是精确 ASR，不得编造逐词时间。
- 视频：先调用 `media_prepare_video_overview` 生成全片联系表，再把联系表作为单张图片理解。需要核对明确时刻或连续动作时，再调用 `media_sample_video_frames` 并按顺序理解原始帧。
- 不用 Read 读取二进制媒体。只报告可见、可听证据，并明确不确定项。
