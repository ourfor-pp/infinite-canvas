# MiniMax H3 官方提示规则

权威来源：

- https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing
- https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt
- https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt

## 基础与首尾帧模式

1. FL2VA 第一行声明首图在 `0.00` 秒、尾图在有效时长终点的对齐关系。
2. 随后严格按 `integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music` 排列。
3. 第一镜写 `[Shot 1]`，不加时间；只有真实切镜才新增 Shot，并写 `At MM:SS.mmm`。
4. 每镜用自然英文描述构图、主体、环境、动作、状态变化、运镜和同步声音，不写剧情摘要、标题或字段清单。
5. FL2VA 描述首帧状态到尾帧状态之间可观察、连续的动作路径，不重复静态图片说明。

## 对白与声音

- 除对白、歌词和确实出现在画面里的文字外，全部使用英文。
- 只给会发声的人分配稳定 `(S1)`、`(S2)` 编号。
- 把对白原文逐字放入 `<d>[Chinese] ...</d>`；说话者身份、动作和语气写在标签外。
- 画外音使用 `says in an off-screen voiceover`，并明确画面人物嘴唇闭合。
- `overall_soundscape` 只总结环境声、动作音和非语言人声，不重复对白或音乐。
- 无配乐时将 `non_diegetic_music` 写成 `N/A`。
- 不把视频段标题、人物名、Shot 标签、时间、动作说明或其他元数据当成可朗读内容。

## Ref2VA

严格按以下六段输出：

1. `subject_definitions`
2. `summary`
3. `retention_analysis`
4. `detailed_description`
5. `overall_soundscape`
6. `non_diegetic_music`

用 `<Subject N>` 表示可复用主体，用 `<Picture N>` 表示具体关键帧或故事板锚点，用 `<Video N>` 表示视频结构或续接来源，用 `<Audio N>` 表示复制或参考的音频。标签在六段中保持同一含义。
