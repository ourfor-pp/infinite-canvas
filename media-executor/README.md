# Infinite Media Executor

部署在 GPU 机器上的单卡媒体能力执行器。H3 与 Music3 的配方、工作流、输入校验和续接计算由执行器维护；它不读取导演项目，只保留可恢复任务和待应用服务器拉取的临时结果。

中立接口为 `GET /v1/capabilities`、`POST /v1/jobs/validate`、`POST /v1/jobs`、`GET/DELETE /v1/jobs/:id` 及结果下载/ACK。请求包含 model、mode、operation、prompt、params、references，可选 continuation={fileId,sha256}；应用私有参数不得发送。H3 返回本次新增 `files`、累计 `cumulativeVideos`、原生 `continuationStates` 和执行快照 `execution`。上传输入是临时文件，任务回收后需要重新上传；应用保存结果后才 ACK。

统一的 `media-generation` Skill 列出服务能力并按需引用模型说明，与实现一起位于 `src/media_executor/skills/`，构建 wheel 时随包发布。应用通过 `MEDIA_CAPABILITY_SKILLS_DIR` 读取同版本 Skill；仓库部署默认读取这一目录，独立部署应用时需复制对应版本的目录并配置路径。协议版本不匹配时预检拒绝提交。完整边界与验收见 [中立媒体能力](../docs/content/docs/development/media-capabilities.mdx)。

```bash
uv sync --extra test
MEDIA_EXECUTOR_TOKEN=change-me MEDIA_EXECUTOR_HOST=0.0.0.0 uv run infinite-media-executor
```

对外仅提供执行器 `8290` 入口。Qwen TTS、MOSS、ASR、VoxCPM2 和 ACE 适配器由执行器按需启动为独立 Python 工作进程，通过数据目录 `workers/*.sock` 私有 Unix Socket 通信，不监听 TCP 端口，也不需要单独安装或启用 systemd 服务。独立 `.venv` 用于隔离依赖；空闲时可保留模型，按显存预算卸载或退出。ComfyUI 与 ACE 官方引擎保留本机接口。`MEDIA_MODEL_ROOT` 使用统一入口 `/data/sas/models`；当前实际启用的模型文件放在 NVMe 的 `/home/cec/.local/share/infinite-media-executor/models`，再由统一入口软链接过去，与现有 ComfyUI 模型方案一致。正式部署使用 `systemd/` 中的 unit，并用防火墙限制 8290 仅允许业务服务器访问。

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
systemctl --user start infinite-media-executor
```

Qwen3-ASR 与 VoxCPM2 使用各自 `runtimes/` 下的 Python 3.12 环境；先执行 `uv sync --frozen`，再验证导入及真实推理。`scripts/download-audio-models.py` 从固定官方 ModelScope revision 下载 ASR 两种尺寸、ForcedAligner、VoxCPM2 和 ZipEnhancer，校验 Git LFS 哈希并保存 `audio-models.json`。CUDA 13 环境的 `nvidia/cu13/lib` 必须加入工作进程的 `LD_LIBRARY_PATH`（执行器启动时自动注入），不能用 CUDA 12 库替代。

ASR 返回 `transcription.json`，区分转写和参考文本对齐；无强制对齐的片段标记 `timestampSource=vad`。完整 JSON 由应用存储，Agent 分页读取。VoxCPM2 普通生成和克隆统一走执行器任务接口。

H3 生态安装器固定 ComfyUI v0.35.0，并关闭尚未纳入本机验收的 Comfy Compiler；把固定 ComfyUI、KJNodes 与 Turbo 节点部署到新的 revision 目录，在独立 8190 端口同时探测 AddGuide、Turbo、Sage Attention 和 `SaveVideo` 后才切换 `/home/cec/ComfyUI-H3-current`。旧 checkout 不删除，可用于回滚。Turbo 权重保存在 SSD 并记录 revision、SHA256 与上游许可入口；只有正式的固定样例视频和原声音频基准通过后，才应将 Turbo 作为默认预览配方。

FLUX.2 Dev 使用 `scripts/install-flux2-dev.sh` 通过 ModelScope SDK 从官方 `Comfy-Org/flux2-dev` 同仓的固定 revision 直接下载 FP8 mixed diffusion、FP8 Mistral 3 Small 文本编码器和 VAE，不保留双份 Git LFS 对象缓存。约 53.8 GB 的实体文件保存在 NVMe 的 `/home/cec/.local/share/comfyui-models`，`/data/sas/ComfyUI/models` 仅放三个稳定软链接；安装器会校验 SHA256，并拒绝覆盖已有真实模型文件。该模型受 FLUX Non-Commercial License v2.1 约束，当前只用于本地内部测试与评估。

执行器使用 NVML 与运行时状态统一串行调度 GPU。空间足够时保留闲置模型；不足时先清缓存，再按最近最少使用顺序卸载，达到预算即停止。未知规格保守腾空间；明确 CUDA OOM 只按原请求和种子重试一次。外部进程计入预算但不停止。按 `systemd/media-executor.env.example` 配置 ComfyUI、ACE 官方引擎的实际 `*_UNITS` 与各模型 `*_REVISION`，不得把包含无关进程的会话 scope 当作受管 unit。释放失败时才终止对应闲置工作进程或受管引擎，下次任务懒启动。

ComfyUI 的 `custom_nodes/` 需链接仓库 `comfy-runtime/` 状态扩展，保持原 H3 工作流节点和续接身份不变。所有应用代理提交与中立任务共用执行权；取消与恢复先核对真实上游任务。诊断记录任务阶段、峰值、驻留和加载次数。应用与执行器必须配套使用协议 2，请求携带 `X-Media-Protocol: 2`，H3 续接版本单独管理。

部署前备份环境、unit 与代码，逐个运行时完成真实推理、结果传输和显存释放验证后，再排空正式队列切换应用和执行器。任一环节失败应恢复整套旧配置与代码；健康检查不能代替推理验收。系统级 unit 仅授权 `systemd/infinite-media-executor-sudoers` 中的明确服务。

安装器只生成和启用 unit，不会在运行时尚未通过 smoke test 时自动启动。执行器监听 `0.0.0.0:8290`，模型工作进程只使用私有 Unix Socket，ComfyUI 与 ACE 官方引擎只监听回环地址；正式跨机器使用时还应由防火墙只放行业务服务器 IP。


当前 v0.15.2 已在本机完成正式切换、应用 ASR/Vox 落库、旧 H3 状态续接及固定输入模型对照，证据与听审边界见 [部署验收](../docs/research/audio-v0152-acceptance.md)。

## IndexTTS 2.5

`indextts-2.5-local` 提供 `speech/clone`，音色参考为 `role: reference`，可选情绪参考为 `role: emotion`；每段音频不超过 15 秒。支持 `language`、`durationFactor`、`intervalSilence`、`emotionVector`、`emotionStrength` 和 `seed`，参数边界见 [使用说明](src/media_executor/skills/media-generation/references/indextts.md)。不内置演示音色、不加载 QwenEmotion、不做后期变速。

运行 `bash scripts/install-indextts.sh` 安装固定代码与 Python 3.11 独立环境；然后用执行器 Python 运行 `scripts/download-indextts.py --ssd-root <SSD目录> --entry-root /data/sas/models`。`models/indextts.json` 固定官方 ModelScope 权重与官方 Hugging Face 辅助模型来源，每个文件校验 SHA-256，已校验文件直接复用。

加载执行器环境、设置 maintenance 并排空已有任务后，运行 `PYTHONPATH=src .venv/bin/python scripts/qualify-indextts.py --reference <参考WAV>`。该脚本核对固定源码与全部权重，使用统一 GPU 调度执行真实工作进程推理，成功记录 `indextts-qualification.json`，退出时停止自己的工作进程。通过后才配置 `INDEX_TTS_ENABLED=1` 与绑定源码、模型和依赖的 `MEDIA_EXECUTOR_INDEX_REVISION`，重启执行器并清除 maintenance；失败保留禁用状态。现有应用与执行器须配套更新以识别 emotion 引用，最后验证应用上传、生成、下载落库与 ACK。没有独立端口或模型 systemd 服务。

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

## Qwen 音色设计与就绪

VoiceDesign 使用 `qwen3-tts-1.7b-voicedesign-local`；正文和 `params.instructions` 必填。CustomVoice 保留固定 speaker，Base 保留参考声音克隆；Base 不接受独立情绪或语速指令。完整参数与协议示例见 [Qwen 音色设计与复用](../docs/content/docs/development/qwen-voice-design.mdx)。

下载仅新增模型：`scripts/download-audio-models.py --model Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign --ssd-root <SSD目录> --entry-root <模型入口>`。固定官方 revision 为 `8dd530dbed7fda907a15ac48d7f78742cc90a065`。

维护时先创建执行器数据目录的 `maintenance` 文件，等待 queued/running 和未完成代理任务排空，再变更运行时。带执行器环境运行 `scripts/qualify-qwen.py --model <模型ID>`；Base 追加 `--reference <WAV> --transcript <准确原文>`。工具核对官方权重、在 GPU 调度下试生成并保存逐模型就绪记录；记录匹配后才 available，不能只凭环境存在判断。保持模型、代码与依赖不变时，进程空闲退出不影响就绪。完成验收或回滚后移除 maintenance 文件恢复接单。
