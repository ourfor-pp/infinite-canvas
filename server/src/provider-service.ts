import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "./config.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { db, parseJson } from "./database.js";
import { COMFY_MODEL_DEFINITIONS, PURPOSE_MODELS, type GenerationPurpose } from "./comfy-workflows.js";

export const providerTypes = ["openai", "openai-compatible", "anthropic", "gemini", "ark"] as const;
export const mediaKinds = ["text", "image", "video", "audio"] as const;
export const modelEndpoints = ["openai-chat", "anthropic-messages", "gemini-generate", "openai-images", "openai-images-generations", "openai-images-edits", "gemini-image", "ark-image", "openai-video", "ark-seedance", "gemini-video", "openai-tts", "gemini-audio"] as const;
export type ProviderType = (typeof providerTypes)[number];
export type MediaKind = (typeof mediaKinds)[number];
export type ModelEndpoint = (typeof modelEndpoints)[number];
export type ProviderCredentials = { apiKey?: string; authToken?: string };
export type ModelEndpointDefinition = { key: ModelEndpoint; label: string; family: "openai" | "anthropic" | "gemini" | "ark"; output: MediaKind; inputs: MediaKind[]; method: "POST"; path: string; agent: boolean };
export type AiModelDefinition = { id: string; name: string; endpoint: ModelEndpoint; output: MediaKind; inputs: MediaKind[]; enabled: boolean; agentEnabled?: boolean };
export type AiGlobalSettings = {
    config: { canvasImageCount: string; audioVoice: string; audioFormat: string; audioSpeed: string; audioInstructions: string; systemPrompt: string };
    promptSources: { sources: Array<Record<string, unknown>>; schedule: Record<string, unknown> };
};
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

export const modelEndpointRegistry: Record<ModelEndpoint, ModelEndpointDefinition> = {
    "openai-chat": { key: "openai-chat", label: "OpenAI 文本", family: "openai", output: "text", inputs: ["text", "image"], method: "POST", path: "/chat/completions", agent: true },
    "anthropic-messages": { key: "anthropic-messages", label: "Anthropic 文本", family: "anthropic", output: "text", inputs: ["text", "image"], method: "POST", path: "/messages", agent: true },
    "gemini-generate": { key: "gemini-generate", label: "Gemini 文本", family: "gemini", output: "text", inputs: ["text", "image"], method: "POST", path: "/models/{model}:generateContent", agent: false },
    "openai-images": { key: "openai-images", label: "OpenAI 图片", family: "openai", output: "image", inputs: ["text", "image"], method: "POST", path: "/images/{generations,edits}", agent: false },
    "openai-images-generations": { key: "openai-images-generations", label: "OpenAI 图片（仅文生图）", family: "openai", output: "image", inputs: ["text"], method: "POST", path: "/images/generations", agent: false },
    "openai-images-edits": { key: "openai-images-edits", label: "OpenAI 图片（仅图生图）", family: "openai", output: "image", inputs: ["text", "image"], method: "POST", path: "/images/edits", agent: false },
    "gemini-image": { key: "gemini-image", label: "Gemini 图片", family: "gemini", output: "image", inputs: ["text", "image"], method: "POST", path: "/models/{model}:generateContent", agent: false },
    "ark-image": { key: "ark-image", label: "火山方舟图片", family: "ark", output: "image", inputs: ["text", "image"], method: "POST", path: "/images/generations", agent: false },
    "openai-video": { key: "openai-video", label: "OpenAI 视频", family: "openai", output: "video", inputs: ["text", "image"], method: "POST", path: "/videos", agent: false },
    "ark-seedance": { key: "ark-seedance", label: "火山方舟视频", family: "ark", output: "video", inputs: ["text", "image", "video", "audio"], method: "POST", path: "/contents/generations/tasks", agent: false },
    "gemini-video": { key: "gemini-video", label: "Gemini 视频", family: "gemini", output: "video", inputs: ["text", "image"], method: "POST", path: "/models/{model}:predictLongRunning", agent: false },
    "openai-tts": { key: "openai-tts", label: "OpenAI 语音", family: "openai", output: "audio", inputs: ["text"], method: "POST", path: "/audio/speech", agent: false },
    "gemini-audio": { key: "gemini-audio", label: "Gemini 语音", family: "gemini", output: "audio", inputs: ["text"], method: "POST", path: "/models/{model}:generateContent", agent: false },
};

export const modelSchema = z.object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    endpoint: z.enum(modelEndpoints),
    enabled: z.boolean().default(true),
    agentEnabled: z.boolean().default(false),
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
}).superRefine((value, context) => {
    value.models.forEach((model, index) => {
        if (model.agentEnabled && !modelEndpointRegistry[model.endpoint].agent) context.addIssue({ code: "custom", path: ["models", index, "agentEnabled"], message: "只有兼容的文本调用方案可以启用 Agent" });
    });
});

export type ProviderInput = z.infer<typeof providerInputSchema>;

const globalGenerationSchema = z.object({
    canvasImageCount: z.string().default("3"),
    audioVoice: z.string().default("alloy"),
    audioFormat: z.string().default("mp3"),
    audioSpeed: z.string().default("1"),
    audioInstructions: z.string().default(""),
    systemPrompt: z.string().default(""),
});
const promptSourcesSchema = z.object({ sources: z.array(z.record(z.string(), z.unknown())).default([]), schedule: z.record(z.string(), z.unknown()).default({}) });
const globalSettingsInputSchema = z.object({ config: globalGenerationSchema.partial().optional(), promptSources: promptSourcesSchema.optional() });
const defaultGlobalSettings: AiGlobalSettings = { config: globalGenerationSchema.parse({}), promptSources: { sources: [], schedule: {} } };

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
    const models = value.models.map((model) => {
        const endpoint = modelEndpointRegistry[model.endpoint];
        return { ...model, output: endpoint.output, inputs: endpoint.inputs };
    });
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
    pruneModelDefaults();
    return adminProviderResponse(getProviderRow(providerId)!);
}

export function deleteProvider(id: string) {
    assertProviderIdle(id);
    const result = db.prepare("DELETE FROM ai_providers WHERE id=?").run(id);
    if (!result.changes) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    pruneModelDefaults();
    return { id };
}

export function clearProviderCredentials(id: string) {
    const row = getProviderRow(id);
    if (!row) throw providerError(404, "AI_PROVIDER_NOT_FOUND", "AI 渠道不存在");
    assertProviderIdle(id);
    db.prepare("UPDATE ai_providers SET encrypted_credentials=?, enabled=0, updated_at=? WHERE id=?").run(encryptJson({}, config.appSecret), new Date().toISOString(), id);
    pruneModelDefaults();
    return adminProviderResponse(getProviderRow(id)!);
}

export function listPublicModels() {
    const providers = db.prepare("SELECT * FROM ai_providers WHERE enabled=1 ORDER BY created_at").all() as ProviderRow[];
    const publicModels = providers.flatMap((provider) => providerModels(provider)
        .filter((model) => model.enabled)
        .map((model) => ({ id: model.id, name: model.name, output: model.output, inputs: model.inputs, enabled: true, value: `${provider.id}::${model.id}`, providerId: provider.id, providerName: provider.name })));
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

export function listModelEndpoints() {
    return modelEndpoints.map((key) => modelEndpointRegistry[key]);
}

export function listModelDefaults() {
    const rows = db.prepare("SELECT kind, model_ref FROM ai_model_defaults").all() as Array<{ kind: MediaKind; model_ref: string }>;
    return Object.fromEntries(mediaKinds.map((kind) => [kind, rows.find((row) => row.kind === kind)?.model_ref || ""])) as Record<MediaKind, string>;
}

export function getAiGlobalSettings(): AiGlobalSettings {
    const row = db.prepare("SELECT encrypted_payload FROM ai_global_settings WHERE id=1").get() as { encrypted_payload: string } | undefined;
    if (!row) return defaultGlobalSettings;
    const stored = decryptJson<Partial<AiGlobalSettings>>(row.encrypted_payload, config.appSecret);
    return { config: globalGenerationSchema.parse(stored.config || {}), promptSources: promptSourcesSchema.parse(stored.promptSources || {}) };
}

export function saveAiGlobalSettings(input: unknown) {
    const value = globalSettingsInputSchema.parse(input);
    const current = getAiGlobalSettings();
    const next: AiGlobalSettings = {
        config: globalGenerationSchema.parse({ ...current.config, ...value.config }),
        promptSources: value.promptSources ? promptSourcesSchema.parse(value.promptSources) : current.promptSources,
    };
    const now = new Date().toISOString();
    db.prepare("INSERT INTO ai_global_settings(id, encrypted_payload, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload, updated_at=excluded.updated_at")
        .run(encryptJson(next, config.appSecret), now);
    return next;
}

export function saveModelDefaults(input: Partial<Record<MediaKind, string>>) {
    const values = z.object({ text: z.string().default(""), image: z.string().default(""), video: z.string().default(""), audio: z.string().default("") }).parse(input);
    const now = new Date().toISOString();
    db.transaction(() => {
        mediaKinds.forEach((kind) => {
            const value = values[kind].trim();
            if (value) resolveProviderModel(value, kind);
            db.prepare("INSERT INTO ai_model_defaults(kind, model_ref, updated_at) VALUES(?, ?, ?) ON CONFLICT(kind) DO UPDATE SET model_ref=excluded.model_ref, updated_at=excluded.updated_at").run(kind, value, now);
        });
    })();
    return listModelDefaults();
}

export function pruneModelDefaults() {
    const rows = db.prepare("SELECT kind, model_ref FROM ai_model_defaults WHERE model_ref != ''").all() as Array<{ kind: MediaKind; model_ref: string }>;
    rows.forEach((row) => {
        try { resolveProviderModel(row.model_ref, row.kind); }
        catch { db.prepare("UPDATE ai_model_defaults SET model_ref='', updated_at=? WHERE kind=?").run(new Date().toISOString(), row.kind); }
    });
}

export function resolveProviderModel(value: string, expectedOutput: MediaKind) {
    const [providerId, ...modelParts] = value.split("::");
    const modelId = modelParts.join("::");
    if (!providerId || !modelId) throw providerError(400, "AI_MODEL_INVALID", "模型标识不正确");
    if (providerId === "comfyui") {
        const output = comfyModelOutput(modelId);
        const node = db.prepare("SELECT id FROM comfy_servers WHERE enabled=1 AND models LIKE ? ORDER BY created_at LIMIT 1").get(`%${modelId}%`) as { id: string } | undefined;
        if (!node || output !== expectedOutput) throw providerError(400, "AI_MODEL_UNAVAILABLE", "模型不可用或能力不匹配");
        return { providerId, modelId, model: { id: modelId, name: modelId, output, inputs: comfyModelInputs(modelId), enabled: true }, comfyServerId: node.id };
    }
    const provider = getProviderRow(providerId);
    const model = provider && providerModels(provider).find((item) => item.id === modelId && item.enabled);
    if (!provider || !provider.enabled || !model || model.output !== expectedOutput) throw providerError(400, "AI_MODEL_UNAVAILABLE", "模型不可用或能力不匹配");
    return { providerId, modelId, model, provider: { ...provider, credentials: decryptCredentials(provider) } };
}

export function resolvePurposeModel(purpose: GenerationPurpose, expectedOutput: MediaKind) {
    if (purpose === "default") throw providerError(400, "AI_MODEL_REQUIRED", "普通生成必须指定模型");
    return resolveProviderModel(`comfyui::${PURPOSE_MODELS[purpose]}`, expectedOutput);
}

export function resolveAgentModel(value: string) {
    const selection = resolveProviderModel(value, "text");
    if (!selection.provider || !selection.model.agentEnabled || !modelEndpointRegistry[selection.model.endpoint]?.agent) {
        throw providerError(400, "AGENT_MODEL_UNAVAILABLE", "所选模型未启用 Agent 能力或协议不兼容");
    }
    return selection as typeof selection & { provider: ProviderRow & { credentials: ProviderCredentials } };
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
    const agentActive = Number((db.prepare("SELECT count(*) count FROM agent_runs WHERE model_ref LIKE ? AND status IN ('queued','running','waiting_for_user')").get(`${id}::%`) as { count: number }).count);
    if (active || agentActive) throw providerError(409, "AI_PROVIDER_BUSY", "仍有生成或 Agent 任务使用该渠道");
}

function comfyModelOutput(id: string): MediaKind {
    return COMFY_MODEL_DEFINITIONS[id as keyof typeof COMFY_MODEL_DEFINITIONS]?.output || "text";
}

function comfyModelName(id: string) {
    return COMFY_MODEL_DEFINITIONS[id as keyof typeof COMFY_MODEL_DEFINITIONS]?.name || id;
}

function comfyModelInputs(id: string): MediaKind[] {
    return COMFY_MODEL_DEFINITIONS[id as keyof typeof COMFY_MODEL_DEFINITIONS]?.inputs || ["text"];
}

function providerError(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}
