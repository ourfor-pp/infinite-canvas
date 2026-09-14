# Qwen 音色设计与声音复用

先查能力目录，只有 available=true 才提交。应用模型名加 `local-media::` 前缀；直接访问执行器使用下面的原始 ID。统一 `kind: audio`（应用侧）、`mode: speech`，正文放 prompt。

| 模型 ID | operation | params | 参考输入 |
| --- | --- | --- | --- |
| qwen3-tts-1.7b-voicedesign-local | generate | instructions 必填；language、seed 可选 | 不接受 |
| qwen3-tts-1.7b-customvoice-local | generate | speaker 默认 Vivian；instructions、language、seed 可选 | 不接受 |
| qwen3-tts-1.7b-base-local | clone | language、seed 可选 | 恰好一段音频，可附 transcript |

language 默认 Auto，也可用 Chinese、English、Japanese、Korean、German、French、Russian、Portuguese、Spanish、Italian。seed 范围 0–9007199254740991；省略时由执行器生成，可从预检计划读取。不保证跨设备或软件版本逐样本复现。

VoiceDesign 的 instructions 描述期望音色、表达与节奏，例如“温和自然的成年旁白，语速舒缓，吐字清楚，句间自然停顿”。CustomVoice 使用固定 speaker，instructions 调整表达。二者均是自然语言控制，不能把描述当作精确语速保证。

Base 没有独立 instructions、speed、emotion 控制；这些参数会在预检报错。参考音频会影响克隆结果，但不保证逐句继承节奏和情绪。本服务不做后处理变速；所有 Qwen 模型都不接受数值 speed 或独立 emotion 字段。不要偷偷删去用户明确要求的控制参数后声称已生效，应先说明限制并调整方案。

## 设计一次，长期复用

1. 使用 VoiceDesign 生成通用参考声音，保持一份清晰、准确的正文；检查音频后再采用。
2. 用 media_save_result 把 WAV 保存到项目长期目录，并由项目保存对应正文、模型 ID、设计描述和 seed。执行器结果是临时文件，ACK 后不可依赖原 fileId。
3. 每次复用先用 media_import_reference 登记已保存 WAV，传给 Base 的 references：`{kind: "audio", fileId: "新上传文件ID", transcript: "参考音频实际原文"}`；prompt 改为本次新台词。
4. Base 的 params 只用 language 和 seed。有 transcript 使用文本与音频参考克隆；省略或空白 transcript 使用 embedding-only 模式。长期声音复用优先准确原文，不在服务内隐式 ASR。
5. 通过 media_validate_generation 预检，再 media_generate，查询任务并保存新结果。不要为每个角色创建服务端模型、单独 Skill 或专用端口。

音色资产、角色命名和采用决定归调用项目；服务不替项目设计角色。实际试听确认音色一致性、发音、情绪和停顿，转写正确不等于听感合格。
