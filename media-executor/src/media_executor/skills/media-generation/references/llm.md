# 本地文字与看图任务

模型 `qwen3.5-4b-q4-local`，`mode: text`，`operation: generate`。输入为 prompt 和最多一张显式图片参考，输出为文本；不读取项目，不自动调用生图模型。调用方负责把采用的分析结果交给图片生成任务。

模型为 Unsloth 在 ModelScope 发布的 Qwen3.5-4B Q4_K_M GGUF，基础模型来自 Qwen，属于社区量化而非 Qwen 官方量化。来源、固定 revision、两份权重的 SHA256 与 llama.cpp revision 见 `models/qwen-llm.json`。

## 请求

使用现有 `POST /v1/jobs`，携带 Bearer 和 `X-Media-Protocol: 2`。图片先通过 `POST /v1/files` 上传，以返回的 fileId 放入 references；不接受外部 URL 或客户端本地路径。

```json
{
  "id": "product-plan-001",
  "model": "qwen3.5-4b-q4-local",
  "mode": "text",
  "operation": "generate",
  "prompt": "整理产品图要求：纯白背景，左边蓝杯，右边红杯，恰好两个杯子，无文字。",
  "params": {
    "systemPrompt": "只输出JSON对象。prompt字段独立包含所有要求，constraints字段列出约束。",
    "responseFormat": "json_object",
    "maxTokens": 768,
    "temperature": 0.2,
    "seed": 42
  },
  "references": []
}
```

- `systemPrompt` 可选，正文原样发送；服务不追加生图创作语义。
- `maxTokens` 为 1–2048，默认 768；`temperature` 为 0–2，默认 0.2。
- `responseFormat` 为 `text`（默认）或 `json_object`。JSON 格式约束不保证内容完整或业务正确。
- 单次总上下文为 8192 token，关闭思考输出；超长输入由引擎明确拒绝。图片保留比例，内部预处理最长边为 1024，视觉 token 上限 1024，原上传文件不变。
- prompt 最多 24000 字符、systemPrompt 最多 8000 字符；字符预检不替代 token 上限校验。

查询 `GET /v1/jobs/:id`，成功结果含 `text`、`usage`、`finishReason` 及 `response.json`、`response.txt` 下载文件。`finishReason: length` 表示达到输出上限，调用方应视为可能不完整，不应直接执行截断的 JSON 或提示词。采用结果后按原流程 ACK 回收。

## 共存和质量边界

模型工作进程及其 llama.cpp 子进程只使用私有 Unix Socket，由现有执行器启动、复用与回收，不增加对外端口或 systemd 服务。GPU 推理串行，空间充足时保持加载，不承诺两个模型同时推理。

`qualify-qwen-llm.py` 实测后才写入绑定 LLM/Comfy 运行时 revision 的显存预算。复用范围包括当前固定 8K LLM，以及 1024/2048 正方形、40 步、无参考图、无负面提示、提示正文不超过 1024 UTF-8 字节的 Qwen Image 文生图。其他规格、版本变化或缺少校准记录时回到保守调度；真实显存不足仍卸载闲置模型，明确 CUDA OOM 仅允许原请求重试一次。

已有样例发现“先描述图片再编辑”可能漏掉最终 prompt 中的修改要求。调用方应把编辑要求写清楚，并检查最终将发送给生图模型的字段；不要因输出合法 JSON 就判定需求完整。
