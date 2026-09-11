# 成片提交与验收

导出前读取时间线并调用 `director_validate`，确认本次时间线采用的视频段均有有效媒体，报告可选声音缺失。校验只保证结构与依赖，不等于画面、剪辑或听感验收。

- `director_start_render({})` 使用当前工程时间线，后端解析 revision。一次提交后记录任务 ID，再查询状态。
- `director_list_renders({ id })` 查看单个任务；历史列表用 `limit/offset`，按 `nextOffset` 翻页，不重复拉取全部历史。
- 用户要求停止时调用 `director_cancel_render({ renderId })`。
- `director_retry_render({ renderId })` 仅重试失败或取消任务，并要求时间线 revision 未变；同一时间线使用当前有效媒体，不是冻结的旧媒体快照。时间线已变应重新校验并新建任务，不能将旧任务改成新时间线。重试遵循用户授权，不能无限循环。

成功后检查 `renders/<renderId>/final.mp4` 与 `render.json`。核对实际时长、顺序、画幅、缺画面、接点、对白可听性和配乐音量；用媒体取样与声音理解提供具体证据。元数据含成片 SHA-256；存在成功文件不代表完整视听质量已通过。向用户返回工程路径及下载结果，保留其他成功版本。
