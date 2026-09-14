# 独立配乐

配乐只在改善叙事时加入。原生视频已有合适配乐时先审听，避免重复叠加；有对白时让音乐保持空间和较低音量，不因可生成歌曲就加入人声。

每条配乐使用 `audio/music/<配乐ID>/prompt.md`。Frontmatter 可写 `model`、`seconds`（默认 30）、`seed` 与 `lyrics`；正文是原样提交的最终音乐提示。默认模型为 `comfyui::minimax-music3-local`，调用前通过 `director_list_models({kind: "audio"})` 确认可用及 music 模式，不向用户索要节点配置。时长是生成上限，不能把它当作精确剪辑点。

Music3 提示按官方三段格式：Global Metadata 写音乐类型、情绪推进和制作质感；Vocal Details 对纯器乐明确无歌声、哼唱、旁白，说明旋律乐器；Arrangement 写乐器进入、退出、对白留白和结尾。歌词独立放 Frontmatter；纯器乐可用 `lyrics: "[Intro]\n[Instrumental]\n[Outro]"`，不要把剧情说明写成歌词，也不要将云 API 的 is_instrumental 或 cover 参数套给本地工作流。

读取完整提示文件并计算当前字节的 SHA256，调用 `director_generate_music({promptPath, expectedHash})`。只提交一次，按返回 ID 调用 `director_get_generation_status({id})`。成功详情的 `music.path` 是永久工程音频路径，`music.metadataPath` 保存生成快照；每次结果独立命名，不覆盖旧版。`music.promptChanged=true` 表示生成期间提示已修改，先对照快照审听，再决定是否采用。不要用 outputs 中的临时审阅缓存路径代替永久配乐路径。

用声音理解辅助检查意外人声、噪声与结尾；空 ASR 不足以排除哼唱。读取实际时长，选取适合的音乐片段，将 `music.path` 放到时间线 music 轨，配置 start、duration、trimIn 和 volume。未确认自然收尾时不宣称可以无缝循环；不要用提高音量掩盖对白或生成缺陷。记录失败、重做和后处理，不以单次成功作为整片声音验收。

独立配乐需要柔和进入或收尾时，在时间线声音片段上设置可选 `fadeIn` / `fadeOut`，单位秒，分别不得超过片段 `duration`。包络作用于裁取后的片段局部时间，再放到 `start` 指定的整片位置；`volume` 控制稳态音量。按音乐与对白需要选择时长，不自动给每段模型原声加淡变，以免损伤对白或连续环境声。
