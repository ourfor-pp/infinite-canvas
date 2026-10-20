# 红岸样片小脸、分辨率与声音复核

用户指出原成片约 49–50 秒雪景中的脸变形、整体声音一般。此前完整解码、帧数、浏览器播放和台词识别通过，仅证明技术链可运行，不能证明视听质量通过。用户随后表示最初的卡顿可能是电脑负载，本轮不将其认定为文件故障。原成片与工程均保留，未用实验结果覆盖。

证据根目录：`.tmp/three-body-quality-followup/`。请求、任务回执、实际工作流、输出、计时和审片图分别保存；所有视频推理经过现有执行器调度，复用同一 ComfyUI。

## 480p 与 768p

采用相同提示、参考、配方与种子，但分辨率改变会改变采样结果，不能视作同一动作逐像素比较。

| 原生生成 | 480p 执行秒数 | 768p 执行秒数 |
|---|---:|---:|
| 107 帧近景 | 38.026 | 89.491 |
| 107 帧转头中景 | 30.891 | 96.942 |
| 原雪景完整 243 帧 | 224.202 | 515.791 |

雪景前 73 帧检测到的人脸高度从约 30–35 像素增加到 49–54 像素；768p 仍有五官比例不稳与发糊，不能将提高原生分辨率视为已解决小脸问题。官方默认短边 768、24fps；社区亦有 1376×768 下的小脸复现。[官方仓库](https://github.com/MiniMax-AI/MiniMax-H3)、[模型讨论](https://huggingface.co/Comfy-Org/MiniMax-H3/discussions/30)。

同取各自雪景前 72 帧、3 秒，先超分再补帧到 60fps：

| 超分条件 | 480p 输入 | 768p 输入 |
|---|---:|---:|
| 产品 4K 长边 | 152.490 秒，3840×2134 | 163.824 秒，3840×2194 |
| 严格相同 3840×2160 | 154.159 秒 | 152.953 秒 |

严格同尺寸只差 1.206 秒，约 0.78%，每种仅一次，不能认定稳定提速。当前证据是生成端明显变慢、超分端没有明显加速。计时为 Comfy 执行开始到成功，不是端到端耗时或 GPU 独占时间；原始墙钟另存。

## 已测修复与未通过条件

相同 768p 输入、3840×2160／60fps：FlashVSR 为 152.953 秒，SeedVR2 为 442.64 秒。Seed 输出出现新的眼部、发际线与皮肤细节伪影，本样本未采用。Seed 的完成历史因调度器切换音频而丢失，输出通过代理图哈希、唯一输出和服务日志恢复；报告明确标为 `recovered-success`，不是重新推理。[Seed 官方限制](https://github.com/ByteDance-Seed/SeedVR)、[节点批次说明](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler)。

局部修脸使用 [Carasibana 作者代码](https://github.com/Carasibana/ComfyUI-H3-FaceRefine)，固定 revision `d8521d14fe0d721d80cd9417fff5a559cbc21aba`。测试包含基础模型、八步 LoRA、512／768 裁框、不同采样器、去噪和贴回范围。作者流程是跟踪裁脸、真实视频 latent 注入、按脸尺寸控制去噪，再贴回；WanGP 的相近实现不能当另一种独立算法计数。

早期适配图重复将裁出的视频作为视频参考，后来核对作者示例后移除此重复输入，仅保留起始 latent 与清晰身份图；旧结果作为负对照保留。修正后的 0.55 去噪候选在中间区间改善了脸部轮廓，但前段约 0.25–0.375 秒新增头部方向跳变；继续超分到 4K／60fps 后仍存在。原生 73 帧和最终前 180 帧已逐帧接触表检查，不能只截中间较好的帧作为成功证明。全部修脸候选维持 `qualityAccepted: false`，整段未采用。

可播放对照：

- `snow-480-vs-768.mp4`：两种原生尺寸。
- `snow-restorers-face-comparison.mp4`：相同源的 Flash 与 Seed。
- `snow-final-face-comparison.mp4`：直接 Flash 与局部修脸后 Flash，保留开头失败帧。

## 声音样本

同一句警告台词对照原 Qwen、Qwen VoiceDesign、IndexTTS 克隆时长系数 1.0／1.15；1.15 是时长增加约 15%，并非加速。另保留原声仅改混音的对照，区分表演与混音的影响。音色、情绪和时长参数以本机能力为准，不将上游能力冒充已接入参数。[Qwen 官方](https://github.com/QwenLM/Qwen3-TTS)、[Index 官方](https://github.com/index-tts/index-tts)。

最终公平试听在 `auditions/`，四份干声与五份 20 秒混音均以恒定增益调到约 −20 LUFS，保留原动态；实际真峰值低于 −1.5 dBTP。`manifest.json` 明确 `gainOnly: true`、`subjectiveListening: false`。干声与三份新混音的台词识别匹配，只证明可辨识，声音表演、空间感和听感尚未验收；没有重混整片。

另补测现有 VoxCPM2，复用同一角色参考，以普通克隆加表演指令生成同句 4.96 秒音频，识别匹配；关闭 `ultimateClone`，避免该模式忽略表演指令。新增等响干声 `voice-voxcpm2.wav` 和相同底轨的 `F-voxcpm2-new-mix.wav`，仍待试听，不能因生成成功或较短就认为表演更好。[VoxCPM 官方](https://github.com/OpenBMB/VoxCPM)。

## 扩展调研与下一轮

单一路线多次调参未达到目标后，分派三个独立研究方向：H3 专用整帧／原生精修、其他模型与时序修复、对白表演与声音制作。重点核对一手实现、权重与资源要求，并由主 Agent 统一选取最小片段测试。尚未测试的候选不得标为有效，也不得把同源实现重复统计。

| 独立路线 | 已核对内容 | 当前状态 |
|---|---|---|
| H3 整帧视频重采样 | mdkberry 原始 v18 与窗口 v3 工作流，固定 `3f13ff8dff5ee05f23a2ff10a6a43db81eb4d592` | 原图与字节校验保留；另用本机核心节点做最小机制实验，非原样复现 |
| KEEP 时序人脸恢复 | 跨帧特征传播，约 0.8GB 权重；没有指定身份图入口 | 已完成两种时序分块及一次 4K／60fps 后续处理；清晰度改善，但有年轻化和美化，身份未通过 |
| LTX2.5 Refine-Details | 源视频条件加外部脸图 Guide，面向生成视频；Restore 则偏旧胶片／黑白损伤 | 已完成同种子无／有人物图两组真实推理；部分轮廓改善但仍偏软，人物图未带来明确身份收益；不代表官方全套 4K 最高质量链路 |
| Wan VACE | 源视频＋动态 mask＋人物参考图，局部重绘 | 官方 1.3B 已完成 50 步实测；多数帧更低头／闭眼，脸仍发软，未采用；遮罩外像素已验证保留 |
| SVFR | 视频时序恢复，但默认身份来自自行恢复结果 | 未安装／未测；官方 CLI 不直接接受指定人物图，保存帧率也须修正 |

一手实现：[mdkberry 工作流](https://github.com/mdkberry/comfyui_workflows/tree/3f13ff8dff5ee05f23a2ff10a6a43db81eb4d592/workflows_by_model/Minimax-H3)、[KEEP](https://github.com/jnjaby/KEEP)、[LTX Refine-Details](https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Refine-Details)、[VACE 指南](https://github.com/ali-vilab/VACE/blob/main/UserGuide.md)、[SVFR](https://github.com/wangzhiyaoo/SVFR)。完整候选成本、实验输入、帧率陷阱与下载前 revision 缺项保存在证据目录 `alternative-video-research.md`；本机有基础节点名称不等于已有权重或完整工作流。

已完成的独立整帧实验：同一 768p 雪景前 73 帧，真实视频 VAEEncode、原身份／场景图、基础模型、不叠加 LoRA；以核心节点合并视频 latent 与冻结的零音频 latent，`er_sde`、明确 sigma `[0.45, 0.3, 0.2, 0.1, 0]`，执行 44.541 秒。没有裁脸／贴回，也没有额外超分。本实验只验证机制，和作者 v18 的放大、rank20 LoRA、`beta57` 配方不同，不能据此否定完整作者路线。73 帧接触表检查未证明小脸结构得到充分修复，未采用；对照为 `snow-whole-face-comparison.mp4`。本样本没有对白，不能声称验证口型锁定。

声音侧另准备并执行单事件 MOSS 雪地脚步样本，用于按实际落脚时刻贴合；不将文本提示中计划的时间当作实际画面事件。当前原片已有分层声音与音乐 ducking，新的工作重点是表演、具体事件同步和保留可重混分轨。[MOSS 音效](https://github.com/OpenMOSS/MOSS-SoundEffect)、[FFmpeg 滤镜](https://ffmpeg.org/ffmpeg-filters.html)。视频条件拟音可继续研究 MMAudio／HunyuanVideo-Foley，但尚未安装或验收。

临时 FaceRefine 扩展已移除，同一受管 ComfyUI 已恢复原节点。恢复后原生四秒 HTTP 回归因已记录显存峰值高于当前可用预算而停在准入，未进入 Comfy 推理，主动撤回且保留诊断；未停止其他 GPU 进程、未修改预算或冒称这次回归通过。随后上述整帧实验经同一执行器调度真实完成。没有新增服务、端口或切换默认配方。

最终技术检查：21 份主要视频通过完整解码、CFR 时间戳、帧数与 SHA256 记录；新增 Vox 和 MOSS 音频通过解码，Vox 台词识别匹配。检查清单分别在 `verification.json`、`diverse-audio-verification.json`。这些检查不改变上述视听未通过结论。

## 独立模型实际测试

这轮统一取 768p 雪景重生成版本中的第 24–72 帧，共 49 帧、24fps、约 2.042 秒，对应时间线 49.000–51.042 秒。它不是原 480p 成片的同一采样动作；以下跨模型对照才使用完全相同的原片。原片仅有约 49–54 像素高的人脸，裁切放大是算法输入适配，不代表新增了真实细节。实验仅检查这个困难片段，无对白，不推广为全剧或口型验收。

| 实际运行 | Comfy 执行秒数 | 结果与限制 |
|---|---:|---|
| KEEP，20＋20＋9 帧 | 13.515 | 五官结构更清楚，但变年轻、眼部更精致；不能保证是指定角色 |
| KEEP，单次 49 帧 | 12.436 | 与分块版本接近，未见明显分块跳变；身份仍未通过 |
| KEEP 单次 49 帧后接 Flash＋RIFE | 112.421 | 输出严格 3840×2160／60fps，122 帧；恢复带来的年轻化仍存在，提质不能纠正身份 |
| Wan VACE 1.3B，人物图＋动态遮罩，50 步 | 67.448 | 仍发软，多个区间更低头／闭眼，不满足头向与表情保持要求 |
| LTX 2.5 Refine-Details，无人物图 | 25.547 | 冷加载首组；部分鼻唇轮廓改善，整体仍偏软，较 KEEP 克制 |
| LTX 2.5 Refine-Details，有人物图 | 13.754 | 未见明确身份收益；复用首组模型缓存，不能据此声称加参考图反而更快 |
| LTX 人物图候选后接 Flash＋RIFE | 115.804 | 严格 3840×2160／60fps、122 帧；画面更清楚、未见明显新增整头翻转，人物仍偏年轻、身份未通过 |

计时是执行开始到成功，包含节点准备与编码；KEEP 子工作进程的恢复循环分别约 2.729／2.561 秒，包含网络运行、CPU 转图与 PNG 写入，不能将其当作纯 GPU 或整条处理耗时。4K 输出 122 帧为约 2.033 秒，与 49／24 秒相差半个 60fps 帧，记录舍入而不静默声称时长完全相等。模型之间裁框大小、原理与资源需求不同，以上是候选工作流实测，不是严格同算力模型排名。

KEEP 固定作者代码 `f382730e329d5924fcaf5344b392a6036ba59a4d`，使用作者 GitHub release 权重并核对 SHA256；官方 ModelScope 同仓不可用，未采用第三方搬运。FP32 网络与权重不改；旧训练依赖在独立环境做导入兼容。对齐适配使用跟踪框内的作者五点检测、中心相对平滑，缺失三帧插值；它与作者直接整片检测、全局平滑不同。保存 49 张对齐图与前后适配证据，不能称为未经改动的作者 CLI 原样复现。

VACE 固定官方 ModelScope `Wan-AI/Wan2.1-VACE-1.3B@6714b95cf37b2a609fe9087387d6313cd311f500`，官方 FP8 scaled T5 另行下载校验；已有同名 T5 哈希不一致，保留且未用于本次测试。使用官方 VACE shift=16、uni_pc／simple、CFG 5、种子 73412，512×512 头部窗口。人物图作为参考 latent，动态人脸内部遮罩为编辑区；解码前去掉参考 latent。生成结果仅贴回脸部内部，RGB 无损编码前后均验证遮罩外 49 帧变化像素为零。这个像素保证仅说明背景保留，不代表脸的身份、头向、表情通过。

LTX 固定作者节点 `44c8a36b7c31ee00b4271daed11dc2a4aa481140`，最小注册层之外的五个算法文件与作者源码逐字节一致。模型来自 Lightricks 官方 ModelScope 同名仓库的固定文件 revision，各文件大小与 SHA256 均验证；不使用不可访问的 HF 下载链接或第三方搬运。采用 2.5 distilled NVFP4 transformer、Gemma4 INT8 ConvRot、BF16 视频 VAE 和 Refine-Details 1.0，属于量化单窗口实验，不是 BF16 全模型或作者完整 DFR／4K 流程的质量上限。音频 VAE 虽已校验，本次纯视频图不加载、不生成音频。

两组均取同一 352×198 平移跟踪窗口，等比例放大至 1024×576、49 帧，8 步、euler、CFG 1、种子 73413；源视频 Guide 位于 frame 0，人物图 Guide 位于 frame −1，除是否接入人物图外配方相同。人物图按比例放入灰色画布，未强行拉伸成视频比例；采样器去掉附加参考帧后解码。脸部遮罩只作用于后合成，LTX 本身会生成整个裁框，不能说它天然支持本次空间遮罩约束。RGB 无损回贴的遮罩外 49 帧变化像素均为零。正常速度对照和全部接触表未证明指定身份恢复，不能把人物图接线成功当作身份条件有效的充分证据。

全部真实输出维持 `qualityAccepted: false`。KEEP、VACE、LTX 的每组 49 帧原生对照，以及 KEEP、LTX 最终各 122 帧对照已检查完整接触表；这是 Agent 的逐帧视觉检查，尚无用户验收或整段主观听审。LTX 最终 4K 人脸更清楚，但皮肤和面部观感仍偏年轻；未见此前 H3 局部精修那种明显整头翻转，不等于微表情和身份已通过。Flash 是全帧生成式提质，4K 结果不再有脸外逐像素保持保证。准备阶段的 manifest 中 `modelRun: false` 等字段保留为历史快照，实际运行以 `face-runs/cross-*` 请求、历史和报告为准，不将 CPU 假输出机制检查算作真实推理。

证据在 `cross-model/KEEP/`、`cross-model/VACE/`、`cross-model/LTX/`，实际 GPU 任务在 `face-runs/cross-*`。各自的 `review/face-comparison.mp4` 或 `review-*/face-comparison.mp4` 可播放，接触表保留全部帧。同屏对照为 `cross-model/comparison.mp4`：原片、KEEP、VACE、LTX 无／有人物图和静态身份图，统一放大尺度；49 帧正常速度重复三遍，共 147 帧、6.125 秒。应用文件存储传输后在独立浏览器页完整播放，147 帧、零掉帧，保留 `browser-playback.json`；这是播放技术验证，不是用户接受画质。

本轮新增 19 份正式视频通过完整软件解码、帧数／规格、逐帧 CFR 与 SHA256 检查，三份 `completed-*-verification.json` 保存原始证据。原两分钟 4K 交付文件 SHA256 仍为 `2b2953503ba184882682539084730c3c5fd75b1da0b408d5799032b77d36f5c5`，与原交付清单一致。执行器 122 项测试、服务端 5 项视频契约测试通过；这不替代上述视觉结论。

全部测试结束后移除本次临时 KEEP／LTX 评测注册扩展，仍为原受管 ComfyUI、原端口，核心及正式节点无变更；初次健康检查的 H3 指纹为异步冷校验中，随后有界只读复核通过，原 H3 基础版与 PDD 指纹、能力集合完全一致。实际应用 HTTP 回归使用更小的 480×480／107 帧配置，执行 23.917 秒，结果在应用落库并下载；不是旧 16:9 准入失败任务的同配置通过，也没有降低预算、清除峰值档案或停止外来 GPU 进程。证据为 `cleanup-report.json`、`after-cleanup-health.json`、`original-h3-smoke.log` 和 `runs/original-h3-square480-after-cross-regression/`。

## 生成阶段优先验证

用户提出先在生成阶段防止变形，再做后期。本轮结果支持将排查优先级前移，但尚未证明某一新生成方案会显著改善当前镜头。三条生成侧候选须区分：

- [PDD 作者的 BASE warmup＋PDD 示例](https://github.com/Jalen-Brunson/ComfyUI-MiniMax-H3-PDD-Acc#example-workflows)以基础模型完成前段采样，再衔接训练网格上的 PDD 尾段；这仍属于第一次生成，不是对 MP4 换脸。已完成雪景新五秒片段的双种子对照，未证明稳定身份收益，产品配方未接入。不能把 PDD 任意加步数、叠加另一个加速 LoRA 或改到非训练 sigma 网格当作该流程。
- [fal Realism People LoRA](https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA)主要展示近景人物、皮肤和表情，不是已证实的远景小脸身份修复器。[作者讨论](https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA/discussions/4)明确原本面向 FP16／FP8，讨论中存在 INT8 ConvRot 组合异常报告。旧强度1.0不采用；本轮当前核心的0／0.5匹配对照已实际完成、日志确认104组补丁挂载，但轻微可读性改善伴随脸变大，未证明身份收益。结论不推广到其他精度、PDD或所有分辨率。
- [Singularity 作者基座](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity)宣称改善中远景脸，但它是混合微调模型。已完成本机 Pruned v1.3 INT8＋BASE20 的单种子换基座对照；构图更远、脸更小，未得到明确身份收益，不能据此否定作者其他配方。[第三方提取 LoRA](https://huggingface.co/TenStrip/Minimax-h3_Singularity-Lora)不是原作者底座，本轮未下载或使用。混合 trunk 不与 PDD 叠加，正式基座不替换。

前一轮49帧后期修复测试段的人脸中位尺寸约37×51像素；本轮新生成片段的脸尺寸另行统计，不能混用。匹配机位的正／侧脸参考、原生脸尺寸与生成配方仍应独立验证，不能只提高参考图尺寸就声称增加了输出脸像素。具体来源及边界在 `cross-model/generation-lora-research.md`、`cross-model/generation-stage-research.md`。

继续验收需要同时满足角色身份、头部方向与表情、整段时序、遮挡及贴回边缘，再检查最终超分与补帧；声音须试听后决定采用。当前不切换产品默认模型、不宣称支持无人值守多集制作。下载前已盘点并归档停用的LTX评测权重，逐文件原作者哈希、源文件与归档副本一致，原路径保留软链接，正式权重未移动；Singularity下载后SSD余量约17GiB。评测权重与结果保留。

## 生成阶段九组实测

统一1344×768、124帧、24fps，实际5.166667秒，使用同一身份板、雪景图、静音粗模前124帧和新的 `prompt-5s-v2.txt`。生成原片保留原生音轨，但本轮不做听感、对白或口型验收。提示改成一个连续行走镜头，移除旧十秒设计中的六秒切镜、摸树桩和室内灯声；种子也与旧成片不同，因此这是新的匹配对照，不能把任一新片比旧成片好归因于单个模型，更不能声称旧49–50秒缺陷已修复。

| 配方 | seed 73412 执行秒数 | seed 73413 执行秒数 | 逐帧结论 |
|---|---:|---:|---|
| PDD8 | 196.378 | 173.848 | 当前比较基准；未见突然换头，但细小五官仍软，精确身份未通过 |
| BASE8＋PDD2 warmup | 211.754 | 211.533 | 无跨种子稳定身份收益；第二种子脸更大且多帧脚被下沿截断 |
| BASE20 beta／res_multistep | 402.159 | 403.473 | 第一种子稍成熟，但脸更大、头向也变；第二种子未重复该优势 |

Warmup按作者默认handoff0.8，BASE首段输出slot0接PDD尾段且不重新加噪；尾段严格在训练sigma网格。BASE20无PDD、CFG1，使用当前正式INT8 ConvRot基座，不代表BF16全精度官方基准。实际提交图已核对控制组的提示、种子、参考加载节点与尺寸完全一致。六片全部744帧逐页检查，未证明更多步数带来稳定身份收益；不因个别更大、更成熟的人脸修改默认。

另外三组统一在同一提示正文加入一次 `r34l1sm`，无PDD；实际图只有LoRA强度或UNET文件名以及输出名不同：

| 单种子73412匹配组 | 执行秒数 | 原生脸框中位宽×高 | 结论 |
|---|---:|---:|---|
| 正式基座＋Realism强度0 | 420.861 | 43.57×63.11px | 匹配触发词基准；五官仍软 |
| 正式基座＋Realism强度0.5 | 404.335 | 48.40×69.31px | 轮廓略易读，但脸高约增9.8%、头向略变；没有明确参考身份结构收益 |
| Singularity基座＋Realism强度0 | 404.108 | 28.59×43.24px | 构图明显更远，脸框面积约为基准45%，五官仍软；当前工作流未达目标，不隔离归因为底座普遍更差 |

Realism复用作者固定版本 `4497aef76812f46bef00dab61d07ff23f25f0777`，完整SHA256核对；当前核心日志实际挂载104组补丁。Singularity选原作者 `af671d9214a6e41ab8c2f43e9f871ea56246115f` 的Pruned v1.3 INT8，20,967,647,456字节、SHA256 `412a7b126595a958964193f3b42513d7cf2df4196ef04223a0f05e3622949cce`。作者HF过慢后，经用户明确授权，使用固定revision、与作者文件哈希一致的ModelScope社区镜像续传；下载后完整校验通过，不称其为作者官方ModelScope仓库。当前核心实际加载成功，没有改权重、核心或节点。

两候选全部248帧逐页检查，加上匹配基准共372帧。当前均无足够明确的原生身份收益，因此不追加第二种子或4K，也不把它们泛化为无效；作者Turbo4步等不同链路尚未验证。这轮九组Comfy执行总计2828.449秒，包含节点准备和编码，不是纯GPU时间或整个制作成本。冷热加载、构图与脸尺寸变化限制速度和画质排名。

每组输出重新检测124帧，未用旧框填补；九份原生片和四份比较片通过完整解码、规格、CFR及SHA256检查。检测124/124不等于五官或身份正确。两份双种子控制比较及一份三候选比较已通过应用文件API下载后在独立新页正常速度完整播放，各124帧、零掉帧；这是播放技术检查，身份、闪烁和声音仍无用户验收。统一192×192原生像素窗口放大，保留全幅与实际脸尺寸，不能把按脸归一化后的清晰程度冒充收益。

证据目录为 `.tmp/three-body-quality-followup/generation-stage/`：`results.json`、`actual-input-matching.json`、`candidate-visual-review.md`、`control-review-*.md`、`candidate-comparison-verification.json`、`comparison-verification.json`及三份`browser-playback-*.json`。可播放主对照为 `comparison-candidates-seed73412.mp4`、`comparison-controls-seed73412.mp4`、`comparison-controls-seed73413.mp4`。原两分钟4K成片哈希与原交付清单一致。

结束后排空队列、移除两个临时模型别名，保留权重、归档副本及结果；当前别名清单为空，历史在 `cleanup-report.json`。未新增节点、服务或端口，未升级核心、切换正式配方或重启ComfyUI。最终基础／PDD指纹、能力和模型目录字段与前轮恢复基线完全一致。

原应用回归中的480×480／四秒双参考配置停在显存准入，诊断记录 `freeBytes=11258101760 < requiredBytes=12648290713`，未提交Comfy即主动撤回；不把它写成通过。改成实际更小的单身份参考，并移除缺省场景参考声明后，原H3 PDD应用请求完成，实际107帧／24fps／4.458333秒，执行23.862秒；结果落库、下载、完整声画软件解码与CFR检查通过。它不是原双参考同配置成功，也不代表本轮小脸或声音质量通过。没有删除峰值档案、修改预算或停止外来GPU进程。执行器47项相关测试、服务端5项视频输入契约测试通过；最终审计与验证保存在 `final-audit.log`、`final-verification.json`，队列为空、维护关闭。

## 审片 Demo 与补充社区调研

页面位于 `web/public/demos/video-quality/index.html`，沿用现有 Vite 与应用文件 API，不新增服务、端口或重启。当前开发入口为 [局域网审片页](http://192.168.3.55:3000/app/infinite-canvas/demos/video-quality/index.html)，本机可用 [localhost](http://localhost:3000/app/infinite-canvas/demos/video-quality/index.html)。静态页面依赖当前应用文件库，不是双击 HTML 即可播放的离线包。

页面按用户反馈改用中文方案名：如“原模型＋人像细节：不加速”“普通8步＋加速2步”“修脸方案三：提供角色照片”，技术原名与参数放入详情。7段同屏片另外制作中文字幕版本，未覆盖原对照文件；完整解码后逐帧检查，标题区域外像素与原片一致。此更新不改变媒体ID、本地评价归属或原推理结果，证据为 `review-demo/readable-overviews-verification.json`、`readable-names-browser.json`、`readable-media-browser.json` 与 `readable-functional-browser.json`。

目录收录14组、47份实际视频／声音：九组生成候选、KEEP／VACE／LTX、H3局部／整帧、原生480p／768p、Flash／SeedVR2、后期接4K、两分钟原成片与等响干声／混音。排除仅用于机制验证的假输出。原文件按需读取；四份原始RGB／PNG结果另做浏览器H.264审片编码并注明，未新增模型修复。页面提供同屏与独立同步A/B、逐帧、固定192×192原生像素人脸窗口、原尺寸查看、49秒定位与本地评价；既有定性观察默认收起。4K选项直接读取3840×2160文件。

47份媒体的206 Range、MIME与首帧／音频数据、视频尺寸均通过浏览器检查；主要比较片完整播放、逐帧、同步、帧导出内容、笔记刷新恢复、音频互斥、4K定位、桌面／手机显示与局域网入口已检查。这不等于本轮重新完整听看全部47份媒体。PNG／JSON数据及下载发起已验证，自动化浏览器连普通文本下载也取消，实际文件保存留给用户确认。证据为 `.tmp/three-body-quality-followup/review-demo/` 下的 `browser-verification.json`、`media-browser-verification.json` 与最终截图。

用户要求的三路 subagent 已补充13条记录，入口为审片页“社区调研”；完整报告也保存在页面的 `reports/` 下：

- [生成与参考工作流报告](../../web/public/demos/video-quality/reports/h3-generation.md)：Singularity作者明确强调4步加速LoRA依赖，当前BASE20实验没有覆盖推荐配方；LBH两阶段latent放大、OmniChar参考分工、RefMod双采样各有实际图或代码证据，但没有证明本机雪景小脸有效。[Singularity作者讨论](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/discussions/7)。
- [完整制作案例报告](../../web/public/demos/video-quality/reports/production-workflows.md)：CATACOMBES、HEIST、ANCESTRA等案例仍使用人物／场景资产、分镜或三维预演、逐镜筛选重做与剪辑声音制作。CATACOMBES作者披露大量候选与人工工时；ANCESTRA为混合实拍、生成、合成和专业声音团队。未找到小说直接无人值守连载且质量可审计的证据；MiniMax StoryBuilder固定代码的续接默认关闭，不能照搬README的旧续接描述。[CATACOMBES作者复盘](https://www.ecoledesvideastes.com/blog/catacombes-court-metrage-ia)、[ANCESTRA官方幕后](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/ancestra-behind-the-scenes/)。
- [后期与局部修复报告](../../web/public/demos/video-quality/reports/postproduction.md)：amao的H3局部重绘→VOSR2 1×→贴回有实际工作流及原片／结果，但展示为大脸缓转，不证明远景小脸；另保留FlipPix、T8相对裁切和MouthGuard。VOSR2图片逐帧处理可能改身份或闪烁；H3FaceRefine最新公开修订与已测版本相同，不列为新版本候选。[VOSR2节点作者仓库](https://github.com/ylchen333/ComfyUI-VOSR2)。

公开图、作者自述和实际看过的片段在页面逐项标明，不把不可获取的完整影片写成已看过。原始网页、固定版本工作流、公开短片与检查记录保存在 `review-demo/research/`。本轮仅整理审片与研究，没有新跑GPU、下载大模型、修改默认配方或改变原成片；下一轮先由用户选方向，再做短片同条件对照。
