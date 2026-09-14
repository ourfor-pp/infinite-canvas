# 离线转写与声音合成

## Qwen3-ASR

- `kind: transcription`、`mode: transcription`，模型默认 `local-media::qwen3-asr-1.7b-local`。用户明确选轻量时用 `local-media::qwen3-asr-0.6b-local`。
- `operation: transcribe`：显式提供一段音频 reference，prompt 可空。`params.language` 可省略以自动识别，`params.timestamps` 默认 true。最长一小时，CPU 发声检测后分段转写。
- `operation: align`：音频最多五分钟，prompt 必须是待对齐的参考文本。`params.language` 默认 Chinese，应按音频实际语言填写。对齐只表示这份参考文本与音频的时间对应，不能当作语音识别所得文字。
- language 使用模型语言名，如 Chinese、English、Cantonese。ForcedAligner 支持中文、英语、粤语、法语、德语、意大利语、日语、韩语、葡萄牙语、俄语、西班牙语。其他转写语言保留 VAD 片段时间，不能声称有逐词精确时间。
- 结果是 `application/json` 文件，保留全文、语言、片段、时间来源。`source` 区分 transcription 与 reference-alignment；`timestampSource` 区分 vad 与 forced-alignment。
- 用 `media_read_transcription` 的 generationId、offset、limit 分页，沿 nextOffset 继续；完整 JSON 可由 `media_save_result` 保存。字幕排版、导出及与剧本比较由应用或项目完成。
- 不提供流式识别、说话人分离或自动角色归属。

## VoxCPM2

使用 `local-media::voxcpm2-local`、`kind: audio`、`mode: speech`。无参考声音使用 generate，有参考声音使用 clone。

prompt 是台词；params.instructions 是可控声音描述。params.normalizeText 默认 true，克隆的 params.denoiseReference 默认 true。可显式设置 cfgValue（1–5，默认 2）、steps（4–50，默认 10）、maxLength（256–8192，默认 4096）、retryBadcase（默认 true）和 seed。

params.ultimateClone=true 使用参考声音续写模式，必须显式提供参考 transcript；此时 instructions 不参与合成。需要补充 transcript 时先调用转写能力并检查结果，不在语音服务中隐式运行另一个识别模型。
