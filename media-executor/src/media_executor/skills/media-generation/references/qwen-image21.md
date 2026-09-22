# Qwen Image 2.1

模型 ID 为 `qwen-image-2.1-local`，能力版本 `1`，通过中立服务 `/v1/jobs/validate` 和 `/v1/jobs` 调用。先查询 `/v1/capabilities` 的 available；此能力不改变宿主 Codex 普通生图使用原生工具的约定，不能假设宿主 MCP 已开放 image 请求。

- 文生图：`mode: text-to-image`、`operation: generate`，不传参考图。`width`、`height` 默认 1024，各为 256–4096 的 32 倍数，总像素不超过 4,300,800，长宽比不超过 8:1。
- 图片编辑：`mode: image-edit`，`operation: generate`，1–10 张 `kind: image, role: reference` 图片，按声明顺序对应图 1、图 2 等。输出沿用第一张参考图比例；`referenceResolution` 默认 1024，可设 256–2048 的 32 倍数，表示参考图等面积缩放的边长，不接受 width/height。
- 公共参数：`steps` 默认 40、范围 1–100；`seed` 是非负安全整数；`negativePrompt` 可选。固定配方 `int8-convrot`，Euler/simple、CFG 1。不支持视频/声音参考、续接或隐式提示改写。
- 输入 PNG 的 alpha 通道保留，输出保存为 PNG。需要透明图时在提示词中明确透明背景和 alpha 通道；实际透明度仍需查看输出，不能仅凭 PNG 扩展名认定抠图成功。

透明图可采用官方建议句式：`This is an RGBA image with transparency. <具体主体描述>. The image has alpha channel and the background is transparent.` 程序不会代为添加这些文字。编辑时清楚指定每张图的用途、要改的部分与应保留的身份和构图。

```json
{"id":"qwen-image-demo","model":"qwen-image-2.1-local","mode":"text-to-image","operation":"generate","prompt":"白色摄影背景上的蓝色陶瓷茶杯","params":{"width":1024,"height":1024,"steps":40,"seed":42},"references":[]}
```

输入先上传到 `/v1/files` 获得临时 fileId，结果通过任务文件下载接口保存后 ACK。任务幂等、取消和 GPU 排队沿用统一服务协议。生成成功不等于画质通过验收。

来源：[官方模型说明](https://github.com/QwenLM/Qwen-Image-2.1)、[官方 ComfyUI 工作流](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json)。权重来自官方推荐的 Comfy-Org ModelScope 同仓，固定 revision、文件哈希和 ComfyUI revision 记录在 `media-executor/models/qwen-image21.json`。模型使用 Qwen Research License，商业使用需按其许可办理。
