# 中立服务的音乐、ASR 与 TTS 选型

本轮为上游资料与本地代码核验，没有下载模型、修改默认值、停止服务或新增推理。质量结论需要同条件样本与完整听音；上游演示、参数规模和采样率不等于本机质量排名。MOSS 环境声/音效按用户决定保留；H3 默认路线继续保留 PDD。

## 建议

- 音乐先选一个默认生成方案，不立即删除另一套。Music3 与 ACE-Step XL SFT 先对比纯配乐和中文歌曲；ACE 的参考音频/改编能力单独评估，不按“都能出音乐”视为完全重复。
- ASR 优先把 Qwen3-ASR 1.7B 与发声检测、强制对齐接成中立服务；0.6B 保留为轻量候选。公开普通话与粤语评测各有胜负，FireRedASR2S 作为中文/唱词对照，不据单榜整体替换。
- TTS 以现有 Qwen3-TTS 为接入基线，比较 VoxCPM2；IndexTTS-2.5 作为情绪、发音与语速控制挑战者，CosyVoice3 作为方言/流式需求候选。
- 中立服务保留可复用能力，产品只选择默认项；保留权重不等于必须常驻显存。

## 当前代码事实

| 项目 | 已有实现 | 尚未具备或未完成 |
| --- | --- | --- |
| Music3 | 执行器内生成图，文字/歌词输入，1–300 秒参数范围 | 当前接口拒绝音频参考；不能据上游宣传增加未实现操作 |
| ACE-Step | 独立官方引擎与适配器，固定 XL SFT、50 步、1.7B LM；generate/cover/remix | cover/remix 当前均映射上游 cover；尚非完整音乐编辑工具箱 |
| Qwen3-TTS | 1.7B CustomVoice 固定音色与指令；Base 参考声音克隆 | 未接 VoiceDesign；现有适配器返回完整 WAV，未提供流式输出 |
| VoxCPM2 | 应用侧 ComfyUI 图，参考语音、文本归一化、降噪等参数 | 未迁入执行器中立能力目录 |
| ASR | 独立 ASRServer 接口包含 SenseVoice、Whisper、Qwen3-ASR；H3 评测脚本用 Qwen 转写与对齐 | 不在执行器能力目录；独立工程 README 的默认模型说明与 API 实现有差异，应以代码及后续实际配置为准 |
| MOSS | 环境声与音效生成已注册 | 保留独立调用，不要求 H3 每次额外生成音效 |

依据：`media-executor/src/media_executor/capabilities/{catalog,music}.py`、`media-executor/runtimes/{ace_step,qwen_tts}/app.py`、`server/src/comfy-workflows.ts`、`media-executor/scripts/transcribe-h3.py`，以及本机 `/home/cec/ASRServer/src/asrserver/app.py`。服务在线状态未在本轮确认。

## 音乐：先比较配方，再决定是否只留一个

[Music3 作者模型卡](https://huggingface.co/MiniMaxAI/MiniMax-Music3)侧重歌词、结构化音乐描述和最长五分钟完整歌曲。官方路径可自主结束，时长控制不能一概理解为严格输出指定秒数。本地 ComfyUI 路径曾输出 44.1kHz，作者其他路径描述 32kHz，因此比较必须记录实际文件参数。

[ACE-Step 作者仓库](https://github.com/ace-step/ACE-Step-1.5)提供多个大小及 Base/SFT/Turbo 变体，参考音频、Cover、Repaint 等能力随模型而异。我们当前用的是 [XL SFT](https://huggingface.co/ACE-Step/acestep-v15-xl-sft)，不能把 Turbo 的八步速度和低显存小模型数字贴到它上面。

[Sogni 自测](https://blog.sogni.ai/blogs/minimax-music3-vs-ace-step-15-xl/)公开六组创作简报和样音：Music3 使用 30 步与 INT8 planner，ACE 使用 XL Turbo 八步；5090 上 ACE 的约 150 秒音乐报告热运行约 25 秒，Music3 不同实际长度样本为 201–376 秒。作者在听感上偏好 Music3 的音质，同时保留 ACE 的速度与编辑优势。这是平台自测、不同输出时长及完整配方比较，不是我们 XL SFT 的同条件结果，更不是盲听共识。

本地已有 Music3 约 30 秒音乐的生成/传输记录，ACE 有约 10 秒音频的正式队列记录，二者场景、长度和计时口径不一致，不能据此计算胜负。ACE 历史电流噪声已修复，不能继续用旧坏配方对比新 Music3。

另一份[三首日语歌配对实测](https://note.com/ai_0049/n/nfe112826df56)也倾向 Music3 的首轮成歌与吐字，但样本很少，不能推广成中文排名。其 16GB 显卡卸载场景报告 ACE 两分钟歌曲约 80 秒，Music3 一分钟超过 700 秒；文中“三分钟约半小时”不是完成后的计时，不采用为实测值。两套模型都出现把结构标签中的额外文字唱出来的问题，因此测试应分别采用原生提示格式。

据此，Music3 是质量优先的默认候选，ACE XL Turbo 是快速生成候选；当前已接入的 XL SFT 则保留生成与改编评测。不能用 Turbo 的速度替 SFT 背书，也没有足够证据现在删除 ACE。

建议首轮 12 项：三种简报（30 秒克制纯配乐、60 秒有情绪推进的纯配乐、90 秒中文歌曲）× 两个种子 × 两套当前配方。保持创作目标和歌词一致，分别采用原生提示格式；同数字种子只为复跑，不代表跨模型相同噪声。固定每套配方后不针对单样本反复调优。明确记录自然结束、提前结束和后期裁切。

评审优先级：纯器乐是否出现人声、对白下是否喧宾夺主、音乐发展与自然结尾、中文歌词准确性、杂音与削波；再比较冷启动/热生成/切换成本、峰值显存和有效采用率。匹配响度后匿名听音，同时保留原始输出。仅在结果接近时以维护复杂度决胜。若 ACE 在改编上保有实际用途，可只保留为专用选项；若无用途且生成也不占优，再退出常规部署，不直接删除历史依赖。

## ASR：转写、检测和对齐分别负责什么

| 候选 | 值得验证的用途 | 取舍 |
| --- | --- | --- |
| [Qwen3-ASR 0.6B / 1.7B](https://github.com/QwenLM/Qwen3-ASR) | 多语言、中英混说、带背景音乐语音；配套 ForcedAligner 可提供字/词时间戳 | 首选家族；对比识别收益和 CPU/GPU 耗时后选默认尺寸 |
| [FireRedASR2S](https://github.com/FireRedTeam/FireRedASR2S) | 中文及方言、唱词；提供 VAD、语言识别、标点，mVAD 区分说话/唱歌/音乐 | 重点对照，尤其用于复杂声音，不先整体替换 |
| [Fun-ASR-Nano](https://github.com/QwenAudio/Fun-ASR) | 中文、热词与 CPU 部署路径 | CPU/低资源需要时作为备选；Nano 与 MLT 语言范围不同 |
| [MOSS-Transcribe-Diarize](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize) | 多人转写与说话人分段 | 有会议或多人说话归属需求再评测；与 MOSS-SoundEffect 是不同模型 |
| 现有 SenseVoice / Whisper | 独立交叉识别与既有使用 | 保留评测基线，不新增为多个产品默认入口 |

ASR 回答“说了什么”；VAD 提供“哪里疑似有语音”的证据；强制对齐回答“给定文本对应哪些时间”。必须先独立转写再与预期台词比较，不能把剧本强制对齐成功当作人物确实说了该台词。VAD 会漏掉低声与短音节，ASR 会误识别背景声，二者冲突要标记不确定，而非强行判定无声/新增对白。纯音乐、静音、气息、脚步、带音乐对白都必须进入测试。

### 公开对照结果

[FireRed 作者论文表 2](https://arxiv.org/html/2603.10420v1)报告的 CER（%，越低越好）如下。普通话与方言列是测试集宏平均，唱词为 Opencpop 单集；这是作者评测。

| 模型 | 普通话四集 | 方言十九集 | 唱词 |
| --- | ---: | ---: | ---: |
| FireRedASR2-LLM | 2.89 | 11.55 | 1.12 |
| FireRedASR2-AED | 3.05 | 11.67 | 1.17 |
| Qwen3-ASR | 3.76 | 11.85 | 2.57 |

[CanCLID 独立粤语实测](https://github.com/CanCLID/asr-bench)使用同一讲述者的二十集约 8.56 小时录音，统一 FSMN VAD、最长 20 秒分段，得到以下去标点 micro CER：

| 模型 | CER |
| --- | ---: |
| Qwen3-ASR 1.7B | 9.73% |
| FireRedASR2-AED | 11.07% |
| Qwen3-ASR 0.6B | 12.18% |
| SenseVoiceSmall | 13.04% |

Qwen 1.7B 在这组数据中比 0.6B 相对少约 20% 字错误，批处理耗时约多 10%。但只有一个讲述者，粤语字形差异也计入 CER，不能推成全部语言结论；FireRed 因显存限制使用不同 batch，不据此给模型速度总排名。两份测试统计口径不同，不跨表合并。综合既有接入与公开证据，优先评测/接入 Qwen 1.7B 是工程选择，不是宣布它中文全面最强。

首轮固定至少 24 段人工标注音频，覆盖普通话、短句低声、中英混说、BGM、噪声、无语音各四段。先比较现有 Qwen 两种尺寸与 SenseVoice，只有明显未解决问题再加 FireRed 对照。指标包括字错率、漏句/重复、无语音误报、人工发声边界误差、处理时长与内存；不只算一个总体平均值。人工标注不能用候选 ASR 自己生成。时间对齐和口型检查不等价，声纹分组也不等于知道剧情角色身份。

接入建议：复用任务、上传、结果下载及 ACK，新增明确的转写/对齐操作和结构化结果类型（文本、片段、起止时间、语言；说话人可选），不把文字结果伪装成音频。接口只收音频与可选语言/参考文本，不读取导演工程；字幕导出和剧本比较放应用层。CPU 检测可独立执行，GPU 转写仍进入资源调度。此次未实施。

## TTS：已有两套先比，再引入有差异的候选

| 候选 | 官方能力与当前价值 | 选择建议 |
| --- | --- | --- |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | CustomVoice、Base 克隆、VoiceDesign 分开的模型；已有前两项接入 | 作为当前基线；不能把新增 VoiceDesign 说成已经支持 |
| [VoxCPM2](https://github.com/OpenBMB/VoxCPM) | 声音设计、可控克隆、30 语言、48kHz；作者提供独立服务路径 | 与 Qwen 直接比较；若采用，可迁成独立运行时，减少对 H3 ComfyUI 生命周期的依赖 |
| [IndexTTS-2.5](https://github.com/index-tts/index-tts) | 情绪与音色控制、拼音/音素发音控制、duration_factor 语速调节 | 最有针对性的新增挑战者；语速比例不等于精确指定台词落在几秒内 |
| [CosyVoice3](https://github.com/QwenAudio/CosyVoice) | 方言、跨语言克隆、发音修正和双流式 | 方言或实时语音成为明确需求时优先；暂不增加部署数量 |

### Qwen 与 VoxCPM2 的差异有多大

[VoxCPM 作者汇总的 Seed-TTS-eval](https://github.com/OpenBMB/VoxCPM#-performance)给出以下结果；字词错误率越低越好，相似度越高越好。属于作者汇总的自动指标，不是本机同条件盲听。

| 指标 | Qwen3-TTS 1.7B | VoxCPM2 |
| --- | ---: | ---: |
| 中文 CER | 1.22% | 0.97% |
| 中文音色相似度 | 77.0% | 79.5% |
| 难句 CER | 6.76% | 8.13% |
| 英文 WER | 1.23% | 1.84% |

Vox 的中文克隆指标值得实测，但难句与英文没有全面领先；同页另一套 MiniMax 多语言测试中，中文 WER 又是 Qwen 0.928%、Vox 1.136%。因此现阶段保留 Qwen 为基线，Vox 优先验证角色声音克隆，不能只凭普通中文单项换掉 Qwen。该表的 IndexTTS2 数据也不能套给 IndexTTS-2.5。

补查的候选包括 [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) 的长文本、显式停顿与不同架构分支，以及 [Fish Speech S2](https://github.com/fishaudio/fish-speech) 的情绪与多人表达。前者与现有 MOSS 音效完全不同，不能视为已安装；后者采用专用研究许可证，需要核对选定权重条款。两者暂列观察，不扩大首轮部署。

[独立语音属性控制研究](https://arxiv.org/html/2608.00545v1)在 CosyVoice3、VoxCPM2、Fish S2 上发现，修改目标声音属性也可能带来非目标变化。因此情绪自然度与身份保持必须分别听评，不能把“支持情绪指令”等同于“变情绪不变音色”。

对照材料：普通旁白、人物情绪短句、数字/多音字/中英混合、长段落各四条。克隆任务使用相同合法参考录音及准确文本；固定音色任务与克隆任务分别统计。至少两次重复，关注漏字重复、读音、跨句音色一致、情绪自然性、停顿、目标语速及冷/热耗时；ASR 只辅助检查文本，自然度和身份保持需要匿名听音。

默认只选一个主要 TTS 家族；第二套只有在有明确且可重复的能力差异时保留。独立 TTS 用于旁白、音色参考和单独语音制作，不能把生成音频直接替换进 H3 视频就视为完成口型同步。全部候选的性能比较需要固定版本和实际推理后再结论，外部排行榜不直接合并。

## 本轮边界与后续顺序

资料选型后的 v0.15.2 已完成正式部署、音乐配对、ASR 固定样本双尺寸与 Qwen/Vox 对照，见 [部署验收](audio-v0152-acceptance.md)。仍未宣称选出音质赢家，完整听感待审；有明确缺口才增加挑战者。模型来源优先作者 ModelScope 同仓并固定 revision，否则用作者 Hugging Face；许可与依赖在具体选定版本后核对，不以第三方包的许可证替代权重条款。

H3 与其他 GPU 推理共享单卡，应分别记录排队和模型切换耗时。对外保留中立能力接口，对内按运行时隔离环境，避免为了统一入口把所有模型塞进同一 Python 环境。
