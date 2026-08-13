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
./scripts/install-comfyui-h3-dropin.sh
```

ACE XL 推理前必须排空其他常驻 GPU 服务。用 `scripts/configure-gpu-drain.sh` 配置本机 unit 列表；执行器会先确认 ComfyUI 队列为空，再暂停这些服务，音乐任务结束后卸载 ACE 并恢复原先处于 active 的服务。若包含系统级 unit，按 `systemd/infinite-media-executor-sudoers` 为执行器账号配置最小化 `systemctl` 权限。

安装器只生成和启用 unit，不会在运行时尚未通过 smoke test 时自动启动。执行器监听 `0.0.0.0:8290`，子运行时始终只监听回环地址；正式跨机器使用时还应由防火墙只放行业务服务器 IP。
