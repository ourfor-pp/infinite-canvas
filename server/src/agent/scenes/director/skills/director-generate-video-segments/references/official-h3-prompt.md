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
- 只给会发声的人分配稳定 `(S1)`、`(S2)` 编号。同一角色在整个视频段内不得改变编号，并通过角色素材 ID 对应到同一个 `<Subject N>`。
- 把对白原文逐字放入 `<d>[Chinese] ...</d>`；`<d>` 内不得出现说话人姓名、语气、动作、时间或任何提示说明。说话者身份、动作和语气必须写在标签外。
- 画外音使用 `says in an off-screen voiceover`，并明确画面人物嘴唇闭合。
- `overall_soundscape` 只总结环境声、动作音和非语言人声，不重复对白或音乐。
- 无配乐时将 `non_diegetic_music` 写成 `N/A`。
- 不把视频段标题、人物名、Shot 标签、时间、动作说明或其他元数据当成可朗读内容。
- Turbo 仅用于快速画面预览；上游要求 4–8 步配合 `simple` 调度，且明确说明音频仍在改进。含对白、旁白或精确音效时优先基础模型预览，不把 Turbo 原声当作验收结果。
- H3 Prompt 只实现已确定的视频段内容，不能补写剧本、压缩对白、删除停顿或增加未规划切镜。若内容无法在 4–15 秒内自然完成，返回上游重新拆段。

## Ref2VA

严格按以下六段输出：

1. `subject_definitions`
2. `summary`
3. `retention_analysis`
4. `detailed_description`
5. `overall_soundscape`
6. `non_diegetic_music`

`detailed_description` 先用一句英文声明整体视觉风格，再开始 `[Shot 1]`。按照官方指南，通常展开为约 350–500 个英文词；只细化已规划的可观察内容，包括开场位置、连续动作路径、时间点、动作结果和结束状态，不靠增加剧情或切镜凑字数。

用 `<Subject N>` 表示可复用主体；普通导演视频段把 `<Picture 1>` 固定为从左到右、从上到下读取的完整故事板，其余 `<Picture N>` 才用于角色、场景、道具或风格参考；用 `<Video N>` 表示上一段运动与原声续接来源，用 `<Audio N>` 表示复制或参考的音频。标签在六段中保持同一含义。不得把整张故事板裁成普通视频的硬时间锚点，也不得让输出保留宫格或分屏版式。

角色参考不能只声明为普通图片。应先定义 `<Subject 1> is the character shown in <Picture 2>`，再在 `detailed_description` 中用 `<Subject 1> (S1)` 指向稳定身份。例如：

```text
At 00:02.200, <Subject 1> (S1) turns toward the doorway and speaks on screen with natural synchronized lip movement, in a restrained and wary delivery: <d>[Chinese] 你是谁？</d>
```

`overall_soundscape` 只写 room tone、脚步、衣料、呼吸等非对白内容，不再重复“你是谁”，也不得把视频段标题或故事板说明塞进 `<d>`。

## 音频参考与保留关系

- `audioReferences` 按上传顺序对应 `<Audio N>`；续接视频的原声先占 `<Audio 1>`，独立音频从 `<Audio 2>` 开始。`voice` 只参考音色，`dialogue` 参考发声与节奏，`sound` 参考声音质感，`music` 参考音乐风格；当前生成链路不支持承诺逐样本复制参考原声。
- `voice` 和 `dialogue` 必须绑定当前视频段已采用且有对白的角色 `speakerAssetId`，音频定义复用该角色的 `<Subject N> (Sx)`，不得独立重排说话人编号。对白内容只使用结构化 `text` 原文，保留标点；起止时间、身份、语气写在 `<d>` 外。
- 音频的保留标记使用 `reference`，任务类型为 `reference generation + audio reference`；不要把音色参考描述为 `fully_copy`。音乐意图同步明确写入 `h3NonDiegeticMusic`。
- 图片保留角色身份、场景、道具或风格各自定义的特征；故事板保留时间顺序与镜头意图，禁止保留宫格边框。
