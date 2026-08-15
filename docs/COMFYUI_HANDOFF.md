# 本地 ComfyUI 接入交接

本文档记录当前机器上已经可用的 ComfyUI、模型和工作流，以及把它们接入 Infinite Canvas 的建议边界。目标是在画布中复用现有图片、视频和音频能力，不再启动第二套 ComfyUI，也不让浏览器绕过共享 GPU 调度并发抢占显存。

## 1. 当前结论

- ComfyUI 已部署并运行在同一台机器的 `8189` 端口。
- 当前图片能力由 Qwen Image 2512、Qwen Image Edit 2511、Z-Image Turbo、RealESRGAN 和 HiDream-O1 组成；MiniMax H3 与 VoxCPM2 继续提供视频和音频能力。
- H3 和 HiDream 已使用工作流级 SageAttention；VoxCPM2 保持普通推理，未默认启用 `torch.compile`。
- 所有模型共享一张 RTX 5090 32 GB。Infinite Canvas 对同一 ComfyUI 节点只运行一个任务，批量和四视图任务进入持久队列，避免显存争抢。
- `./dev.sh` 会把 ComfyUI 仅绑定到 `127.0.0.1`，由 Infinite Canvas 后端调用；浏览器和公网都不应直接访问它。

## 2. 部署清单

| 项目 | 当前值 |
|---|---|
| ComfyUI 稳定入口 | `/home/cec/ComfyUI-H3-current` |
| ComfyUI checkout | `/home/cec/.local/share/infinite-media-executor/h3-runtimes/ComfyUI-7fe8a6138504f90ff7be82f3babf416da32876b1` |
| ComfyUI commit | `7fe8a6138504f90ff7be82f3babf416da32876b1`（v0.33.0） |
| Python | 3.12.10 |
| PyTorch | `2.11.0+cu130` |
| GPU | NVIDIA GeForce RTX 5090，约 32 GiB |
| Python 环境 | `/home/cec/ComfyUI-H3-current/.venv` |
| 模型根目录 | `/data/sas/ComfyUI/models` |
| 输出目录 | `/home/cec/ComfyUI-H3-current/output` |
| 日志 | `journalctl -u comfyui-h3.service` |
| 本机 API | `http://127.0.0.1:8189` |
| 浏览器访问 | 禁止，由 Express 后端代理任务 |
| systemd 系统服务 | `comfyui-h3.service` |

服务当前是开机启用的正式 system unit。运行中可检查：

```bash
systemctl status comfyui-h3.service
curl -sS http://127.0.0.1:8189/system_stats
curl -sS http://127.0.0.1:8189/queue
```

部署或修复服务配置时运行仓库安装器；不要漏掉 CUDA 13 NVRTC 路径，否则 VoxCPM2 会在运行期报 `libnvrtc-builtins.so.13.0` 找不到：

```bash
media-executor/scripts/install-comfyui-h3-dropin.sh
```

不要重新加回 `--disable-all-custom-nodes`，否则 VoxCPM2 和 SageAttention 工作流会失效。

## 3. 已安装的关键节点

### KJNodes / SageAttention

- 目录：`/home/cec/ComfyUI-H3-current/custom_nodes/ComfyUI-KJNodes`
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

### v0.16 图片工作流

固定模型 ID 与用途如下；蓝图只用于核对节点，运行时图由 `server/src/comfy-workflows.ts` 构建：

| 模型 ID | 用途 | 基线参数 |
|---|---|---|
| `qwen-image-2512-local` | 高质量文生图 | Lightning 4/8 步；高质量无 Lightning 40 步 |
| `z-image-turbo-local` | 快速文生图 | 8 步、低 CFG |
| `qwen-image-edit-2511-local` | 通用编辑、参考图编辑、多角度 | BF16、20 步；高质量 40 步；最多 3 张参考图 |
| `qwen-image-inpaint-local` | 蒙版局部编辑 | InstantX Inpaint ControlNet；默认扩张 12px、羽化 6px |
| `realesrgan-x4-local` | 忠实 AI 超分 | RealESRGAN x4 后精确缩放到目标尺寸 |
| `z-image-upscale-local` | 生成式细节增强 | RealESRGAN 预放大、约 2MP 重绘、默认 denoise 0.20 |

Inpaint ControlNet 安装位置：

```text
/data/sas/ComfyUI/models/controlnet/Qwen-Image-InstantX-ControlNet-Inpainting.safetensors
SHA-256 49c01aafe6545c1f6e7627a724c8fb13357fe74efee235622158f0a8f30e5458
```

该文件来自 ModelScope `Comfy-Org/Qwen-Image-InstantX-ControlNets` 同名仓库，大小和 SHA-256 已与 InstantX 官方 Hugging Face 文件核对一致。

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

导演台现在把 H3 能力分为“快速预览”和“最终成片”。FL2VA 预览在执行器探测到 Larry Turbo 节点与固定权重后使用 480p/8 步配方；探测失败则明确回到 480p 基础配方。最终成片固定使用 768p/20 步基础模型。Ref2VA 的预览与成片都不使用未经实机门禁的 Turbo，分别采用 `ref_image_size=match/max`。

整张故事板的全部画格会被裁成派生媒体，每段最多选择四个 `MiniMaxH3AddGuide` 时间锚点。服务端按 24 FPS 将时间换算到 `17k+5` 合法帧网格，生成后裁回计划时长；`continue` 边界使用上一段实际成片最后 22 个有效帧及对应原声作为 frame 0 引导。普通用户和导演 Agent 只看到质量档、锚点与续接语义，不看到节点、采样器或权重路径。

升级与回滚入口：

```bash
media-executor/scripts/audit-h3-ecosystem.sh
media-executor/scripts/install-h3-ecosystem.sh
media-executor/scripts/install-comfyui-h3-dropin.sh
```

安装器固定 ComfyUI、KJNodes、Turbo custom node 和 LoRA revision，在隔离端口完成 AddGuide、Turbo、Sage Attention 与 `SaveVideo` 节点探测后才切换 `/home/cec/ComfyUI-H3-current`。当前实机 smoke test 已用四个时间锚点生成 8 秒、864×480、24 FPS 的 H.264/AAC 预览，并成功提取 32 kHz 立体声模型原声；生产批准前仍须用固定十场景样例比较基线、预览、成片与 Sage 模式。

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

v0.17.0 开发版把四个本地模型接入与公网供应商共用的 Express 持久任务系统。浏览器只提交同源生成任务，不再接收或访问 ComfyUI 地址。相关入口：

```text
server/src/comfy-workflows.ts
server/src/generation-service.ts
server/src/file-store.ts
web/src/services/api/ai-generation.ts
```

后端负责 `/upload/image -> /prompt -> /history -> /view` 全链路，并把 `prompt_id`、任务状态和结果文件写入 SQLite。这样解决了浏览器跨域和页面关闭中断的问题，但共享 GPU 的跨产品协调仍需后续统一。

### 推荐架构

```text
Browser
  -> Express /api（身份、任务、文件）
       -> 固定工作流与持久任务
            -> ComfyUI 127.0.0.1:8189
```

当前后端已提供：

- 图片：文生图、多参考图生图。
- 视频：FL2VA 首尾帧、Ref2VA 多模态参考。
- 音频：VoxCPM2 声音设计和单参考音频克隆。
- 统一任务状态：`queued/running/succeeded/failed`。
- 返回浏览器能持久化的 Blob 或同源下载 URL。
- 取消时停止前端等待；只有确认该 prompt 可中断时才操作 ComfyUI 队列。

前端统一使用 `providerId::modelId` 模型标识和同一生成客户端；ComfyUI 由正式 `comfyui` adapter type 路由，不再存在脚本哨兵或用户 JavaScript。

### 不再使用浏览器直连

`./dev.sh` 会把 ComfyUI 绑定到回环地址且不启用 CORS。不要重新加入浏览器直连脚本或把 8189 暴露到局域网/公网。

## 9. 后续验收顺序

1. 人工验证六个图片固定工作流、画布比例和参考素材上限。
2. 验证关闭页面、断线重连、取消和服务重启恢复。
3. 后续把 Infinite Canvas 与 ArcReel 统一接入共享 GPU coordinator，并覆盖跨模型、手工 ComfyUI 队列和 OOM 重试测试。

## 10. 已知限制

- 8189 当前无鉴权，因此只允许绑定回环地址并由后端访问。
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
- 分别执行 Qwen 2512 与 Z-Image 文生图、Qwen Edit 单图与三参考图编辑、严格/自然局部编辑、两种 AI 超分和一键四视图。
- 严格局部编辑需要逐像素检查羽化范围外与原图一致；1K/2K/4K 超分需要检查输出尺寸与界面预览值完全一致。
- 关闭浏览器等待任务完成后重新打开，确认任务和结果可从后端恢复，且浏览器响应中没有 8189 地址。
