# H3 短片参考与可借鉴流程

目前找到有作品、制作说明和观众正面反馈的候选，但证据不足以给出“公认顶尖 H3 短剧”排名。以下制作参数来自作者陈述，评论代表局部观众反馈；尚未完成原片逐镜头、声音及压缩前画质审看。

| 参考 | 已核实的信息 | 对本项目的用途 |
| --- | --- | --- |
| [MEOW 47 原片](https://youtu.be/eNXcIxRu_4k) | 作者称 2分21秒喜剧短片，ComfyUI 原生 Ref2V，Krea 2 RAW 参考图；多数镜头 1MP、24fps、15秒、BF16 模型和编码器，RTX PRO 6000，最长渲染约23分钟，再放大至QHD。观众具体肯定了镜头、剧本组织、猫的动作和身份延续。[作者与评论](https://www.reddit.com/r/MiniMax_AI/comments/1vqijyj/meow_47_fully_local_minimax_h3_short_film/) | 参考图设计与选片是实际成本；不能把高显存 BF16 成片表现直接归给本机 INT8/NVFP4 加速配方。优先审看动作细节与角色稳定性。 |
| foxdit 全流程短片教程 | 作者公开工作流，讨论 DaVinci Resolve 剪辑与音频制作；观众赞赏流程和雪景调色，作者也承认成片音频有遗漏。[教程及讨论](https://www.reddit.com/r/StableDiffusion/comments/1vmug7r/making_an_entire_shortfilm_with_minimax_from/) | 把调色、对白可懂度、环境声和混音纳入成片验收。独立镜头剪辑可用于叙事，但不能替代本任务要求的真实连续续接。 |
| MiniMax 官方 H3 展示 | 官方页面展示多模态参考、原生立体声、片头和广告，宣称最高15秒、2K。这是供应商展示，不是本机开源量化配置验收。[官方页面](https://www.minimax.io/blog/minimax-h3) | 用于挑选镜头、声音和多模态能力的对照维度；不将展示或分辨率标签作为稳定产片证明。 |

## 本地迭代决定

1. 样章采用原创人物与剧情，避免靠熟悉的影视角色和配乐营造质量错觉。先交付可检查的剧本、镜头意图和参考设计。
2. 明确区分连续镜头与叙事切镜：前者检查运动、空间、声音的跨段连续，后者检查视线、轴线、情绪和节奏。
3. 每个候选保存提示、参考、版本、种子、耗时、拒绝原因；计入失败镜头与修复成本。
4. 加速不能跳过画质与声音验收；短片矩阵中 PDD 作为候选，完整对白时序与长片段仍须另测。

## 续接方案线索

[ttulttul 的原生 latent 续接节点](https://github.com/ttulttul/ComfyUI-Minimax-H3-Continuation)使用前段音视频 latent 尾部作为时间零的原生引导，在新窗口生成后丢弃重叠，追加新增部分并统一解码。它不保证语义无缝，累计 latent 占用仍随长度增长。本机隔离实验固定 `e1768d5fdfc6f9519d2090dcf78458c2d9625f80`，首轮为124帧起始段加三次119帧延伸，共481帧，约20.04秒。

[seitanism 的 Motion Context 工作流](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef)包含 AV Extension、AV Bridge 与音乐视频路线，作为下一候选审查。功能列表、社区推荐和本机质量通过分别记录，不能混用。

## 官方样片文件检查

已下载官方 `h3-en-v2-video-006-1785473655612.mp4`，ffprobe 显示2560×1440、24fps、15.084秒并含音轨。1fps抽帧可见唱片、剪影、文字与分屏片头排版；属于图形化片头参考，不能用于证明自然表演、口型或长续接质量。输出尺寸本身也不能证明原生生成分辨率。原文件及抽帧存于 `.tmp/h3-community-research/showcases/`。
