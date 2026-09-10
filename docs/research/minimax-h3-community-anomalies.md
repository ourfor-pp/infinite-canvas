# MiniMax H3 异常的社区证据与排查结论

## 结论与适用范围

社区已有额外对白、固定机位失效、动作节奏难控制和噪声被 ASR 识别成短词的第一手反馈。它们支持继续排查这些现象，但不能证明所有案例具有同一个根因，也不能据此估算失败率。本轮仅检索公开讨论并核对本机测试代码，没有追加生成或调整正式服务。

本机对照见[多场景复核](./minimax-h3-second-batch-validation.md)。其中 LightX2V 特指 `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`，不能把该版本的结果推广到全部 Turbo 权重。

## 相近问题与证据强度

| 本机现象 | 社区第一手证据 | 判断 |
| --- | --- | --- |
| 泳池画外音重复完整台词 | [RTX 5090 Ref2VA 音频反馈](https://www.reddit.com/r/StableDiffusion/comments/1vx23t1/minimax_h3_audio_issues/)列出 BF16 基座、BF16 编码器、不加 LoRA、已包含特殊标记修复的环境，仍出现未要求的对白和乱码语音 | 额外对白并非只有 Turbo 用户报告；本次检索尚未找到与我们同权重、同条件的完整句子重复复现，不能认定为同一缺陷 |
| 明确要求固定机位，画面仍跟随主体 | [固定镜头仍移动或切镜](https://www.reddit.com/r/StableDiffusion/comments/1vfhe9j/minimax_h3_camera_cuttingmoving_when_i_said/)报告尝试 static、stationary 后仍然平移 | 与我们的机位失效现象相近；帖子未提供足以确定根因的受控对照 |
| 动作、对白没有严格按时间执行 | [快速运动讨论](https://www.reddit.com/r/StableDiffusion/comments/1vsrvp0/any_fast_motion_tips_for_minimax_h3/)报告冲刺变慢跑、时间标注影响有限；[官方提示指南讨论](https://www.reddit.com/r/StableDiffusion/comments/1w7d4go/minimax_h3_prompting_guide_discussion_best/)报告采用指南后精确编排仍需反复改写 | 官方结构有助于表达意图，现有证据不足以把时间文字视为硬约束；社区动作反馈不能直接证明本机对白偏移的原因 |
| 水声被识别为“嗯”等短词 | [Qwen3-ASR 官方仓库 #165](https://github.com/QwenLM/Qwen3-ASR/issues/165)直接报告噪声或回声被识别成“嗯、哎、嗨”，但未附复现音频 | 症状高度相近；结合本机不同 ASR 猜测不一致、VAD 未检出语音，更支持先排查识别幻觉，仍需人工听音 |

另有 [MiniMax 官方仓库 #51](https://github.com/MiniMax-AI/MiniMax-H3/issues/51)报告开头约 50–200 ms 出现多余语音。该问题与我们的后半段重复台词位置不同。提交者提出的边界上下文/VAE padding 原因只是猜测，关闭状态也不能当作修复证明；裁切开头不能解决本次重复台词。

LightX2V 作者仓库还存在[音效消失、回声或失真讨论 #31](https://huggingface.co/lightx2v/Minimax-h3-Turbo/discussions/31)和[慢动作讨论 #36](https://huggingface.co/lightx2v/Minimax-h3-Turbo/discussions/36)。这些是需要覆盖的质量维度，但并未给出统一且验证充分的修复方案。

## 已核对的历史修复

本机实验运行时固定为 ComfyUI `40c4fcdf513a4523e39d54a9d391908af8df8171`。通过 Git 祖先关系与源码检查，确认以下内容已存在；这只描述实验运行时，不代表正式服务已升级。

- [特殊标记修复 #15808](https://github.com/Comfy-Org/ComfyUI/pull/15808)，提交 `924743af`：`comfy/text_encoders/minimax.py` 已加入并注册 `<d>` 等七个标记。因此不能把这次异常直接归因于缺少该修复。
- [音频向 wrapper 传递修复 #15390](https://github.com/Comfy-Org/ComfyUI/pull/15390)，提交 `93cb5edb`，以及 AudioVAE offload 修复 `2340099d` 已存在。实验未启用 EasyCache 或 Spectrum，优先级不应放在缓存开关上。
- `comfy/model_sampling.py` 已实现 `ModelSamplingAV`，`model_base.py` 已选择该采样类型。

[Larry Turbo 节点作者的说明](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo#why-a-custom-sampler-and-how-it-adapts)明确区分新旧 ComfyUI：旧版缺少双流调度时，其自定义采样器能纠正音频步进；新版原生支持后，该采样器退化为与普通采样器一致的调度。因此，[社区更换 Turbo Sampler 后改善音频的报告](https://www.reddit.com/r/StableDiffusion/comments/1vi7zo4/minimax_turbo_lora_lightx2v_ref2v_audio_fix/)不能直接作为我们更换节点的依据；该案例还同时使用了六步及音频参考，变量没有隔离。

## 提示与评测上可以采用什么

1. 继续按官方 Skill 编写，保留最终提交提示。社区有人用 [`non_diegetic_music: N/A`](https://www.reddit.com/r/StableDiffusion/comments/1viui81/the_h3_gibberish_problem_solved/)减少无关语音，但我们的四份提示已包含这一项，重复仍然发生，不能当作尚未尝试的修复。
2. 以多种子检验重复对白，不用单个成功样片宣布解决。对原 v0.1 权重可做 4/6/8 步对照；[增加步数的社区建议](https://huggingface.co/lightx2v/Minimax-h3-Turbo/discussions/30)只提供实验方向，尚未证明能修复本机重复。
3. 固定机位分别检查背景刚性锚点和主体运动；时间检查分别记录对白、动作和镜头变化。参考视频控制节奏是可测试方向，不能以事后加速视频代替模型遵循提示的验收。
4. 无对白样片结合 VAD、独立 ASR 和听音判断；有对白样片先识别实际文本，再检查时间。[Qwen 强制对齐讨论 #78](https://github.com/QwenLM/Qwen3-ASR/discussions/78)提醒：给定文字能获得对齐结果，并不证明音频实际说过这些文字。VAD 同样可能漏检，不能单独成为通过条件。

## 下一轮应优先验证的新版本

LightX2V 作者已发布[原生 Ref2V v1.0 八步、最高 768p 权重](https://huggingface.co/lightx2v/Minimax-h3-Turbo/discussions/51)，建议 Euler、video shift 12、audio shift 3。ComfyUI 文件为 `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`。这是与本机已测 v0.1 四步不同的发布，当前尚未测试，不能声称其修复或保留了重复问题。

后续优先固定新版来源 revision，使用同一套官方 Skill 提示、输入与种子，对比基础 20 步、原 v0.1 四步、新 v1.0 八步和 PDD 八步。先覆盖泳池重复对白、固定机位和对白时间，再扩展多种子、多角色音色与视频参考。比较时同时记录对白完整性、额外语音、时序、机位、参考一致性与耗时。

本轮未修改默认模型路由。发布讨论里的混合 LoRA 推荐及不同任务排行榜，不能替代导演所需 Ref2VA 多模态参考能力的实测。
