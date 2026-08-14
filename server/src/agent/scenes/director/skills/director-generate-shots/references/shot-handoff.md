# MiniMax H3 视频段交接

本地 H3 统一生成 4–15 秒、24 FPS、768p，并可能输出 32kHz 立体声原生音轨。原声作为独立默认启用轨道，不覆盖对白、旁白、环境声、音效和音乐。

## 自动路由

1. 用户手动模式优先，但必须通过能力校验。
2. `continue` 或精确首尾锚定使用 FL2VA。
3. 多个 Shot、整板语义控制、参考视频或音频使用 Ref2VA。
4. 其他使用 FL2VA。

FL2VA 输入整板裁切的首尾锚点；连续段首帧改用上一段实际尾帧。提示结构包含 `integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music`。

Ref2VA 输入整板、角色、场景、道具、风格及可选上一段视频/声音。上限为 9 图、3 视频、3 音频、合计 12 文件；提示结构包含 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music`。

结构描述用英文，中文对白原样保留；Shot 编号和切镜时间必须与故事板一致。Ref2VA 的参考视频续接不是确定性原生 Extend。
