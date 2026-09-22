import type { DirectorProjectChanged } from "@/types/director-sync";
import type { CreativeAsset } from "@/types/creative-asset";
import type { VisualStyle, VisualStyleTemplate } from "@/types/visual-style";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/api`;

export type ServerSession = {
    user: { id: string; username: string; isAdmin: boolean };
    counts: { projects: number; assets: number; generations: number; settings: number };
    authMode: "dev" | "fnos";
};

export type ServerFile = {
    id: string;
    fileId: string;
    name: string;
    mimeType: string;
    bytes: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    url: string;
};

export type ServerGeneration = {
    id: string;
    kind: "image" | "video" | "audio" | "text" | "transcription";
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    providerId: string | null;
    modelId: string;
    request: Record<string, unknown>;
    result: Record<string, unknown> | null;
    error: string | null;
    errorCode: string | null;
    progress: number;
    diagnostics?: { phase?: string; [key: string]: unknown } | null;
    usage: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
};

export type ComfyServer = { id: string; name: string; url: string; enabled: boolean; models: string[]; createdAt: string; updatedAt: string };
export type ComfyTestResult = { available: boolean; workflows: Array<{ id: string; available: boolean; missing: string[] }> };
export type ModelCapability = "text" | "image" | "video" | "audio";
export type ImageMode = "generate" | "edit";
export type ImageWorkflowPurpose = "image-inpaint" | "image-upscale-faithful" | "image-upscale-generative" | "image-angle";
export type AudioMode = "speech" | "ambient" | "sfx" | "music";
export type AudioOperation = "generate" | "clone" | "transform" | "extend" | "inpaint" | "cover" | "remix";
export type ModelEndpoint = "openai-chat" | "anthropic-messages" | "gemini-generate" | "openai-images" | "openai-images-generations" | "openai-images-edits" | "gemini-image" | "ark-image" | "openai-video" | "ark-seedance" | "gemini-video" | "openai-tts" | "gemini-audio";
export type ModelEndpointDefinition = { key: ModelEndpoint; label: string; family: "openai" | "anthropic" | "gemini" | "ark"; output: ModelCapability; inputs: ModelCapability[]; method: "POST"; path: string; agent: boolean };
export type AiGlobalSettings = { config: { canvasImageCount: string; audioVoice: string; audioFormat: string; audioSpeed: string; audioInstructions: string; systemPrompt: string; creativeAssetReviewModel: string }; imageEditModel: string; imageWorkflows: Record<ImageWorkflowPurpose, string>; audioDefaults: Record<AudioMode, Partial<Record<AudioOperation, string>>>; promptSources: { sources: Array<Record<string, unknown>>; schedule: Record<string, unknown> } };
export type VideoReferenceRole = "reference" | "first-frame" | "last-frame" | "continuation";
export type AiModelDefinition = { id: string; name: string; endpoint: ModelEndpoint; output: ModelCapability; inputs: ModelCapability[]; enabled: boolean; agentEnabled?: boolean; audioModes?: AudioMode[]; audioOperations?: AudioOperation[]; maxReferenceAudios?: number; minDurationSeconds?: number; maxDurationSeconds?: number; languages?: string[]; voices?: string[]; imageModes?: ImageMode[]; maxReferenceImages?: number; imagePromptProfile?: "generic" | "gpt-image-2"; videoReferenceRoles?: VideoReferenceRole[]; videoExtend?: boolean; videoModes?: Array<"fl2va" | "ref2va">; maxReferenceVideos?: number; maxReferenceFiles?: number; videoFps?: number; videoNativeAudio?: boolean; videoNativeResolution?: string; videoContinuationMode?: "reference" | "extend" };
export type PublicAiModel = Omit<AiModelDefinition, "endpoint" | "agentEnabled" | "output"> & { output: ModelCapability | "transcription"; value: string; providerId: string; providerName: string };
export type AiProvider = {
    id: string;
    name: string;
    type: "openai" | "openai-compatible" | "anthropic" | "gemini" | "ark";
    baseUrl: string;
    enabled: boolean;
    models: AiModelDefinition[];
    concurrency: number;
    credentialConfigured: boolean;
    credentialType: "apiKey" | "authToken";
    createdAt: string;
    updatedAt: string;
};
export type AdminGeneration = Omit<ServerGeneration, "request" | "result"> & { user: { id: string; username: string }; request?: undefined; result?: undefined };
export type BackupSettings = { url: string; username: string; directory: string; passwordConfigured: boolean; updatedAt: string };
export type BackupSnapshot = { id: string; createdAt: string; files: number; bytes: number };
export type CreativeAssetGenerationPreview = {
    assetId: string;
    assetRevision: number;
    kind: "image" | "audio";
    audioMode?: AudioMode;
    model: { value: string; name: string; providerName: string; inputs: ModelCapability[]; imageModes?: Array<"generate" | "edit">; maxReferenceImages?: number; audioModes?: AudioMode[] };
    prompt: string;
    instructions: string;
    references: Array<{ fileId: string; kind: "image" | "audio"; source: "style" | "asset" | "canvas" | "primary"; label: string; purpose?: string; nodeId?: string; title?: string }>;
    excludedReferences: Array<{ fileId: string; source: "style" | "asset" | "canvas"; label: string; reason: string }>;
    style: { id: string; revision: number; name: string; description: string; referenceFileId: string | null; imageApplied: boolean } | null;
    warnings: Array<{ code: string; message: string; blocking: boolean }>;
    params: Record<string, unknown>;
};

export class ServerApiError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly status: number,
        readonly details?: unknown,
    ) {
        super(message);
    }
}

export function serverApiUrl(path: string) {
    return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function serverRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
        response = await fetch(serverApiUrl(path), { ...init, headers });
    } catch {
        throw new ServerApiError("无法连接无限画布服务，请确认后端已经启动", "SERVER_OFFLINE", 0);
    }
    const body = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string; details?: unknown } } | null;
    if (!response.ok) throw new ServerApiError(body?.error?.message || `服务请求失败（${response.status}）`, body?.error?.code || "REQUEST_FAILED", response.status, body?.error?.details);
    return body?.data as T;
}

export const serverApi = {
    session: () => serverRequest<ServerSession>("/session"),
    projects: (kind?: "canvas" | "director") => serverRequest<Array<Record<string, unknown>>>(`/projects${kind ? `?kind=${kind}` : ""}`),
    project: (id: string) => serverRequest<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}`),
    createProject: (project: Record<string, unknown>) => serverRequest<Record<string, unknown>>("/projects", { method: "POST", body: JSON.stringify(project) }),
    updateProject: (id: string, project: Record<string, unknown>, force = false) => serverRequest<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}${force ? "/force" : ""}`, { method: "PUT", body: JSON.stringify(project) }),
    deleteProjectNodes: (id: string, ids: string[], revision: number) => serverRequest<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}/nodes`, { method: "DELETE", body: JSON.stringify({ ids, revision }) }),
    deleteProject: (id: string) => serverRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
    creativeAssets: (projectId: string) => serverRequest<CreativeAsset[]>(`/projects/${encodeURIComponent(projectId)}/creative-assets`),
    createCreativeAsset: (projectId: string, input: Record<string, unknown>) => serverRequest<CreativeAsset>(`/projects/${encodeURIComponent(projectId)}/creative-assets`, { method: "POST", body: JSON.stringify(input) }),
    creativeAsset: (id: string) => serverRequest<CreativeAsset>(`/creative-assets/${encodeURIComponent(id)}`),
    updateCreativeAsset: (id: string, input: Record<string, unknown>) => serverRequest<CreativeAsset>(`/creative-assets/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    deleteCreativeAsset: (id: string) => serverRequest(`/creative-assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
    previewCreativeAssetGeneration: (id: string, input: Record<string, unknown>) => serverRequest<CreativeAssetGenerationPreview>(`/creative-assets/${encodeURIComponent(id)}/generation-preview`, { method: "POST", body: JSON.stringify(input) }),
    generateCreativeAsset: (id: string, input: Record<string, unknown>) => serverRequest<ServerGeneration>(`/creative-assets/${encodeURIComponent(id)}/generations`, { method: "POST", body: JSON.stringify(input) }),
    setCreativeAssetPrimary: (id: string, variantId: string, revision: number) => serverRequest<CreativeAsset>(`/creative-assets/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}/primary`, { method: "POST", body: JSON.stringify({ revision }) }),
    reviewCreativeAssetVariant: (id: string, variantId: string, input: { revision: number; accepted: boolean; summary?: string; issues?: string[]; setPrimary?: boolean }) => serverRequest<CreativeAsset>(`/creative-assets/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}/review`, { method: "POST", body: JSON.stringify(input) }),
    visualStyleTemplates: () => serverRequest<VisualStyleTemplate[]>("/visual-style-templates"),
    visualStyles: (projectId: string) => serverRequest<VisualStyle[]>(`/projects/${encodeURIComponent(projectId)}/visual-styles`),
    createVisualStyle: (projectId: string, input: Record<string, unknown>) => serverRequest<VisualStyle>(`/projects/${encodeURIComponent(projectId)}/visual-styles`, { method: "POST", body: JSON.stringify(input) }),
    updateVisualStyle: (id: string, input: Record<string, unknown>) => serverRequest<VisualStyle>(`/visual-styles/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    deleteVisualStyle: (id: string) => serverRequest(`/visual-styles/${encodeURIComponent(id)}`, { method: "DELETE" }),
    setDefaultVisualStyle: (id: string) => serverRequest<VisualStyle>(`/visual-styles/${encodeURIComponent(id)}/default`, { method: "POST" }),
    analyzeVisualStyle: (id: string, revision: number) => serverRequest<ServerGeneration>(`/visual-styles/${encodeURIComponent(id)}/analyze`, { method: "POST", body: JSON.stringify({ revision }) }),
    generateVisualStyleReferences: (id: string, revision: number) => serverRequest<ServerGeneration>(`/visual-styles/${encodeURIComponent(id)}/references/generate`, { method: "POST", body: JSON.stringify({ revision }) }),
    assets: () => serverRequest<Array<Record<string, unknown>>>("/assets"),
    createAsset: (asset: Record<string, unknown>) => serverRequest<Record<string, unknown>>("/assets", { method: "POST", body: JSON.stringify(asset) }),
    updateAsset: (id: string, asset: Record<string, unknown>) => serverRequest<Record<string, unknown>>(`/assets/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(asset) }),
    deleteAsset: (id: string) => serverRequest(`/assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
    file: (id: string) => serverRequest<ServerFile>(`/files/${encodeURIComponent(id)}`),
    settings: () => serverRequest<{ config: Record<string, unknown>; promptSources?: Record<string, unknown> } | null>("/settings"),
    updateSettings: (settings: Record<string, unknown>) => serverRequest("/settings", { method: "PUT", body: JSON.stringify(settings) }),
    generations: () => serverRequest<ServerGeneration[]>("/generations"),
    generation: (id: string) => serverRequest<ServerGeneration>(`/generations/${encodeURIComponent(id)}`),
    createGeneration: (input: Record<string, unknown>) => serverRequest<ServerGeneration>("/generations", { method: "POST", body: JSON.stringify(input) }),
    deleteGeneration: (id: string) => serverRequest(`/generations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    cancelGeneration: (id: string) => serverRequest<ServerGeneration>(`/generations/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    aiModels: () => serverRequest<PublicAiModel[]>("/ai/models"),
    aiModelDefaults: () => serverRequest<Record<ModelCapability, string>>("/ai/model-defaults"),
    aiGlobalSettings: () => serverRequest<AiGlobalSettings>("/ai/config"),
    aiProviders: () => serverRequest<AiProvider[]>("/admin/ai/providers"),
    aiModelEndpoints: () => serverRequest<ModelEndpointDefinition[]>("/admin/ai/model-endpoints"),
    updateAiModelDefaults: (input: Record<ModelCapability, string>) => serverRequest<Record<ModelCapability, string>>("/admin/ai/model-defaults", { method: "PUT", body: JSON.stringify(input) }),
    updateAiGlobalSettings: (input: Partial<AiGlobalSettings>) => serverRequest<AiGlobalSettings>("/admin/ai/config", { method: "PUT", body: JSON.stringify(input) }),
    createAiProvider: (input: Record<string, unknown>) => serverRequest<AiProvider>("/admin/ai/providers", { method: "POST", body: JSON.stringify(input) }),
    updateAiProvider: (id: string, input: Record<string, unknown>) => serverRequest<AiProvider>(`/admin/ai/providers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    deleteAiProvider: (id: string) => serverRequest(`/admin/ai/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    testAiProvider: (id: string) => serverRequest<{ available: boolean; models: number }>(`/admin/ai/providers/${encodeURIComponent(id)}/test`, { method: "POST" }),
    discoverAiProviderModels: (id: string) => serverRequest<{ models: string[] }>(`/admin/ai/providers/${encodeURIComponent(id)}/models/discover`, { method: "POST" }),
    clearAiProviderCredentials: (id: string) => serverRequest<AiProvider>(`/admin/ai/providers/${encodeURIComponent(id)}/credentials/clear`, { method: "POST" }),
    adminGenerations: () => serverRequest<AdminGeneration[]>("/admin/ai/generations"),
    adminCancelGeneration: (id: string) => serverRequest<ServerGeneration>(`/admin/ai/generations/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    importBrowser: (input: Record<string, unknown>) => serverRequest("/imports/browser", { method: "POST", body: JSON.stringify(input) }),
    comfyServers: () => serverRequest<ComfyServer[]>("/admin/comfyui/servers"),
    createComfyServer: (input: Record<string, unknown>) => serverRequest<ComfyServer>("/admin/comfyui/servers", { method: "POST", body: JSON.stringify(input) }),
    updateComfyServer: (id: string, input: Record<string, unknown>) => serverRequest<ComfyServer>(`/admin/comfyui/servers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    deleteComfyServer: (id: string) => serverRequest(`/admin/comfyui/servers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    testComfyServer: (id: string) => serverRequest<ComfyTestResult>(`/admin/comfyui/servers/${encodeURIComponent(id)}/test`, { method: "POST" }),
    mediaExecutorStatus: () => serverRequest<{ url: string; tokenConfigured: boolean; stableAudio3LicenseAccepted: boolean; configured: boolean; available: boolean; models: string[]; modelDetails?: Record<string, { engine?: string; modes?: AudioMode[]; operations?: AudioOperation[] }>; runtimes?: Record<string, boolean>; configuredRuntimes?: Record<string, boolean>; catalog: Array<{ id: string; value: string; name: string; output: ModelCapability | "transcription"; imageModes?: ImageMode[]; audioModes?: AudioMode[]; maxReferenceImages?: number; engine: string; specialWorkflow: boolean }> }>("/admin/media-executor/status"),
    updateMediaExecutorSettings: (value: { url: string; token: string; stableAudio3LicenseAccepted: boolean }) => serverRequest<{ url: string; tokenConfigured: boolean; stableAudio3LicenseAccepted: boolean }>("/admin/media-executor/settings", { method: "PUT", body: JSON.stringify(value) }),
    backupSettings: () => serverRequest<BackupSettings | null>("/admin/backups/settings"),
    updateBackupSettings: (input: Record<string, unknown>) => serverRequest<BackupSettings>("/admin/backups/settings", { method: "PUT", body: JSON.stringify(input) }),
    testBackup: () => serverRequest<{ available: boolean }>("/admin/backups/test", { method: "POST" }),
    createBackup: () => serverRequest<BackupSnapshot>("/admin/backups", { method: "POST" }),
    backups: () => serverRequest<BackupSnapshot[]>("/admin/backups"),
    restoreBackup: (id: string) => serverRequest<{ restored: boolean; safetyId: string; restartRequired: boolean }>(`/admin/backups/${encodeURIComponent(id)}/restore`, { method: "POST" }),
};

export async function uploadServerFile(file: Blob, name = "file") {
    const form = new FormData();
    form.set("file", file, name);
    return serverRequest<ServerFile>("/files", { method: "POST", body: form });
}

export function serverFileUrl(storageKey?: string, fallback = "") {
    if (!storageKey?.startsWith("server:")) return fallback;
    return serverApiUrl(`/files/${encodeURIComponent(storageKey.slice(7))}/content`);
}

export function serverFileIdFromUrl(source: string) {
    try {
        const match = new URL(source, window.location.href).pathname.match(/\/api\/files\/([^/]+)\/content$/);
        return match ? decodeURIComponent(match[1]) : "";
    } catch {
        return "";
    }
}

export function subscribeServerEvents(onGeneration: (generation: ServerGeneration) => void, onDelta?: (value: { id: string; delta: string }) => void, onProject?: (project: Record<string, unknown>) => void, onCreativeAsset?: (asset: CreativeAsset | { id: string; projectId: string; deleted: true }) => void, onVisualStyle?: (style: VisualStyle | { id: string; projectId: string; deleted: true }) => void, onDirector?: (entity: { type: string; projectId: string; data: unknown }) => void, onDirectorChange?: (event: DirectorProjectChanged) => void, onConnected?: () => void) {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let stopped = false;
    const connect = () => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}${apiBase}/events`);
        socket.addEventListener("message", (event) => {
            try {
                const message = JSON.parse(event.data) as { type?: string; data?: ServerGeneration | { id: string; delta: string } | Record<string, unknown> };
                if (message.type === "connected") onConnected?.();
                if (message.type === "director.project.changed") onDirectorChange?.(message as DirectorProjectChanged);
                if (message.type === "generation.updated" && message.data) onGeneration(message.data as ServerGeneration);
                if (message.type === "generation.delta" && message.data) onDelta?.(message.data as { id: string; delta: string });
                if (message.type === "project.updated" && message.data) onProject?.(message.data as Record<string, unknown>);
                if (message.type === "creative_asset.updated" && message.data) onCreativeAsset?.(message.data as CreativeAsset | { id: string; projectId: string; deleted: true });
                if (message.type === "visual_style.updated" && message.data) onVisualStyle?.(message.data as VisualStyle | { id: string; projectId: string; deleted: true });
                if (message.type === "director.updated" && message.data) onDirector?.(message.data as { type: string; projectId: string; data: unknown });
            } catch {
                // Ignore malformed server events and keep the connection alive.
            }
        });
        socket.addEventListener("close", () => {
            if (!stopped) retryTimer = window.setTimeout(connect, 2000);
        });
    };
    connect();
    return () => {
        stopped = true;
        window.clearTimeout(retryTimer);
        socket?.close();
    };
}
