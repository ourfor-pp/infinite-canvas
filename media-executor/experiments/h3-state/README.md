# H3 AV 状态实验

此目录未接入正式执行器、模型目录或导演生成链路。依赖来自隔离 ComfyUI 的 torch/safetensors，不增加执行器主环境依赖。

`state.py` 分别保存 H3 累计视频与音频 latent，保留 dtype，通过来源/模型/VAE固定标识和形状校验恢复。目标文件创建不可覆盖，写入失败清理临时文件。调用方必须提供可信来源标识、固定权重 revision 与用户工程归属；模块不负责鉴权。

测试：使用已有 torch/safetensors 环境运行 `python -m unittest discover -s media-executor/experiments/h3-state -v`。九项 CPU 检查通过；真实 243 帧状态经重启后独立任务重解码的全部视频帧与音频 PCM 一致，另一个任务追加 119 帧后原双流 latent 前缀精确一致。完整视听与正式导演接入尚未完成。

`__init__.py` 提供隔离节点 `H3SaveContinuationState` / `H3LoadContinuationState`。保存位于 Comfy 输出的 `h3-state/`，加载只允许输入根目录内的 safetensors 文件，重建原生 NestedTensor；路径越界和软链接越界拒绝。

`H3NewAVSegment` 只输出累计结果中新生成的画格和音轨，累计状态仍完整保留。视频使用 24 fps，音轨起点按累计帧边界计算；仅对原生 40 Hz 音频 latent 引起的不超过半个 tick 的时长量化差补零或裁尾，较大差异拒绝。CPU 精确切片检查及隔离真实节点输出均通过：从 362 帧累计状态仅输出新增 119 帧，音视频约 4.958/4.959 秒；完整视听仍待验收。

应用已支持状态与展示媒体分别存储，但可信模型上下文、来源生成绑定、替换失效与导演时间线接入仍待完成。不得把原型安装或节点成功执行当作成片验收。
