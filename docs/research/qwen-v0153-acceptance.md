# v0.15.3 Qwen 音色设计验收

## 交付范围

正式 8290 已接入 `qwen3-tts-1.7b-voicedesign-local`，保留 CustomVoice、Base 和现有默认项；沿用协议 2、GPU 队列及 Unix Socket 工作进程。只生成通用验收音频，业务角色的音色设计与长期管理仍由调用项目负责。

VoiceDesign 权重来自作者 ModelScope 同仓，revision `8dd530dbed7fda907a15ac48d7f78742cc90a065`，Git LFS 哈希校验通过，实体位于 SSD 上独立 revision 目录。三个 Qwen 模型均完成官方权重检查和真实 smoke generation，逐模型就绪记录与文件、代码和安装依赖绑定；工作进程停止不清除有效记录。

正式队列与代理任务为空后备份并暂停服务，隔离验收完成才切换；旧配置、数据库和代码保存在 `~/.local/state/infinite-media-executor/backups/v0153-20260914-213026`。新版本维护标记真实返回 503，解除后恢复提交，其他项目 GPU 进程未停止。

## 固定节奏对照

两段通用中文文本 × 两个 seed（1531、1532）× 普通/舒缓指令 × VoiceDesign/CustomVoice，共 16 条输出。提示正文、seed 与其他参数成对保持一致。全部成功下载、保存及 ACK，并确认 ACK 后执行器结果不可再下载。

| 模式 / 文本 / seed | 普通秒数 | 舒缓秒数 | 时长比 | 普通字/秒 | 舒缓字/秒 | 内部停顿秒：普通 / 舒缓 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| custom-0-1531 | 15.04 | 18.40 | 1.223 | 2.73 | 2.23 | 3.58 / 6.46 |
| custom-0-1532 | 14.32 | 16.08 | 1.123 | 2.86 | 2.55 | 3.86 / 4.86 |
| custom-1-1531 | 16.80 | 17.92 | 1.067 | 3.15 | 2.96 | 5.30 / 5.52 |
| custom-1-1532 | 17.52 | 17.28 | 0.986 | 3.03 | 3.07 | 5.62 / 4.42 |
| design-0-1531 | 11.04 | 13.84 | 1.254 | 3.71 | 2.96 | 4.18 / 4.58 |
| design-0-1532 | 13.84 | 15.36 | 1.110 | 2.96 | 2.67 | 5.26 / 4.88 |
| design-1-1531 | 14.88 | 16.72 | 1.124 | 3.56 | 3.17 | 5.14 / 5.84 |
| design-1-1532 | 14.72 | 20.24 | 1.375 | 3.60 | 2.62 | 5.12 / 7.46 |

VoiceDesign 四组全部延长，中位时长增加 18.9%；CustomVoice 三组延长、一组略短，中位增加 9.5%。自然语言指令在这组样本中总体有效，但不是数值语速承诺，增加时长也不能单独证明停顿自然。

字/秒以移除标点和空白的原文长度除以完整音频时长；停顿以 20ms 单声道 RMS、-40dBFS 阈值检测，仅统计内部至少 150ms 的低能量段。此数值是声学近似，不是人工语言学标注。

全部 22 条隔离语音（16 条对照、3 条初步复用、3 条最终复用）均可解码、非静音，并完成独立 ASR 回读。回读 CER 使用 NFKC、小写、移除标点和空白，不做数字文本转换。对照中 VoiceDesign CER 为 0–7.55%，CustomVoice 为 0–1.89%；部分差异涉及“颗/棵”等字形及 ASR 额外“嗯”。未完整听审前不能直接判断为合成错误或 ASR 错误。

## 保存、重启及复用

采用 `design-0-1532-slow` 的已保存 WAV 和对应原文作为最终复用参考，其回读 CER 为 0。每次通过协议 2 重新上传，Base 生成两段新台词，再在实际停止 Qwen 工作进程后生成第三段；三次最终复用的回读 CER 均为 0。没有向 Base 传入 instructions、speed 或 emotion，也没有把它的参考声音效果表述为独立情绪控制。

冷启动证据：旧 PID `736933` 停止，新 PID `737217`；新进程只加载 Base 一次，任务诊断记录加载耗时 1.348 秒。初步验收脚本的相对 Socket 路径没有实际停止进程，因此那一次不作为重启通过依据；最终绝对路径及 PID/加载计数核对已补验通过。

## 正式应用与回归

- VoiceDesign 应用任务 `s8IRP1MMWejjQdLgkbmqX` 成功，文件 `bXuMmy634BdHXcx5ckUGd`。
- 下载后重新上传，再提交 Base 任务 `6wPORpHR2YISFWPv3dol9` 成功，文件 `fUvr5DGLEhAiWARHQloFh`。
- 两条结果均核对 SQLite 成功状态、实际下载大小及 SHA256；应用保存后执行器临时结果已 ACK 清理。
- Base 携带 instructions 经真实应用预检返回 400：`unsupported Qwen parameters for qwen3-tts-1.7b-base-local: instructions`。
- 最终执行器 68 项回归、服务端 42 项相关回归及服务端 TypeScript 检查通过。前次测试从仓库根目录启动导致服务端 Skill 路径错误，改在规定 server 目录运行后通过。

固定的 16 条对照请求另外保存在 `media-executor/examples/qwen-voice-design/cases.json`。交付的 `scripts/qwen-voice-reuse.py` 已对正式服务实跑通过，两条任务 `7d773c9e23dc44e9b3fdd8ce192b20df`、`9902c89b6d82467caf6906c20f2393e8` 均完成下载和 ACK。

完整输入、WAV、ASR、诊断与计算结果位于 `.tmp/v0153-acceptance/`，包括 `cases.json`、`evaluation.json`、`cold-proof.json` 和 `app/`；服务使用说明见 [Qwen 接口文档](../content/docs/development/qwen-voice-design.mdx)。

## 待试听边界

没有宣称音色一致性、自然停顿和情绪表达已经人工验收，也没有设计五个业务角色。需调用项目试听参考声音并决定采用；Base 不保证每句继承参考语速。长期保存参考 WAV、准确原文和生成参数，不依赖执行器临时 fileId 或仅保存 seed。
