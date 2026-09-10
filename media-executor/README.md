# Infinite Media Executor

部署在 GPU 机器上的单卡媒体任务执行器。它不保存业务数据，只保留可恢复任务和待业务服务器拉取的临时结果。

```bash
uv sync --extra test
MEDIA_EXECUTOR_TOKEN=change-me MEDIA_EXECUTOR_HOST=0.0.0.0 uv run infinite-media-executor
```

运行时分别监听 `127.0.0.1:8301`（Qwen TTS）、`8302`（MOSS SoundEffect）、`8303`（ACE-Step 适配器）和 `8304`（Stable Audio 3）。`MEDIA_MODEL_ROOT` 使用统一入口 `/data/sas/models`；当前实际启用的模型文件放在 NVMe 的 `/home/cec/.local/share/infinite-media-executor/models`，再由统一入口软链接过去，与现有 ComfyUI 模型方案一致。正式部署使用 `systemd/` 中的 unit，并用防火墙限制 8290 仅允许业务服务器访问。

业务服务器配置：

```bash
MEDIA_EXECUTOR_URL=http://5090-machine.lan:8290
MEDIA_EXECUTOR_TOKEN=change-me
STABLE_AUDIO_3_LICENSE_ACCEPTED=0
```

ACE-Step 适配器调用官方 `acestep-api`（回环端口 8001）。`scripts/download-models.sh` 已固定官方 ModelScope revision，直接下载到 `MEDIA_MODEL_SSD_ROOT`，再在 `MEDIA_MODEL_ROOT` 创建软链接并生成 `manifest.json`；Stable Audio 许可未确认时不会下载。

安装 ACE 官方引擎使用 `scripts/install-ace-step.sh`。当前固定上游版本的 API 初始化仍直接读取源码目录下的 `checkpoints`，安装器会将它链接到 `ACESTEP_CHECKPOINTS_DIR`（默认 `/data/sas/models/ACE-Step1.5`），确保 XL SFT、VAE、Embedding 和 LM 全部从 SSD 读取。

ACE 只有在官方引擎和完整检查点通过 smoke test 后才设置 `ACE_STEP_ENABLED=1`；仅安装适配器不会把音乐模型加入可用目录。

当前机器可用用户服务安装器：

```bash
./scripts/install-user-services.sh
systemctl --user start infinite-media-executor infinite-qwen-tts
```

VoxCPM2 所在的 CUDA 13 ComfyUI 正式服务需要额外的 NVRTC 动态库路径。使用下列安装器部署受版本管理的 systemd drop-in；脚本会在队列非空时拒绝重启：

```bash
./scripts/audit-h3-ecosystem.sh
./scripts/install-h3-ecosystem.sh
./scripts/install-comfyui-h3-dropin.sh
```

H3 生态安装器固定 ComfyUI v0.35.0，并关闭尚未纳入本机验收的 Comfy Compiler；把固定 ComfyUI、KJNodes 与 Turbo 节点部署到新的 revision 目录，在独立 8190 端口同时探测 AddGuide、Turbo、Sage Attention 和 `SaveVideo` 后才切换 `/home/cec/ComfyUI-H3-current`。旧 checkout 不删除，可用于回滚。Turbo 权重保存在 SSD 并记录 revision、SHA256 与上游许可入口；只有正式的固定样例视频和原声音频基准通过后，才应将 Turbo 作为默认预览配方。

FLUX.2 Dev 使用 `scripts/install-flux2-dev.sh` 通过 ModelScope SDK 从官方 `Comfy-Org/flux2-dev` 同仓的固定 revision 直接下载 FP8 mixed diffusion、FP8 Mistral 3 Small 文本编码器和 VAE，不保留双份 Git LFS 对象缓存。约 53.8 GB 的实体文件保存在 NVMe 的 `/home/cec/.local/share/comfyui-models`，`/data/sas/ComfyUI/models` 仅放三个稳定软链接；安装器会校验 SHA256，并拒绝覆盖已有真实模型文件。该模型受 FLUX Non-Commercial License v2.1 约束，当前只用于本地内部测试与评估。

ACE XL 与 MiniMax H3 推理前必须排空其他常驻 GPU 服务。用 `scripts/configure-gpu-drain.sh` 配置本机 unit 列表；执行器会在 ACE 任务或 H3 ComfyUI 提交前暂停冲突服务，等对应任务及队列完成后恢复原先处于 active 的服务。H3 默认暂停 Qwen TTS、MOSS SoundEffect 和普通 ComfyUI，但不会停止承载 H3 队列的 `comfyui-h3.service`。若包含系统级 unit，按 `systemd/infinite-media-executor-sudoers` 为执行器账号配置最小化 `systemctl` 权限。

安装器只生成和启用 unit，不会在运行时尚未通过 smoke test 时自动启动。执行器监听 `0.0.0.0:8290`，子运行时始终只监听回环地址；正式跨机器使用时还应由防火墙只放行业务服务器 IP。


## H3 隔离加速验证

`h3-experiments.json` 固定 ComfyUI、VDN/PDD 节点和原作者增量权重。LightX2V、VDN 优先使用官方 ModelScope 同仓；PAI 无对应同仓时使用官方 Hugging Face。下载脚本校验尺寸和 SHA256，安装脚本建立独立 `.venv`，均不切换现有服务或默认模型。

```bash
python3 media-executor/scripts/download-h3-experiments.py
# H3_SAGE_WHEEL 应指向与 Python 3.12 / Torch 2.11 CUDA 13 匹配的本地 SageAttention wheel。
H3_SAGE_WHEEL=/absolute/path/to/sageattention.whl bash media-executor/scripts/install-h3-experiments.sh
python3 media-executor/scripts/prepare-h3-experiments.py --runtime .tmp/h3-lab/ComfyUI-40c4fcdf513a4523e39d54a9d391908af8df8171
```

在该独立 runtime 中以 `--listen 127.0.0.1 --port 8190 --disable-auto-launch --disable-comfy-compiler --cache-none` 启动；不对外暴露端口。先检查现有与实验队列，再把同一参考图放入实验 runtime 的 `input/`。通过服务端导出固定图：

```bash
cd server
node --import tsx scripts/export-h3-experiment.ts --recipe lightx2v-ref4 --mode ref2va --prompt ../media-executor/examples/h3-evaluation/ref2va.txt --output /absolute/path/to/experiment.json
cd ..
python3 media-executor/scripts/benchmark-h3.py /absolute/path/to/experiment.json --output .tmp/h3-evaluation/lightx2v-ref4
```

配方为 `base`、`lightx2v-ref4`、`lightx2v-ref8`、`pdd-ref8`、`vdn8`；所有配方固定 960×544、124 帧、24 FPS 和同一种子。FL2VA 基座仅使用 `base`、`vdn8`，当前单首图样例的实际提示模式是 I2VA，使用 `examples/h3-evaluation/i2va.txt`；Ref2VA 使用同目录的 `ref2va.txt`。两份提示词按官方 `h3-prompt-writing` Skill 优化，来源 revision 和内容哈希记录在 `prompt-manifest.json`。PDD 使用原作者完整权重和专用节点输出的 sigma，保留 32 区间蒸馏输出头；VDN 使用默认与 Turbo 两个自带适配器，禁止叠加其他 Turbo LoRA。它是社区 Comfy 移植验证，不代表官方 Ref2VA 专用训练支持。当前 pruned ConvRot 基座在 VDN merge 路径会跳过 51 项 AdaLN 增量，结果不能当作官方完整复现或直接进入默认配方。

每次保留请求图、配方、完整 history、实际视频、文件哈希、ffprobe 和音频统计。生成成功不能自动通过画质、音色或对白验收；脚本中的 `qualityAccepted` 和 `audioAccepted` 默认保持 false。先跑 FL2VA VDN，再单独跑社区 Ref2VA。长片段与多宫格故事板的质量验证完成后才能调整产品默认值。

### 多场景复跑与对白检查

`examples/h3-evaluation/second-batch/` 保存四类官方 Skill 提示、固定种子及公开参考图来源/哈希。把 `input-sources.json` 中的原图以指定文件名放在同一目录，保持实验运行时 8190 空闲，然后执行：

```bash
python3 media-executor/scripts/benchmark-h3-suite.py --inputs /absolute/reference-images --output .tmp/h3-evaluation/new-suite
```

可追加 `--recipes lightx2v-ref8` 仅测试作者 Ref2V v1.0 八步版本，或显式列出需要比较的配方。

套件先检查图片与提示哈希，拒绝覆盖旧结果，再顺序运行基础模型、LightX2V 4 步和 PDD 8 步。没有改变默认服务配置。

使用已有 Qwen3-ASR 环境和本地模型进行离线 CPU 辅助检查；此步骤应在 GPU 计时结束后运行：

```bash
/path/to/asr/.venv/bin/python media-executor/scripts/transcribe-h3.py .tmp/h3-evaluation/new-suite \
  --cases media-executor/examples/h3-evaluation/second-batch/cases.json \
  --model /absolute/Qwen3-ASR-0.6B --aligner /absolute/Qwen3-ForcedAligner-0.6B \
  --output .tmp/h3-evaluation/new-suite/asr-results.json
```

转写对比仅忽略标点和空白，保留原始转写；时间检查要求首尾边界分别落在目标的 ±0.25 秒内，并记录偏差；另输出 `speechWithinWindow`，单独判断是否在容差范围内开始且按时说完，允许提前结束。该阈值是本套件预先规定的评测标准，不是模型能力保证。无对白场景检查转写是否为空；ASR 可能对非语言声音误识别，任何结果均不自动设置 `audioAccepted=true`，也不能替代完整听音和口型验收。
