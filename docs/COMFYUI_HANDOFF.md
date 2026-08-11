# 本地 ComfyUI 接入交接

本文档记录当前机器上已经可用的 ComfyUI、模型和工作流，以及把它们接入 Infinite Canvas 的建议边界。目标是在画布中复用现有图片、视频和音频能力，不再启动第二套 ComfyUI，也不让浏览器绕过共享 GPU 调度并发抢占显存。

## 1. 当前结论

- ComfyUI 已部署并运行在同一台机器的 `8189` 端口。
- 当前已跑通三个模型家族：HiDream-O1 图片、MiniMax H3 音视频、VoxCPM2 TTS。
- H3 和 HiDream 已使用工作流级 SageAttention；VoxCPM2 保持普通推理，未默认启用 `torch.compile`。
- 三个模型共享一张 RTX 5090 32 GB，不能由 Infinite Canvas 自行并发提交。应复用 ArcReel 的队列、显存判断和切模逻辑，或者将该逻辑抽成独立本地网关。
- ComfyUI 当前允许可信局域网访问，但没有鉴权，也没有开启浏览器 CORS。不要直接暴露到公网。

## 2. 部署清单

| 项目 | 当前值 |
|---|---|
| ComfyUI 根目录 | `/home/cec/ComfyUI-H3` |
| ComfyUI commit | `0764232429b8cfb10b79b6f186c8cb23e0b22897`（v0.30.1） |
| Python | 3.12.10 |
| PyTorch | `2.11.0+cu130` |
| GPU | NVIDIA GeForce RTX 5090，约 32 GiB |
| Python 环境 | `/home/cec/ComfyUI-H3/.venv` |
| 模型根目录 | `/data/sas/ComfyUI/models` |
| 输出目录 | `/home/cec/ComfyUI-H3/output` |
| 日志 | `/home/cec/ComfyUI-H3/comfyui-8189.log` |
| 本机 API | `http://127.0.0.1:8189` |
| 可信局域网 API/UI | `http://192.168.3.55:8189` |
| systemd 用户服务 | `arcreel-comfyui-8189.service` |

服务当前是 transient user unit，不是开机永久 unit。运行中可检查：

```bash
systemctl --user status arcreel-comfyui-8189
curl -sS http://127.0.0.1:8189/system_stats
curl -sS http://127.0.0.1:8189/queue
```

若 unit 已停止并被 `--collect` 回收，使用下面的完整命令重建；不要漏掉 CUDA 13 NVRTC 路径，否则 VoxCPM2 会在运行期报 `libnvrtc-builtins.so.13.0` 找不到：

```bash
systemd-run --user \
  --unit=arcreel-comfyui-8189 \
  --collect \
  --working-directory=/home/cec/ComfyUI-H3 \
  --setenv=LD_LIBRARY_PATH=/home/cec/ComfyUI-H3/.venv/lib/python3.12/site-packages/nvidia/cu13/lib:/home/cec/ComfyUI-H3/.venv/lib/python3.12/site-packages/nvidia/cuda_nvrtc/lib \
  --property=StandardOutput=append:/home/cec/ComfyUI-H3/comfyui-8189.log \
  --property=StandardError=append:/home/cec/ComfyUI-H3/comfyui-8189.log \
  /home/cec/ComfyUI-H3/.venv/bin/python main.py \
  --listen 0.0.0.0 \
  --port 8189 \
  --models-directory /data/sas/ComfyUI/models \
  --reserve-vram 2 \
  --disable-auto-launch
```

不要重新加回 `--disable-all-custom-nodes`，否则 VoxCPM2 和 SageAttention 工作流会失效。

## 3. 已安装的关键节点

### KJNodes / SageAttention

- 目录：`/home/cec/ComfyUI-H3/custom_nodes/ComfyUI-KJNodes`
- commit：`6edfa76599c13905968841b81309784a7dbb7803`
- 版本：1.4.9
- SageAttention wheel：`sageattention==2.2.0+cu130torch2.11`
- 当前工作流节点：`PathchSageAttentionKJ`
- 当前 mode：`sageattn_qk_int8_pv_fp16_cuda`
- `allow_compile=false`

节点名中的 `Pathch` 是上游实际注册名，不要在工作流里自行改成 `Patch`。

### VoxCPM2

- 目录：`/home/cec/ComfyUI-H3/custom_nodes/ComfyUI_RH_VoxCPM`
- commit：`1cd7b29fb6596588319fc5ad49cd78f5b5375d76`
- 关键节点：`RunningHub_VoxCPM_LoadModel`、`RunningHub_VoxCPM_Generate`、`SaveAudio`

HiDream-O1 和 MiniMax H3 的主体节点来自当前 ComfyUI core；不要只复制 custom nodes 到旧版 ComfyUI。

可用下面的请求检查节点是否注册：

```bash
curl -sS http://127.0.0.1:8189/object_info/PathchSageAttentionKJ
curl -sS http://127.0.0.1:8189/object_info/MiniMaxH3ImageToVideo
curl -sS http://127.0.0.1:8189/object_info/RunningHub_VoxCPM_Generate
```

## 4. 当前使用的模型

### HiDream-O1 Full FP8

画布模型名建议使用：`hidream-o1-full-fp8-local`

```text
/data/sas/ComfyUI/models/checkpoints/hidream_o1_image_fp8_scaled.safetensors
```

已支持：

- 文生图。
- 图生图/多参考图生成，最多 10 张参考图。
- 当前 ArcReel 产品档固定为 2K、`16:9` 或 `9:16`。

### MiniMax H3

画布模型名建议使用：

- `minimax-h3-fl2va-local`：文生视频、首帧/尾帧图生视频。
- `minimax-h3-ref2va-local`：参考图片、参考视频和参考音频驱动视频。

```text
/data/sas/ComfyUI/models/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors
/data/sas/ComfyUI/models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors
/data/sas/ComfyUI/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
/data/sas/ComfyUI/models/vae/minimax_h3_video_vae_fp16.safetensors
/data/sas/ComfyUI/models/vae/minimax_h3_audio_vae_fp32.safetensors
```

已支持：

- 5–15 秒，24 FPS。
- `480p` 预检档和 768 短边正式档。
- FL2VA：首帧和尾帧；不接受通用参考图片/音频/视频数组。
- Ref2VA：最多 9 张参考图片、3 段参考视频、3 段参考音频。
- 参考视频和参考音频总时长上限均为 15 秒。
- H3 原生同时生成视频与立体声音轨，输出 MP4。

### VoxCPM2

画布模型名建议使用：`voxcpm2-local`

```text
/data/sas/ComfyUI/models/voxcpm/VoxCPM2/model.safetensors
/data/sas/ComfyUI/models/voxcpm/VoxCPM2/audiovae.pth
/data/sas/ComfyUI/models/voxcpm/VoxCPM2/config.json
```

已支持：

- 中文 TTS 和声音设计。
- 通过自然语言 `control_instruction` 控制音色和表达。
- 上传一段参考音频进行可控声音克隆。
- 当前固定 CFG 2.0、10 steps、自动或指定 seed。
- 不启用 ultimate clone、ASR、参考降噪或 LoRA。
- `optimize=false` 是安全默认值；当前 `cudaMallocAsync` 与 Vox 的 `torch.compile(mode="reduce-overhead")` CUDA Graph 路径不兼容。

## 5. 已跑通的工作流

ArcReel 中可复用的真相源：

```text
/home/cec/ArcReel/lib/comfyui_shared.py
/home/cec/ArcReel/lib/image_backends/comfyui.py
/home/cec/ArcReel/lib/video_backends/comfyui.py
/home/cec/ArcReel/lib/audio_backends/comfyui.py
```

### HiDream-O1 文生图/图生图

主要节点链：

```text
CheckpointLoaderSimple
  -> ModelNoiseScale(noise_scale=8)
  -> HiDreamO1PatchSeamSmoothing
  -> PathchSageAttentionKJ
  -> SamplerCustom
  -> VAEDecode
  -> SaveImage
```

默认参数：40 steps、CFG 5.0、`dpmpp_2m_sde_gpu`。存在参考图时，先通过 `/upload/image` 上传，再把 `LoadImage` 接到 `HiDreamO1ReferenceImages`。

### MiniMax H3 FL2VA

主要节点链：

```text
UNETLoader(INT8 ConvRot)
  -> PathchSageAttentionKJ
  -> BasicGuider / BasicScheduler
MiniMaxH3ImageToVideo
  -> SamplerCustomAdvanced
  -> VAEDecode + VAEDecodeAudio
  -> CreateVideo
  -> SaveVideo
```

默认参数：20 steps、`res_multistep` sampler、`simple` scheduler、24 FPS。首尾帧先上传，再接到 `MiniMaxH3ImageToVideo`。

### MiniMax H3 Ref2VA

与 FL2VA 共用采样和解码链，但换成 Ref2VA 权重和 `MiniMaxH3ReferenceToVideo`。图片、视频和音频都先上传；视频通过 `LoadVideo -> GetVideoComponents` 拆出画面与声音后接入节点。

### VoxCPM2 声音设计/克隆

```text
RunningHub_VoxCPM_LoadModel(optimize=false)
  -> RunningHub_VoxCPM_Generate
  -> SaveAudio
```

有参考音频时增加 `LoadAudio`。固定开启 `retry_badcase=true`，默认输出由 ComfyUI `SaveAudio` 决定。

## 6. ComfyUI 原生 HTTP 协议

三个工作流当前都走同一套协议：

1. 本地素材用 `POST /upload/image` 上传，字段为 `image`，`type=input`。该端点也被当前实现用于音频和视频文件。
2. 用 API-format graph 调用 `POST /prompt`：

   ```json
   {
     "prompt": { "节点 ID": { "class_type": "节点类型", "inputs": {} } },
     "client_id": "infinite-canvas-随机标识"
   }
   ```

3. 保存返回的 `prompt_id`。
4. 轮询 `GET /history/{prompt_id}`，不要只依赖 WebSocket。
5. 从 `outputs` 中找到 `filename`、`subfolder`、`type`。
6. 调用 `GET /view?filename=...&subfolder=...&type=output` 下载产物。
7. `GET /queue` 用于检测浏览器手工任务和其他客户端任务。

其他运维端点：

- `GET /system_stats`：包含实际空闲显存。
- `POST /free`，body 为 `{"unload_models": true, "free_memory": true}`：卸载模型并回收显存。

`/free` 只能在 `/queue` 同时没有 running 和 pending 任务时调用。

## 7. GPU 共享调度规则

当前 ArcReel 已实现以下规则，Infinite Canvas 不应复制出第二套互不感知的状态：

- H3、HiDream 和 VoxCPM2 的 ArcReel 任务使用同一把进程内异步锁串行执行。
- 连续同模型任务直接复用驻留模型，不主动清显存。
- 跨模型前读取 `/queue` 和 `/system_stats`。
- 预算：H3 24 GiB、HiDream 24 GiB、VoxCPM2 9 GiB，另加 4 GiB 安全余量。
- 空闲显存够时直接切换，不调用 `/free`。
- 空闲显存不足或统计不可靠时，等待队列空闲后才调用 `/free`。
- OOM 时只清理并重试一次。
- 任务结束后保留模型，不做定时卸载。

这把锁目前只在 ArcReel Python 进程内有效。Infinite Canvas 如果直接从浏览器调用 8189，ArcReel 不知道该任务属于哪个 workload，也不能阻止两边同时提交。推荐把 `ComfyUIClient + ComfyUIResourceCoordinator` 抽到一个本地网关，由两边共同调用；如果暂时不抽模块，至少由 ArcReel 暴露面向画布的媒体接口。

## 8. Infinite Canvas 的接入边界

Infinite Canvas 当前具备图片、视频、音频模型能力和“自定义调用脚本”，前端会直接请求用户配置的 Base URL。相关入口：

```text
web/src/services/api/model-plugin.ts
web/src/services/api/image.ts
web/src/services/api/video.ts
web/src/services/api/audio.ts
web/src/stores/use-config-store.ts
```

自定义脚本可以使用 `request`、`poll`、`Blob`、`FormData` 和 `fetch`，技术上足以直接实现 ComfyUI `/upload/image -> /prompt -> /history -> /view`。但当前不建议直接这样上线，原因有两个：

1. ComfyUI 启动时没有 `--enable-cors-header`；带 `Origin: http://192.168.3.55:3000` 的请求当前返回 403。
2. 浏览器直连会绕过 ArcReel 的 GPU 协调器，可能在切模或手工任务期间错误调用 `/free`，也无法可靠串行多个模型。

### 推荐架构

```text
Infinite Canvas
  -> 本机同源 ComfyUI adapter（媒体级 API）
       -> 共享 GPU coordinator
            -> ComfyUI :8189
```

adapter 最少应提供：

- 图片：文生图、多参考图生图。
- 视频：FL2VA 首尾帧、Ref2VA 多模态参考。
- 音频：VoxCPM2 声音设计和单参考音频克隆。
- 统一任务状态：`queued/running/succeeded/failed`。
- 返回浏览器能持久化的 Blob 或同源下载 URL。
- 取消时停止前端等待；只有确认该 prompt 可中断时才操作 ComfyUI 队列。

画布端可以继续复用现有 custom script 返回约定：

- 图片返回 URL/data URL 数组。
- 视频返回 `{ url }` 或 `{ blob }`。
- 音频返回 `Blob`、URL、data URL 或 base64。

### 仅开发态直连备选

如果只是短期验证画布交互，可以维护重启 ComfyUI，并把启动命令增加精确源站：

```text
--enable-cors-header http://192.168.3.55:3000
```

不要使用无范围的 `--enable-cors-header`，因为该形式等价于允许 `*`。即使开启 CORS，画布脚本也只能提交和轮询任务，不应调用 `/free`；跨产品显存协调仍未解决。

## 9. 建议实施顺序

1. 先在 Infinite Canvas 中新增一个本地 ComfyUI channel/provider，模型 ID 使用本文档列出的四个名称。
2. 先接 HiDream 文生图，验证 prompt、Blob 下载和画布节点落图。
3. 接 HiDream 多参考图，验证浏览器上传到 adapter 后的文件生命周期。
4. 接 H3 FL2VA 的首帧图生视频，再接 Ref2VA 的多模态参考。
5. 接 VoxCPM2 声音设计和参考音频克隆。
6. 最后把三个能力统一纳入共享 GPU coordinator，并覆盖跨模型、手工 ComfyUI 队列和 OOM 重试测试。

## 10. 已知限制

- 8189 当前无鉴权，只适用于可信局域网。
- ComfyUI 队列只能反映已经提交的任务，不能替代 ArcReel workload 级别的互斥。
- 当前协调锁不是跨进程锁；若 adapter 单独部署，需要把协调器迁到共同进程，或升级成跨进程租约。
- H3 的 480p/768p、时长和参考数量限制应在提交工作流前校验，避免让 ComfyUI 运行很久后才失败。
- VoxCPM2 的 `speed` 参数当前没有独立实现；画布音频面板中的 speed 对该模型应隐藏或明确标为不支持。
- H3 和 HiDream 的 SageAttention 是现有质量基线；不要把 TE-Speed、Spectrum、降 steps 等近似加速和基础接入同时上线。
- `/home/cec/ComfyUI-TTS` 不属于当前链路，不启动、不依赖，也不要擅自删除。

## 11. 最小验收

- 打开画布，从文本节点生成一张 HiDream 16:9 图片。
- 用画布中的一张图片作为参考，再生成一张 HiDream 图片。
- 用该图片作为 H3 首帧生成 5 秒 480p 视频，确认 MP4 同时包含视频和 AAC 音轨。
- 用 VoxCPM2 生成中文声音设计音频，并把结果作为音频节点插回画布。
- 连续执行 HiDream -> H3 -> Vox -> H3，检查没有并发任务、误清显存或第二个 ComfyUI 进程。
- 生成期间从 `http://192.168.3.55:8189` 手工提交任务，确认 adapter 能观察 `/queue`，且不会在队列忙时调用 `/free`。
