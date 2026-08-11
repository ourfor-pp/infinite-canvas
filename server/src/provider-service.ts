import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { db, parseJson } from "./database.js";

export const providerTypes = ["openai", "openai-compatible", "anthropic", "gemini", "ark"] as const;
export const mediaKinds = ["text", "image", "video", "audio"] as const;
export type ProviderType = (typeof providerTypes)[number];
export type MediaKind = (typeof mediaKinds)[number];
export type ProviderCredentials = { apiKey?: string; authToken?: string };
export type AiModelDefinition = { id: string; name: string; output: MediaKind; inputs: MediaKind[]; enabled: boolean };
export type ProviderRow = {
    id: string;
    name: string;
    type: ProviderType;
    base_url: string;
    encrypted_credentials: string;
    enabled: number;
    models: string;
    concurrency: number;
    created_at: string;
    updated_at: string;
};

export const modelSchema = z.object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    output: z.enum(mediaKinds),
    inputs: z.array(z.enum(mediaKinds)).min(1),
    enabled: z.boolean().default(true),
});

export const providerInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(providerTypes),
    baseUrl: z.string().url(),
    apiKey: z.string().optional(),
    authToken: z.string().optional(),
    credentialMode: z.enum(["apiKey", "authToken"]).optional(),
    enabled: z.boolean().default(true),
    concurrency: z.number().int().min(1).max(32).default(2),
    models: z.array(modelSchema).default([]),
});

export type ProviderInput = z.infer<typeof providerInputSchema>;

export function listAdminProviders() {
    return (db.prepare("SELECT * FROM ai_providers ORDER BY created_at").all() as ProviderRow[]).map(adminProviderResponse);
}

export function saveProvider(input: ProviderInput, id?: string) {
    const value = providerInputSchema.parse(input);
    const providerId = id || nanoid();
    const now = new Date().toISOString();
    const current = id ? getProviderRow(id) : undefined;
    if (id && !current) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    const currentCredentials = current ? decryptCredentials(current) : {};
    const credentialMode = value.type === "anthropic" ? value.credentialMode || (currentCredentials.authToken ? "authToken" : "apiKey") : "apiKey";
    const credentials = {
        apiKey: credentialMode === "apiKey" ? value.apiKey?.trim() || currentCredentials.apiKey || "" : "",
        authToken: credentialMode === "authToken" ? value.authToken?.trim() || currentCredentials.authToken || "" : "",
    };
    const credentialReady = value.type === "anthropic" ? Boolean(credentials.apiKey || credentials.authToken) : value.type === "openai-compatible" ? true : Boolean(credentials.apiKey);
    if (value.enabled && !credentialReady) throw providerError(400, "AI_CREDENTIAL_REQUIRED", value.type === "anthropic" ? "启用渠道前请配置 API Key 或 Auth Token" : "启用渠道前请配置 API Key");
    const baseUrl = normalizeProviderUrl(value.baseUrl, value.type);
    const models = value.type === "anthropic" ? value.models.map((model) => {
        const inputs = model.inputs.filter((input): input is "text" | "image" => input === "text" || input === "image");
        return { ...model, output: "text" as const, inputs: inputs.length ? inputs : ["text" as const] };
    }) : value.models;
    if (current) {
        assertProviderIdle(providerId);
        db.prepare("UPDATE ai_providers SET name=?, type=?, base_url=?, encrypted_credentials=?, enabled=?, models=?, concurrency=?, updated_at=? WHERE id=?").run(
            value.name,
            value.type,
            baseUrl,
            encryptJson(credentials, config.appSecret),
            Number(value.enabled),
            JSON.stringify(models),
            value.concurrency,
            now,
            providerId,
        );
    } else {
        db.prepare("INSERT INTO ai_providers(id, name, type, base_url, encrypted_credentials, enabled, models, concurrency, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            providerId,
            value.name,
            value.type,
            baseUrl,
            encryptJson(credentials, config.appSecret),
            Number(value.enabled),
            JSON.stringify(models),
            value.concurrency,
            now,
            now,
        );
    }
    return adminProviderResponse(getProviderRow(providerId)!);
}

export function deleteProvider(id: string) {
    assertProviderIdle(id);
    const result = db.prepare("DELETE FROM ai_providers WHERE id=?").run(id);
    if (!result.changes) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    return { id };
}

export function clearProviderCredentials(id: string) {
    const row = getProviderRow(id);
    if (!row) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    assertProviderIdle(id);
    db.prepare("UPDATE ai_providers SET encrypted_credentials=?, enabled=0, updated_at=? WHERE id=?").run(encryptJson({}, config.appSecret), new Date().toISOString(), id);
    return adminProviderResponse(getProviderRow(id)!);
}

export function listPublicModels() {
    const providers = db.prepare("SELECT * FROM ai_providers WHERE enabled=1 ORDER BY created_at").all() as ProviderRow[];
    const publicModels = providers.flatMap((provider) => providerModels(provider)
        .filter((model) => model.enabled)
        .map((model) => ({ ...model, value: `${provider.id}::${model.id}`, providerId: provider.id, providerName: provider.name })));
    const comfyRows = db.prepare("SELECT name, models FROM comfy_servers WHERE enabled=1 ORDER BY created_at").all() as Array<{ name: string; models: string }>;
    const comfyNames = new Set(comfyRows.flatMap((row) => parseJson<string[]>(row.models, [])));
    return [
        ...publicModels,
        ...Array.from(comfyNames).map((id) => {
            const output = comfyModelOutput(id);
            return { id, name: comfyModelName(id), value: `comfyui::${id}`, providerId: "comfyui", providerName: "ComfyUI", output, inputs: comfyModelInputs(id), enabled: true };
        }),
    ];
}

export function resolveProviderModel(value: string, expectedOutput: MediaKind) {
    const [providerId, ...modelParts] = value.split("::");
    const modelId = modelParts.join("::");
    if (!providerId || !modelId) throw providerError(400, "AI_MODEL_INVALID", "模型标识不正确");
    if (providerId === "comfyui") {
        const output = comfyModelOutput(modelId);
        const node = db.prepare("SELECT id FROM comfy_servers WHERE enabled=1 AND models LIKE ? ORDER BY created_at LIMIT 1").get(`%${modelId}%`) as { id: string } | undefined;
        if (!node || output !== expectedOutput) throw providerError(400, "AI_MODEL_UNAVAILABLE", "模型不可用或能力不匹配");
        return { providerId, modelId, model: { id: modelId, name: modelId, output, inputs: comfyModelInputs(modelId), enabled: true } satisfies AiModelDefinition, comfyServerId: node.id };
    }
    const provider = getProviderRow(providerId);
    const model = provider && providerModels(provider).find((item) => item.id === modelId && item.enabled);
    if (!provider || !provider.enabled || !model || model.output !== expectedOutput) throw providerError(400, "AI_MODEL_UNAVAILABLE", "模型不可用或能力不匹配");
    return { providerId, modelId, model, provider: { ...provider, credentials: decryptCredentials(provider) } };
}

export async function testProvider(id: string) {
    const row = getProviderRow(id);
    if (!row) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    const models = await fetchProviderModels(row);
    return { available: true, models: models.length };
}

export async function discoverProviderModels(id: string) {
    const row = getProviderRow(id);
    if (!row) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    return { models: await fetchProviderModels(row) };
}

export function getProviderRow(id: string) {
    return db.prepare("SELECT * FROM ai_providers WHERE id=?").get(id) as ProviderRow | undefined;
}

export function providerModels(row: ProviderRow) {
    return parseJson<AiModelDefinition[]>(row.models, []);
}

export function decryptCredentials(row: ProviderRow) {
    return decryptJson<ProviderCredentials>(row.encrypted_credentials, config.appSecret);
}

function adminProviderResponse(row: ProviderRow) {
    const credentials = decryptCredentials(row);
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        baseUrl: providerBaseUrl(row),
        enabled: Boolean(row.enabled),
        models: providerModels(row),
        concurrency: row.concurrency,
        credentialConfigured: Boolean(credentials.apiKey || credentials.authToken),
        credentialType: credentials.authToken ? "authToken" : "apiKey",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function fetchProviderModels(row: ProviderRow) {
    const credentials = decryptCredentials(row);
    const url = new URL(providerPath(row, "/models"));
    if (row.type === "gemini" && credentials.apiKey) url.searchParams.set("key", credentials.apiKey);
    let response: Response;
    try {
        response = await fetch(url, { headers: providerHeaders(row, credentials), signal: AbortSignal.timeout(15_000), redirect: "error" });
    } catch {
        throw providerError(502, "AI_PROVIDER_UNAVAILABLE", "无法连接 AI 渠道");
    }
    if (!response.ok) throw providerError(502, "AI_PROVIDER_UNAVAILABLE", `渠道返回 HTTP ${response.status}`);
    const body = await response.json().catch(() => null) as { data?: Array<{ name?: string; id?: string }>; models?: Array<{ name?: string; id?: string }> } | null;
    if (!body || typeof body !== "object") throw providerError(502, "AI_PROVIDER_RESPONSE_INVALID", "模型列表响应格式不正确，请检查 API Base URL");
    const values = row.type === "gemini"
        ? (body.models || []).map((model) => (model.name || model.id || "").replace(/^models\//, ""))
        : (body.data || body.models || []).map((model) => model.id || model.name || "");
    if (!Array.isArray(body.data) && !Array.isArray(body.models)) throw providerError(502, "AI_PROVIDER_RESPONSE_INVALID", "渠道没有返回模型列表，请检查 API Base URL");
    return Array.from(new Set(values.filter(Boolean)));
}

export function providerBaseUrl(row: Pick<ProviderRow, "base_url" | "type">) {
    return normalizeProviderUrl(row.base_url, row.type);
}

export function providerPath(row: Pick<ProviderRow, "base_url" | "type">, path: string) {
    return `${providerBaseUrl(row)}/${path.replace(/^\/+/, "")}`;
}

export function providerHeaders(row: Pick<ProviderRow, "type">, credentials: ProviderCredentials, json = false) {
    const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
    if (row.type === "anthropic") {
        headers[credentials.authToken ? "Authorization" : "x-api-key"] = credentials.authToken ? `Bearer ${credentials.authToken}` : credentials.apiKey || "";
        headers["anthropic-version"] = "2023-06-01";
    } else if (row.type === "gemini") {
        if (credentials.apiKey) headers["x-goog-api-key"] = credentials.apiKey;
    } else if (credentials.apiKey) {
        headers.Authorization = `Bearer ${credentials.apiKey}`;
    }
    return headers;
}

function normalizeProviderUrl(value: string, type: ProviderType) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw providerError(400, "AI_PROVIDER_URL_INVALID", "渠道地址只支持不含凭据的 HTTP/HTTPS URL");
    if (type === "anthropic" && (!url.pathname || url.pathname === "/")) url.pathname = "/v1";
    return url.toString().replace(/\/+$/, "");
}

function assertProviderIdle(id: string) {
    const active = Number((db.prepare("SELECT count(*) count FROM generations WHERE provider_id=? AND status IN ('queued','running')").get(id) as { count: number }).count);
    if (active) throw providerError(409, "AI_PROVIDER_BUSY", "仍有生成任务使用该渠道");
}

function comfyModelOutput(id: string): MediaKind {
    if (id === "hidream-o1-full-fp8-local") return "image";
    if (id.startsWith("minimax-h3-")) return "video";
    if (id === "voxcpm2-local") return "audio";
    return "text";
}

function comfyModelName(id: string) {
    if (id === "hidream-o1-full-fp8-local") return "HiDream-O1 Full FP8";
    if (id === "minimax-h3-fl2va-local") return "MiniMax H3 FL2VA";
    if (id === "minimax-h3-ref2va-local") return "MiniMax H3 Ref2VA";
    if (id === "voxcpm2-local") return "VoxCPM2";
    return id;
}

function comfyModelInputs(id: string): MediaKind[] {
    if (id === "minimax-h3-ref2va-local") return ["text", "image", "video", "audio"];
    if (id === "minimax-h3-fl2va-local") return ["text", "image"];
    return ["text"];
}

function providerError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}
