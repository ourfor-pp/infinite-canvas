# IndexTTS 2.5 声音克隆

应用模型 ID 是 `local-media::indextts-2.5-local`，执行器原始 ID 去掉此前缀。先查询 available，再用 `kind: audio`、`mode: speech`、`operation: clone`，prompt 原样放本次台词。

必须上传一段音色参考，`references: [{kind: "audio", fileId: "上传ID", role: "reference"}]`；不要求 transcript，不自动调用 ASR。可另传一段 `role: "emotion"` 的情绪参考，与音色参考分开。每段参考必须大于 0 且不超过 15 秒，过长时先由调用方明确裁切，服务不静默截断。

| params | 默认值 | 约束与用途 |
| --- | --- | --- |
| language | ZH | ZH、EN、JA、ES、AR |
| durationFactor | 1 | 0.5–2；时长倍率，越大越慢，不是语速倍率，也不是目标秒数 |
| intervalSilence | 200 | 0–2000 毫秒，仅模型切分的片段之间插入静音，不是每个标点的停顿 |
| emotionVector | 无 | 八项 0–1 数值，总和不超过 1，顺序为高兴、生气、悲伤、害怕、厌恶、低落、惊讶、平静；不能同时传情绪音频 |
| emotionStrength | 1 | 0–1，必须同时有 emotionVector 或情绪音频 |
| seed | 服务生成 | 非负安全整数；不保证跨设备与软件版本逐样本一致 |

不接受 instructions、speed、emoText 或任意上游采样参数；当前未部署 QwenEmotion。不要把自然语言语气要求伪装成已生效参数，也不要擅自改写台词。默认不改变用户的 TTS 模型选择。

音色与项目角色归调用方管理。可复用已采用的参考录音，重新上传后提交新台词；服务不内置官方演示音色、不维护角色目录。结果下载保存后才能 ACK，不能长期依赖执行器临时 fileId。试听检查口音、断句、语速和音色一致性；转写通过不是听感验收。
