# MiniMax H3 生态与 Infinite Canvas 迭代建议

最值得优先投入的是 **Ref2VA 预览加速、参考用途表达、连续视频的声画衔接**。这些方向直接覆盖导演台已经存在的生产路径，收益更容易测量。新出现的 **OpenVDN / Video DeltaNet 应加入优先实验清单**，重点比较首尾帧生成的质量与耗时；其社区 Ref2VA 路线另行验收。ControlNet、视频局部修复和高清精修适合第二阶段；FastH3、流式生成和世界模型应分别评估，不能因为同属 H3 就视为当前导演流程的直接替换。

本报告以 2026-09-10 可访问的发布说明、模型卡、作者代码及当前项目源码为依据。公开示例、作者实测、代码支持和本项目验收是不同证据等级。本文没有运行新模型、安装插件、调用付费生成或切换正式服务；涉及画质和速度的建议均需本机对照验证。项目状态以源码为准，没有把旧环境的基准或运行记录当作当前验收结果。

**一、当前项目的位置**

| 能力 | 当前源码事实 | 迭代意义 |
| --- | --- | --- |
| 官方提示结构 | 已有 FL2VA 三段、Ref2VA 六段编译，以及官方 Skill 的本地摘录 | 应更新和补齐语义，重复安装 Skill 的收益有限 |
| 结构化对白 | 已绑定角色、语言、时间窗和发声方式，并校验声音字段与视觉字段 | 新方案必须保住对白原文、说话人和音画同步 |
| 普通导演视频 | 整张故事板和素材进入 Ref2VA；FL2VA 用于专门的过渡段 | 应优先选择有 Ref2VA 证据的模型和配方 |
| 快速预览 | FL2VA 在符合条件时为 Turbo 8 步；Ref2VA 仍为基础模型 20 步、480p | 普通导演视频尚未获得少步蒸馏的主要收益 |
| 最终成片 | 768p、20 步、Sage Attention；Ref2VA 使用 `beta` 调度及 `max` 参考尺寸 | 先保留为质量对照组，再比较新配方 |
| 连续段 | 裁出上一段最后 22 帧及原声，作为 Ref2VA 参考视频 | 有续接意图，但尚未固定上一段的生成 latent |
| 时间锚点 | 通用工作流能构建 `MiniMaxH3AddGuide` | 普通导演生成调用没有因此自动获得 latent 连续性 |
| 音频参考 | 可传三份音频；提示用途统一为 voice / dialogue timing / sound identity | 缺少逐份音频的用途、角色和时间范围绑定 |
| 执行器 | 已有固定 revision 安装、独立端口探测、GPU 排空与恢复 | 沿用现有隔离升级方式即可，无需另造部署系统 |
| 验收 | TODO 仍有固定十场景 H3 基准；pending-test 明确节点探测不等于质量通过 | 新生态接入应补齐真实样例，不能只检查节点存在 |

源码入口：[`comfy-workflows.ts`](../../server/src/comfy-workflows.ts)、[`director-render.ts`](../../server/src/director-render.ts)、[`h3-prompt.ts`](../../server/src/h3-prompt.ts)、[`director-generate-shots`](../../server/src/agent/scenes/director/skills/director-generate-shots/SKILL.md)、[`安装脚本`](../../media-executor/scripts/install-h3-ecosystem.sh)、[`执行器`](../../media-executor/src/media_executor/app.py)。

上述差距中，最直接的是普通视频的预览配方。当前 `h3Recipe()` 只有 `preview + fl2va + turboAvailable` 才走 8 步，其余预览均为 20 步。把已有 Turbo 当作“导演视频已经全面加速”会误判项目状态。

**二、近期生态变化与证据取舍**

| 方向 | 已核实的变化 | 对项目的判断 |
| --- | --- | --- |
| 官方 Skills | 一个可移植提示 Skill，另有八个依赖 MiniMax Hub 的风格工作流 | 引入知识和示例，保留自己的场景工具边界 [^1][^2] |
| LightX2V Turbo | 已有 FL2VA 768p 版本和 Ref2VA 4 步版本 | 比当前固定旧 FL2VA Turbo 更值得做模式对应的比较 [^5] |
| Alibaba PAI PDD | FL2VA、Ref2VA 均有 8 步权重 | 优先候选，先验证 Ref2VA 和中文对白 [^6] |
| ComfyUI 主线 | v0.35.0 包含 PDD、ControlNet 参考兼容、TE-only references、DiffSynth LoRA 兼容和 Sparse Attention 等更新 | 应检查主线能力后再决定是否安装额外节点 [^7] |
| FastH3 | 官方 Preview v1 发布四步稀疏蒸馏；公开保证范围为 T2VA | 适合文生视频实验，不能直接替换导演 Ref2VA [^9] |
| OpenVDN / VDN-H3 | 混合注意力与八步蒸馏；作者已增加首尾帧生成，社区已有 ComfyUI 移植 | 优先实验；明确区分作者确认的模式与社区 Ref2VA 扩展 [^28][^29][^31][^32] |
| H3 Max | fal 对 H3 的后训练模型，已有云端参考视频 API | 适合作为质量、延迟对照和可选渠道 [^10][^11] |
| Motion Context | 保存和重用声画 latent，并处理重叠窗口裁切 | 比当前尾部 MP4 参考多了一层实际约束 [^12] |
| ControlNet Union | 一份控制权重覆盖边缘、深度、姿态及修补等任务 | 可将“参考动作”升级为显式动作控制 [^13] |
| Prompt Rewriter | 出现基于 Qwen3-VL-8B 的专用改写 LoRA | 当前不支持 Ref2VA，优先级低于改进既有 Agent [^16] |
| RAVEN / H3-World | 分别探索流式生成、精确时段动作控制 | 有研究价值，但不是当前成片质量升级的首选 [^20][^21] |

有三处旧资料特别容易误导实施：PDD 曾需要专用加载支持，但现在主线已经合入；Kijai 的独立 Sol-Attn 节点已标记弃用，作者指向 ComfyUI/comfy-kitchen 内置实现；RAVEN 的模型卡已提供作者 ComfyUI 节点，不能再写成“没有 ComfyUI 路线”。这些更新均以作者或主线材料为准。[^8][^17][^20]

**三、官方 Skill 与提示工程：补语义，不重复搭架子**

官方 `h3-prompt-writing` 是 Markdown 加参考文件，不依赖外部调用。它按输入模式选用 Base 或 Ref2VA 指南，强调结构顺序、时间表达、引用标签及保留对白原文。我们的 `official-h3-prompt.md` 与 `compileH3Prompt()` 已覆盖主要形式要求。真正的差距在“每份参考究竟约束什么”，而不是缺少六个标题。[^1][^3]

官方八个风格 Skill 覆盖产品广告、三维动画短片、纸艺定格、品牌宣传、音乐字幕、合作游戏开场、拼贴解说和手绘真人混合等任务，但依赖 Hub 的生成工具、节点和选择卡。可以把适用的摄影、动作、节奏案例整理进现有领域 Skill 的参考资料或视觉风格模板；不应直接搬入 Hub 工具名和交互流程。[^2]

另一个官方入口是 MMX 的 `mmx-h3-video` Skill，侧重 API 媒体检查、任务等待、下载和错误处理。它适合作为渠道适配的参考，不适合让内置 Agent 绕开后端任务系统、直接使用 Shell 和 API Key。[^4]

建议进行以下有限修改：

| 内容 | 当前情况 | 建议 |
| --- | --- | --- |
| 参考用途 | 一般 reference、首尾帧和 continuation；业务编译时再按资产类型补文字 | 明确身份、构图、动作、音色、原声复制等用途，并生成可读输入清单 |
| 音频与人物 | 三份音频都得到相同用途描述 | 每份音频绑定说话角色，区分借音色、按原声表演和声景参考 |
| 保留范围 | `retentionDefinition()` 对主体采用通用保留描述 | 表达哪些属性保留、哪些可改变，避免身份图连服装或构图一起过度限制 |
| 提示校验 | 已校验剧本节拍、Shot 和对白窗口 | 增加未定义标签、角色音频错配、重复对白、参考用途冲突检查 |
| 上游同步 | 本地手工摘录，列出来源链接 | 标记实际采用的上游 revision，升级时查看规则差异及少量回归样例 |

可借鉴 `ComfyUI-MiniMax-H3-Guide` 的用途建模，以及 OpenH3-IR 的“生成结构后再检查”流程。前者仍有多个 WIP 示例；后者是年轻的独立实现，会进行语义扩写，不能当作官方 Context-IR 的等价复现。最小方案是在现有编译器和校验器中吸收需要的部分。[^14][^15]

特别值得试验的是 ComfyUI 新增的 **只进入文本编码器、不建立参考 latent** 的输入路径。整张故事板主要负责讲清时序与镜头安排，而角色图更关心身份保真。因此可比较“故事板作为语义参考”是否减少宫格、边框和构图污染。[^18]

这只是待验证假设。上游允许断开 VAE，不等于已经提供任意逐图混合策略；若要同时保留角色图的 latent 条件，需要进一步检查原生条件组合。不能直接断开全部参考的 VAE，也不能宣称该改动一定提高人物一致性。故事板仍保持完整媒体，不恢复逐格裁切或点击热区。

**四、推理加速：优先解决 Ref2VA**

PDD 是首选实验对象。PAI 已发布 FL2VA 与 Ref2VA 两份 8 步适配权重；它包含主干 LoRA 和分时段输出头，不能只加载普通 LoRA 部分。[^6]

ComfyUI PR #15908 已合入对应支持：转换后的头部可通过标准 LoRA 文件表达，使用适配的原生主线加载即可，不必默认安装另一套 PDD 节点。仍要确认权重格式、模型变体和调度设置与该实现一致；“文件成功加载”不等于蒸馏机制完整生效。[^8]

LightX2V 是第二个同类对照。其 Ref2VA 4 步 v0.1 训练于 544p，参考尺寸采用 `match`；FL2VA 768p 版本的 video/audio shift 与较早版本不同。当前项目把步骤、调度和注意力写在固定配方中，不能只更换 LoRA 文件名并继续沿用全部旧参数。[^5]

| 实验 | 保持不变 | 主要检验 |
| --- | --- | --- |
| 现有 Ref2VA 480p / 20 步 | 当前模型、参考、提示、种子 | 预览对照 |
| PDD Ref2VA / 8 步 | 同一提示、参考和输出尺寸 | 端到端时间、人物、对白、动作是否合格 |
| LightX2V Ref2VA / 4 步 | 同一业务内容；采用对应官方配方 | 是否适合纯视觉预览，声音损失是否可接受 |
| 当前基础模型 + 内置 INT8 注意力 | 步数和参考不变 | 单步提速与数值变化 |
| 当前基础模型 + 内置稀疏注意力 | 独立于少步实验 | 运动、遮挡、对白是否受影响 |

初筛时逐项替换，之后才测试组合。不要把少步、量化、缓存、稀疏注意力和低精度 VAE 一次性全部打开，否则无法确定画质问题和收益来源。

FastH3 需要另列。官方 8 月 27 日发布的 Preview v1 是 T2VA 学生模型；推荐 VSA 权重需要对应稀疏后端，不能直接换成 dense attention。其“最高 14 倍”等数据来自作者限定硬件与基准，不能套用于项目的单卡 5090。社区有人将其用于参考图和口型视频，但这属于模式外实践，需要独立证据。[^9][^19]

建议前端继续只呈现“快速预览 / 最终成片”。后端配方记录模型变体、权重 revision、加载布局、采样器、视频/音频调度、参考尺寸策略、注意力后端和实测通过范围。只有 Ref2VA 样例通过后，才让普通导演预览自动采用新配方；基础最终档继续保留。

**OpenVDN 专项：研究价值高，接入需要分模式验证**

OpenVDN 模型卡的初始发布记录为 9 月 6 日；作者代码仓库在 9 月 8 日宣布同一 checkpoint 支持 I2VA、FL2VA 和 L2VA。不能只看较早的模型卡，将其限定成纯文生视频。作者在 issue #5 中进一步确认首帧和首尾帧可用，同时明确没有训练专门的 Ref2VA 模型；参考控制可以尝试社区实现。[^28][^29][^31]

VDN 的技术增量是把近邻画面保留在精确 softmax 注意力中，远距离画面交给线性分支；首尾边界保持全局连接，再结合学习到的门控。它改变了注意力结构，并配有训练后的分支和适配器。其双向长程上下文服务于当前生成片段，不能据此认为已经获得任意长视频的跨段持久记忆。[^30]

| 比较项 | PDD | FastH3 Preview v1 | VDN-H3 |
| --- | --- | --- | --- |
| 主要变化 | 输出头与少步蒸馏 | 少步蒸馏及 VSA 稀疏注意力 | 近邻 softmax + 长程线性分支及少步蒸馏 |
| 最贴合的当前用途 | 导演 Ref2VA 预览 | 画布文生视频实验 | 画布图生视频、首尾帧、导演专用过渡段 |
| 普通导演 Ref2VA | 有对应发布权重 | 官方范围尚未覆盖 | 有社区扩展；作者无专门训练模型 |
| 接入方式 | 对应版本 ComfyUI 原生加载支持 | 对应后端或社区适配 | 作者推理栈或社区 ComfyUI 节点 |
| 质量结论 | 本项目待测 | 本项目待测 | “近乎无损”是作者表述，本项目待测 |

VDN 公布的 14.4 秒、768p 视频在 8×B200 上用 11.23 秒完成，统计的是稳定状态去噪，排除了加载、预热、VAE 解码和 MP4 编码。不能将其作为用户从点击到拿到视频的等待时间，更不能外推成单张 5090 的速度。[^28]

针对现有机器，应先研究 Saganaki22 的 ComfyUI 移植。它可在原生 H3 上应用分支和适配器，支持 pruned/int8 路线，已有 5090 和 Ref2VA 示例。作者也明确额外分支的显存与计算代价，以及 `fast_kernels` 在部分环境的质量漂移问题。它提供了可以实验的实现，但不意味着获得数据中心栈的速度。[^32]

T8 的实现还提供多图、参考视频、独立音频和混合输入案例，可作为第二条对照。其“上游仅 T2VA”的文字已经落后于 OpenVDN 的首尾帧更新；Ref2VA 仍应按社区扩展看待。不要把不同节点所需的底模、适配器和加速 LoRA 混用。[^33]

推荐先做两项有边界的验证：第一项在画布或独立实验中比较基础 FL2VA、LightX2V 与 VDN 的相同首尾帧任务，选择较长的片段观察动作细节和等待时间；第二项把整张故事板、角色图及中文对白送入社区 Ref2VA 路径，验证它能否满足普通导演任务。第二项未通过之前，不能为了使用 VDN 而改掉整张故事板 Ref2VA 的产品路线。

运行时也须分清：作者优化路径使用特定 PyTorch、FlashAttention 与 Diffusers 配置；另有 Modular Diffusers 的 offload 路径，两者并不对应同一性能。代码配置中 FP8、预热、视频/音频 shift 均是完整配方的一部分，不是单个通用 LoRA 开关。[^29][^34] 原型优先用隔离 ComfyUI 和作者原始增量权重，并按项目规范优先核对作者链接的同名 ModelScope 仓库、固定 revision，不下载整个模型包作为第一步。

本次核验的作者代码 revision 为 `1cc4d48ad51ad7f77dcf6e1a79fb3851082b8958`，Hugging Face 模型 revision 为 `84932c28f0451df1d3e47219e3e80420edd46fec`。这是资料快照，后续实验应重新核对，并单独固定社区节点版本。

**五、长视频连续性：由参考尾帧发展为保留生成上下文**

当前 `extractContinuationTail()` 从 MP4 取约 0.92 秒、22 帧及原声，后续放入 `ref_videos` 和 `ref_video_audios`。这能传达运动与声音参考，却没有保存或固定上一段 latent。当前导演调用也没有把这份尾部输入转换为 `temporalGuides`；不能仅因通用工作流支持 AddGuide，就认定普通导演续接已经具备硬约束。

Motion Context 提供的新增机制是：上一段声画 latent 保存后供下一段使用，视频尾部作为固定窗口，音频窗口向接缝之前回溯，再同步裁掉输出中的重叠部分。作者还提供接缝探测工具。它仍需在项目的参考图组合和配方上验证，不能承诺任意长度都无漂移。[^12]

建议以一组连续三段做原型，沿用现有 `continue`、前段依赖和过期传播，不改变视频段生产单元。工程需要完成以下对应关系：

| 对象 | 必须表达的信息 |
| --- | --- |
| 续接上下文 | 前段 generationId、revision、模型/VAE revision、画幅和帧率 |
| 缓存文件 | 视频与音频 latent 的配套保存；生成任务之间可定位 |
| 时间预算 | 为重叠窗口预留推理帧，裁切后满足计划时长 |
| 剪辑输出 | 画面和声音一起裁切，避免重复动作或重复音节 |
| 前段重生成 | 后段标记过期；旧上下文不可被误当成新成片的上下文 |

latent 文件应是与权威生成记录绑定的执行缓存，而不是替代 SQLite 和正式媒体文件。若原生成没有该缓存，应明确采用重新编码的续接方式，或重新准备上下文；不要静默声称与原生 latent 延续等价。

另一项接入约束是云端参考视频长度。项目当前约 0.92 秒的尾部 MP4 不能直接套入要求 2–15 秒输入的 H3 Max 参考 API。应把本地重叠上下文和云端参考素材准备分别处理。[^11]

**六、从提示运镜走向动作控制和局部修复**

PAI 的 MiniMax-H3-Fun-Controlnet-Union 支持 Canny、Depth、HED、MLSD、Pose 和视频修补。额外控制分支约 6.8 GB，模型卡演示使用 40 步，因而它首先解决可控性，并不是加速模型。[^13]

ComfyUI 后续补充了参考/关键帧兼容，PR #16020 明确记录了 Ref2VA + 参考图 + 控制视频的验证。这一点使它比早期只能单一路径演示的方案更符合我们的角色素材流程，但仍不构成本机显存和画质验收。[^24]

建议首先提供一个窄功能：“使用动作参考”。用户给出动作视频后，选择按姿态或深度控制，角色和场景仍沿用当前素材。最小验收场景是角色走位、转身、伸手取物和简单跟拍，先观察动作是否跟随及脸部是否漂移。不要立即开发庞大的三维导演编辑器。

视频修复可比较 ControlNet 的修补路径和 LanPaint。LanPaint 作者已提供 H3 视频、音频联合修补示例，能处理逐帧蒙版与音频区间。[^25] 对产品最有价值的用途是“主体表演可用，只修某个局部或声音区间”，减少整段重生成造成的回退。

局部修复必须作为独立工作流，记录源视频与蒙版。验收同时查看未编辑区域是否保留、蒙版边缘是否闪烁、脸部和服装是否改变、原声是否意外重写。低分辨率静态图片的修复成功，不能替代视频时序验证。

**七、成片精修、云端模型与训练**

本地基础 H3、官方完整 2K 流程和第三方超分需要分开。MiniMax 官方说明：H3-Base 输出 768p；Context-IR 和 Regenerate-2K 属于完整系统中的另外环节，并未随基础模型完整开放。Regenerate-2K 会结合原始上下文重新生成，不能称为普通无损放大。[^26]

社区 latent upscaler 可作为较轻的实验：在潜空间放大后再精修，减少解码、像素缩放、重新编码的往返。LBH-123-AI 发布了专用于 H3 24 通道 latent 的模型和示例。[^27] 项目可尝试“采用预览后精修”，但不能默认保证构图、脸和音轨逐帧保持。更换配方时，同 seed 也不代表同一条视频。

H3 Max 是 fal 后训练的云端路线，值得与本地 H3 同样例比较；作者关于画质和极低延迟的描述应视为供应商评估，不能直接代替端到端结果。[^10] 它的参考 API 已有图片、视频、音频字段，并返回 `expanded_prompt` 和部分运行时间信息。[^11]

当前项目的 endpoint 注册表没有 fal 原生适配，所以直接接入其队列 API 需要服务端适配，不能只在现有下拉框增加模型名。应沿用管理员凭据、文件托管、任务查询和取消；明确保存提交提示与服务端返回的扩写提示。扩写字段为空时，不应把提交文本标为已知的模型最终提示。网页宣传的推理秒数也应与上传、排队、扩写、编码、下载后的总等待时间分别记录。

专用 Prompt Rewriter 8B 是加载在 Qwen3-VL-8B 上的语言/视觉模型 LoRA，不是加载到 H3 视频模型上的 LoRA。作者明确其支持文生和首尾帧改写，不支持 Ref2VA。[^16] 我们普通导演流程恰好使用 Ref2VA，因此当前不值得优先新增这套常驻服务。需要时可在画布基础模式离线比较，并避免默认增加视觉理解调用。

个性化训练方面，DiffSynth-Studio 已提供 FL2VA / Ref2VA 的训练、LoRA 及验证入口，包括先缓存数据再训练，以及音频损失权重等配置。[^23] 它可以支持以后为固定人物、特定服饰或固定表现风格建立训练实验，但“推理能在消费卡运行”不等于“高质量训练也能轻松运行”。先拿现有身份板、多模态引用和稳定提示建立基线，再判断是否确实需要训练；不要从少量成功样片直接得出人物 LoRA 可以替代角色资产。

**八、研究前沿与暂不采用项**

| 方案 | 研究价值 | 当前限制与取舍 |
| --- | --- | --- |
| RAVEN Streaming LoRA | 将 H3 转为分块因果生成，探索边生成边播放 | 作者已有 ComfyUI 节点，但仍标注预览、细节不足和实时速度待优化；不替换最终档 [^20] |
| H3-World | 将人物与镜头指令绑定时间区间，减少动作控制串扰 | 游戏样本上的研究结果，尚未证明影视角色和长对白生产效果 [^21] |
| Code World Model | 用代码维护世界状态，代理视频承载空间和时间约束，再交给 H3 渲染 | 对未来空间预演有启发；需要额外表示与训练链路 [^22] |
| 低比特混合、模型合并、风格提取模型 | 可能降低内存或改变观感 | 先确认来源和加载兼容，避免仅凭大小或模型名替换现有基线 |
| 大量缓存/注意力节点叠加 | 有潜在速度收益 | 主线已吸收部分能力；先使用可解释、可分别测试的原生实现 [^7][^17] |
| 整套社区 Director UI | 有交互和流程案例可参考 | 我们已有项目、素材、故事板、时间线和权限模型，搬整套会形成双重状态 |

H3-World 提到 8,000 个游戏样本、10,000 次 LoRA 优化和少量可训练参数。这些数字说明适配可能较轻，不代表本项目只需相同预算就能获得电影级动作控制。[^21] Code World Model 中“世界状态与视觉渲染分离”的思想更适合作为长期架构参考，近期可以先保留结构化起止状态和动作意图，不启动世界模型产品线。[^22]

**九、建议的实施顺序与验收方式**

以下是优先级建议，不是已经排期或完成的功能。

| 阶段 | 具体交付 | 范围 | 进入下一步的证据 |
| --- | --- | --- | --- |
| P0：建立比较基础 | 固定样例、种子、输入、阶段耗时和音视频结果记录 | 复用现有十场景 TODO | 能复跑并与现有配方逐项比较 |
| P0：参考表达 | 更新官方规则来源，增加音频用途和角色对应，补引用校验 | Agent Skill、编译器和小范围语义字段 | 标签不漂移、对白不改写、参考表与实际请求一致 |
| P0：Ref2VA 加速 | PDD 8 步与 LightX2V Ref2VA 对照；主线注意力独立测试 | 隔离运行时及后端配方 | 普通导演视频显著减少等待，质量和原声通过 |
| P1：VDN 优先实验 | 先比首尾帧，再试社区 Ref2VA；逐项记录原声、身份和动作 | 独立 ComfyUI 原型，沿用现有素材 | 在 5090 上有实际收益，且参考图与对白不退化 |
| P1：参考路径实验 | 比较整张故事板普通参考与语义参考 | 独立工作流实验 | 宫格泄漏下降，身份和镜头顺序不退化 |
| P1：连续段 | latent 上下文、声画重叠裁切、接缝检查 | 三段连续原型 | 无重复帧/音节，动作、音色和节拍衔接可接受 |
| P1：可控动作 | Ref2VA + Pose/Depth 控制视频 | 专用动作工作流 | 动作跟随、人物保持、显存与耗时可接受 |
| P2：精修 | 局部声画修复、latent 高清精修 | 两条独立工作流 | 保留已采用的表演及非编辑部分 |
| P2：云端选择 | H3 Max 原生服务端适配与同样例对照 | 可选渠道 | 全流程等待、质量和实际成本具有优势 |
| 观察 | FastH3 模式扩展、RAVEN、世界模型、人物训练 | 独立实验 | 对目标业务有可重复的优势，再考虑产品化 |

建议把十场景分成：静默人物近景、单人中文对白、双人轮流对白、快动作、遮挡后身份保持、复杂运镜、完整故事板两 Shot、多参考素材、三段连续动作、连续声音/节拍。第一轮只选其中四类筛掉明显不合格配方；候选再覆盖全部场景，每场景至少三个固定种子。三种子是初筛建议，不是足以证明普遍可靠性的统计标准。

记录至少包含：模型和节点 revision、最终工作流摘要、分辨率和实际帧数、视频/音频有效时长、冷启动与热运行时间、文本/参考编码耗时、采样耗时、VAE 解码及保存耗时、峰值显存与内存、失败率。速度用同场景端到端中位数比较，避免把 480p 对 768p 或热启动对冷启动称为纯算法收益。

质量检查采用原视频及原声：身份、服装、角色数量、动作完成度、切镜数量、宫格泄漏、对白逐字内容、说话人、口型和声画同步。接缝另看重复动作、画面冻结、色彩变化、音量台阶、音节和节拍断裂。客观指标用于定位问题，最终仍需人工观看和听音。

建议产品第一轮完成“参考语义 + Ref2VA 加速”，并输出通过和未通过的样片对照；VDN 同期作为独立的优先研究实验，首尾帧与 Ref2VA 分别给出结论。此后再引入连续 latent 和 ControlNet，防止一次变更多个条件导致结果不可归因。现有最终档、固定版本部署与手动发起生成的产品边界继续作为实施基础。

**十、来源与核验入口**

以下链接均指向原作者、模型发布者或项目主线。发布日期或合并日期在已核实时标注；动态 README 和模型卡以本报告资料截点为准。生态目录只用于发现线索，关于可用性和能力的结论优先依据具体发布源。

[^1]: MiniMax，[H3 Prompt Writing Skill](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/SKILL.md)。输入模式、结构与可移植性。
[^2]: MiniMax，[H3 Skills 目录](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/README.md)及[主仓库说明](https://github.com/MiniMax-AI/MiniMax-H3)。九个 Skills 及 Hub 依赖边界。
[^3]: MiniMax，[Base 指南](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt)、[Ref2VA 指南](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt)。主体、引用、保留范围和对白规则。
[^4]: MiniMax，[MMX H3 Video Skill](https://github.com/MiniMax-AI/cli/blob/main/skill/h3-video/SKILL.md)。云端任务、媒体检查和凭据使用方式。
[^5]: ModelTC / LightX2V，[MiniMax-H3 Turbo](https://github.com/ModelTC/Minimax-H3-Turbo)。版本、模式、训练尺寸、调度与参考尺寸配方。
[^6]: Alibaba PAI，[MiniMax-H3-Acc-LoRAs](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs)。FL2VA/Ref2VA PDD 权重及示例。
[^7]: Comfy-Org，[ComfyUI v0.35.0](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.35.0)。发布于 2026-09-09 UTC，包含 H3 主线更新。
[^8]: Comfy-Org / Kijai，[PDD 支持 PR #15908](https://github.com/Comfy-Org/ComfyUI/pull/15908)。2026-08-28 UTC 合并；输出头、加载和调度机制。
[^9]: FastVideo Team，[FastH3 Preview v1 发布说明](https://haoailab.com/blogs/fasth3-preview/)，2026-08-27；[LoRA 模型卡](https://huggingface.co/FastVideo/FastVideo-FastH3-4-step-Preview-v1-LoRA)。T2VA 范围、VSA 要求、速度条件。
[^10]: fal，[Introducing H3 Max by fal](https://blog.fal.ai/introducing-h3-max-by-fal/)，2026-08-27。后训练定位和供应商评估。
[^11]: fal，[H3 Max Reference-to-Video API](https://fal.ai/models/minimax/h3-max/reference-to-video/api)。输入、参考长度、扩写提示和耗时字段。
[^12]: NikoDemon80，[H3 Motion Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)。latent 传递、音频窗口、重叠裁切和接缝探测。
[^13]: Alibaba PAI，[MiniMax-H3-Fun-Controlnet-Union](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union)。控制类型、分支大小和示例设置。
[^14]: ethanfel，[ComfyUI MiniMax H3 Guide](https://github.com/ethanfel/ComfyUI-MiniMax-H3-Guide)。Typed Plan v2、参考用途与示例成熟度。
[^15]: ruashots，[OpenH3-IR](https://github.com/ruashots/open-h3-ir)。独立 Context-IR 实现及约束。
[^16]: LightX2V，[Prompt Rewriter LoRA 8B](https://huggingface.co/lightx2v/MiniMax-H3-Prompt-Rewriter-LoRA-8B)。Qwen3-VL-8B 基座和不支持 Ref2VA 的范围。
[^17]: Kijai，[ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton)。弃用声明和内置实现指向。
[^18]: Comfy-Org / Kijai，[TE-only references PR #16065](https://github.com/Comfy-Org/ComfyUI/pull/16065)，2026-09-03 合并。不构建参考 latent 的可选路径。
[^19]: matsuo-koya，[MiniMax H3 speed-up notes](https://github.com/matsuo-koya/minimax-h3-notes)。单卡 5090 作者实测；包含部分已被上游更新替代的判断，未直接移植其结论。
[^20]: Imperial College / mvp-lab，[RAVEN H3 模型卡](https://huggingface.co/mvp-lab/MiniMax-H3-RAVEN-Streaming-LoRA)及[作者 ComfyUI 节点](https://github.com/YanzuoLu/ComfyUI-MiniMax-H3-RAVEN-Streaming)。预览限制和消费卡路线。
[^21]: Danze Chen 等，[H3-World: Turning Language Understanding into World Control](https://arxiv.org/abs/2609.01560)，2026-09-01。时段动作和镜头控制研究。
[^22]: Yiwen Chen 等，[Code World Model: Coding Agent as World Brain](https://arxiv.org/abs/2608.25927)，2026-08-26。可执行状态与代理视频研究。
[^23]: ModelScope / DiffSynth-Studio，[MiniMax-H3 文档](https://github.com/modelscope/DiffSynth-Studio/blob/main/docs/en/Model_Details/MiniMax-H3.md)。推理、训练、缓存及音频损失配置。
[^24]: Comfy-Org / Kijai，[Fun Union 参考兼容 PR #16020](https://github.com/Comfy-Org/ComfyUI/pull/16020)，2026-09-01 UTC 合并。Ref2VA 参考图与控制视频组合。
[^25]: LanPaint 作者，[LanPaint](https://github.com/scraed/LanPaint)。H3 视频及音频区间修补、v2.1.0 支持说明。
[^26]: MiniMax，[H3 系统与 Full 2K Workflow](https://github.com/MiniMax-AI/MiniMax-H3#system-overview)。基础模型、Context-IR 和 Regenerate-2K 的边界。
[^27]: LBH-123-AI，[H3 Latent Upscaler](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler)。专用潜空间放大模型与工作流。
[^28]: OpenVDN，[VDN-H3 模型卡](https://huggingface.co/OpenVDN/vdn-minimax-h3)。权重、初始发布日期及去噪基准口径。
[^29]: OpenVDN，[代码与使用说明](https://github.com/OpenVDN/vdn-minimax-h3/tree/1cc4d48ad51ad7f77dcf6e1a79fb3851082b8958)。9 月 8 日首尾帧支持更新、两条推理路径及 ModelScope 来源。
[^30]: OpenVDN，[VideoDeltaNet on MiniMax H3](https://openvdn.github.io/)。混合注意力、全局边界与门控机制；质量对比为作者材料。
[^31]: OpenVDN，[FL2VA / Ref2VA issue #5](https://github.com/OpenVDN/vdn-minimax-h3/issues/5)。作者确认基础关键帧模式，明确没有训练专门 Ref2VA 模型。
[^32]: Saganaki22，[ComfyUI-VDN-H3](https://github.com/Saganaki22/ComfyUI-VDN-H3)。原生 ComfyUI 移植、5090 实践、额外显存及快速 kernel 的限制。
[^33]: T8mars，[comfyui-minimax-h3-audio-T8](https://github.com/T8mars/comfyui-minimax-h3-audio-T8)。OpenVDN 的多模态社区扩展工作流，区别于作者训练声明。
[^34]: OpenVDN，[8NFE FP8 配置](https://github.com/OpenVDN/vdn-minimax-h3/blob/1cc4d48ad51ad7f77dcf6e1a79fb3851082b8958/configs/inference/8nfe_tuned_fp8.yaml)、[模型装配](https://github.com/OpenVDN/vdn-minimax-h3/blob/1cc4d48ad51ad7f77dcf6e1a79fb3851082b8958/src/inference/utils/assemble.py)。实际运行参数与装载顺序。

项目待办与待测清单已核对。本次产出为研究建议，没有实现功能、完成现有待办或新增可验收行为，因此不改变 TODO、pending-test 和 Unreleased；建议获采纳并实施后，再按实际交付更新这些清单。
