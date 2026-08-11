import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { providerBaseUrl, type ProviderCredentials, type ProviderRow } from "../provider-service.js";

type ProxyRuntime = { row: ProviderRow; credentials: ProviderCredentials; model: string; expiresAt: number };
const runtimes = new Map<string, ProxyRuntime>();

export function registerAgentProviderProxy(row: ProviderRow, credentials: ProviderCredentials, model: string) {
    cleanup();
    const token = randomUUID();
    runtimes.set(token, { row, credentials, model, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return {
        baseUrl: `http://127.0.0.1:${config.port}${config.basePath}/api/agent/provider-proxy`,
        apiKey: token,
    };
}

export async function handleAgentProviderProxy(req: Request, res: Response) {
    const token = String(req.headers["x-api-key"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const runtime = runtimes.get(token);
    if (!runtime || runtime.expiresAt <= Date.now()) {
        res.status(401).json({ type: "error", error: { type: "authentication_error", message: "Agent provider proxy token is invalid" } });
        return;
    }
    runtime.expiresAt = Date.now() + 6 * 60 * 60 * 1000;
    const anthropic = req.body as ClaudeRequest;
    const upstreamUrl = `${providerBaseUrl(runtime.row).replace(/\/+$/, "")}/chat/completions`;
    const upstreamToken = runtime.credentials.authToken || runtime.credentials.apiKey || "";
    let response: globalThis.Response;
    try {
        response = await fetch(upstreamUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(upstreamToken ? { Authorization: `Bearer ${upstreamToken}` } : {}) },
            body: JSON.stringify(toOpenAiRequest(anthropic, runtime.model)),
            signal: AbortSignal.timeout(10 * 60 * 1000),
            redirect: "error",
        });
    } catch (error) {
        res.status(502).json({ type: "error", error: { type: "api_error", message: error instanceof Error ? error.message : "上游连接失败" } });
        return;
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        res.status(response.status).json({ type: "error", error: { type: "api_error", message: sanitize(detail) || `上游返回 HTTP ${response.status}` } });
        return;
    }
    if (!anthropic.stream) {
        res.json(toClaudeResponse(await response.json() as OpenAiResponse, runtime.model));
        return;
    }
    if (!response.body) {
        res.status(502).json({ type: "error", error: { type: "api_error", message: "上游没有返回数据流" } });
        return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    await pipeOpenAiStream(response.body, res, runtime.model);
}

type ClaudeContent = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; source?: { type?: string; media_type?: string; data?: string; url?: string } };
type ClaudeRequest = { model?: string; system?: string | ClaudeContent[]; messages?: Array<{ role?: string; content?: string | ClaudeContent[] }>; tools?: Array<{ name?: string; description?: string; input_schema?: unknown }>; max_tokens?: number; temperature?: number; top_p?: number; stream?: boolean };
type OpenAiResponse = { id?: string; choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };

function toOpenAiRequest(request: ClaudeRequest, model: string) {
    const messages: Array<Record<string, unknown>> = [];
    const system = textContent(request.system);
    if (system) messages.push({ role: "system", content: system });
    for (const message of request.messages || []) {
        const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content || [];
        if (message.role === "assistant") {
            const text = blocks.filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
            const toolCalls = blocks.filter((block) => block.type === "tool_use").map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } }));
            messages.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
            continue;
        }
        const normal: Array<Record<string, unknown>> = [];
        for (const block of blocks) {
            if (block.type === "tool_result") {
                if (normal.length) messages.push({ role: "user", content: normal });
                normal.length = 0;
                messages.push({ role: "tool", tool_call_id: block.tool_use_id, content: textContent(block.content) || "工具执行完成" });
            } else if (block.type === "image" && block.source) {
                const url = block.source.type === "base64" ? `data:${block.source.media_type || "image/png"};base64,${block.source.data || ""}` : block.source.url || "";
                if (url) normal.push({ type: "image_url", image_url: { url } });
            } else if (block.type === "text") normal.push({ type: "text", text: block.text || "" });
        }
        if (normal.length) messages.push({ role: "user", content: normal.length === 1 && normal[0].type === "text" ? normal[0].text : normal });
    }
    return {
        model,
        messages,
        max_tokens: request.max_tokens || 8192,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: Boolean(request.stream),
        ...(request.stream ? { stream_options: { include_usage: true } } : {}),
        tools: (request.tools || []).map((item) => ({ type: "function", function: { name: item.name, description: item.description, parameters: item.input_schema || { type: "object", properties: {} } } })),
    };
}

function toClaudeResponse(response: OpenAiResponse, model: string) {
    const choice = response.choices?.[0];
    const content: Array<Record<string, unknown>> = [];
    if (choice?.message?.reasoning_content) content.push({ type: "thinking", thinking: choice.message.reasoning_content, signature: "compatible-provider" });
    if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
    for (const call of choice?.message?.tool_calls || []) content.push({ type: "tool_use", id: call.id || randomUUID(), name: call.function?.name || "tool", input: parseArguments(call.function?.arguments) });
    return {
        id: response.id || `msg_${randomUUID().replace(/-/g, "")}`,
        type: "message",
        role: "assistant",
        model,
        content,
        stop_reason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: response.usage?.prompt_tokens || 0, output_tokens: response.usage?.completion_tokens || 0 },
    };
}

async function pipeOpenAiStream(body: ReadableStream<Uint8Array>, res: Response, model: string) {
    const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
    send(res, "message_start", { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let textStarted = false;
    let thinkingStarted = false;
    let nextBlockIndex = 0;
    const tools = new Map<number, { blockIndex: number; id: string; name: string }>();
    let stopReason = "end_turn";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            const raw = line.trim();
            if (!raw.startsWith("data:") || raw === "data: [DONE]") continue;
            let chunk: { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            try { chunk = JSON.parse(raw.slice(5).trim()); } catch { continue; }
            const choice = chunk.choices?.[0];
            if (choice?.delta?.reasoning_content) {
                if (textStarted) {
                    send(res, "content_block_stop", { type: "content_block_stop", index: nextBlockIndex });
                    textStarted = false;
                    nextBlockIndex += 1;
                }
                if (!thinkingStarted) {
                    thinkingStarted = true;
                    send(res, "content_block_start", { type: "content_block_start", index: nextBlockIndex, content_block: { type: "thinking", thinking: "", signature: "" } });
                }
                send(res, "content_block_delta", { type: "content_block_delta", index: nextBlockIndex, delta: { type: "thinking_delta", thinking: choice.delta.reasoning_content } });
            }
            if (choice?.delta?.content) {
                if (thinkingStarted) {
                    send(res, "content_block_delta", { type: "content_block_delta", index: nextBlockIndex, delta: { type: "signature_delta", signature: "compatible-provider" } });
                    send(res, "content_block_stop", { type: "content_block_stop", index: nextBlockIndex });
                    thinkingStarted = false;
                    nextBlockIndex += 1;
                }
                if (!textStarted) {
                    textStarted = true;
                    send(res, "content_block_start", { type: "content_block_start", index: nextBlockIndex, content_block: { type: "text", text: "" } });
                }
                send(res, "content_block_delta", { type: "content_block_delta", index: nextBlockIndex, delta: { type: "text_delta", text: choice.delta.content } });
            }
            for (const call of choice?.delta?.tool_calls || []) {
                if (thinkingStarted) {
                    send(res, "content_block_delta", { type: "content_block_delta", index: nextBlockIndex, delta: { type: "signature_delta", signature: "compatible-provider" } });
                    send(res, "content_block_stop", { type: "content_block_stop", index: nextBlockIndex });
                    thinkingStarted = false;
                    nextBlockIndex += 1;
                }
                if (textStarted) {
                    send(res, "content_block_stop", { type: "content_block_stop", index: nextBlockIndex });
                    textStarted = false;
                    nextBlockIndex += 1;
                }
                const key = call.index || 0;
                let toolState = tools.get(key);
                if (!toolState) {
                    toolState = { blockIndex: nextBlockIndex++, id: call.id || `toolu_${randomUUID().replace(/-/g, "")}`, name: call.function?.name || "tool" };
                    tools.set(key, toolState);
                    send(res, "content_block_start", { type: "content_block_start", index: toolState.blockIndex, content_block: { type: "tool_use", id: toolState.id, name: toolState.name, input: {} } });
                }
                if (call.function?.arguments) send(res, "content_block_delta", { type: "content_block_delta", index: toolState.blockIndex, delta: { type: "input_json_delta", partial_json: call.function.arguments } });
            }
            if (choice?.finish_reason === "tool_calls") stopReason = "tool_use";
        }
    }
    if (thinkingStarted) {
        send(res, "content_block_delta", { type: "content_block_delta", index: nextBlockIndex, delta: { type: "signature_delta", signature: "compatible-provider" } });
        send(res, "content_block_stop", { type: "content_block_stop", index: nextBlockIndex });
    }
    if (textStarted) send(res, "content_block_stop", { type: "content_block_stop", index: nextBlockIndex });
    tools.forEach((toolState) => send(res, "content_block_stop", { type: "content_block_stop", index: toolState.blockIndex }));
    send(res, "message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 0 } });
    send(res, "message_stop", { type: "message_stop" });
    res.end();
}

function send(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function textContent(value: unknown): string {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map((item) => item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text || "") : typeof item === "string" ? item : "").filter(Boolean).join("\n");
}

function parseArguments(value?: string) {
    try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function sanitize(value: string) {
    return value.replace(/https?:\/\/\S+/gi, "[URL]").replace(/(?:sk|key|token|bearer)[-_\s:=]+[A-Za-z0-9._-]{8,}/gi, "[凭据已隐藏]").slice(0, 1000);
}

function cleanup() {
    const now = Date.now();
    runtimes.forEach((runtime, token) => {
        if (runtime.expiresAt <= now) runtimes.delete(token);
    });
}
