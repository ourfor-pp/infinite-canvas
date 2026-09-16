---
name: director-stage-previs
description: 为分镜段搭建声明式三维场景、可辨识粗模、基础动作与摄影，检查连续性、导出参考视频并按需生成时间绑定的定妆帧。
allowed-tools: [Read, Write, Edit, Glob, Grep, LS, mcp__infinite_canvas__director_read_segments, mcp__infinite_canvas__director_read_previs, mcp__infinite_canvas__director_capture_look_frame, mcp__infinite_canvas__director_generate_look_frame, mcp__infinite_canvas__director_render_previs, mcp__infinite_canvas__director_previs_render_status, mcp__infinite_canvas__director_validate]
---

# 三维预演

先读 [数据格式](references/format.md) 与 [多人交互样例](references/example.json)，再读取当前分镜段及场景空间。先交付可修改的粗模预演，不因缺少素材图片停止。用户通过播放、逐帧、拖动时间和自然语言检查，无手工骨骼或场景拖拽编辑。

1. 使用稳定对象 ID 与 `assetId` 绑定人物、场景和关键道具。比较身高、体型、轮廓、耳尾和配色，明确每个人物对应哪个粗模；不得只以姓名区分相似角色。布局保留通行空间，地面用基础几何表达。
2. 每段保存显式 `initial`，前段终点需主动转换成后段初始状态。关键帧使用段内绝对秒数；移动和转身写轨迹，基础表演写动作。切镜只改变摄影机，不重置人物。
3. 递物用 `attachments` 明确交接时刻和持物手。人物动作与道具附着同时设计；放下道具指定世界坐标。不能用物理模拟或一句“打斗”代替编排，不支持的复杂动作应简化或说明后明确跳过预演。
4. 多机位 `shots` 从 0 连续覆盖到 `duration`。镜头设计服务于动作和关系变化，检查视线、遮挡、轴线、构图和人物可辨识度。
5. `director_validate` 检查工程；`director_read_previs` 分页读取校验结果、对象、动作或镜头。验证后用 `director_render_previs` 提交明确范围与 `expectedHash`，通过 `director_previs_render_status` 查询、取消或重试。后台独立运行，关闭页面不影响导出；默认 24 fps、480p、静音。

## 可选定妆帧

收到生成请求后，调用 `director_capture_look_frame`，指定段 ID、时间、当前预演 hash；重绘同一帧传 `frameId`。等待返回的提取任务成功，实际打开 `inputs/previs.png`，结合角色身份图、场景和风格编写该目录 `prompt.md`。正文为最终提示，不依赖服务端隐藏拼接；Frontmatter `references` 按实际输入顺序明确工程相对 `path`、`purpose` 和中文 `label`。必须保留当前预演画面参考，逐人说明身份映射、当前动作与遮挡。普通背景无须单独生图。

Codex 使用原生生图，输出复制到该帧 `primary.*`；调用前记录 `prompt.md` 哈希与 `frame.json.captureHash`、`captureId` 和 `inputs/capture.json` 提取回执，完成后重新核对。预演哈希、提取请求或提示词变化时保留生成缓存，不覆盖主图。采用新图时将 `frame.json.sourceHash` 更新为本次使用的 `captureHash`，不伪造新的预演版本。内置 Agent 调用 `director_generate_look_frame`，传提示词哈希，使用管理员渠道；工具保存原始输入快照并在成功时更新主图。两种引擎最后都调用 `director_validate` 登记媒体。

只在实际采用图像后更新版本；重绘失败保留旧图和待检查标记。`useForVideo` 是视频输入选择，不是确认门槛。选中帧应显式加入相应任务 `referenceImages`，取消选择时同步移除；不得遗漏其他已声明的角色图。上游改变后只提示待检查，不自动生成。

检查实际导出画面与预演同一时刻，重点看三人交叉遮挡、双人递物、硬切后的角色位置、跨段空间。预演只表达基础调度，不替代最终影像和声音的人工验收。
