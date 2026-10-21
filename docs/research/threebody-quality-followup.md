# 红岸样片小脸、分辨率与声音复核

用户审片反馈：人像细节补丁收益不明显，加速版本脸更糊，现有结果仍不足以采用。新增研究转向生成时的专用身份控制与按角色照片重绘视频；不把当前INT8＋20步结果推广为整个社区的质量上限。新来源与边界见 `.tmp/three-body-quality-followup/review-demo/research/identity-next-decision.md`、`identity-alternatives.md`、`h3-identity-limits.md`、`identity-restoration-alternatives.md`。此轮没有启动新模型推理。

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

## 角色照片引导的原生身份实验

用户已要求实际测试 RG-FVR、DreamID-V 和 Stand-In，先检查原生身份再决定是否追加4K／60fps。共同身份图 SHA256 为 `1bbb86f93d8b30b6f295ba887de3316e6a3aae50b83b58467380f0974dd751e4`；两种修复路线冻结 `cross-model/VACE/vace-source49-crop512.mp4`（49帧、24fps、512方形，SHA256 `b9627ba7ae4ae58d4dc396d1db0772146a529e513607344204c21b63836887de`）。该输入来自已重生成的768p雪景，约49–51秒窗口，不是原两分钟480p成片的逐帧修复。

DreamID-V 固定作者源码 `9b589940577559c91481fb3a13bae000a55f97a1`，48文件逐一核对；标准 DWPose／UniPC20步、image CFG4、seed73412，未使用Faster。明确本机适配为512方形面积预算、CPU姿态提取和Torch原生SDPA，保留完整加载审计及49张原生PNG。DreamID主模型实际参数为FP32，共享文本编码器使用作者BF16文件；不把原版精度和量化模型混写。作者HF速度较慢后使用固定ModelScope镜像 `svjack/DreamID-V@017721f57c2a62dba768aa9d1c845ef9278108bb`，三份文件大小及SHA256先与作者固定版本核对，下载后再完整校验；不称镜像为作者仓库。

| 实际对照 | 总执行秒数 | 模型生成与解码秒数 | NVML峰值字节 | 初步观察 |
| --- | ---: | ---: | ---: | --- |
| 原角色照片等比留白至512 | 139.043 | 47.412 | 22617784320 | 五官比源片规整，仍偏年轻、偏美化；未证明指定身份恢复 |
| 同图先对齐裁切及去背景 | 141.045 | 47.906 | 22617784320 | 与第一版接近，尚无明确新增身份收益；不是换一张角色照片 |

两组各49帧均保存和检查，已生成全帧接触表及与原片的局部／全幅对照。贴回沿用同一跟踪变换与受限遮罩；49帧在编码前及RGB无损视频解码后，遮罩外变化像素均为0。浏览器审片只另转H.264，不追加修复、超分或补帧；预览编码本身不提供像素不变保证。新样本追加到既有Demo的“新方法：修好脸后贴回雪景”和“放大检查：角色照片能否修回身份”，旧媒体ID和评价键保持。两组身份与动态质量均未采用。

所有GPU调用通过 `identity-tests/native_qualification.py` 排空队列、建立维护标记、执行NVML准入并独立进程运行。首组准入回收受管ComfyUI空闲显存后停止了其残留进程，随后已恢复同一服务；第二组完成记录显示维护关闭、原生工作进程退出、四项队列均为0。未停止外来GPU进程，也未新增模型端口或常驻服务。

实验准备时按用户明确授权将停用Singularity、VACE和共享FP8文本编码器评测副本共34,849,623,989字节复制校验后归档，保留原路径软链接；该归档前后正式运行时状态一致。新模型权重保持SSD，三个本轮自建Python依赖环境独立于正式执行器和ComfyUI。准备、来源、权重校验、执行与原始图像证据位于 `.tmp/three-body-quality-followup/identity-tests/`；六组已完成CUDA实测，具体对照如下；下载与CPU导入没有计入推理成功。


### RG-FVR与生成时身份注入的实际对照

RG-FVR固定作者源码 `54a89307bc4b5118c70b5482ab044e0a237d8535`，使用作者teacher、50步及同一照片／种子。teacher从作者大学下载源取得并完整核对官方SHA512，共享Wan文本编码器、VAE与ConsisID身份编码器均固定来源和版本；没有用风格或加速LoRA替代身份模型。192像素原生跟踪窗口与收紧到96像素两组均放到512推理，只改变模型看到的区域；其贴回遮罩转换到源画面后逐帧完全一致，并未通过改遮罩扩大效果。

| 原生49帧对照 | 执行秒数（含加载） | NVML峰值GiB | 实际观察 |
| --- | ---: | ---: | --- |
| RG-FVR：192像素裁框 | 90.072 | 21.428 | 五官结构改善，较保守，仍有年龄与身份偏移 |
| RG-FVR：96像素裁框 | 77.023 | 21.428 | 眼鼻唇线更清楚，但更年轻、圆润，14–23帧嘴形改动更强 |
| DreamID：原图留白 | 139.043 | 21.064 | 五官规整但年轻化 |
| DreamID：对齐去背景 | 141.045 | 21.064 | 没有明确优于原图的身份收益 |
| Stand-In：身份关闭 | 894.141 | 22.709 | 脸框约20.5×32.9原生像素，仍软 |
| Stand-In：身份打开 | 898.178 | 22.488 | 脸框约55.1×71.0像素，头向和构图改变，侧边色噪不可用 |

RG两组与Dream两组共196帧均保留原始PNG、贴回无损RGB视频和完整逐帧接触表；编码前及无损视频解码后的遮罩外像素变化均为0。独立CPU审片另外在贴回全幅上用同一源位置、固定96原生像素窗口做49帧三列比较，优先向用户展示tight96的可见修复，但保留192版本供较保守的选择；两组身份和表演保真均未采用。证据为 `identity-tests/rgfvr/tight-vs-standard-review/`。

Stand-In固定作者源码 `e351224366be169076e94af1454115d91d458313` 与身份适配器；基座采用ComfyOrg官方Wan2.1 14B BF16重封装，适配器作者哈希与已授权ModelScope镜像完整一致。两个独立生成短片的提示、种子、20步、CFG5、shift5、768p尺寸和模块相同，仅开关身份照片；使用Torch SDPA、CPU卸载与分块VAE，不使用FP8或加速LoRA。这是作者算法加BF16重封装的本机适配，不是作者FP32原始分片的完整复现。

身份开启后脸框中位面积约为关闭的5.8倍，且逐渐转为较正面，不能将更易读的脸当成同尺寸远景身份改善。侧边黑色、黄绿色噪声在原始PNG已存在，不能归因于MP4或浏览器，也未裁掉坏画面。CPU检测曾把35、47帧的噪声当成巨大人脸，已改成空间与尺度连续的唯一可靠原始检测，保存全部候选、拒绝原因及原审片快照；不插值、不修图，模型49张PNG的哈希不变，两帧真实脸框可检测，未以噪声框计算结论。

源码与CPU小张量已确认：作者首步建立身份KV缓存，后续即便显式 `ip_image=None` 仍使用缓存，不能认定身份仅生效一步；本轮没有擅自改成每步重算身份条件。作者CLI默认非分块解码，当前实验使用分块，是继续诊断的明确差异，尚未据此确认根因。保留相同采样配置并截获最终latent，以后续相同latent的解码对照定位；具体证据见 `identity-tests/standin/noise-diagnostic-findings.md`。

三个临时Python环境后来将依赖缓存迁至机械盘、保留独立入口，完整校验文件与硬链接后验证CPU导入；没有修改正式执行器或ComfyUI环境。DreamID完成两组后，其不再使用的实验权重也已复制核对后归档并保留链接；下一次若需启用必须先恢复SSD。当前RG、Stand-In与共享实际启用权重仍位于SSD；未移动正式H3或提质模型。


### 同一latent解码交叉验证与收尾

身份开启原配置再跑一次并保存最终latent，901.172秒；49张输出PNG与先前异常版逐张SHA256完全相同，异常可重复。最终latent为BF16 `[1,16,13,96,168]`，全finite、范围−3.4375至3.5，SHA256 `07ee84ec20b9d43bcb87ecac5f61d1c8cd434353d1fb34f58fb9493b7b5de261`。其后卸载完整生成模型，每次只严格加载原作者VAE的独立进程，复用该latent、不重新扩散采样，得到：

| 仅VAE复核 | 实际解码秒数 | 独立任务总秒数 | NVML峰值GiB | 49帧观察 |
| --- | ---: | ---: | ---: | --- |
| BF16完整解码 | 4.972 | 19.008 | 15.508 | 两侧背景异常仍在 |
| FP32分块解码 | 30.556 | 45.012 | 3.764 | 两侧背景异常仍在 |
| FP32完整解码 | 8.821 | 25.015 | 27.004 | 两侧背景异常仍在 |

三组相同latent哈希、194键严格加载、输出finite、49张PNG和完整MP4解码／24fps CFR均通过，全部49帧接触表仍有原区域的颗粒／块状异常。各解码输出像素不同，不能写成四种解码RGB相同；结论仅为当前精度与分块开关未修复，不扩大排除所有共有VAE实现或上游采样／身份注入问题。没有改作者采样循环、停止外来GPU进程、降低全局显存预留或新增服务。独立复核为 `identity-tests/runs/standin-vae-same-latent-review.{json,md}`。

当前Demo共19组、62份可播放样本；本轮新增15份，包括两种局部源输入、四组后期的局部／贴回结果、身份开关两片及三份解码复核。旧47个clip、14个group实体逐项保持；已发表样本的ID与本地评价归属保留。“新方法：修好脸后贴回雪景”默认先比较tight96，“背景异常：换解码方式能修好吗？”保留全部四种解码结果。新媒体均通过现有文件API的MIME与206 Range，追加的完整正常速度浏览器播放与桌面／手机检查记录位于 `identity-tests/*browser-proof.json`；播放技术检查不替代身份／表演或用户采用。

六组主要对照另完成294张PNG与完整视频核查：Stand两组98张原文件SHA匹配；Dream和RG的196张没有历史PNG文件字节哈希基线，按当前PNG逐帧RGB与既有无损视频解码RGB精确匹配，不能伪称有原始文件哈希。四组后期的编码前后遮罩外像素全0。证据为 `native-six-verification.json`。十次独立GPU任务（六主对照、一次精确复跑、三次仅VAE复核）均成功技术退出，没有CUDA OOM重试；效果仍未自动采用。

最终 `final-verification.json` 与 `final-audit.log` 记录：四项队列为0、维护关闭、临时原生工作进程退出，同一受管ComfyUI服务已恢复，正式H3／PDD及VAE／能力指纹与准备前一致。受管服务因显存回收而重启，其PID变化已记录，不宣称服务始终未重启。原两分钟4K成片SHA256仍为 `2b2953503ba184882682539084730c3c5fd75b1da0b408d5799032b77d36f5c5`。本轮不追加4K／60fps、不修改正式默认模型，等待用户按原生对照判断修复价值。

最终目录与交付核查见 `identity-tests/delivery-verification.json`。首轮解码诊断A/B播放各掉1帧，原始记录保留；等待字体和canplaythrough后仅复核一次，两边均49帧完整播放、零掉帧。其余新增主要对照播放记录均完整结束；这不证明所有设备的播放性能或身份质量。


## RG-FVR：参考脸角度对照

固定同一768p重生成雪景的49帧、24fps、96像素跟踪裁框、512输入、50步、guidance 2、seed 73412、提示、版本和贴回遮罩，只更换参考候选；正脸复用既有结果。

|参考|单次执行耗时|观察|
|---|---:|---|
|原正脸|77.023秒|已有最优裁框基线，嘴部仍有变化|
|四分之三侧脸|77.031秒|与正脸结果非常接近，未见明确稳定性提升|
|更侧脸|76.023秒|嘴部开合在相近帧出现，未解决嘴抖|

两张新参考均用原生生图能力从同一正脸独立编辑，随后统一尺寸至558×800；不是实拍同身份多角度真值，也不是严格测量的45/75度。身份、年龄和嘴形细节可能同时改变，因此不能把细微差异归因于角度。原始图保存在 `.tmp/20261020-164104.png`、`.tmp/20261020-164249.png`；输入哈希与配方核验在 `identity-tests/angle-references/manifest.json`、`comparison-proof.json`。

已查看全部49帧的四列固定位置对照，尤其14–23帧嘴部开合：三种修复输出相近，没有可据此采用侧脸替换的明确收益。该观察只针对一个短片、一个种子、后期RG-FVR，不代表H3生成时侧脸参考无效。没有新增4K或补帧。两个新运行均成功，无OOM；无损贴回的49帧遮罩外像素变化均为0。

Demo新增「换侧脸参考，嘴会更稳吗？」及实际参考图同屏，共67条/20组；原62条记录逐项保持不变。浏览器同屏完整播放2.041667秒、零掉帧，正脸/更侧脸同步双路均结束，无媒体或页面错误；390像素宽无横向溢出。完整原片SHA保持不变，执行器队列排空、维护状态解除；Comfy冷启动指纹首次暂未就绪，随后复核正式模型指纹一致。证据在 `angle-references/final-verification.json` 与 `browser-proof.json`。


## 生成阶段：身份参考组织五组对照

复用原受管 ComfyUI 和执行器 NVML 串行调度，没有安装权重、切换正式模型或新增服务。官方固定提示指南全文重新读取；将身份板专用描述改为通用身份描述，重跑基线，不能与旧提示结果直接做因果比较。统一 Ref2VA pruned INT8、20步 beta/res_multistep、shift12/3、seed73412、1344×768/124帧/24fps、match、场景图及同一静音粗模视频。

身份板/单正脸/单侧脸三组提示字节相同；多角度在正脸基础上增加两张侧脸，服装组在正脸基础上增加原身份板裁出的无脸服装图，仅在主体定义追加实际参考用途映射，其余正文完全相同。侧脸为此前原生生图的合成候选，不是实拍多角度真值；参考尺寸、token数和图片内容均可能不同，不能解释为纯角度实验。

|参考|执行耗时（秒）|人脸框中位宽×高（原生像素）|
|---|---:|---|
|原身份板|427.464|46.2 × 67.4|
|单独正脸|406.169|47.9 × 68.6|
|单独侧脸|406.172|48.1 × 70.9|
|正脸＋两种侧脸|429.055|46.8 × 69.1|
|正脸＋无脸服装|414.161|49.1 × 68.6|

五组整体轮廓接近，原生五官仍偏软，未看到足以采用的明确身份收益；多角度比单正脸多22.886秒，服装拆分多7.992秒。身份板首组包含不同缓存状态，不能把它与后续组耗时差全部归因于参考组织。以上是单场景、单种子的候选工作流对照，不推广为所有模型/角度/多参考无效。共有620帧，已查看各组完整人脸接触表，并检查同原生192像素窗口的全幅/局部对照；声音未完成主观验收。

实际提交图及上传文件SHA已核对；执行缓存记录显示各组参考条件节点5及采样节点10均重新运行，非复用旧结果。五组全部124帧、CFR和完整解码通过，人脸检测未缺帧；检测仅提供定位和大小，不证明身份。没有做后期修脸、超分或补帧，也没有因为一次不明显结果就不断增加种子。

Demo新增「生成时换正脸、侧脸，有帮助吗？」和「生成时多角度、脸与服装分开，有帮助吗？」共7条媒体，累计74条/22组。原67条记录逐项保持不变。两段同屏视频在独立浏览器均完整播放124帧、零掉帧，正脸/服装分离双路均播放结束，无页面/媒体错误；390像素视口无横向溢出。最终队列四项均0、维护关闭、正式模型指纹及两分钟原片SHA不变。本轮未重启服务；复用核验脚本中的PID前值来自早期归档回合，不作为本轮重启证据。

证据目录：`.tmp/three-body-quality-followup/reference-generation/` 的 `manifest.json`、`actual-input-matching.json`、`results.json`、`observations.json`、`browser-proof.json`、`publish-proof.json` 与 `final-verification.json`。原始任务位于 `face-runs/reforg-*-seed73412/`。本轮完成参考组织缺口，LBH两阶段精修和作者完整推荐配方仍未测试。


## 学习型中间状态放大与二阶段精修

本轮实际完成三次 GPU 生成：672×384、BASE20、seed73412、124帧24fps草稿；同一保存的视频和音频 latent 分别普通双线性2倍放大、LBH学习型2倍放大，再进行相同BASE8、denoise0.35精修至1344×768。两个高分任务除放大节点与输出名外图完全相同，提示、参考、种子和音频冻结设置一致。属于现有H3基础模型适配，不是作者完整底座＋Turbo4原配方。

|阶段|实际引擎耗时|含共享草稿总成本|
|---|---:|---:|
|384p草稿|135.695秒|135.695秒|
|普通放大＋精修|180.064秒|315.759秒|
|学习型放大＋精修|186.447秒|322.142秒|

学习型高分阶段比普通多6.383秒。普通组有明显重影、重复轮廓和纹理破碎，不能采用；学习型避免这类严重破坏，比草稿清楚，但脸仍偏软、偏年轻，身份未验收。已有直接768p正脸参考样本406.169秒作为视觉背景对照，其构图、参考编码尺度和缓存状态不同，不能据此宣称严格提速或身份优于直接768p。三个新结果完整124帧接触表已检查，同屏采用192像素原生窗口，不按脸大小归一。没有追加4K或补帧。

视频latent由[1,24,37,24,42]放大到[1,24,37,48,84]，中间和结果tensor均有限。冻结音频latent与源最大差1.4901161193847656e-08，并非逐bit相同；声音未完成主观验收。

来源：LBH作者仓库 `https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler` 固定40316cf008b2fd8663263270669eb4da23f89d2c；作者模型版本3f941d5d182014dd5c0a5e16330420ee2d4aa0c6，FP16文件690592672字节，SHA256 043e5a48e161610ef6c3ea974645220354d06fa618abca15f76d084812eb55c2。使用此前授权的哈希一致社区镜像加速，镜像revision b04d484cfcd97fa0cea9887f922fd6196564b54d，完整校验通过，不将同名镜像称为作者官方源。

一次学习型提交在预检因模型别名不可见拒绝，未获得prompt_id、未进入GPU，不计作推理失败。实际服务使用--models-directory /data/sas/ComfyUI/models，源码目录models别名不生效；查询object_info核对模块与可选模型后修正。旧请求ID重试409并不等于GPU忙，只读队列和proxy记录确认无执行后使用新attempt2。

Demo新增3条原生片和1条同屏片，旧74条记录保持，现78条/23组；同屏浏览器完整播放5.166667秒、零掉帧、无媒体错误，390像素视口无横向溢出。GPU任务结束后排空队列、移除本轮临时节点及两处模型别名并重启同一受管服务；保留下载权重与实验文件。正式模型指纹与原片SHA未变，队列四项均0、维护关闭；不将服务健康当视觉验收。

证据：`.tmp/three-body-quality-followup/latent-stage/` 下latent-proof.json、download-manifest.json、observations.json、publish-proof.json、browser-proof.json、remove-before.json、remove-after.json与final-verification.json。原生任务为face-runs/latent-*；初次预检失败记录保留。


## 原生生成阶段：加速与小脸质量联合对照

完成PDD8、Larry v4 6／8步、Singularity＋作者指定LightX2V Ref2V 4步四组真实推理。统一1344×768、124帧、24fps、seed73412、同一正脸图、雪景图、静音粗模视频及参考组织轮的提示正文；实际提交图共用节点与引用逐项匹配。全部不做后期修脸、超分或补帧。与旧身份板PDD实验不是同一输入，故重新生成正脸PDD基准。

|配方|引擎耗时|脸框中位宽×高|观察|
|---|---:|---:|---|
|PDD8|186.133秒|39.16×59.65|轮廓连续，五官软，身份未通过|
|Larry v4 6步|142.199秒|44.69×62.29|场景细节突出，脸略大，嘴部部分帧张开，身份收益不明确|
|Larry v4 8步|179.893秒|43.44×61.31|多37.694秒，脸部改善不明显，仍有嘴部开合|
|Singularity＋指定4步|92.754秒|37.42×55.48|最快，脸更小更软、偏年轻，未证明身份改善|

耗时含加载、编码、解码；PDD首轮与停用模型归档并行，Larry复用热基座，Singularity重新加载底座，不能作为纯采样速度排名。固定192像素窗口展示构图与脸大小差异，不把更大脸归因为身份优化。496帧接触表全部检查，四组检测完整不代表身份通过。没有足够明确身份收益，未追加第二种子；本轮嘴部只是无对白行走镜头，不是口型同步测试，原生声音未完成主观验收。

Larry采用已安装作者专用加载器与采样器，simple、strength1、low_vram=false；实际日志显示158个bypass适配器、50个INT8 fc2合并补丁与51个运行时AdaLN注入，并非完全没有量化合并。权重revision43a74557ac3f6539db8e0f2a959d03feb7a81480，SHA256 5f3a626cd72c93a8b9318d6760c510bc5092d2ab13aaba1f932c5bab07a416d3，已实核。

Singularity沿用作者原版Pruned v1.3 INT8（af671d9214a6e41ab8c2f43e9f871ea56246115f），配作者推荐 `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`、普通LoRA加载器strength1、euler/simple4、shift12/3；实际208组补丁挂载。LoRA为lightx2v官方ModelScope固定94b21758d9f5ff45b2a8e3cfc1875caf8c53cf01，SHA256 5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c，已实核。这是指定模型与LoRA组合的本机768p适配，不声称完整复刻作者工作流；该Ref2V4 LoRA训练分辨率544p，不能把本轮结论外推全部分辨率和精度。

来源：[Larry模型卡](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora)、[Singularity模型卡](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity)、[LightX2V作者训练规格与shift说明](https://github.com/ModelTC/Minimax-H3-Turbo)。

SSD起初仅约3GB，先将已停用Stand-In目录29,206,325,058字节复制机械盘、逐文件SHA校验、检查无打开句柄，再保留原路径软链接。Singularity从已有核验归档复制到新的SSD评测目录并核对作者SHA，未重新下载、未改正式权重。归档前后正式运行时不变。所有生成复用同一ComfyUI与执行器GPU调度，无新增节点、服务、端口或重启。结束后移除两个本轮专用模型别名，保留评测权重与结果。

首次PDD仅因准备图中的绝对素材路径预检拒绝，未取得prompt_id、未执行GPU；改为已有上传素材名后以v2请求完成，保留失败记录。后续四组均success，无OOM。

Demo增加4原生片和2比较片，旧78条记录逐项保留，现84条／25组。两段比较片与PDD/Singularity双路播放均完整结束、零掉帧、无媒体错误；390像素手机无横向溢出。执行器相关34项、服务端视频契约测试通过；初次从根目录调用tsx因依赖查找失败，改在server目录运行通过，不修改依赖。正式H3/PDD指纹、原两分钟成片SHA不变，队列四项0、维护关闭。

证据目录 `.tmp/three-body-quality-followup/turbo-native/`：experiment-design.json、larry-provenance.json、archive-manifest.json、restored-model.json、results.json、observations.json、browser-proof.json、publish-proof.json、cleanup-report.json与final-verification.json；原生任务位于face-runs/turbo-native-*-seed73412-v2。

## 抖音 Star7／VEDA 与 LTX Ingredients 同源实测

用户提供的两条原片分别展示 Star7／VEDA／高清二采／修脸，以及 LTX2.5 Ingredients＋角色参考板＋空间 latent 放大。实际检查原视频可见节点和设置后，本轮固定作者源码测试；未取得创作者原始工作流 JSON，以下是本机适配，不声称完整复刻。

- Star7：`star7code/minimax-h3-chunk-star7@404d319dc279cb80983cdaf2d33a5c63de849029`。其修脸复用 H3FaceRefine 跟踪裁脸，不是完全不同的身份模型。
- LTX：`Lightricks/ComfyUI-LTXVideo@220e1d45aa0469f518e982102fca4dca92a61862`，组合作者 Ingredients 与 Two Stage Distilled 模板。使用 LTX2.5 distilled NVFP4、Gemma INT8、Ingredients0.9、作者空间放大2倍模型。新增权重均从作者同名 ModelScope 固定版本下载，并核对 HF LFS SHA256及本地完整哈希，详见证据清单。
- PDD基线1344×768、124帧24fps、seed73412，参考与提示沿用原测试。重生成并保存原生音视频 latent 后，解码逐帧 MD5 与此前偏好版本完全相同。Star7各分支复用此状态；LTX直接编码原视频前49帧（2.04秒），不是传递H3 latent。

|方案|实际阶段耗时|输出及观察|
|---|---:|---|
|PDD原版＋保存状态|188.222秒|1344×768，仍作身份对照|
|Star7只修脸|额外92.434秒|同分辨率，后半段贴回重影；未采用|
|Star7只做高清二采|额外132.952秒|1856×1056；细节增加，同时改变头向、动作和局部构图|
|高清后再修脸|额外122.086秒|复用上一行latent；两阶段合计255.038秒，不含PDD；较直接修脸少见重影，未证明比只二采更好|
|普通H3路线，关闭VEDA|171.510秒|重新生成124帧；同参数开关对照|
|普通H3路线，开启VEDA|104.722秒|400次实际稀疏调用，SM120 Triton，非静默回退；构图、步态、脸也改变，不能当修脸模型|
|LTX放大，无角色参考|额外49.950秒|2688×1536／49帧；明显重画脸与场景，树桩出现类似木凳的变化|
|LTX Ingredients＋角色板|额外40.502秒|同尺寸／帧数；脸更圆、更年轻、画面偏柔，没有还原原角色|
|LTX Ingredients较弱重绘|额外29.508秒|3步改2步后仍有年龄与脸型偏移，没有足够身份收益|

时间均为实际引擎执行区间，含对应加载、编码和解码，不含排队。VEDA开关两轮缓存热度不同，开启轮含首次内核编译，不将171.5→104.7秒解释为稳定加速比例。LTX后续复用热模型，也不能说“加角色参考反而更快”。H3与LTX片长不同，不能横向比较表中绝对耗时。

Star7高清使用学习型latent放大、PDD训练尾部2步、2MP目标、4块／128重叠；实际对齐尺寸1856×1056。修脸使用“远景小脸”预设：强度0.48、裁脸768、上下文2.4、混合0.95、羽化18、4步；修复模型独立使用LightX2V4，避免把PDD训练网格直接套普通simple4步。LTX两组3步sigmas为0.909375／0.725／0.421875／0，较弱组去掉第一档。无参考组同时不加载Ingredients，对比的是组合方案，不是纯参考开关；较弱组只改变sigma段。角色板是原有正面全身、背面全身和正面头肩三栏图。

初次修脸缺少ultralytics，补齐固定依赖后通过；Star7分块先缺作者曲线网格，补齐并验证Git blob后仍因核心缺少`comfy.ops.linear_input_act_`失败。保留失败记录，未伪造接口或修改作者算法；VEDA改用作者支持的普通H3＋Sage＋VEDA路线，通过400次稀疏调用验证，跳过72.1%的完整注意力计算。该预测器为T2VA训练，Ref2VA结果仅代表本机此样本。完整Star7分块组合尚未通过。

未发现明确原生身份收益，不追加全片4K／60fps。全部9份原生片共891帧完整解码、时间戳和逐帧人脸接触表检查通过；没有把检测完整算作身份合格。5段等视野同屏片完整浏览器播放结束、零掉帧、无媒体错误，9原片浏览器元数据与尾部定位通过；390像素布局无横向溢出。LTX为静音短片，H3声音和对白口型未完成验收。Demo新增9原片＋5同屏，旧84条媒体及25组逐项保留，现98条／30组。

所有任务复用同一ComfyUI和执行器GPU调度。停用Singularity与IdentityShared约33GB复制归档、逐文件核对哈希并保留软链接；归档断言中的状态差异为模型发现从null变ready，同一PID、功能标志不变。LTX所需约35.9GB权重从旧归档恢复SSD并核验；未移动正式模型。测试结束已删除本轮所有临时节点与模型别名，重启同一服务恢复正式能力；保留评测文件和四个新增检测依赖，Torch／CUDA／OpenCV不变。最终正式H3/PDD指纹与原两分钟成片SHA一致，队列四项0、维护关闭。执行器34项及服务端2项视频契约测试通过。

证据：`.tmp/three-body-quality-followup/douyin-followup/` 下的源码及模型固定版本、`new-models.json`、`restored-models.json`、`archive-manifest.json`与`archive-audit.json`、`baseline-comparison.json`、`results.json`、`observations.json`、各API图与逐帧review、`browser-proof.json`、`publish-proof.json`、`cleanup-report.json`和`final-verification.json`；实际任务在`face-runs/douyin-*`。新增Demo组ID为`douyin-star7-face`、`douyin-star7-hd`、`douyin-veda`、`douyin-ltx-reference`、`douyin-ltx-strength`。

本轮原始来源：[高清放大展示](https://www.douyin.com/video/7677502224636906790)、[加速与小脸修复展示](https://www.douyin.com/video/7694171136967462182)、[固定Star7源码](https://github.com/star7code/minimax-h3-chunk-star7/tree/404d319dc279cb80983cdaf2d33a5c63de849029)、[固定LTX官方节点](https://github.com/Lightricks/ComfyUI-LTXVideo/tree/220e1d45aa0469f518e982102fca4dca92a61862)、[Ingredients作者模型](https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients)。
