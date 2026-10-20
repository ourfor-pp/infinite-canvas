# H3 高清视频与高帧率制作链调研

公开工作流已经证明：H3 低分辨率生成后，通过视频超分和补帧得到高清、高帧率成片是一条实际使用的路线。另有两条不同路线：官方结合原始上下文再生成 2K，以及社区在 H3 采样过程中放大潜变量并继续高分采样。人物身份与跨段连续性则主要依赖参考素材和生成状态，不能交给超分或补帧补救。

本轮由三位 subagent 分别调查案例、超分、补帧与身份保持，并核对当前仓库及公开演示文件。以下区分作者报告、源码核查和本地观察；最初调研阶段未安装模型、提交生成或调用付费 API。后续本机生成、超分与补帧结果单独记在[本机对照](./h3-video-quality-local-evaluation.md)。没有用户所见作品的链接，因此不推断那些作品具体采用了哪套流程。

## 已公开的制作案例

| 来源 | 实际公开的链路 | 对本项目的意义 |
| --- | --- | --- |
| [FlashVSR+ 作者演示](https://www.flashvsr.tech/) | MiniMax H3 1344×768 → FlashVSR+ 3840×2160；提供原片和超分结果 | 最直接对应 H3 到 4K 的增强路线；该演示不能单独证明高帧率或长片人物一致性。 |
| [dawidope 的对照仓库](https://github.com/dawidope/minimax-h3-upscale)及[交互对比](https://dawidope.github.io/minimax-h3-upscale/) | 10 秒 H3 INT8 Turbo 原片，1344×768、24fps；分别使用 RealESRGAN、FlashVSR，再用 RIFE 4.26 得到 48fps | 有脚本、多变体和拖动对比，适合复核处理顺序。结果对齐到 2048×1172，服务还有输入尺寸限制，不能称为原生 4K。服务名 RealESRGAN_Vid 的行为也不能直接推广到普通 Real-ESRGAN。 |
| [TimelineDirector 作者仓库](https://github.com/Songssx/ComfyUI-MiniMaxH3-TimelineDirector) | SelfLift 低高分阶段，例如八步中的六步低分、学习式 latent 放大、两步高分；跨段传递低分 latent 尾和高分上下文，另有漂移控制 | 清晰度和连续性可以在生成流程内改善。作者的长片例子仍为 24fps，不能把顺滑观感都归因于补帧。 |
| [双阶段 1080p 作者说明](https://www.reddit.com/r/comfyui/comments/1vqtkpm/minimax_h3_native_1080p_video_generation/)与[配套节点](https://github.com/wjc573/ComfyUI-H3LatentUpscale-jingchen573) | 先完成部分低分采样，仅放大视频 latent，再沿剩余 sigma 在高分继续采样 | 早期节点使用几何插值，并非训练出的超分网络；作者所称 4090 为 48GB 配置，不能当作普通 24GB 卡基准。该仓库许可尚不明确，不直接复制入产品。 |

TimelineDirector 的[发布帖](https://www.reddit.com/r/comfyui/comments/1wio4eg/i_opensourced_my_comfyui_workflow_for_minimax_h3/)称使用 24 张参考图、一段音乐、四段共约 29 秒视频，5090 约十分钟；帖子尺寸为 1536×960，当前 README 的另一组基准为 1536×832。这些是不同作者记录，不拼成同一个复现结果。24 张参考图属于整条时间线的素材库存，并非一次突破 H3 的单段参考预算。

### 官方演示文件核对

在独立浏览器页面读取媒体元数据，并使用独立暂停的 video 元素分别定位到同一时间 2.5 秒与 4.5 秒，避免演示页自动播放造成错帧比较：

| 文件 | 浏览器读取尺寸 | 时长 |
| --- | --- | --- |
| [H3 原片](https://www.flashvsr.tech/projects/flashvsr-plus/video_demo/minimax_demo_lr.mp4) | 1344×768 | 5.166667 秒 |
| [FlashVSR+ 结果](https://www.flashvsr.tech/projects/flashvsr-plus/video_demo/minimax_demo_sr.mp4) | 3840×2160 | 5.167 秒 |

同时间截图可观察到衣料、头发和背景边缘的清晰度变化；2.5 秒时面部被擦拭布遮挡，4.5 秒时面部可见，但单帧仍不足以验收全段身份保真。两文件比例略有差别，具体裁切或缩放策略还需核对。截图保存在 `.tmp/h3-4k-research/flashvsr-official-h3-comparison.jpeg` 与 `flashvsr-official-h3-face.jpeg`。这属于外部演示的元数据与抽帧检查，没有完成整段动态、声音及本机推理验收。

## 官方 2K 与本地高清采样

H3 官方系统分为 Context-IR、Base 和 Regenerate-2K：Base 默认 768p、24fps；2K 环节把低分视频和原始上下文一起送回模型生成细节。Context-IR 和 Regenerate-2K 未包含在当前开源发布中。[官方系统说明](https://github.com/MiniMax-AI/MiniMax-H3#h3-regenerate-2k)

官方公开了“Context-IR API → 本地 Base → Regenerate-2K API”的混合流程。[官方脚本](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/scripts/readme/full-2k-t2va-h3-regenerate-2k.sh)确实把本地 MP4 编码为 data URL，连同展开后的提示以 `base_video` 角色提交。因此不能笼统说官方 2K 不接受本地产物。

[再生成文档](https://platform.minimax.cn/docs/api-reference/video-generation-v2-regeneration)限定符合 H3 768P 输出规格的视频，支持源任务 ID 或 `base_video`。源任务 ID 分支标注白名单、同账号成功任务和七日内限制；这不足以推断 `base_video` 分支对当前账号的开放情况。正式使用前需核实账号权限和收费，不能把它当通用视频放大接口。

已展开官方文档的“按源视频再生成”分支核对：`content` 必须原样保留实际提交给 768P 模型的最终提示和全部图、视频、音频输入，不能用 Context-IR 展开前的原稿替代。`base_video` 必须含音轨、24fps、宽高各能被 32 整除、面积在 589824–1032192 像素之间；总帧数在 107–362 之间并按 17 帧递增，恰好一个 `base_video`，目标仅支持 2K。请求不超过 64MB，大文件使用 URL。公开请求未要求 seed、noise 或原生 latent，但不能丢失最终提示与原参考。480p、改成 48fps 或长片拼接均不满足这些公开规格；不应先简单缩放、改帧数再声称等效支持。

纯本地候选是 [LBH 的 H3 学习式 latent upscaler](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler)：低分 latent → 专用 2D/3D 放大网络 → 高分继续采样 → VAE 解码。它保留 H3 的潜空间结构，避免像素解码、放大、重新编码的往返。作者明确指出常规高分精修主要省时间，不保证节省峰值显存；另有时间和空间切块方案，但接缝、运动及身份仍须实测。它也不是官方 Regenerate-2K 的完整本地复现。

## 本地超分候选

| 方案 | 可用基础 | 需要验证的问题 |
| --- | --- | --- |
| FlashVSR+ Turbo / Base | [官方代码与模型入口](https://github.com/OpenImagingLab/FlashVSR_Plus)，单步视频超分；作者报告 4090 24GB 可不做空间切块输出 4K | 优先比较两种变体；5090 attention 后端、峰值显存、清晰度和运动纹理尚无本机结果。 |
| SeedVR2 3B / 7B | [字节官方模型](https://github.com/ByteDance-Seed/SeedVR)；[NumZ / AInVFX 的 Comfy 集成](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler)提供视频工作流、BlockSwap、VAE tiling 和多种精度 | 先用 3B 建质量对照，再决定 7B 的额外成本。多帧联合处理与批次重叠很重要，不能改成独立逐帧运行后仍声称使用完整时序能力。 |
| Real-ESRGAN | [作者代码](https://github.com/xinntao/Real-ESRGAN)，较轻，支持切块与视频脚本 | 作为增强基线；普通逐帧网络不具有视频模型的联合时序约束，需观察闪烁。 |
| Topaz Video | [官方产品](https://www.topazlabs.com/topaz-video)提供视频增强、人脸相关模型和插帧 | 可作商业后期对照；没有具体作者证据时，不认定网上作品用了 Topaz。 |

SeedVR2 作者特别提醒：轻度退化的 720p AIGC 视频可能被过度生成细节和锐化，严重退化、大运动也有失败情况。由此不宜把“故意先降到很低画质再拉 4K”定为质量路线。低分预览适合选动作、种子和构图，最终要比较原生 768p 后处理与低分双阶段精修。[作者限制说明](https://github.com/ByteDance-Seed/SeedVR#-notice)

SeedVR2 Comfy 节点要求批次为 `4n+1`；视频时序处理通常至少五帧，并可设置批次重叠。实际显存取决于分辨率、模型、精度和帧数，32GB 不等于任意 4K 批次均可运行。[节点参数与工作流](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler#-usage)

FlashVSR+ 官方 CLI 要求宽高为 128 的倍数，默认会中心裁切和缩放，并保留输入帧率及现有音轨。其 3840×2176 示例不能直接作为标准 UHD 输出，应显式设计保比例、补边和最后裁边；不能为了凑 3840×2160 拉伸人物。[官方推理说明](https://github.com/OpenImagingLab/FlashVSR_Plus#command-line-inference)

### 作者速度数据的正确解释

[FlashVSR+ 项目页](https://www.flashvsr.tech/)给出的 RTX 4090、4K 推理吞吐如下。以下换算假设输入正好十秒、24fps、240 帧，且吞吐可线性外推，仅用于估计量级：

| 方法 | 作者报告处理吞吐 | 十秒视频的超分时间换算 |
| --- | --- | --- |
| SeedVR2 | 0.18 帧/秒 | 约 22.2 分钟 |
| FlashVSR+ Base | 0.50 帧/秒 | 约 8 分钟 |
| FlashVSR+ Turbo | 0.98 帧/秒 | 约 4.1 分钟 |

这些数字既不是输出视频的播放帧率，也不是本机 5090 的成绩，更不代表从源文件到成品文件的总耗时。作者在 [issue #4](https://github.com/OpenImagingLab/FlashVSR_Plus/issues/4) 澄清其 2K 计时包含 LQ 投影、DiT（包括 KV 搬运）和 TinyDecoder，不含输入预处理、颜色校正与 CPU 后处理；该回复明确针对 2K，4K 表格是否完全沿用同一边界未另行确认。比较只反映作者配置；不同 SeedVR2 规模、精度、切块、编译和输出尺寸会改变结果，不能据此宣布所有配置的速度排名。

## 补帧与人物一致性

[Practical-RIFE](https://github.com/hzwer/Practical-RIFE)作者推荐多数场景从 4.25 开始，并明确表示 4.24 之后适合扩散模型视频后处理；4K 输入建议测试 `scale=0.5`。先以 24→48fps 建立基线，可完整保留源帧时间点。[Google FILM](https://github.com/google-research/frame-interpolation)和支持任意时间点的 [GIMM-VFI](https://github.com/GSeanCDAT/GIMM-VFI)可作为大运动或遮挡失败时的对照。

当前 [ComfyUI 原生实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_frame_interpolation.py)已经提供 RIFE/FILM 加载与推理节点，暴露整数倍率 2–16，输出帧数为 `(N−1)×倍率+1`。其中没有场景切换检测，应先按切镜边界分段，避免在无关镜头之间插出变形过渡。

24→60fps 需要按目标时间采样：第 `k` 帧对应源位置 `0.4k`，按相邻源帧及小数时间插值。沿用整数倍率节点时，可五倍补至 120fps 后每两帧取一帧，再按 60fps 封装，但中间量较大。直接对目标时间推理更省；两种方式均需处理末帧和音频时长。把 48fps 的帧序列直接以 60fps 编码会变快，不能作为正确补帧。

超分与补帧的次序没有统一最优答案。先超分只需增强原来的 24fps，随后高分补帧；先补帧能降低插帧单帧尺寸，但重超分需处理更多帧。dawidope 的单片对照倾向先超分后补帧，适合成为初始候选，不能上升为所有模型的规律。应在相同尺寸、时长、编码和输出帧率下进行顺序对照。

人物一致性优先在生成时建立：固定同一角色参考包，明确身份、服装、构图和动作分别由哪份素材承担，并在跨段保持主体标签和状态含义。[H3 官方参考指南](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt)可作为输入责任划分依据。超分推断纹理，补帧估计中间时刻，都不保证把已经换脸的人恢复成指定角色。

人脸修复也应独立对照。[CodeFormer](https://github.com/sczhou/CodeFormer)明确存在质量与保真权衡；[KEEP](https://github.com/jnjaby/KEEP)通过前帧传播稳定视频人脸特征，但也不保证纠正生成阶段的身份变化。不默认逐帧叠加修脸。先检查眼鼻唇、牙齿、发际线、转头遮挡与跨镜头身份，再决定是否需要局部修复。

## 当前项目与落地条件

调研阶段实查 GPU 为 RTX 5090，显存总量 32607 MiB；权重所在物理盘为 NVMe。仓库中立能力目录目前只声明 H3 的 480p / 768p、24fps，以及基础与 PDD 配方，没有视频超分和补帧能力。生成图使用 INT8 ConvRot 基座、NVFP4 编码器，直接解码保存，未串接上述增强节点。依据见 `media-executor/src/media_executor/capabilities/catalog.py` 与 `capabilities/h3.py`。

稳定 ComfyUI 目录已包含 `nodes_frame_interpolation.py`，但本轮未找到对应补帧权重，且最初探测时 8189 拒绝连接，因此当时只确认源码基础。后续经用户授权安装与重启同一实例，补帧及高清实际运行结果见[本机对照](./h3-video-quality-local-evaluation.md)，不能把调研时状态当成当前运行状态。

FlashVSR+ 的[官方依赖](https://raw.githubusercontent.com/OpenImagingLab/FlashVSR_Plus/main/requirements.txt)约束 `torch>=2.5,<2.8`，与当前受管 Comfy 环境不能直接混装。社区 [FlashVSR Comfy 节点](https://github.com/smthemex/ComfyUI_FlashVSR)已包含 Plus 支持，但并非研究团队官方节点。实施前需先审查依赖与 5090 后端，不把完整 requirements 安装进现有环境导致 Torch 降级。

建议把视频超分、补帧作为中立专用工作流能力，接收源视频和目标参数，保留原始视频及音轨，记录处理模型、版本和派生关系。继续复用一个执行器入口、一个受管 ComfyUI、同一 GPU 调度和唯一 `media-generation` Skill，不为 H3 额外创建常驻服务。官方云端再生成属于独立供应商路线，不能冒充本地超分。

## 建议验证顺序

先选四类片段：人像对白、快速转头及遮挡、手部交互、包含明确切镜的片段；优先复用已有原片，再对代表镜头比较 480p 与 768p。保留原文件、提示与输入版本，各阶段保存结果，不同时更换生成配方、超分、人脸修复和调色。

1. **画质与成本对照**：比较 480p 直接超分、768p 直接超分，以及低分 latent 高分精修；像素超分候选包括普通缩放、Real-ESRGAN、SeedVR2 3B、FlashVSR+ Turbo / Base。先统一到 1080p 再检查 4K；保持原始 24fps，不加修脸。相同种子跨分辨率仍可能改变表演，两条生成结果分别检查，不能当作逐帧相同的底片。
2. **运动对照**：原片 24fps、RIFE 48fps、采用的超分→RIFE、RIFE→同款超分。只有困难段确实失败时才增加 GIMM，随后才测试 60fps。
3. **生成流程对照**：对需要更强细节的镜头，另测 H3 学习式 latent 放大与高分续采；保持参考、提示、种子和基础配置一致，比较身份、动作及完整成本。云端 2K 在权限和费用明确后可作质量上限对照。
4. **成片验收**：同时检查全速动态和同时间放大帧，覆盖人物身份、皮肤是否塑料化、手指、文字、纹理闪烁、遮挡鬼影、切镜、音画同步、比例及原时长。记录模型加载、推理、编码、失败重试和峰值显存，计算每秒合格成片的总耗时。

## 480p 创作与后置提质流程

768p 不是创作阶段的必要条件。当前执行器在 `qualityPreset=preview` 且未显式指定分辨率时默认 480p；final 默认 768p。按当前尺寸计算，16:9 通常得到 864×480 与 1344×768，前者空间像素约为后者的 40%。同配方、帧数和参考条件下，480p 通常可降低采样耗时与显存需求，但模型加载、文本编码、音频和编解码等开销不同比例缩减，不能据此承诺固定加速倍数。对照时显式固定分辨率与配方，避免同时改变质量预设而混入采样器和参考图处理差异。

建议的创作链为：**角色与镜头参考 → H3 480p / 24fps 草片 → 完成全片叙事、剪辑与声音编排 → 对实际采用片段统一提质 → 按原时间线合成高清成片**。480p 中动作、构图、身份和表演已合格的镜头可以直接测试视频超分，不要求全部重生 768p；细节确实不足的关键镜头再单独比较高分精修或重新生成。模糊与像素不足可交给提质测试，错脸、错误动作及缺失的剧情事件仍在创作阶段修正。

统一提质可以在全片创作完成后发起，内部仍按源镜头或采用区间处理，切镜处不插帧，必要时保留时间上下文余量。保存原始片、采用范围、时长、音轨及派生关系；提质失败保留原片，成功后沿用原剪辑与声音编排。无需为了增强而新建分镜段或改变影片节奏。

像素超分可直接处理已保存的 MP4。若要延后运行 H3 latent 高分精修，创作时还需保存精修所需的原生 latent、参考、提示、配方与版本等；仅保存种子或重新以 final 生成，不能保证原样复现草片。已有原生续接状态也不等于高清精修已接通，状态格式、音视频保持及跨分辨率处理仍需单独验证。[学习式 latent 放大流程](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler#-usage)

中立服务负责生成、源视频超分、补帧及可选精修这些可查询的通用能力；项目 Agent 负责何时采用草片、完成剪辑，以及何时对哪些素材发起提质。沿用唯一 `media-generation` Skill，并将模型输入规则放在参考文档中，不把全片创作编排写进模型能力。

该流程的本机执行、速度与初步画面证据见[本机对照](./h3-video-quality-local-evaluation.md)；4K / 高帧率产品接入与完整质量验收仍单独进行。
