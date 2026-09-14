# H3 迭代决策与验收缺口

当前产品路线是按能力选择PDD Ref2VA八步、保留基础版重做，并由导演Agent按叙事选择普通生成、首尾帧或原生续接。代码已实现适用图片参考且运行时就绪时默认PDD；独立音频参考与首尾帧不套用该加速结论。正式运行时切换仍待明确批准，最近真实Agent的007生成使用基础20步。当前验收项目是147秒《留一把》，尚未交付完整成片；旧42秒《留灯》保留为工程验证材料，不能替代真实Agent全流程验收。

## 方案取舍

| 方向 | 已有证据 | 决定 |
| --- | --- | --- |
| 官方提示 Skill | 固定官方版本，保留六段结构、参考标签、中文对白及实际提交提示 | 继续使用；不以模型名或简短泛化提示代替明确调度 |
| PDD 八步 | 十八项矩阵中六项对白转写完整，中位加速 1.712×；768p 双人对白单次配对 2.247×；尚未证明省显存 | 已接入适用路径的默认选择与基础重做；正式切换、完整声画和端到端成本仍待验收 |
| LightX2V 八步 | 三种子矩阵存在重复短句反例 | 保留可选实验，暂不作为默认 |
| OpenVDN | 当前剪枝量化基座出现 51 项 AdaLN 增量无法合并 | 当前移植不算完整复现；先解决适配，不能用现有速度评判官方模型优劣 |
| 原生续接 | 保存双流 latent、加载追加、累计解码及工程往返已实测；样章保留 379 帧、15.792 秒连续镜头 | 继续采用累计解码路线；完整感知连续性仍待验收 |
| 人物写实 LoRA | 104 组增量挂载；1.0 强度同输入对照出现推近和更迟对白，耗时无改善 | 本次不采用；不直接与 PDD 叠加 |
| H3-World 等控制路线 | 研究用途与当前短剧生产路径不同 | 不作为本轮成片交付的前置条件 |

参考来源与作品见[生态调研](minimax-h3-ecosystem-iteration.md)、[短片参考](h3-short-film-references.md)。作品作者说明、局部观众评价、社区复现、本机测试与完整视听通过分别记录，当前没有证据支持“公认顶尖 H3 短剧”排名。

## 对原目标逐项验收

| 原要求 | 直接证据与当前状态 | 未完成部分 |
| --- | --- | --- |
| 官方 Skill、生态及异常调研 | 固定提示来源；已调查并实测 PDD、LightX2V、VDN、原生续接与人物写实候选；有公开制作说明及争议记录 | 参考原片的完整视听分析不足 |
| 质量前提下加速 | 三配方三种子两场景；另有 768p 配对，含显存和失败记录 | 自动指标及抽帧不等于质量达标；不能计算每秒合格成片收益 |
| 生成阶段超过 15 秒续接 | 原生状态前缀、累计解码、重启恢复、导入后追加及真实媒体播放均有证据 | 完整动态、语义和声音无破绽仍未通过 |
| 角色、运动、镜头、低 AI 味 | 42 秒样章、身份板、镜头计划、候选及缺陷记录均可检查 | 全速表演、身份细节、肢体/物体物理及跨镜色调仍需视听验收 |
| 画面质量 | 原生 1376×768，导出 1920×1080，放大/适配方法明确 | 导出尺寸不是原生细节提升；不能宣称原生 1080p |
| 配音、口型、音乐与混音 | 样章原生对白、配乐及混音；ASR 与响度/峰值通过相应数值检查；新增已渲染成片播放入口 | 自然听感、音色、发声人和音素级口型未通过；对白计划时序有偏差 |
| 完整样章与导演集成 | 历史42.083秒工程验证有ZIP/续接/渲染/浏览器证据；当前147秒《留一把》由真实Agent规划，007已完成两次基础预览及实际页面播放 | 历史工程有事后重建；当前样章多数媒体仍缺失，不能以两段预览、手工样片或播放成功替代完整成片 |
| 正式服务健康与部署 | 正式运行时未被实验覆盖；部署副本曾验证相同解码与回滚准备 | 正式切换此前被自动审批拒绝，等待用户明确批准；批准后需重新核对当时服务状态 |

本表不缩小目标，也不把未验收项目转换为“可忽略”。目标仍未完成。

## 历史工程验证材料

- 完整样片：`.tmp/h3-evaluation/director-full-sample/final.mp4`，SHA-256 `787d785e03f92aba5becad326e8b361adcbd7e30557e70246dd69d5cc053d31e`。
- 导演工程：`.tmp/h3-evaluation/director-full-sample/liudeng-v4-project.zip`，SHA-256 `c17e5468b84c6f01ca5c9e90622f89992017eb464f3fcd26ca9afd73a3192371`。
- 工程与浏览器实测：`media-executor/examples/h3-evaluation/liudeng/director-full-sample-report.json`。
- 768p 对白加速：`media-executor/examples/h3-evaluation/liudeng/dialogue-768-pdd-pair.json`。
- 加速压力矩阵：[三种子验证](minimax-h3-multiseed-validation.md)。
- 续接实现：[原生续接集成](h3-native-continuation-integration.md)。
- 写实 LoRA 取舍：[对照报告](h3-realism-people-validation.md)。

## 当前工作流覆盖

| 路线 | 可直接核对的证据 | 仍缺少的验收 |
| --- | --- | --- |
| 普通Ref2VA默认加速 | [真实HTTP默认PDD及继承续接](../../media-executor/examples/h3-evaluation/pdd-production-entry-report.json)、[基础重做](../../media-executor/examples/h3-evaluation/base-redo-entry-report.json)；为专门工程夹具 | 正式运行时部署，真实Agent多图整板的PDD完整声画及效率 |
| 官方最终提示 | [真实Agent提交逐字节/哈希一致](../../media-executor/examples/h3-evaluation/agent-final-prompt-live-submission.json)，[新预览实际页面播放](../../media-executor/examples/h3-evaluation/agent-retry007-browser-report.json) | 指令遵循、身份、表演、对白与口型；提示直传不是质量保证 |
| 多模态声音参考 | 图片＋独立环境声参考经真实HTTP生成，默认基础20步，音频通过加载/条件节点进入采样，最终提示逐字一致；81.266秒，整卡采样最高31852MiB；离线ASR检出疑似“嗯”须听音复核 | 同一角色跨镜音色与身份、对白控制的产品实际生成，不以多图测试代替音频输入测试 |
| 首尾帧 | 独立过渡路由与早期固定样例 | 最新最终提示入口、实际前后镜头的边界一致性；不套用Ref2VA速度结果 |
| 原生续接 | [新最终提示入口基础20步真实生成](../../media-executor/examples/h3-evaluation/final-prompt-native-generation-report.json)：新增119帧，双流已有前缀精确保持，PCM WAV原声；历史超过15秒累计输出 | 完整动作与音频接缝、新入口下PDD及更长链路；基础配方结果不能替代其他模式 |
| Music3与混音 | [真实本地Music3输出](../../media-executor/examples/h3-evaluation/merged-runtime-music3-report.json)；独立配乐工具、淡入淡出、PCM原声及导出已接入 | 当前Agent样章实际配乐、听感及对白混音；模型输出不等于可用背景音乐 |
| 插帧与超分 | 历史样片有导出尺寸与适配记录 | 独立算法的细节、鬼影、动作自然性与端到端成本；简单缩放不算细节增强 |

## 成本口径

历史H3执行账本以 [all-recorded-executions.json](../../media-executor/examples/h3-evaluation/all-recorded-executions.json) 的目录范围为准；真实Agent图片调用另见 [agent-production-ledger.json](../../media-executor/examples/h3-evaluation/agent-production-ledger.json)。两者口径不同，不能相加后当作完整账单。007两次预览的参考哈希、不同随机种子与提交到落盘耗时见 [对照条件](../../media-executor/examples/h3-evaluation/agent-retry007-comparison-conditions.json)。

合格成片时长、货币成本、人工审片及所有重试的端到端成本仍未知，不默认为零，不用采用任务耗时掩盖被拒绝候选。此前42秒样片采用来源的1704.463秒仅是历史选中任务执行之和。

## 下一步顺序

006经真实Agent局部编辑采用，并通过[整板与完整提示浏览器验收](../../media-executor/examples/h3-evaluation/agent-storyboard006-browser-report.json)；004仍有物理连续性错误，005正在修订机位。继续补齐完整147秒叙事的媒体；007保留待审预览，依据实际问题决定后续处理。纸箱构图、切镜时刻偏移与对白口型分别记录，不能机械把导演偏好当成物理错误，也不能因生成成功放行。同步核实新PCM原声输出与声音理解能力，外部音频诊断未获明确批准前保持暂停。

正式PDD/原生续接/Music3运行时的切换和回滚方案见[部署验收](h3-merged-runtime-deployment.md)，此前自动审批要求的明确批准仍待答。最新回合、合入和验证状态以[真实Agent路线图](h3-agent-production-roadmap.md)为准；以下42秒样片审查是历史证据。

## 整片声音自动复核

对上述相同 SHA 的 42 秒成片运行 Qwen3-ASR、SenseVoice 与 FSMN-VAD，并分别检查四段及静音对照。两套识别器在整片及对白裁片均检出预期的“还没睡？这灯，刚修好。”；整片 VAD 仅检出 25.27–26.56 秒、29.50–31.77 秒两个语音区间。非对白裁片的零散“嗯”/“The”未获独立语音检测支持，且 Qwen 对纯静音也输出“嗯”，不能据此认定意外人声。整片强制对齐末字出现零时长，裁片对齐不同，因此不能将其当作口型验收依据。自然听感、发声身份与口型仍未验收。原始结果见 `media-executor/examples/h3-evaluation/liudeng/full-audio-audit.json`。

## 画面定点复核

按解码帧检查原生续接点（成片第 385 帧）前后及三个剪辑点。续接点抽帧中的父亲、手、双杯、台灯位置连续；递茶段每秒抽帧可见伸手、推杯、接住和收手。对白窗口每三帧裁切面部，父女均有口形变化，但不能据此认定音素同步。

新增待审点：33.958 秒 C/D 切镜前女儿仍握行李箱，切入桌面特写时手已放桌边；这可能是省略动作的剪辑，也可能显得突兀，需要带声常速判断。若不顺，应衔接 C 尾部的伸手动作与 D 开场，并固定杯位，而非先重做整片。原始帧号与限定结论见 `media-executor/examples/h3-evaluation/liudeng/visual-audit.json`；审看片位于 `.tmp/h3-evaluation/director-full-sample/` 的 `cut-boundaries.jpg`、`native-boundary.jpg`、`cup-review.jpg`、`daughter-mouth.jpg` 和 `father-mouth.jpg`。

续接编译器修正已补真实应用入口验收：同一原始状态、同一工程，实际提交提示末点为 8.708 秒；新增 187 帧、累计 379 帧，原音视频 latent 前缀精确保留，应用状态采用、累计播放计划和最终渲染成功。该 480p 基础配方测试不计为高清样章或 PDD 质量验证。详见 `director-native-compiled-report.json`。
