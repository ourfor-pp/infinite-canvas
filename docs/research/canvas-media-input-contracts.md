# 画布图片、视频与音频输入契约验收

## 当前结构

画布仍按目标产物提供通用图片、视频、音频节点。应用公开模型目录携带无凭据的 `imageContract` / `videoContract` / `audioContract`，前端据此展示字段、默认值、选项及参考限制，服务端使用同一定义校验。协议适配器负责映射供应商或执行器字段；结果沿用统一任务和文件结构，以文件实际 MIME 类型播放或展示。

- 音频定义：`server/src/audio-contract.ts`。声音克隆、预设音色、声音设计、音乐及音效是模型能力，不增加画布节点类型。
- 图片定义：`server/src/image-contract.ts`。管理员可覆盖具体云端模型的尺寸、质量、背景及单次数量；文生图／图生图能力和最多参考图仍属于具体模型配置。
- Qwen Image 2.1 编辑的自动尺寸跟随首张参考图比例，显式尺寸独立控制输出宽高，参考图预处理分辨率不再占用输出尺寸参数；Qwen Edit 2511 跟随参考图；HiDream 按比例匹配原生尺寸。
- Gemini 使用比例输入，自动时省略 `imageConfig`；GPT 图片不发送 `response_format`，图片编辑保留背景参数。依据：[Gemini 图片 API](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)、[OpenAI 图片 API](https://developers.openai.com/api/reference/cli/resources/images/methods/generate)。
- 切换模型清理原有参数，保留显式参考并重新校验。新节点使用当前模型默认值；已有明确配置不合法时提示重新选择。专用局部编辑、超分和多角度继续走专用工作流。

这里是逐模型声明与现有协议适配器的组合，并非允许管理员编写任意请求转换脚本的通用映射平台。新调用协议仍需新增并测试适配器。

## 真实应用任务

本机应用提交至现有执行器队列，未重启或改动模型服务，未取消用户任务。以下均已成功生成、回传应用文件并下载核对。

| 模型／用途 | 任务 ID | 实际结果 |
| --- | --- | --- |
| Qwen CustomVoice | `RxtLJhgRwC8aLXMrKh_F4` | WAV，24 kHz，单声道，4.160 秒 |
| Qwen Base 克隆 | `WIl6U8hzIuXyTMDroyYsZ` | 复用上一段参考及对应文字；WAV，24 kHz，4.000 秒 |
| IndexTTS 克隆 | `b2_CCLzekhoufcVFuWKyF` | 复用上述音色参考；WAV，22.05 kHz，3.506 秒 |
| MiniMax Music3 | `F23lg93W95rJOtt82iRW-` | FLAC，44.1 kHz，双声道，4.992 秒；已据实际结果修正输出声明 |
| Qwen Image 2.1 文生图 | `rmx-qXfr07q3xtGzB9pvQ` | 1024×1024 蓝色陶瓷杯 |
| Qwen Image 2.1 图生图 | `uI-MuGeeksEWxx9oNYhPa` | 参考上一张改为红杯，已查看两图，构图、材质与白色背景保留 |

请求、结果和下载样本位于项目 `.tmp/audio-canvas-review/`，任务记录及媒体仍以应用后端为准。音频格式与时长检查不能替代人工试听；未据此声明全部音频模型或音色质量已验收。

## 自动验证与后续边界

契约与适配器测试覆盖参数范围、参考数量、模型覆盖配置、专用工作流边界、Gemini 比例映射和 GPT 请求字段；浏览器模拟接口覆盖深浅主题、模型切换、参考用途、原地重生成及失败保留旧结果。前后端类型检查和前端构建通过。

云端图片 sxh-image 已完成真实文生图，cec-image 实测失败，详见补测表；云端视频尚无配置渠道，只完成模拟协议验证。所有当前音频模型已有代表任务回传，音色与音乐质量仍待试听，克隆、情绪参考、Cover/Remix 等操作组合尚未全部实测。视频契约已补齐基础生成链路；文字输入契约、视频原生续接与时间引导的画布交互仍是后续工作。


## 参考图与输出比例修正

Qwen Image 2.1 原编辑适配器把画布尺寸换算成 `referenceResolution`，再用首张参考图对应的 latent 采样，造成有参考图时无法改变输出比例。现在显式尺寸映射为 `width` / `height` 并使用独立输出 latent；自动尺寸仍使用首张参考图 latent。参考条件与参考图本身保持独立，不对成图做事后拉伸。

实际应用任务 `-L4B-II9sB9SIlR0TLte3` 与 `gpoGv3VvJig9kKgO6F1wS` 使用同一张 1024×1024 蓝杯参考图，分别输出 1536×1024 和 1024×1536 的红杯，文件尺寸及图片已检查。证据为 `.tmp/audio-canvas-review/live-ratio-results.json` 与对应 PNG。改变画幅会改变主体布局，本例验证尺寸与改色可用，不代表复杂文字、人物或精确局部编辑已验收；需要保留原位置时使用自动尺寸。上游 [ComfyUI 编码节点](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_qwen.py) 也说明更换采样尺寸会影响编辑对齐。


## 视频第一版

- `server/src/video-contract.ts` 统一声明尺寸／比例、分辨率、时长、可选声音／水印开关以及各类参考上限。管理员可按具体云端模型覆盖选项，未支持字段不会发往模型；服务端再次校验。调用方案默认值是保守起点，不能替代具体模型配置或实测。
- OpenAI `/videos` 使用像素尺寸及单一 `input_reference`；Gemini 映射 `durationSeconds`、`resolution`，按模型声明使用首尾帧或 `referenceImages`；Ark 映射对应原生字段。依据：[OpenAI Videos](https://developers.openai.com/api/reference/typescript/resources/videos/methods/create)、[Gemini Veo](https://ai.google.dev/gemini-api/docs/veo)。当前没有配置云端视频渠道，云端仅作模拟协议验证。
- H3 FL2VA 普通画布输入只接受一至两张图，按当前参考顺序用作首帧、尾帧；Ref2VA 支持多种参考，纯音频参考必须搭配图或视频。高级时间引导和原生状态续接不冒充普通参考输入，继续由现有中立能力协议处理。
- 视频节点重新生成更新当前节点，失败保留旧文件；重试使用当前节点配置，结果必须是视频 MIME 类型。
- 当前公开目录共 8 个图片、8 个音频、2 个视频模型，均有对应输入定义。目录覆盖不等于所有模型和所有模式已经实测。

真实任务：H3 FL2VA `fYxi6boqjzmmHTDoWF59u`、H3 Ref2VA `iSXBAgH4CHHFOiY0QUWBV` 使用方形蓝杯参考、16:9、480p、4 秒请求，均成功回传 MP4。FL2VA 实际 864×480、约 4.46 秒，包含音轨；H3 原生帧数会使实际时长偏离请求整数。已查看逐秒抽帧，两例杯把朝镜头方向转动；FL2VA 跨比例样本中杯身变扁，不能认定主体比例保真通过，复杂运动、原声音轨仍待视听验收。请求和文件见 `.tmp/audio-canvas-review/live-video-results.json`，此次未修改执行器工作流或模型部署。


## 其余模型补测

| 模型 | 任务 ID | 结果 |
| --- | --- | --- |
| voxcpm2-local | `oi3OTMfh0Fyv1Mvd0n2KZ` | WAV，48000 Hz，1 声道，3.040 秒；待试听 |
| qwen3-tts-1.7b-voicedesign-local | `XExZRhg-zW6ZKnzT8PzrC` | WAV，24000 Hz，1 声道，2.960 秒；待试听 |
| moss-soundeffect-v2-local | `NYAeRrWxxz5-9yyKCv6WI` | WAV，48000 Hz，1 声道，3.000 秒；待试听 |
| ace-step-v15-xl-sft-local | `LH5ZMgRz84z8QBKi4XsWF` | WAV，48000 Hz，2 声道，10.000 秒；待试听 |
| qwen-image-2512-local | `6MostKIGKp9wrW8lt_u2j` | 1024×1024，已查看样图 |
| z-image-turbo-local | `fVeHtgQ4Aw_VyXb3JIMJC` | 1024×1024，已查看样图 |
| qwen-image-edit-2511-local | `tyiNQ7Wn6TDR2leko2_R_` | 1024×1024，已查看样图 |
| hidream-o1-full-fp8-local | `wFxDlEcwWSGPJMz7R_ig3` | 2048×2048，已查看样图 |
| flux2-dev-fp8-local | `zhMIUIIWYjKYd0tF5JMay` | 1024×1024，已查看样图 |
| cec-image | `l2iwDyth9WU5Pp2MhEP93` | 失败：Not Found |
| sxh-image | `NPeJ6i4-on9RG8Ougk-OM` | 1024×1024，已查看样图 |
| flux2-dev-fp8-local | `zhMIUIIWYjKYd0tF5JMay` | 1024×1024，已查看样图 |

cec-image 返回 `Not Found`；只读查询同一渠道的模型目录仍包含 cec-image，尚无法确定是生成路由还是下游服务问题，未擅自改动渠道地址、凭据或模型 ID。成功记录证明代表任务链路可用，不代表所有参考模式、选项组合及视听质量都已验收。

当前 18 个模型的代表任务合计 17 个成功、1 个失败：本地 6 个图片、8 个音频、2 个视频全部完成至少一个基础任务，云端 sxh-image 成功、cec-image 返回 404。基础图片样例已查看，HiDream 样例没有遵循白色摄影台背景，H3 FL2VA 跨比例样例变扁，均保留质量边界；未测试完所有编辑、克隆、音乐改编和续接组合。
