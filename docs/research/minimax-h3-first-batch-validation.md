# MiniMax H3 首批迭代与本机验证

本批完成音频参考语义、导演提示规则以及隔离加速工作流。六个正式对照均生成了视频和原生音轨。LightX2V Ref2VA 4 步在本场景的端到端耗时最低；VDN 在当前剪枝模型上存在明确的适配缺口，暂不能据此评价官方完整模型质量。

## 实现范围

- `audioReferences` 最多三项，显式区分音色、对白发声、声音质感与音乐风格；前两项绑定本段说话角色。服务端检查文件归属和音频类型。
- 续接视频原声先占 `<Audio 1>`，独立参考顺延；提示中的角色、音频定义、对白段与声音段使用同一编号。音频只承诺特征参考，不承诺复制信号。
- 结构化对白保留原文、标点和完整起止时间；有音频参考或配乐计划时走原声敏感策略。工程文件与 ZIP 往返保留参考音频和元数据。
- 新增实验工作流导出、固定来源下载、独立运行时安装和基准脚本；没有把加速实验加入默认模型目录。

## 官方 Skill 与固定输入

实际阅读并应用 [MiniMax 官方 h3-prompt-writing](https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing) 及其完整 `base-en.txt`、`ref-en.txt`。提示词和哈希已保存到 [评测输入目录](../../media-executor/examples/h3-evaluation/)。

Ref2VA 使用六段结构、角色/剑/环境三个 Subject、Shot 前的风格句、约 400 词的动作与声音描述、稳定 S1 和原文 `<d>[Chinese] 别担心，等我回来。</d>`。FL2VA 权重本次只输入一张首图，实际测试的是 I2VA 模式，并使用官方首帧对齐句；尚未测双首尾帧任务。

场景是作者公开参考图中的女子把剑向右下移出画面，于 1.5–3.5 秒说一句中文，最后微笑。各模式内图片、提示、seed 314159、960×544、124 帧、24 fps 完全固定，成片 5.167 秒。参考图片来自 [PAI 作者固定 revision](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs/blob/335001fb9e5455d68a0caa18ec2e319072150328/asset/ref2va_test_5_1.jpg)。

前两条短提示探索样片仅证明运行链路。官方规则优化后，基础模型抽帧中原来没有完成的移剑动作得以执行；这是单样本观察，不能泛化为提示优化的统计收益。探索样片不计入下表。

## 正式生成结果

| 配方 | 步数 | 提交至完成（秒） | 同模式基线 / 本项耗时 | 整卡采样峰值 MiB |
|---|---:|---:|---:|---:|
| fl2va-base | 20 | 93.489 | 1.00× | 30152 |
| fl2va-vdn8 | 8 | 72.893 | 1.28× | 29740 |
| ref2va-base | 20 | 97.365 | 1.00× | 31226 |
| ref2va-lightx2v-ref4 | 4 | 40.570 | 2.40× | 31770 |
| ref2va-pdd-ref8 | 8 | 56.838 | 1.71× | 31290 |
| ref2va-vdn8 | 8 | 74.905 | 1.30× | 30028 |

这是每配方一次、逐次卸载模型、禁用节点缓存后的端到端时间，包含加载、编码、采样和保存，轮询约有 2 秒粒度；不是纯采样吞吐，也没有重复运行的置信区间。GPU 峰值为整卡每约 2 秒采样值，包含其他既有服务，并非模型独占显存。

已查看各成片的四帧联系表，未见明显人物身份崩坏。多数配方完成移剑动作，但 PDD 和 Ref2VA VDN 的第二个采样画面仍可见画面边缘剑体，不能认定严格达到 1.25 秒完全移出要求。抽帧不替代完整运动、口型与声音验收。

## 对白与时间点

使用本机已有离线 Qwen3-ASR-0.6B 与 Qwen3-ForcedAligner-0.6B，在 CPU 上转写及对齐。六项正式样片均得到原文“别担心，等我回来。”；实际发声窗口如下，提示要求均为 1.50–3.50 秒。

| 配方 | ASR 对齐窗口（秒） | 转写 |
|---|---:|---|
| fl2va-base | 2.32–4.48 | 原文一致 |
| fl2va-vdn8 | 2.32–4.56 | 原文一致 |
| ref2va-base | 2.24–4.48 | 原文一致 |
| ref2va-lightx2v-ref4 | 2.32–4.56 | 原文一致 |
| ref2va-pdd-ref8 | 2.56–4.48 | 原文一致 |
| ref2va-vdn8 | 2.32–4.48 | 原文一致 |

所有样片都明显晚于目标窗口，因而对白时间门槛未通过；正确转写不能替代音色、韵律、口型或人工听音验收。强制对齐本身存在误差，逐字结果出现个别零时长字，不宜当作精确音素边界。模型来源 revision、转写和成片哈希见 [机器可读结果](../../media-executor/examples/h3-evaluation/results.json)。下一轮须优先验证在不改台词的前提下调整动作与发声顺序，或显式校验实际时长后回到拆段环节，不能只依赖提示时间标签。

## VDN 的实际限制

当前使用 [OpenVDN 原作者 stage-dmd-step-250](https://huggingface.co/OpenVDN/vdn-minimax-h3) 与 [社区 ComfyUI 节点](https://github.com/Saganaki22/ComfyUI-VDN-H3/tree/7271c648d7c2ff61ae1a7342dd9761e4545a34c3)，`merge`、`er_sde/beta`、8 步、grouped attention，并加载发行包 default/turbo 两个适配器，没有叠加额外 Turbo 或 Sage。

FL2VA、Ref2VA 两次均出现：`51 adaln deltas cannot merge ... skipping them`。当前 pruned ConvRot 基座折叠了 AdaLN，节点无法合并这些增量。因此结果标记为部分适配；Ref2VA 另有跨基座社区适配因素。生成成功和耗时改善均不能证明完整 VDN 质量，也不满足默认替换条件。下一步应先使用与官方一致的基座或验证完整增量注入，再进行质量比较。

PDD 使用 [原作者完整 Ref2VA Acc 权重](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs/tree/335001fb9e5455d68a0caa18ec2e319072150328)，通过固定版本专用节点加载 LoRA、32 项 head bank 与原配方 sigmas；没有把完整 checkpoint 当成普通 LoRA 静默丢弃 head。LightX2V 使用 [作者 Ref2VA 4 步权重](https://huggingface.co/lightx2v/Minimax-h3-Turbo)、Euler/simple 与视频/音频 shift 12/3。

## 环境与复现

RTX 5090 32607 MiB，driver 580.159.03；独立 ComfyUI `40c4fcdf513a4523e39d54a9d391908af8df8171`、Python 3.12、Torch 2.11.0+cu130、Sage 2.2.0+cu130torch2.11。沿用既有 pruned int8 ConvRot H3 基座与 NVFP4 AWQ 文本编码器。新增权重约 8.189 GiB，逐文件固定 revision 并检查大小和 SHA256，实际存放 NVMe，稳定入口为 `/data/sas/models/H3-Experiments`。

具体命令见 [执行器实验说明](../../media-executor/README.md)，来源清单见 [h3-experiments.json](../../media-executor/h3-experiments.json)。本机证据位于 `.tmp/h3-evaluation/official-skill-v1/`，每项包含 graph、完整执行 history、MP4、ffprobe、音量信息和抽帧图；运行时日志在 `.tmp/h3-evaluation/runtime.log`。这些大体积实验产物不属于仓库交付文件。

## 验证边界与后续

服务端构建和 70 项测试通过，包含音频用途/角色/时间/编号、非法音频和 ZIP 往返；前端类型检查通过，执行器 4 项测试通过，脚本语法及 Skill 校验通过。浏览器交互、多角色音色、真实续接音轨、完整运动与人工听音尚未验收。默认模型配方保持原状。实验完成后已停止独立 8190 运行时，8189 原服务仍可访问且队列为空，可用显存恢复为 28311 MiB。

优先把 LightX2V Ref2VA 纳入多场景候选评测，PDD 保留为第二候选；两者均须检查对白完整性、发声时间、身份与动作一致性。VDN 优先解决完整基座适配，再比较速度与质量。原定十场景基准及回滚验收仍在 TODO。

后续四场景、十二项生成及双 ASR/VAD 复核见 [多场景复核](./minimax-h3-second-batch-validation.md)。LightX2V 在新增泳池任务中出现重复画外音，因此首批单样本速度优势不支持将它提升为含对白默认。
