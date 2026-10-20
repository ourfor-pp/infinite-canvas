# 真实创作者的剧情视频制作流程核查

本轮只读联网研究与 CPU 抽帧，没有安装模型、提交 GPU 或修改服务。选择五例：两位创作者/团队的制作拆解、一个可核对代码的 H3 工程、一个公开前后对照素材的专业混合制作，以及较早的长叙事案例。它们支持的共同点是：**按镜头组织素材、反复选片、在时间线上检查前后关系，并独立处理声音**。本轮没有证据证明这些作品统一使用“低清成片→超分→补帧”才获得剧情质量。

## 证据边界

- **源码核实**：StoryBuilder 固定提交的导演、声音代码及示例图已读取，但没有安装或运行，不能算本机效果实测。
- **制作素材实查**：ANCESTRA 两段 Google 官方 MP4 已下载、ffprobe 并各抽查六个时点；看到的是制作对照，不是完整原片，也不是动态视听验收。
- **作者披露**：CATACOMBES、HEIST、The Frost 的过程来自作者文章、本人访谈或合作方制作专访。次数与工时是作者自报，没有后台日志可独立复核。
- **原片获取限制**：The Frost / HEIST 原 YouTube watch 页面可取得，但播放器返回 `LOGIN_REQUIRED / Sign in to confirm you’re not a bot`，未取得视频流；CATACOMBES 作者文章没有直链文件，公开短链接连接失败。没有使用标题、缩略图或 HTTP 成功来判定完整成片质量。

## 案例对比

| 案例 | 公开可核对工件 | 自然衔接主要依靠什么 | 配音与口型的已知边界 | 人工与自动化边界 |
|---|---|---|---|---|
| CATACOMBES / Kévin Mendiboure | 作者详细回顾、角色/场景/单镜起始帧示例 | 逐镜分镜、角色状态更新、边生成边剪辑、选取有效片段 | 作者称视频模型原生生成声音，character ID 固定角色声音；没有公开该机制 API | 大量重做、选片、混音由作者完成；可自动管理素材状态，不能据此宣称自动导演 |
| HEIST / James C. Martin | 官方制作拆解、3D 预演与生成示例、公开视频入口 | 生成前固定场面调度、摄影机与镜头顺序 | 具体配音先后、口型算法未披露 | 3D 镜头规划和画面筛选是人工；Agent 可整理/调用已确定方案 |
| MinimaxStoryBuilder | 固定版本代码、完整 Comfy 图 | **当前代码每镜硬切，重复发送身份与地点参考** | 先生成每人音色参考，再逐镜原生 AV；音色参考不等于最终台词表演轨 | 规划/缓存/重做/剪辑接口可自动化；没有证实其长片质量 |
| ANCESTRA / Eliza McNitt 与 Primordial Soup | 官方技术拆解、动作匹配/合成 MP4 | 人工分镜、真实演员、预演控制运动、传统 VFX/调色合成 | 真人表演与专业声音团队；不是全片先 TTS 的案例 | 作者称团队超 200 人；部分能力为合作定制，不可直接等同公开 Veo 接口 |
| The Frost / Waymark 团队 | 原片及 BTS 入口、导演与技术负责人长访谈 | 持续更新的图像故事板、边剪边补镜头、手工动画 | 第一部 AI 声音试音未达要求；不能混用第二部测试的声音结论 | 重绘、表情、动画、剪辑人工很多；适合学剪辑闭环，不是当前写实模型指标 |

### 1. CATACOMBES：最接近个人制作短剧情的过程披露

[作者本人回顾](https://www.ecoledesvideastes.com/blog/catacombes-court-metrage-ia)披露：先剧本、角色正背侧与近景板、场景及道具，再逐镜设计起始帧；角色受伤或状态变化时更新整套参考。先用快速低清找构图/运动，认可后**重新生成高质量版本**，并非明确披露对低清成片直接超分。作者自报 3,229 次图像/视频生成、242 小时、每镜约 15–40 次；边生成边在 Premiere 剪辑，15 秒多镜生成也会拆选。

[导演专访](https://www.creativebloq.com/ai/how-a-filmmaker-turned-a-10-year-old-unmakeable-movie-idea-into-reality-with-ai)提供交叉来源。作者博客另明确：对白与音效来自视频工具，音乐单独生成，音效剪切与混音人工完成；“character ID”只披露用途，没有足以复现的参数。未公开独立口型、插帧、4K 超分配方。**对我们的启发**：保存角色状态版本、每镜起始帧及前后剪辑检查，比盲目追加清晰度步骤更有直接依据；这是建议，不是已验证移植结果。

### 2. HEIST：先锁住动作与摄影，再生成表面细节

[Reallusion 官方制作拆解](https://magazine.reallusion.com/2026/06/26/ai-studio-storytellers-heist-previz-to-production-the-3d-to-ai-workflow/)介绍 James Martin 从故事板、Character Creator 角色到 iClone 场景/走位/机位，再以预演引导 AI Studio 的图像与视频。文中列出 Nano Banana 和 Seedance；AI Actors 用于人物复用。关键可迁移项是**镜头顺序、人物相对位置和摄影先被可视化**，再修提示。没有公开完整图、seed、重试分布、音轨顺序或后期超分参数，属于制作示范，不是完全可复现实验。

[原演示视频](https://www.youtube.com/watch?v=V0lr5L_d_E8)本轮取流失败；[创作者讲解活动说明](https://discussions.reallusion.com/t/free-webinar-action-sequences-3d-control-cinematic-storytelling-with-ai-studio/17762)可作补充过程入口。**对我们的建议**：粗模承担动作、空间和摄影约束，身份与最终材质使用独立明确参考；不能仅因有粗模就认定生成会忠实执行全部动作。

### 3. StoryBuilder：可借鉴的组织方式，必须纠正 README 与代码偏差

仓库：[lumosai8/MinimaxStoryBuilder](https://github.com/lumosai8/MinimaxStoryBuilder)。核查固定提交 `47b6ceb55fb096f766d04c2ef0adde6973264216` 的 [director.py](https://github.com/lumosai8/MinimaxStoryBuilder/blob/47b6ceb55fb096f766d04c2ef0adde6973264216/director.py)、[voices.py](https://github.com/lumosai8/MinimaxStoryBuilder/blob/47b6ceb55fb096f766d04c2ef0adde6973264216/voices.py)与示例图。

**实读代码**：`CONTINUITY="off"`；每镜独立 `MiniMaxH3ReferenceToVideo`，重复送角色与地点图；边界硬切。README 的“上一镜末 22 帧与声音作为 guide”尚留在文档，不能当此提交的运行行为。每人先生成 124 帧声音样本、仅解码音频，并按总预算裁成最多 5 秒/人；随后它是**音色参考**，最终对白与口型仍随新镜头生成。可选快路由包含低分辨率采样、3D latent upscale、局部噪声 refine、可选 RTX SR；没有验证其身份保真或本机兼容。

[固定 README](https://github.com/lumosai8/MinimaxStoryBuilder/blob/47b6ceb55fb096f766d04c2ef0adde6973264216/README.md)明确人物镜头限制为中景/中近景/近景，原因是远景脸像素太少；大头主板加小视角条优于均分六格，是该作者参考布局经验。**不能称其解决当前固定远景小脸**。规划/素材缓存/单镜重做/时间线裁切很有参考价值，但本轮没有核到可审验的高质量长片与完整参数对照；示例混合模型/LoRA也不能直接套到现有 PDD。

### 4. ANCESTRA：专业效果中包含定制能力与传统制作

[Google DeepMind 官方技术拆解](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/ancestra-behind-the-scenes/)披露：McNitt 剧本、人工故事板、出生照片辅助视觉开发；Imagen 图像与 Veo 动画结合真人拍摄。团队为婴儿视觉微调 Imagen，用 3D 虚拟摄影机预演控制部分镜头运动，再把生成素材与演员、传统 VFX 和调色结合；官方称参与者超过 200 人。不能将其认作“一人公开接口自动长剧”。

本轮实际下载并抽查：

- [鳄鱼蛋镜头分层制作 MP4](https://storage.googleapis.com/gweb-uniblog-publish-prod/original_videos/WM_RNDR_Breakdown_crodocile_003_1k.mp4)：10.542 秒、1280×720、24fps、无音轨。可见蛋壳开口、水面、鳄鱼等分离素材逐步进入合成；这支持“组合素材实现特定镜头”，不代表单次生成全片。
- [动作参考与生成对照 MP4](https://storage.googleapis.com/gweb-uniblog-publish-prod/original_videos/WM__COMBINED_Output_v_003.mp4)：12 秒、1920×1080、24fps、无音轨。并排显示有机孔洞参考与冰/植物风格结果；抽查能看到构图与孔洞变化的对应关系，不能据静态帧认定逐帧运动完全匹配。

本地 `sources/*-contact.jpg`、各帧及 `.probe.json` 可复核。**推论**：专业画面往往是“可控镜头 + 生成素材 + 合成”的产物，发布画质不能反推基础模型一次输出质量。官方未披露统一 4K60 后处理方案。

### 5. The Frost：长叙事的历史案例，主要价值是制作闭环

[官方成片与 BTS 入口](https://www.thefrost.ai/)；[原片](https://www.youtube.com/watch?v=DNyxZi9Gp_4)；[导演与技术负责人的访谈](https://www.cognitiverevolution.ai/ai-powered-filmmaking-with-waymarks-stephen-parker-and-josh-rubin/)。团队先探索脸、雪山与装备图，逐步形成故事；将实际采用的静帧排成可持续替换的故事板，再剪辑、补镜、D-ID 面部动画与 After Effects 手工处理。访谈约 26:31–31:46 具体讨论边剪边补握绳近景、人物一致性困难；约 1:05 后讨论手调眉唇表情，1:14:26 说明第一部 AI 声音试音没有达到要求。不能把续作测试当第一部技术栈。它的有限动画形式与今天不同，本轮不做写实质量排名。

## 可以立即借鉴的制作规则（本报告推论，未开展新生成）

1. **先做可剪的镜头计划。** 每镜保存人物状态/衣服、地点朝向、入画出画方向、视线、道具归属、动作开始和结束状态、景别机位；相邻镜头同时审查。只给“相同角色”不足以保证空间与动作连续。
2. **选择声音路线后再定台词节奏。** 原生 AV 可像 CATACOMBES 那样保留同期对白再混音；固定台词表演则应先锁录音/配音，再验证该模型是否真正按音轨驱动。StoryBuilder 的音色参考只固定声音身份，不能保证每句长度和口型。不能将另一段 TTS 覆盖 H3 原声音轨后直接宣布口型同步。
3. **粗剪先于昂贵修复。** 先在原生输出上核身份、对白、视线、接触动作、切点，再重做坏镜头。超分与补帧没有披露能修复跳轴、换脸、情绪错位、动作状态断裂；本轮案例也不能推出必须补到 60fps。
4. **声音承接单独处理。** 对白、环境、音效、音乐分轨，检查切点处响度与环境连续；声音预入/延后可作为有动机的剪辑手段。这是制作建议，不是上述每位作者都明确披露使用了 J/L cut。
5. **Agent 适合管理闭环，不宜自动签收。** 可整理状态参考、编译镜头输入、保存提交快照、排队、缓存、标出遗漏、产出邻接对照和粗剪；身份是否可信、表演是否成立、切点是否自然仍需动态视听审查。失败局部重做比盲目扩大模型链路更可控。

建议最小验证：同一 30–45 秒双人场景、6–8 镜，先确认人物/场景状态与声音路线，再用原生分辨率出粗剪；同时审反打空间关系、出入画动作、对白停顿和口型。记录每镜候选数、采用区间、失败原因及人工分钟数；通过后仅对采用片段做后期。此处只是实验设计，没有提交或新增生成费用。

## 仍未验证

五例均没有提供足以复现“同一小说→高质量完整长剧”的端到端公开输入、所有候选、统一模型 revision 与最终轨道工程。不能据此声称已有全自动长剧方案。CATACOMBES 与 HEIST 也未提供本轮可下载完整原片文件；ANCESTRA 实查为制作素材；StoryBuilder 只有源码核实。这些限制均写入配套 JSON。
