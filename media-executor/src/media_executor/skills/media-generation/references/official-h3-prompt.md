# MiniMax H3 官方提示规则

权威来源：

本次核对版本：`MiniMax-AI/MiniMax-H3@d21241f0a4b3acbb34c97dae47fa417b7065e438`。

- https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing
- https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt
- https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt

## 基础与首尾帧模式

1. FL2VA 第一行声明首图在 `0.00` 秒、尾图在有效时长终点的对齐关系。
2. 随后严格按 `integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music` 排列。
3. 第一镜写 `[Shot 1]`，不加时间；只有真实切镜才新增 Shot，并写 `At MM:SS.mmm`。
4. 每镜用自然英文描述构图、主体、环境、动作、状态变化、运镜和同步声音，不写剧情摘要、标题或字段清单。
5. FL2VA 描述首帧状态到尾帧状态之间可观察、连续的动作路径，不重复静态图片说明。
6. Shot 编号只能对应真实摄影切换。同一 Shot 内多个画格描述同一机位下的时间推进，禁止把每个画格编译成隐含的新构图或新镜头。

## 对白与声音

- 除对白、歌词和确实出现在画面里的文字外，全部使用英文。
- 只给会发声的人分配稳定 `(S1)`、`(S2)` 编号。同一角色在整个视频段内不得改变编号，并对应到同一个 `<Subject N>`；编号按本次目标视频的实际发声顺序分配，不给不发声角色预分配说话人编号。
- 把对白原文逐字放入 `<d>[Language] ...</d>`；`<d>` 内不得出现说话人姓名、语气、动作、时间或任何提示说明。说话者身份、动作和语气必须写在标签外。
- 画外音使用 `says in an off-screen voiceover`，并明确画面人物嘴唇闭合。
- `overall_soundscape` 只总结环境声、动作音和非语言人声，不重复对白或音乐。
- 无配乐时将 `non_diegetic_music` 写成 `N/A`。
- 不把视频段标题、人物名、Shot 标签、时间、动作说明或其他元数据当成可朗读内容。
- Turbo 仅用于快速画面预览；上游要求 4–8 步配合 `simple` 调度，且明确说明音频仍在改进。含对白、旁白或精确音效时优先基础模型预览，不把 Turbo 原声当作验收结果。
- H3 Prompt 只实现已确定的视频段内容，不能补写剧本、压缩对白、删除停顿或增加未规划切镜。若内容无法在当前模型单次窗口内自然完成，为同一镜头安排多个任务；不得截断镜头设计。

## Ref2VA

严格按以下六段输出，不能只保留标题而省略标签关系：

1. `subject_definitions`：逐行定义本次目标中实际使用的主体与来源。只列本段出场的可见主体和实际使用的声音，不复制整片角色表；仅在片外发声的角色明确标为 off-screen，不要求入画。来源片段看不清身份时，补清晰图片，而不是靠姓名或审美词猜测。
2. `summary`：以任务类型方括号开头，再概述目标和主要参考关系。参考角色/动作/剪辑用 `[reference generation]`；声音只引导音色或节奏时加 `audio reference`；具体首帧/关键帧/尾帧锚点加 `keyframe completion`。仅真正修改原视频才用 `video editing`，只有直接复用音轨才用 `audio reuse`。后期贴原声不表示模型正在复制音轨。
3. `retention_analysis`：每个已定义标签单独一行，写明出现镜头或生效阶段、保留关系与具体特征。可见内容使用 `fully_preserved`、`partially_preserved`、`attribute_transfer` 或 `weak_reference`；音频使用 `reference` / `weak_reference`，只有真实复制才用 `fully_copy` / `partially_copy`。这里不写 `(Sx)`，不能用一段“全部跟随参考”替代逐项分析。
4. `detailed_description`：先用一两句英文声明视觉风格，再开始 `[Shot 1]`；后续真实切镜写 `[Shot N] At MM:SS.mmm, ...`。按播放顺序描述出场主体、位置、构图、动作路径与结果、镜头运动、声音和停顿。重要主体首次出现与实际发声时使用对应标签；对白使用 `<Subject N> (Sx)`。跨切点对白、结尾截断或持续声音按官方基础指南使用 `<scenetrans>` / `<cutoff>` 等格式。
5. `overall_soundscape`：环境、物理动作声和非语言人声；需要时写对应 `<Audio N>` 的作用，不重复对白或音乐。
6. `non_diegetic_music`：画外配乐的乐器、节奏和变化；有参考则注明音轨关系，无配乐用 `N/A`。

生成任务的 `detailed_description` 通常为 350–500 个英文词，细节应来自已规划的可观察内容；对白密集时优先容纳完整表演时间，不机械凑字数。视频编辑按修改复杂度描述。不能用反复“跟随原片”的通用句代替实际动作，也不能为了扩写增加角色、剧情或切镜。

## 参考标签与实际输入

- `<Subject N>` 表示实际复用的角色、场景、道具或视觉特征。一个主体可组合多个来源，明确各自职责，例如身份来自图片、动作来自视频。角色图写成 `<Subject 1> is the character shown in <Picture 1>`，不要只声明为普通图片。
- `<Picture N>` 与本次普通参考图片顺序一致，`<Video N>` 与普通参考视频顺序一致，各类分别编号，不能按混合 references 数组的总序号编号。普通视频标注其提供的动作、剪辑或时间结构；它不能代替出场角色的 `<Subject N>`。
- 图片作为具体构图/首尾帧锚点时单独定义 `<Picture N>` 并明确镜头对应；若只作身份来源，在主体定义中引用即可。故事板说明对应哪些镜头与位置关系，禁止保留宫格、边框或分屏版式；不要把整板裁成普通视频来冒充硬时间锚点。
- 参考必须真实提交到 `references`，提示中提及但未提交的图片、音频和视频不会自动变成模型输入。参数使用 `fileId`、`kind`、`role`、`includeAudio`、`frameIndex`，不传导演角色 ID 或导演专用声音字段。
- 硬首尾状态优先考虑 FL2VA，混合身份/动作参考用 Ref2VA；`frameIndex` 是执行器时间锚点，不能把它当普通参考序号。原生延续使用 `operation=extend` 和 `continuation` 返回状态；仅传一个 mp4 是视频参考，不等于原生续接。

## 声音参考

使用视频声音时显式设置 `includeAudio: true`，只参考画面时设为 false。需要实际使用的同步音轨也定义为 `<Audio N>`，说明它提供音色、节奏、对白还是音乐；不要因为视频文件有声音就无条件要求复制。

声音和视频标签分别编号。当前普通 Ref2VA 输入先按视频顺序为启用的同步音轨分配 `<Audio N>`，跳过 includeAudio=false 的视频，再按独立音频顺序继续编号。例如视频 1 静音、视频 2 启用声音、另有一段独立音频，则视频 2 的声音是 `<Audio 1>`，独立音频是 `<Audio 2>`。图片不占声音编号；时间锚点和原生续接状态不作为普通参考音轨编号。不能沿用其他任务的序号。

独立音频使用 `references` 中的 `kind: audio`，用途在提示正文说明。音色/对白参考绑定实际说话主体 `<Subject N> (Sx)`，在其发声处引用 `<Audio N>`；对白原文逐字放入 `<d>`，时间、身份和语气写在外面。听不清处标 `[unclear]`，不得猜词；配乐意图直接写入 `non_diegetic_music`。当前生成链路不能承诺逐样本复制参考原声，精确原声由调用方在后期显式合成并检查同步。

以下仅示范标签关系，正式提示仍须完成上述六段及镜头细节：

```text
subject_definitions:
<Subject 1> is the white rabbit in <Picture 1>, with long pink inner ears and brown eyes.
<Subject 2> is the forest clearing in <Video 1>, with low green plants and warm side lighting.
<Video 1> provides the close-up composition and the rabbit's speaking rhythm.
<Audio 1> is the synchronized track of <Video 1>, providing the voice and delivery of <Subject 1> (S1).
summary:
[reference generation + audio reference] <Subject 1> thanks her off-screen friends in a single close-up, following <Video 1> and <Audio 1>.
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - preserve her facial proportions and ear shape from <Picture 1>.
<Subject 2> (appears in [Shot 1]): fully_preserved - preserve the foliage and direction of sunlight.
<Video 1> ([Shot 1] composition and timing): fully_preserved - retain the close-up and pause after speaking.
<Audio 1>: reference - guide the rabbit's voice and delivery without copying the signal.
```

## 提交前与结果检查

核对每个标签确有来源、主体确在本段出现、声音编号对应正确、切点和对白在有效时长内。参考不足时按具体风险补身份图或关键帧，不设固定图片数量；密集切镜反复遗漏时交回调用方拆镜，不能只加长提示。

执行器预检只验证参数、文件与执行计划，不能证明身份、动作和剪辑正确。结果必须实际检查角色人数/身份、动作顺序、关键切镜、说话人和声音；错误应定位到参考、提示或任务拆分后修订，不能仅凭任务 succeeded 批量复制同一方案。
