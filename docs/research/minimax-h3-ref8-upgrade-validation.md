# H3 Ref2V v1.0 八步与 ComfyUI 升级验证

## 新版权重结果

使用作者 ModelScope 同仓固定 revision `9056a6d9bdb2f0b2de6f03cbf4e3ad399df57343`，文件 `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`，SHA256 `6a56f41ab4229c9dd845b9501bbd475ee57e112d846cf2e819d534a1ae928c5a`。实体位于现有 NVMe 实验模型目录，未加入正式模型目录。参数遵循[作者发布说明](https://huggingface.co/lightx2v/Minimax-h3-Turbo/discussions/51)：Euler、8 步、video/audio shift 12/3。

本轮沿用[上一轮四份官方 Skill 提示、输入及种子](../../media-executor/examples/h3-evaluation/second-batch/)，重新核对官方 `h3-prompt-writing` 的 Ref2VA 六段规范，没有为新版改写提示。ComfyUI 仍为 `40c4fcdf513a4523e39d54a9d391908af8df8171`，960×544、124 帧、24 fps、seed 314159；每任务一次生成，不能代表多种子成功率。

| 任务 | 耗时 | Qwen 识别发声区间 | 台词结果 |
| --- | --- | --- | --- |
| 先说话再移剑 | 54.774 秒 | 0.56–2.96 秒 | 原文一致，超出计划 0.25–2.25 秒 |
| 摩托车对白 | 56.878 秒 | 0.96–3.04 秒 | 原文一致，在计划 0.5–3.5 秒窗口内 |
| 泳池画外音 | 56.762 秒 | 0.16–2.72 秒 | 原文一致一次，早于计划 0.5 秒开始 |
| 无对白水面 | 56.830 秒 | “嗯”被对齐到 5.12–5.12 秒 | Qwen 与 SenseVoice 猜测不一致，VAD 未检出语音，需听音 |

四项平均 56.311 秒；上一轮基础平均 95.423 秒、v0.1 四步 40.5465 秒、PDD 八步 56.267 秒。新版在此组样例约为基础速度的 1.69 倍，耗时与 PDD 接近；不同批次的计时只能作描述比较。

泳池台词由 Qwen 与独立 SenseVoice 均识别为一次“慢慢来，保持呼吸。”，FSMN-VAD 的最后语音段结束于 2.95 秒，旧版在 3 秒之后的重复现象没有在本次样片复现。这是新版值得继续测试的证据，尚不能宣布重复问题已经修复。时间偏移仍存在。

泳池抽帧中泳者大体保持画面中部、背景内容发生变化，尚不足以验收严格固定机位；完整运镜、肢体和口型仍需逐段观看。所有自动记录继续保留 `qualityAccepted=false`、`audioAccepted=false`。

结构化记录见[本轮结果](../../media-executor/examples/h3-evaluation/ref8-v1/)。本机 `.tmp/h3-evaluation/ref8-v1/index.html` 提供基础、旧版、新版和 PDD 四列视频。原始请求、history、视频、音轨及抽帧保存在同目录。

## ComfyUI 版本核对

[官方最新稳定版](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.35.0)是 v0.35.0，对应本轮实验已使用的 `40c4fcdf`。查询时 master 为 `a7b1d39d`，稳定版之后六项提交未发现本轮必须依赖的 H3 音频修复，升级候选固定稳定版。

升级前 8189 实际进程来自 `/home/cec/ComfyUI-H3`，revision `0764232429b8cfb10b79b6f186c8cb23e0b22897`，由用户级临时服务 `arcreel-comfyui-8189.service` 启动。系统级 `comfyui-h3.service` 为 inactive，`ComfyUI-H3-current` 还指向另一个旧目录，不能以该软链接推断实际运行版本。

稳定版已包含对白特殊标记、音频 wrapper 传递、PDD 支持等更新，但本轮时间偏移仍在，升级不能被描述为这些质量异常的确定修复。

## 验证状态

新版实验配方、CLI 和准备脚本已支持独立的 `lightx2v-ref8`。配方回归、服务端类型检查、服务端 71 项测试与执行器 4 项测试通过。完整候选环境的 198 个依赖包检查通过；H3 基础 20 步视频以 95.344 秒完成，VoxCPM2 也成功生成并下载音频。实际服务已切换到 v0.35.0，保留用户级 `arcreel-comfyui-8189.service`，输入与输出目录仍指向旧服务媒体目录，旧 checkout 未删除。升级后从应用主机经执行器 8290 提交 H3 任务，95.513 秒完成，并经同一路径下载含音轨的 MP4，传输与 ffprobe 检查通过。VoxCPM2 候选音频时长 2.56 秒。

正式服务仍仅监听 `127.0.0.1:8189`，实验 8190 已关闭。`ComfyUI-H3-current` 已指向新目录；本次沿用原用户级临时服务，没有启用或迁移系统级服务。回滚可在队列为空后，将同一用户级服务的工作目录、Python 和 CUDA 库路径恢复为 `/home/cec/ComfyUI-H3`，启动参数恢复为原命令；原始配置记录保存在 `.tmp/h3-community-research/upgrade-before.json`。新版移除的云端供应商节点不被本项目固定工作流引用。
