# 远景人脸与最终 4K：社区后期组合调查

本次找到四条有公开源码或工作流的线索。最完整的实际做法是：**生成阶段用可读的人脸构图和明确身份参考稳住底片 → 按人物、镜头处理局部脸 → 验收后整体超分 → 最后补帧**。本次材料没有证明“几十像素、已经失去身份的小脸，能通过后期可靠恢复成指定角色的真实 4K 细节”。公开成功展示往往是本来就清楚的大脸；修后漂亮、结构正常与身份保真需要分开判断。

本轮只读取公开材料和本地既有记录；下载的是小型源码、JSON、作者公开短示例与 GIF，没有下载模型、运行 GPU、安装依赖或改服务。以下参数以保存的工作流/源码为准，不把教程标题中的“fast”“4step”当作实际推理参数。

## 1. amao2001 / Veteran AI：H3 局部重绘后，VOSR2 以 1 倍修脸，再贴回

西川和久在自己的实际使用文章中披露了这条组合，并指向作者公开的慢动作与快动作两份工作流。[亲自使用的报道](https://www.techno-edge.net/article/2026/09/20/5510.html)、[作者视频](https://www.youtube.com/watch?v=9XWjmx3bVjE)、[固定版工作流目录](https://github.com/amao2001/ganloss-latent-space/tree/df4dc8fdefcb46f31fa6c3b8e03641c4520fad97/workflow/2026-09-11%20face%20refine)。

已下载两份 JSON，仓库固定为 `df4dc8fdefcb46f31fa6c3b8e03641c4520fad97`。文件名日期是 `2026-08-31`，目录日期是 `2026-09-11`。共同的真实配置如下：

| 环节 | 工作流实际值 |
|---|---|
| 生成/重绘模型 | `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors` |
| LoRA | `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`，强度 1；采样实际为 8 步 |
| 脸跟踪 | `face_yolov8n.pt`，confidence 0.35，crop_factor 2.5，manual 768×768，中心/尺寸 Gaussian 平滑 21/51 |
| 脸重绘 | Euler + Beta，8 步，BasicScheduler denoise 0.4；另外有 per-frame mask：small 1 / large 0.35，阈值 30/120px，平滑 9 帧 |
| 声音 | 原始 audio 经 NativeAudioLock，并在保存节点复用原音轨 |
| 局部 VOSR2 | `upscale=1`，wavelet，DiT tile 512 / overlap 32，VAE tile 1024 / overlap 32 |
| 贴回 | face_only，dilation 24，feather 24，colour_match 1，blend 1，缺检 fade_out |

慢动作文件的底片由 `MiniMaxH3ImageToVideo.first_frame` 锚定；快动作文件底片由 Ref2VA 生成。两者脸修复阶段均把同一张输入图接到 Ref2VA 的身份参考，而不是仅给 detector。详情见本地 `amao-slow.json` / `amao-fast.json`。

**实看证据。** 从快动作 JSON 的公开 preview URL 取得 node135 原片和 node192 修后片：均为 **1152×640、124 帧、24fps**，完整 CPU 解码无错；抽看 0/24/48/72/96/123 帧，保留左右对照。内容实际是大头/上半身轻转头，原脸已经清楚；修后局部略平滑，不能据此证明极小脸、遮挡或快速侧转会成功。未取得作者输入身份图的真值对照，也没有用这两段成片隔离 VOSR 的增益。来源是 JSON 自带公开成片，不是本机运行结果。

**成本与风险。** [VOSR 官方](https://github.com/cswry/VOSR) 是图像超分，2.0 为 one-step 1.4B；[作者链接的 Comfy 包](https://github.com/ylchen333/ComfyUI-VOSR2/tree/6a21810b3f4f1a0ffc477c55330db0ac03c671f0) 声明三组件约 7GB，VAE 使用 fp32，IMAGE batch 第 i 张使用 `seed+i`。它没有时序缓存或跨帧身份约束，因此 1 倍也可能产生闪烁与新皮肤细节。此轮未测 5090 显存、速度。源码 Apache-2.0 不代表所有外部权重同许可，采用前仍须核对固定权重条款。

**最小试验，优先级 P1。** 复用已经生成的同一段 49 帧脸 crop，固定种子，只比较“当前 H3 修脸输出直接贴回”与“同一输出经 VOSR2 1x 后贴回”；保留相同掩码、颜色匹配和底片。先在原生大小及 192px 统一窗口看眼口/鼻轮廓是否改变，再看整段闪烁；通过后才接现有 FlashVSR/RIFE。相对已测 H3/Singularity/KEEP/VACE/LTX，真正新增变量是 **局部图像先验补细节**，不是一个新的身份保证。

## 2. FlipPix：生成时限制远景、关键帧锁定，每个角色单独修，再 FILM×2 + RTX×2

这是一套公开应用代码，组合和限制同时写在源码里。固定版本 `ca016afa54ae4de4440b866dc4ea8fbf3dceacef`，默认分支叫 `flippix-prompt-image`，不是 main。[公开图](https://github.com/bongobongo2020/flippix/blob/ca016afa54ae4de4440b866dc4ea8fbf3dceacef/workflow/video/h3-minimax/h3-cast-hybrid.json)、[实际组图代码](https://github.com/bongobongo2020/flippix/blob/ca016afa54ae4de4440b866dc4ea8fbf3dceacef/FlipPix.UI/ViewModels/Video/H3CastHybridViewModel.cs)。

底片为 `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8` + FL2V Turbo8 v1.0 LoRA；图中启用了半宽半高 draft 4 步、H3 3D latent upscaler 2x、`0.9035,0.6316,0.3158,0` 三步 finish。关键帧与身份图分开：前者在指定时刻锁画面，后者只供角色参考。代码默认每人使用正面全身 + 面部近照两个 panel，修脸时只接该角色参考，并另接 `identity_reference` 选跟踪对象；第二个人的结果叠在第一个人的修复上。

公开脸图配置为 crop 2.5、auto_capped_768、平滑 15/41、8 步 denoise 0.45；默认 SAM 人脸掩码 temporal_smooth=9，贴回 feather 从矩形 24 降到 6。作者同时在代码提示：快动作时 denoise 0.30–0.35 更稳；FILM 会把快速转头/甩镜的中间脸拉糊，应先关掉定位问题。末端是 `film_net_fp16` multiplier 2 → RTX Super Resolution scale 2、quality ULTRA、deblur MEDIUM → 48fps，**这不是 60fps**。

**为什么值得看。** 作者直接约束镜头不得超远、航拍，不把远景和大幅相机运动叠加；每个人的脸须可读。它将生成构图、跟踪身份选择、网络身份条件、贴回边界和补帧分开处理。代码可复核，但本轮没有取得这套组合的公开原片/成片成对视觉验收，不能称为已证实优于本机链路。

**成本与最小试验，P1。** 不安装整个桌面应用；在现有 H3 路径先只试“同角色已确认的正面+相符侧脸参考，固定合格首帧”，再试 SAM 贴回对照，避免同时换 checkpoint、LoRA 和补帧器。SAM 需额外权重/依赖；hybrid 是否本机现有以实时能力与权重清单为准，本轮未启动。整批 float32 RGB 的 124 帧 4K 单份约 **11.5GiB RAM**，60fps 后约 **28.7GiB/份**，还没算副本和模型；整批修脸→超分→插帧不可只按显存判断容量。这是按像素计算的内存下界，不是峰值实测。

## 3. T8：可复现的 512px 相对去噪、多角色分镜/掩码，不承诺模糊源恢复身份

固定源码 `c1d5726ea09ca26ef0d7604f575bca1377d8bec1`，同时取到推荐 parity JSON。[文档](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/c1d5726ea09ca26ef0d7604f575bca1377d8bec1/docs/README_ComfyUI.md)、[可下载的单人工作流](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/c1d5726ea09ca26ef0d7604f575bca1377d8bec1/examples/workflows/06-face-refine/2026-08-09_H3_Face_Refine_Parity_Advanced_EXP.json)。

当前 JSON 实际是 **manual512、crop2.5、21/51 平滑、relative_to_clip 0.8/0.35、锁原音、face-only 24/24，er_sde + simple + 8 步 denoise0.45、seed42**；模型为 Ref2VA pruned INT8、Qwen3VL NVFP4、Turbo4 alpha8-T8-convert LoRA 0.75、两张身份参考。文档中的旧固定样本曾用 4 步，不能把旧成绩当成当前 8 步图的速度。

作者提供过 89 帧 320×320 固定样本 112.48 秒、15823/16380MiB 整卡峰值、音轨哈希相同的记录，并明确限定为该样本的人类非劣接受。后续 SAM3.1 多人路径按镜头、人物串行，推荐 73 帧 legal window，可目标脸高 300px/512 crop；作者也披露模糊源提升有限，清楚侧脸结构损坏的样本才获一次用户接受。**这些是作者记录，本轮未下载其成片复核，也不是我们 5090 的性能。**

**差异、成本、最小试验，P2。** 与本机已有 H3FaceRefine 768/absolute_px 相比，先试 512 + relative_to_clip、两张可信身份图；SAM3.1 多人物流程不是当前单人雪景的必要前置。选原始合法 56/73 帧，不先改时间网格。把 source-face 像素、修复后头向/五官、缺检/背脸段和原音轨校验一起保存。SFace/InsightFace 选择人物不等于神经网络保证长相；300px crop 脸只是放大后的画布占比。T8 作者自己明确不宣称从缺失纹理恢复真实身份。

## 4. dagthomas MouthGuard：说话镜头的身份重绘必须保护嘴和声音

公开工作流是 whole-frame V2V 身份重绘：先 2x，MediaPipe lips mask 保护嘴，再对 Ref2VA 重新采样，直接复制原 AV latent 音频；还附有关闭 guard 的 A/B 与原嘴像素贴回支路。[作者说明](https://github.com/dagthomas/comfyui_dagthomas/blob/master/H3_NODES.md)、[原始 JSON](https://github.com/dagthomas/comfyui_dagthomas/blob/master/examples/h3/h3_face_refine_mouthguard.json)。本地已保存该次下载及 SHA，尚未固定仓库 commit，执行前要再 pin。

已读 JSON：Ref2VA pruned INT8、SigmaShift12/3、Euler/simple 20 步 denoise0.4、seed77、2x Lanczos；`H3MouthGuard` 参数为 grow8、protect_audio=true、temporal_dilation1、feather0.5、merge。作者要求正常 RandomNoise，不能用已经加噪的 latent 当受保护原始嘴。口罩落到约 32 源像素的粗粒度，超小侧脸 MediaPipe 可能根本检不出；2x 重绘也明显比 ROI 贵。无本机或独立视觉优胜证据。

**最小试验，P3。** 只在现有警告台词说话样本做同种子 guard 开/关，核对口型帧、音频 PCM 和原嘴边界；不在静音雪景先跑。只锁音频不能锁住嘴部表演，单纯最后 remux 也不能补救重绘过的口型。这是当前链路的保护措施，不是极小脸纹理恢复模型。

## 排除一个伪“新候选”，以及真实失败边界

当前 H3 FaceRefine 最新 1.1.2 的 commit 仍是 `d8521d14fe0d721d80cd9417fff5a559cbc21aba`，和本机已测 `community/source.json` 完全相同。它已修复转身/遮挡时错误接到邻近脸的问题：失踪报告与 fade_out 保留原像素。**更新同一版本不会带来额外质量收益。** identity_reference 用来挑跟踪人物，必须另外接 H3 conditioning 才有模型身份引导。[作者源码](https://github.com/Carasibana/ComfyUI-H3-FaceRefine/tree/d8521d14fe0d721d80cd9417fff5a559cbc21aba)。

独立用户 Shingosa 的 [真实试用](https://note.com/wise_fairy2094/n/nd66806546ce0) 同时公布成功与失败：544×960 全身舞蹈示例可改善，极小脸另一例收益有限，向上出场会发生贴回上下漂动；约 3 分钟的修复没有披露硬件。本轮下载三段原 GIF 和一张 1920px 原/修对照，逐文件取 6 张检查。能看到眼口/皮肤更规整，也可见嘴部轮廓变化；没有角色真值，不把它记为身份保真。GIF 经作者减帧、缩放，不能当完整原速时序质量证据。

## 建议下一轮顺序与判定

1. **同一旧片先做 VOSR2 1x 局部补细节消融**；H3 原有修脸不同时换模型。将“结构正常”“更清楚”“参考身份相符”分开打分，分正面、侧面、背转、遮挡段记录。
2. **生成端做首帧/侧脸参考/适当景别的单变量试验**。参考须来自确认的同一角色；把新生成侧脸当真值会循环自证。用于低像素脸的目标不是写更多精美容词，而是让源图有可识别五官。
3. **边界优先保守**：检测失踪、遮挡和背脸不硬重建；不跨切镜平滑。掩码必须保住围巾、头发、手与雪等遮挡前景，逐帧比较原底片；SAM 是否真的做到要看输出，不能只看节点存在。
4. **保真通过后再接已测 FlashVSR → RIFE**。先保留原生 24fps，再单独检查新增中间帧；极快转头允许保留原帧率。FILM/RTX 的社区组合不是必须替换现有已测链路的理由。全局超分不能修复身份选错，补帧不能重建丢失五官。

没有变更产品功能或待办，本轮是 `.tmp/` 研究材料，因此无需修改 CHANGELOG、todo 或 pending-test。

## 可核查的本地证据

- `postproduction-evidence/fetch-*-manifest.json`：公开 URL、文件大小和 SHA256；`vosr-wrapper-manifest.json` 固定 wrapper revision。
- `amao-fast-comparison-contact.jpg`、`amao-preview-probe.json`：作者原片/成片的 6 个时间点、完整解码与原始 ffprobe。
- `shingosa-*.contact.jpg`、`shingosa-still.png`、`media-inspection.json`：真实公开对照与 GIF 帧数/时长，明确仅抽帧观察。
- 所有新建议仍待受调度 GPU 小样验证；本报告不将他人固定样本计时、源码可执行或压缩后截图作为本机身份/时序验收。
