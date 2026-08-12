import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, AutoComplete, Button, Checkbox, Empty, Form, Input, InputNumber, List, Modal, Radio, Result, Select, Switch, Table, Tag } from "antd";
import { Bot, Cable, DatabaseBackup, KeyRound, Library, ListChecks, Pencil, Plus, RefreshCw, Search, Server, SlidersHorizontal, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigServerServices } from "@/components/layout/config-server-services";
import { serverApi, type AiProvider, type AudioMode, type ComfyServer, type ImageMode, type ImageWorkflowPurpose, type ModelCapability, type ModelEndpoint, type ModelEndpointDefinition } from "@/services/api/server";
import { AgentManager } from "./components/agent-manager";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const providerTypes = [
    { value: "openai", label: "OpenAI", url: "https://api.openai.com/v1", hint: "OpenAI 官方接口" },
    { value: "openai-compatible", label: "OpenAI Compatible", url: "https://api.example.com/v1", hint: "兼容 OpenAI 协议的中转或本地服务" },
    { value: "anthropic", label: "Anthropic", url: "https://api.anthropic.com/v1", hint: "Anthropic 官方接口或支持 /v1/messages 的 New API" },
    { value: "gemini", label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta", hint: "Google Generative Language API" },
    { value: "ark", label: "火山方舟", url: "https://ark.cn-beijing.volces.com/api/v3", hint: "火山方舟文本、Seedream 与 Seedance" },
] as const;
const capabilityLabels: Record<ModelCapability, string> = { text: "文本", image: "图片", video: "视频", audio: "语音" };
const inputLabels: Record<ModelCapability, string> = { text: "文本", image: "图片", video: "视频", audio: "音频" };
const audioModeOptions: Array<{ value: AudioMode; label: string }> = [{ value: "speech", label: "语音/对白" }, { value: "ambient", label: "环境声" }, { value: "sfx", label: "音效" }];
const imageModeLabels: Record<ImageMode, string> = { generate: "文生图", edit: "图生图" };
const comfyModels = [
    { value: "qwen-image-2512-local", label: "Qwen Image 2512 FP8", output: "image" },
    { value: "z-image-turbo-local", label: "Z-Image Turbo", output: "image" },
    { value: "qwen-image-edit-2511-local", label: "Qwen Image Edit 2511", output: "image" },
    { value: "qwen-image-inpaint-local", label: "Qwen Image 局部编辑", output: "image" },
    { value: "realesrgan-x4-local", label: "RealESRGAN 忠实超分", output: "image" },
    { value: "z-image-upscale-local", label: "Z-Image 细节增强", output: "image" },
    { value: "hidream-o1-full-fp8-local", label: "HiDream-O1 Full FP8", output: "image" },
    { value: "minimax-h3-fl2va-local", label: "MiniMax H3 FL2VA", output: "video" },
    { value: "minimax-h3-ref2va-local", label: "MiniMax H3 Ref2VA", output: "video" },
    { value: "voxcpm2-local", label: "VoxCPM2", output: "audio" },
] as const;
const imageWorkflowFields: Array<{ purpose: ImageWorkflowPurpose; model: string; label: string; description: string }> = [
    { purpose: "image-inpaint", model: "qwen-image-inpaint-local", label: "局部编辑", description: "原图、蒙版与修改要求" },
    { purpose: "image-upscale-faithful", model: "realesrgan-x4-local", label: "忠实超分", description: "文字、界面和产品图优先" },
    { purpose: "image-upscale-generative", model: "z-image-upscale-local", label: "细节增强", description: "照片与 AI 图片生成式重绘" },
    { purpose: "image-angle", model: "qwen-image-edit-2511-local", label: "多角度生成", description: "单视角与一键四视图" },
];

const adminSections = [
    { key: "providers", label: "供应商", description: "连接与模型", icon: Cable },
    { key: "agent", label: "Agent", description: "模型与运行任务", icon: Bot },
    { key: "defaults", label: "模型与生成", description: "画布全局默认", icon: SlidersHorizontal },
    { key: "prompts", label: "提示词来源", description: "共享内容源", icon: Library },
    { key: "services", label: "服务与备份", description: "WebDAV 快照", icon: DatabaseBackup },
    { key: "tasks", label: "运行任务", description: "队列与状态", icon: ListChecks },
] as const;
type AdminSection = (typeof adminSections)[number]["key"];

type ProviderForm = Omit<AiProvider, "id" | "credentialConfigured" | "credentialType" | "createdAt" | "updatedAt"> & { apiKey?: string; authToken?: string; credentialMode: "apiKey" | "authToken" };
type ComfyForm = { name: string; url: string; enabled: boolean; models: string[] };
type DefaultsForm = Record<ModelCapability, string> & { imageEditModel: string; imageWorkflows: Record<ImageWorkflowPurpose, string>; canvasImageCount: string; audioVoice: string; audioFormat: string; audioSpeed: string; audioInstructions: string; systemPrompt: string };

function inferredOutput(id: string): ModelCapability {
    const value = id.toLowerCase();
    if (["video", "veo", "seedance", "sora", "kling"].some((part) => value.includes(part))) return "video";
    if (["image", "imagen", "seedream", "dall-e", "flux"].some((part) => value.includes(part))) return "image";
    if (["audio", "speech", "tts", "voice"].some((part) => value.includes(part))) return "audio";
    return "text";
}

function inferredEndpoint(id: string, providerType: AiProvider["type"]): ModelEndpoint {
    const output = inferredOutput(id);
    if (output === "image") return providerType === "gemini" ? "gemini-image" : providerType === "ark" ? "ark-image" : "openai-images";
    if (output === "video") return providerType === "gemini" ? "gemini-video" : providerType === "ark" ? "ark-seedance" : "openai-video";
    if (output === "audio") return providerType === "gemini" ? "gemini-audio" : "openai-tts";
    return providerType === "anthropic" ? "anthropic-messages" : providerType === "gemini" ? "gemini-generate" : "openai-chat";
}

function endpointFields(definition: ModelEndpointDefinition | undefined, fallbackOutput: ModelCapability = "text") {
    const output = definition?.output || fallbackOutput;
    const imageModes = definition ? imageModesForEndpoint(definition.key) : undefined;
    return { output, inputs: definition?.inputs || ["text" as const], imageModes, maxReferenceImages: imageModes?.includes("edit") ? 1 : undefined };
}

function imageModesForEndpoint(endpoint: ModelEndpoint): ImageMode[] | undefined {
    if (!["openai-images", "openai-images-generations", "openai-images-edits", "gemini-image", "ark-image"].includes(endpoint)) return undefined;
    if (endpoint === "openai-images-generations") return ["generate"];
    if (endpoint === "openai-images-edits") return ["edit"];
    return ["generate", "edit"];
}

function imageModeOptionsForEndpoint(endpoint: ModelEndpoint) {
    return (imageModesForEndpoint(endpoint) || []).map((value) => ({ value, label: imageModeLabels[value] }));
}

export default function AdminAiPage() {
    const isAdmin = useUserStore((state) => state.user?.isAdmin);
    const [active, setActive] = useState<AdminSection>("providers");
    if (!isAdmin) return <Result status="403" title="无权访问" subTitle="只有 fnOS 管理员可以管理共享 AI 服务。" />;
    return (
        <main className="grid h-full min-h-0 bg-background md:grid-cols-[196px_minmax(0,1fr)]">
            <aside className="border-b border-stone-200 px-3 py-4 md:border-b-0 md:border-r dark:border-stone-800">
                <div className="mb-5 px-3"><div className="text-base font-semibold">管理员配置</div><div className="mt-1 text-xs text-stone-500">全局设置统一在这里管理</div></div>
                <nav className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1" aria-label="管理员配置">
                    {adminSections.map((item) => {
                        const Icon = item.icon;
                        const selected = active === item.key;
                        return <button key={item.key} type="button" onClick={() => setActive(item.key)} className={`flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${selected ? "bg-stone-100 text-stone-950 dark:bg-stone-900 dark:text-stone-100" : "text-stone-500 hover:bg-black/[0.035] hover:text-stone-900 dark:hover:bg-white/[0.06] dark:hover:text-stone-100"}`}>
                            <Icon className="size-4 shrink-0" />
                            <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.label}</span><span className="hidden truncate text-[11px] text-stone-400 md:block">{item.description}</span></span>
                        </button>;
                    })}
                </nav>
            </aside>
            <section className="min-h-0 min-w-0 overflow-hidden">
                {active === "providers" ? <ProviderManager /> : <div className="h-full overflow-y-auto px-5 py-6 md:px-8">
                    <div className="mx-auto max-w-5xl">
                        <header className="mb-6 border-b border-stone-200 pb-4 dark:border-stone-800"><h1 className="text-xl font-semibold">{adminSections.find((item) => item.key === active)?.label}</h1><p className="mt-1 text-sm text-stone-500">{adminSections.find((item) => item.key === active)?.description}</p></header>
                        {active === "agent" ? <AgentManager /> : active === "defaults" ? <DefaultModelsManager /> : active === "prompts" ? <ConfigPromptSources /> : active === "services" ? <ConfigServerServices /> : <TaskManager />}
                    </div>
                </div>}
            </section>
        </main>
    );
}

function DefaultModelsManager() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<DefaultsForm>();
    const { data: models = [] } = useQuery({ queryKey: ["ai-models"], queryFn: serverApi.aiModels });
    const { data: comfyServers = [] } = useQuery({ queryKey: ["comfy-servers"], queryFn: serverApi.comfyServers });
    const { data: defaults } = useQuery({ queryKey: ["ai-model-defaults"], queryFn: serverApi.aiModelDefaults });
    const { data: globalSettings } = useQuery({ queryKey: ["ai-global-settings"], queryFn: serverApi.aiGlobalSettings });
    useEffect(() => { if (defaults || globalSettings) form.setFieldsValue({ ...defaults, ...globalSettings?.config, imageEditModel: globalSettings?.imageEditModel, imageWorkflows: globalSettings?.imageWorkflows }); }, [defaults, globalSettings, form]);
    const save = useMutation({
        mutationFn: async (value: DefaultsForm) => {
            const { text, image, video, audio, imageEditModel, imageWorkflows, ...config } = value;
            const [modelDefaults, settings] = await Promise.all([serverApi.updateAiModelDefaults({ text, image, video, audio }), serverApi.updateAiGlobalSettings({ config: { ...config, creativeAssetReviewModel: "" }, imageEditModel: imageEditModel || "", imageWorkflows })]);
            return { modelDefaults, settings };
        },
        onSuccess: ({ modelDefaults, settings }) => { queryClient.setQueryData(["ai-model-defaults"], modelDefaults); queryClient.setQueryData(["ai-global-settings"], settings); useConfigStore.getState().hydrateFromServer({ ...settings.config, imageEditModel: settings.imageEditModel }); useConfigStore.getState().hydrateModels(models, modelDefaults, settings.imageEditModel); message.success("模型与生成默认值已保存"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });
    const otherGroups = (["text", "video", "audio"] as const).map((kind) => ({
        kind,
        options: models.filter((model) => model.output === kind).map((model) => ({ value: model.value, label: `${model.name}（${model.providerName}）` })),
    }));
    const imageGenerateOptions = models.filter((model) => model.output === "image" && model.imageModes?.includes("generate")).map((model) => ({ value: model.value, label: `${model.name}（${model.providerName}）` }));
    const imageEditOptions = models.filter((model) => model.output === "image" && model.imageModes?.includes("edit")).map((model) => ({ value: model.value, label: `${model.name}（${model.providerName}）` }));
    const enabledWorkflows = new Set(comfyServers.filter((server) => server.enabled).flatMap((server) => server.models));
    const workflowValues = Form.useWatch("imageWorkflows", form) || {};
    return <section>
        <Form form={form} layout="vertical" initialValues={{ image: "", imageEditModel: "", video: "", audio: "", text: "", imageWorkflows: {}, canvasImageCount: "3", audioVoice: "alloy", audioFormat: "mp3", audioSpeed: "1", audioInstructions: "", systemPrompt: "" }}>
            <section className="mb-7"><div className="mb-4"><h2 className="font-semibold">图片默认模型</h2><p className="mt-1 text-sm text-stone-500">普通生成根据是否带参考图自动选择文生图或图生图模型。</p></div><div className="grid gap-x-4 md:grid-cols-2"><Form.Item name="image" label="默认文生图模型"><Select allowClear showSearch optionFilterProp="label" options={imageGenerateOptions} placeholder={imageGenerateOptions.length ? "选择文生图模型" : "暂无可用文生图模型"} /></Form.Item><Form.Item name="imageEditModel" label="默认图生图模型"><Select allowClear showSearch optionFilterProp="label" options={imageEditOptions} placeholder={imageEditOptions.length ? "选择图生图模型" : "暂无可用图生图模型"} /></Form.Item></div></section>
            <section className="mb-7 border-t border-stone-200 pt-6 dark:border-stone-800"><div className="mb-4"><h2 className="font-semibold">专用图片工具</h2><p className="mt-1 text-sm text-stone-500">由对应画布工具自动调用，不受文生图或图生图模型选择影响。</p></div><div className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">{imageWorkflowFields.map((field, index) => { const available = enabledWorkflows.has(field.model); const configured = Boolean(workflowValues[field.purpose]); const model = comfyModels.find((item) => item.value === field.model); return <div key={field.purpose} className={`flex items-center gap-4 px-4 py-3 ${index ? "border-t border-stone-200 dark:border-stone-800" : ""}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{field.label}</span><Tag color="gold" className="!m-0">专用工作流</Tag><Tag className="!m-0" color={!available ? "error" : configured ? "success" : "default"}>{!available ? "缺少模型或节点" : configured ? "已启用" : "已停用"}</Tag></div><div className="mt-1 text-xs text-stone-500">{field.description} · {model?.label || field.model}</div></div><Form.Item noStyle name={["imageWorkflows", field.purpose]} getValueProps={(value) => ({ checked: Boolean(value) })} getValueFromEvent={(checked: boolean) => checked ? field.model : ""}><Switch disabled={!available && !configured} /></Form.Item></div>; })}</div></section>
            <section className="mb-7 border-t border-stone-200 pt-6 dark:border-stone-800"><div className="mb-4"><h2 className="font-semibold">其他默认模型</h2><p className="mt-1 text-sm text-stone-500">文本、视频和语音任务进入对应工作台时的默认选择。</p></div><div className="grid gap-x-4 md:grid-cols-2">{otherGroups.map(({ kind, options }) => <Form.Item key={kind} name={kind} label={`默认${capabilityLabels[kind]}模型`}><Select allowClear showSearch optionFilterProp="label" options={options} placeholder={options.length ? `选择${capabilityLabels[kind]}模型` : `暂无可用${capabilityLabels[kind]}模型`} /></Form.Item>)}</div></section>
            <section className="border-t border-stone-200 pt-6 dark:border-stone-800"><div className="mb-4"><h2 className="font-semibold">生成默认值</h2><p className="mt-1 text-sm text-stone-500">用户仍可在当前画布或工作台任务中临时覆盖。</p></div><div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-4"><Form.Item name="canvasImageCount" label="画布默认生图张数"><Input type="number" min={1} max={15} /></Form.Item><Form.Item name="audioVoice" label="默认音频声音"><Input placeholder="alloy" /></Form.Item><Form.Item name="audioFormat" label="默认音频格式"><Select options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }, { value: "opus", label: "Opus" }, { value: "aac", label: "AAC" }]} /></Form.Item><Form.Item name="audioSpeed" label="默认音频语速"><Input type="number" min={0.25} max={4} step={0.05} /></Form.Item></div><Form.Item name="audioInstructions" label="默认音频指令"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：自然、温暖、适合旁白。" /></Form.Item><Form.Item name="systemPrompt" label="系统提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="应用到文本、图片、视频和语音请求。" /></Form.Item></section>
            <div className="sticky bottom-0 mt-6 flex justify-end border-t border-stone-200 bg-background/95 py-3 backdrop-blur dark:border-stone-800"><Button type="primary" loading={save.isPending} onClick={() => void form.validateFields().then((value) => save.mutate(value))}>保存全局默认值</Button></div>
        </Form>
    </section>;
}


function ProviderManager() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [selectedKey, setSelectedKey] = useState("");
    const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
    const [editingComfy, setEditingComfy] = useState<ComfyServer | "new" | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [discovering, setDiscovering] = useState(false);
    const [modelSearch, setModelSearch] = useState("");
    const [form] = Form.useForm<ProviderForm>();
    const [comfyForm] = Form.useForm<ComfyForm>();
    const providerType = Form.useWatch("type", form) || "openai";
    const credentialMode = Form.useWatch("credentialMode", form) || "apiKey";
    const selectedModels = Form.useWatch("models", form) || [];
    const selectedModelIds = new Set(selectedModels.map((model) => model?.id).filter(Boolean));
    const unboundModels = availableModels.filter((id) => !selectedModelIds.has(id));
    const { data: providers = [], isLoading } = useQuery({ queryKey: ["ai-providers"], queryFn: serverApi.aiProviders });
    const { data: comfyServers = [] } = useQuery({ queryKey: ["comfy-servers"], queryFn: serverApi.comfyServers });
    const { data: defaults } = useQuery({ queryKey: ["ai-model-defaults"], queryFn: serverApi.aiModelDefaults });
    const { data: endpointCatalog = [] } = useQuery({ queryKey: ["ai-model-endpoints"], queryFn: serverApi.aiModelEndpoints });
    const endpointMap = new Map(endpointCatalog.map((endpoint) => [endpoint.key, endpoint]));
    const endpointOptions = (["text", "image", "video", "audio"] as const).map((output) => ({
        label: capabilityLabels[output],
        options: endpointCatalog.filter((endpoint) => endpoint.output === output).map((endpoint) => ({ value: endpoint.key, label: `${endpoint.label} · ${endpoint.path}` })),
    }));
    const availableKeys = [...providers.map((provider) => `api:${provider.id}`), ...comfyServers.map((server) => `comfy:${server.id}`)];
    const effectiveSelectedKey = availableKeys.includes(selectedKey) ? selectedKey : availableKeys[0] || "";
    const selectedProvider = effectiveSelectedKey.startsWith("api:") ? providers.find((provider) => `api:${provider.id}` === effectiveSelectedKey) : undefined;
    const selectedComfy = effectiveSelectedKey.startsWith("comfy:") ? comfyServers.find((server) => `comfy:${server.id}` === effectiveSelectedKey) : undefined;
    const refreshAll = async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["ai-providers"] }), queryClient.invalidateQueries({ queryKey: ["comfy-servers"] }), queryClient.invalidateQueries({ queryKey: ["ai-models"] }), queryClient.invalidateQueries({ queryKey: ["ai-model-defaults"] })]);
        const [models, defaults] = await Promise.all([serverApi.aiModels(), serverApi.aiModelDefaults()]);
        useConfigStore.getState().hydrateModels(models, defaults);
    };
    const discoverModels = async (provider: AiProvider) => {
        setDiscovering(true);
        try {
            const result = await serverApi.discoverAiProviderModels(provider.id);
            setAvailableModels(result.models);
            return result.models;
        } finally {
            setDiscovering(false);
        }
    };
    const bindAllModels = () => {
        const current = form.getFieldValue("models") || [];
        const additions = unboundModels.map((id) => ({
            ...endpointFields(endpointMap.get(inferredEndpoint(id, providerType)), inferredOutput(id)),
            id,
            name: id,
            endpoint: inferredEndpoint(id, providerType),
            enabled: true,
            agentEnabled: false,
            ...(inferredOutput(id) === "audio" ? { audioModes: ["speech" as const] } : {}),
        }));
        form.setFieldValue("models", [...current, ...additions]);
        message.success(`已追加 ${additions.length} 个模型，保存后生效`);
    };
    const save = useMutation({
        mutationFn: async (value: ProviderForm) => {
            const saved = editing && editing !== "new" ? await serverApi.updateAiProvider(editing.id, value) : await serverApi.createAiProvider(value);
            return { provider: saved, created: editing === "new" };
        },
        onSuccess: async ({ provider, created }) => {
            await refreshAll();
            setSelectedKey(`api:${provider.id}`);
            if (!created) {
                setEditing(null);
                message.success("供应商已保存");
                return;
            }
            setEditing(provider);
            form.setFieldsValue({ ...provider, credentialMode: provider.credentialType, apiKey: "", authToken: "" });
            try {
                const models = await discoverModels(provider);
                message.success(`连接已保存，读取到 ${models.length} 个候选模型`);
            } catch (error) {
                message.warning(`连接已保存，但模型列表读取失败：${error instanceof Error ? error.message : "未知错误"}`);
            }
        },
        onError: async (error) => { await refreshAll(); message.error(error instanceof Error ? error.message : "保存失败"); },
    });
    const openEditor = (provider?: AiProvider) => {
        setAvailableModels([]);
        setModelSearch("");
        setEditing(provider || "new");
        form.setFieldsValue(provider
            ? { ...provider, models: provider.models.map((model) => ({ ...model, endpoint: model.endpoint || inferredEndpoint(model.id, provider.type) })), credentialMode: provider.credentialType, apiKey: "", authToken: "" }
            : { name: "", type: "openai", baseUrl: providerTypes[0].url, credentialMode: "apiKey", apiKey: "", authToken: "", enabled: true, concurrency: 2, models: [] });
        if (provider) void discoverModels(provider).catch((error) => message.error(error instanceof Error ? error.message : "模型列表读取失败"));
    };
    const remove = (provider: AiProvider) => modal.confirm({ title: `删除“${provider.name}”？`, content: "已完成的生成记录不会删除；运行中的任务会阻止此操作。", okButtonProps: { danger: true }, onOk: async () => { await serverApi.deleteAiProvider(provider.id); await refreshAll(); } });
    const test = async (provider: AiProvider) => {
        try {
            const result = await serverApi.testAiProvider(provider.id);
            message.success(`供应商连接正常，可读取 ${result.models} 个模型`);
        } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); }
    };
    const clearCredentials = (provider: AiProvider) => modal.confirm({
        title: `清除“${provider.name}”的凭据？`,
        content: "供应商会同时停用，重新填写凭据后才能恢复生成。",
        okText: "清除并停用",
        okButtonProps: { danger: true },
        onOk: async () => { await serverApi.clearAiProviderCredentials(provider.id); await refreshAll(); message.success("供应商凭据已清除"); },
    });
    const openComfyEditor = (server?: ComfyServer) => {
        setEditingComfy(server || "new");
        comfyForm.setFieldsValue(server || { name: "内网 ComfyUI", url: "http://127.0.0.1:8188", enabled: true, models: comfyModels.map((model) => model.value) });
    };
    const saveComfy = async () => {
        const value = await comfyForm.validateFields();
        const saved = editingComfy && editingComfy !== "new" ? await serverApi.updateComfyServer(editingComfy.id, value) : await serverApi.createComfyServer(value);
        setEditingComfy(null);
        await refreshAll();
        setSelectedKey(`comfy:${saved.id}`);
        message.success("ComfyUI 供应商已保存");
    };
    const removeComfy = (server: ComfyServer) => modal.confirm({ title: `删除“${server.name}”？`, okButtonProps: { danger: true }, onOk: async () => { await serverApi.deleteComfyServer(server.id); await refreshAll(); } });

    return (
        <section className="grid h-full min-h-0 md:grid-cols-[232px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-stone-200 p-3 md:border-b-0 md:border-r dark:border-stone-800">
                <div className="mb-2 px-2 py-2"><h1 className="font-semibold">供应商</h1><p className="mt-1 text-xs text-stone-500">连接、凭据与模型能力</p></div>
                <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400">API 供应商</div>
                <div className="space-y-0.5">{providers.map((provider) => {
                    const selected = effectiveSelectedKey === `api:${provider.id}`;
                    return <button key={provider.id} type="button" onClick={() => setSelectedKey(`api:${provider.id}`)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? "bg-stone-100 text-stone-950 dark:bg-stone-900 dark:text-stone-100" : "text-stone-500 hover:bg-black/[0.035] hover:text-stone-900 dark:hover:bg-white/[0.06] dark:hover:text-stone-100"}`}>
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-background text-[11px] font-semibold uppercase dark:border-stone-700">{Array.from(provider.name)[0] || "?"}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{provider.name}</span>
                        <span className={`size-1.5 shrink-0 rounded-full ${provider.enabled ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"}`} />
                    </button>;
                })}</div>
                <Button block type="text" className="!mt-1 !justify-start" icon={<Plus className="size-4" />} onClick={() => openEditor()}>添加 API 供应商</Button>
                <div className="mx-2 my-3 border-t border-stone-200 dark:border-stone-800" />
                <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400">本地供应商</div>
                <div className="space-y-0.5">{comfyServers.map((server) => {
                    const selected = effectiveSelectedKey === `comfy:${server.id}`;
                    return <button key={server.id} type="button" onClick={() => setSelectedKey(`comfy:${server.id}`)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? "bg-stone-100 text-stone-950 dark:bg-stone-900 dark:text-stone-100" : "text-stone-500 hover:bg-black/[0.035] hover:text-stone-900 dark:hover:bg-white/[0.06] dark:hover:text-stone-100"}`}>
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-background dark:border-stone-700"><Server className="size-3.5" /></span>
                        <span className="min-w-0 flex-1 truncate text-sm">{server.name}</span>
                        <span className={`size-1.5 shrink-0 rounded-full ${server.enabled ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"}`} />
                    </button>;
                })}</div>
                <Button block type="text" className="!mt-1 !justify-start" icon={<Plus className="size-4" />} onClick={() => openComfyEditor()}>添加 ComfyUI</Button>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
                {selectedProvider ? <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
                        <div className="mx-auto max-w-3xl">
                            <header className="mb-6 flex items-start gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-sm font-semibold uppercase dark:border-stone-700 dark:bg-stone-900">{Array.from(selectedProvider.name)[0] || "?"}</span>
                                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{selectedProvider.name}</h2><Tag color={selectedProvider.enabled ? "green" : undefined}>{selectedProvider.enabled ? "已连接" : "已停用"}</Tag></div><p className="mt-1 truncate font-mono text-xs text-stone-400">{providerTypes.find((item) => item.value === selectedProvider.type)?.label} · {selectedProvider.baseUrl}</p></div>
                            </header>
                            <section className="mb-6 rounded-xl border border-stone-200 p-4 dark:border-stone-800"><h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">连接信息</h3><dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2"><div className="flex justify-between gap-4"><dt className="text-stone-500">供应商预设</dt><dd>{providerTypes.find((item) => item.value === selectedProvider.type)?.label}</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-500">凭据</dt><dd>{selectedProvider.credentialConfigured ? "已安全保存" : selectedProvider.type === "openai-compatible" ? "无需鉴权" : "未配置"}</dd></div><div className="flex justify-between gap-4 sm:col-span-2"><dt className="shrink-0 text-stone-500">Base URL</dt><dd className="truncate font-mono text-xs">{selectedProvider.baseUrl}</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-500">最大并发</dt><dd>{selectedProvider.concurrency}</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-500">更新时间</dt><dd>{new Date(selectedProvider.updatedAt).toLocaleDateString()}</dd></div></dl></section>
                            <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">模型列表</h3><span className="text-xs text-stone-400">{selectedProvider.models.length} 个</span></div><div className="space-y-1.5">{selectedProvider.models.map((model) => {
                                const endpoint = endpointMap.get(model.endpoint);
                                const isDefault = Object.values(defaults || {}).includes(`${selectedProvider.id}::${model.id}`);
                                return <div key={model.id} className={`flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-sm dark:border-stone-800 ${model.enabled ? "" : "opacity-45"}`}><span className="min-w-0 flex-1 truncate font-mono text-xs">{model.name || model.id}</span>{model.output === "image" ? model.imageModes?.map((mode) => <Tag key={mode} className="m-0">{imageModeLabels[mode]}</Tag>) : <Tag className="m-0">{capabilityLabels[endpoint?.output || model.output]}</Tag>}{model.imageModes?.includes("edit") ? <Tag className="m-0">最多 {model.maxReferenceImages} 张参考图</Tag> : null}{isDefault ? <Tag color="blue" className="m-0">默认</Tag> : null}{model.agentEnabled ? <Tag className="m-0">Agent</Tag> : null}</div>;
                            })}</div>{!selectedProvider.models.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未绑定模型" /> : null}</section>
                        </div>
                    </div>
                    <div className="border-t border-stone-200 bg-background/95 px-5 py-3 backdrop-blur md:px-8 dark:border-stone-800"><div className="mx-auto flex max-w-3xl flex-wrap gap-2"><Button type="primary" icon={<Pencil className="size-4" />} onClick={() => openEditor(selectedProvider)}>编辑</Button><Button icon={<Wifi className="size-4" />} onClick={() => void test(selectedProvider)}>测试连接</Button>{selectedProvider.credentialConfigured ? <Button onClick={() => clearCredentials(selectedProvider)}>清除凭据</Button> : null}<Button danger icon={<Trash2 className="size-4" />} onClick={() => remove(selectedProvider)}>删除</Button></div></div>
                </> : selectedComfy ? <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8"><div className="mx-auto max-w-3xl">
                        <header className="mb-6 flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900"><Server className="size-4" /></span><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="text-xl font-semibold">{selectedComfy.name}</h2><Tag color={selectedComfy.enabled ? "green" : undefined}>{selectedComfy.enabled ? "已连接" : "已停用"}</Tag></div><p className="mt-1 truncate font-mono text-xs text-stone-400">ComfyUI · 本地工作流供应商</p></div></header>
                        <section className="mb-6 rounded-xl border border-stone-200 p-4 dark:border-stone-800"><h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">连接信息</h3><dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-stone-500">类型</dt><dd>ComfyUI</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-500">服务地址</dt><dd className="truncate font-mono text-xs">{selectedComfy.url}</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-500">更新时间</dt><dd>{new Date(selectedComfy.updatedAt).toLocaleDateString()}</dd></div></dl></section>
                        <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">模型与工作流</h3><span className="text-xs text-stone-400">{selectedComfy.models.length} 项</span></div><div className="space-y-1.5">{selectedComfy.models.map((id) => { const definition = comfyModels.find((model) => model.value === id); const isDefault = Object.values(defaults || {}).includes(`comfyui::${id}`); const isSpecial = imageWorkflowFields.some((field) => field.model === id) || ["qwen-image-inpaint-local", "realesrgan-x4-local", "z-image-upscale-local"].includes(id); const modes = id === "qwen-image-2512-local" || id === "z-image-turbo-local" ? ["文生图"] : id === "qwen-image-edit-2511-local" ? ["图生图"] : id === "hidream-o1-full-fp8-local" ? ["文生图", "图生图"] : []; return <div key={id} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-sm dark:border-stone-800"><span className="min-w-0 flex-1 truncate font-mono text-xs">{definition?.label || id}</span>{modes.map((mode) => <Tag key={mode} className="m-0">{mode}</Tag>)}{isSpecial ? <Tag color="gold" className="m-0">专用工作流</Tag> : !modes.length ? <Tag className="m-0">{capabilityLabels[definition?.output || "image"]}</Tag> : null}{isDefault ? <Tag color="blue" className="m-0">默认</Tag> : null}</div>; })}</div></section>
                    </div></div>
                    <div className="border-t border-stone-200 bg-background/95 px-5 py-3 backdrop-blur md:px-8 dark:border-stone-800"><div className="mx-auto flex max-w-3xl gap-2"><Button type="primary" icon={<Pencil className="size-4" />} onClick={() => openComfyEditor(selectedComfy)}>编辑</Button><Button icon={<Wifi className="size-4" />} onClick={() => void serverApi.testComfyServer(selectedComfy.id).then((result) => { const failed = result.workflows.filter((item) => !item.available); failed.length ? modal.warning({ title: "部分工作流不可用", content: failed.map((item) => `${comfyModels.find((model) => model.value === item.id)?.label || item.id}：${item.missing.join("、")}`).join("\n") }) : message.success("供应商及固定工作流均可用"); }).catch((error) => message.error(error.message))}>测试连接</Button><Button danger icon={<Trash2 className="size-4" />} onClick={() => removeComfy(selectedComfy)}>删除</Button></div></div>
                </> : <div className="flex flex-1 items-center justify-center">{isLoading ? <span className="text-sm text-stone-400">正在读取供应商…</span> : <Empty description="添加一个供应商开始配置" />}</div>}
            </div>
            <Modal
                title={editing === "new" ? "添加模型供应商" : "编辑模型供应商"}
                width={1080}
                centered
                open={Boolean(editing)}
                onCancel={() => setEditing(null)}
                onOk={() => void form.validateFields().then((value) => save.mutate(value))}
                okText={editing === "new" ? "保存连接并读取模型" : "保存"}
                confirmLoading={save.isPending}
                destroyOnHidden
                styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto", paddingRight: 8 } }}
            >
                <Form form={form} layout="vertical" className="space-y-5 pt-3">
                    <section>
                        <h3 className="mb-3 font-semibold">服务地址</h3>
                        <div className="grid gap-x-4 md:grid-cols-2"><Form.Item name="name" label="显示名称" rules={[{ required: true, message: "请输入供应商名称" }]}><Input placeholder="例如：团队 New API" /></Form.Item><Form.Item name="type" label="供应商预设" extra="决定默认地址、模型发现和凭据格式；实际生成接口由模型调用方案决定。" rules={[{ required: true }]}><Select options={providerTypes.map(({ value, label }) => ({ value, label }))} onChange={(type) => { const option = providerTypes.find((item) => item.value === type); setAvailableModels([]); form.setFieldsValue({ baseUrl: option?.url, credentialMode: "apiKey", apiKey: "", authToken: "", models: [] }); }} /></Form.Item></div>
                        <Form.Item name="baseUrl" label="API Base URL" className="mb-0" extra={providerType === "anthropic" ? "New API 可填写域名根地址或带 /v1 的地址，保存时会自动规范为 /v1。" : providerTypes.find((item) => item.value === providerType)?.hint} rules={[{ required: true, type: "url", message: "请输入完整的 HTTP/HTTPS 地址" }]}><Input placeholder={providerTypes.find((item) => item.value === providerType)?.url} /></Form.Item>
                    </section>

                    <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
                        <h3 className="mb-3 flex items-center gap-2 font-semibold"><KeyRound className="size-4" />身份凭据</h3>
                        {providerType === "anthropic" ? <Form.Item name="credentialMode" label="鉴权方式"><Radio.Group optionType="button" buttonStyle="solid" options={[{ label: "API Key（推荐）", value: "apiKey" }, { label: "Bearer Token", value: "authToken" }]} /></Form.Item> : <Form.Item name="credentialMode" hidden><Input /></Form.Item>}
                        {credentialMode === "authToken" && providerType === "anthropic"
                            ? <Form.Item name="authToken" label="Anthropic Auth Token" extra={editing !== "new" ? "留空表示保留当前 Token；仅用于要求 Authorization: Bearer 的网关。" : "仅用于要求 Authorization: Bearer 的网关。"} rules={[{ required: editing === "new", message: "请输入 Auth Token" }]}><Input.Password autoComplete="new-password" placeholder="Bearer Token" /></Form.Item>
                            : <Form.Item name="apiKey" label="API Key" extra={editing !== "new" ? "留空表示保留当前密钥。New API 的 Anthropic 协议通常选择此项。" : providerType === "anthropic" ? "New API 的 Anthropic 协议通常使用 API Key。" : undefined} rules={[{ required: editing === "new" && providerType !== "openai-compatible", message: "请输入 API Key" }]}><Input.Password autoComplete="new-password" placeholder="输入后仅发送到应用后端" /></Form.Item>}
                        <div className="grid gap-x-4 md:grid-cols-[160px_1fr]"><Form.Item name="concurrency" label="最大并发" className="mb-0"><InputNumber min={1} max={32} className="w-full" /></Form.Item><Form.Item name="enabled" label="服务状态" valuePropName="checked" className="mb-0"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></div>
                    </section>

                    <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">模型</h3><p className="mt-0.5 text-xs text-stone-500">每个图片模型单独配置文生图、图生图能力；调用方案只限制可选范围。</p></div>{!editing || editing === "new" ? <Button size="small" disabled>保存连接后读取模型</Button> : <div className="flex gap-2"><Button size="small" disabled={!unboundModels.length || !endpointCatalog.length} onClick={bindAllModels}>绑定全部{unboundModels.length ? `（${unboundModels.length}）` : ""}</Button><Button size="small" icon={<RefreshCw className="size-3.5" />} loading={discovering} onClick={() => void discoverModels(editing).then((models) => message.success(`已更新 ${models.length} 个候选模型，现有绑定未改变`)).catch((error) => message.error(error instanceof Error ? error.message : "读取失败"))}>读取候选</Button></div>}</div>
                        <Form.List name="models">{(fields, { add, remove }) => <List
                            size="small"
                            bordered
                            header={<div className="space-y-2"><Input allowClear prefix={<Search className="size-3.5 text-stone-400" />} value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder={`搜索 ${selectedModels.length} 个模型`} /><div className="hidden grid-cols-[auto_minmax(0,1.1fr)_minmax(0,.9fr)_minmax(260px,1.3fr)_76px_auto] gap-3 px-1 text-[11px] text-stone-400 md:grid"><span className="w-4" /><span>模型 ID</span><span>显示名称</span><span>调用方案</span><span>Agent</span><span className="w-8" /></div></div>}
                            dataSource={fields.filter((field) => { const model = selectedModels[field.name]; const query = modelSearch.trim().toLowerCase(); return !query || `${model?.id || ""} ${model?.name || ""}`.toLowerCase().includes(query); })}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={modelSearch ? "没有匹配的模型" : "暂未配置模型"} /> }}
                            renderItem={(field) => {
                                const endpoint = endpointMap.get(selectedModels[field.name]?.endpoint);
                                const imageModes = selectedModels[field.name]?.imageModes || [];
                                return <List.Item key={field.key} className="!block !px-3 !py-2.5">
                                <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,.9fr)_minmax(260px,1.3fr)_76px_auto]">
                                    <Form.Item {...field} name={[field.name, "enabled"]} valuePropName="checked" className="mb-0 flex h-8 items-center"><Checkbox aria-label="启用模型" /></Form.Item>
                                    <Form.Item {...field} name={[field.name, "id"]} className="mb-0" rules={[{ required: true, message: "请选择或输入模型 ID" }, { validator: (_, value) => selectedModels.filter((model) => model?.id === value).length > 1 ? Promise.reject(new Error("模型 ID 不能重复")) : Promise.resolve() }]}><AutoComplete options={availableModels.map((value) => ({ value }))} placeholder="模型 ID" filterOption={(input, option) => String(option?.value || "").toLowerCase().includes(input.toLowerCase())} onSelect={(value) => { if (!form.getFieldValue(["models", field.name, "name"])) form.setFieldValue(["models", field.name, "name"], value); }} /></Form.Item>
                                    <Form.Item {...field} name={[field.name, "name"]} className="mb-0" rules={[{ required: true, message: "请输入显示名称" }]}><Input placeholder="显示名称" /></Form.Item>
                                    <Form.Item {...field} name={[field.name, "endpoint"]} className="mb-0" rules={[{ required: true, message: "请选择调用方案" }]}><Select showSearch optionFilterProp="label" options={endpointOptions} placeholder="调用方案" onChange={(value: ModelEndpoint) => { const definition = endpointMap.get(value); const derived = endpointFields(definition); form.setFieldValue(["models", field.name, "output"], derived.output); form.setFieldValue(["models", field.name, "inputs"], derived.inputs); form.setFieldValue(["models", field.name, "imageModes"], derived.imageModes); form.setFieldValue(["models", field.name, "maxReferenceImages"], derived.maxReferenceImages); form.setFieldValue(["models", field.name, "audioModes"], derived.output === "audio" ? ["speech"] : undefined); if (!definition?.agent) form.setFieldValue(["models", field.name, "agentEnabled"], false); }} /></Form.Item>
                                    <Form.Item {...field} name={[field.name, "agentEnabled"]} valuePropName="checked" className="mb-0 flex h-8 items-center"><Checkbox disabled={!endpoint?.agent}>Agent</Checkbox></Form.Item>
                                    <Button danger type="text" icon={<Trash2 className="size-4" />} onClick={() => remove(field.name)} />
                                </div>
                                {endpoint ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-8 text-xs text-stone-500"><Tag className="m-0">输出 · {capabilityLabels[endpoint.output]}</Tag><span className="font-mono text-[11px]">{endpoint.method} {endpoint.path}</span><span>支持{endpoint.inputs.map((input) => inputLabels[input]).join("、")}输入</span>{endpoint.agent ? <span>可用于 Agent</span> : null}{endpoint.output === "audio" ? <Form.Item {...field} name={[field.name, "audioModes"]} className="mb-0 basis-full"><Checkbox.Group options={audioModeOptions} /></Form.Item> : null}{endpoint.output === "image" ? <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-2"><span className="font-medium text-stone-700 dark:text-stone-300">图片能力</span><Form.Item {...field} name={[field.name, "imageModes"]} className="mb-0" rules={[{ required: true, message: "请选择文生图或图生图能力" }]}><Checkbox.Group options={imageModeOptionsForEndpoint(endpoint.key)} onChange={(values) => { const supportsEdit = values.includes("edit"); if (supportsEdit && !form.getFieldValue(["models", field.name, "maxReferenceImages"])) form.setFieldValue(["models", field.name, "maxReferenceImages"], 1); if (!supportsEdit) form.setFieldValue(["models", field.name, "maxReferenceImages"], undefined); }} /></Form.Item>{imageModes.includes("edit") ? <><span>最多参考图</span><Form.Item {...field} name={[field.name, "maxReferenceImages"]} className="mb-0" rules={[{ required: true, message: "请输入最多参考图数量" }]}><InputNumber min={1} max={32} className="w-20" /></Form.Item><span>张</span></> : null}</div> : null}</div> : null}
                            </List.Item>}}
                            footer={<Button block type="text" icon={<Plus className="size-4" />} disabled={!endpointCatalog.length} onClick={() => { const endpoint = inferredEndpoint("", providerType); const fields = endpointFields(endpointMap.get(endpoint)); add({ id: "", name: "", endpoint, ...fields, enabled: true, agentEnabled: false, ...(fields.output === "audio" ? { audioModes: ["speech"] } : {}) }); }}>添加模型</Button>}
                        />}</Form.List>
                    </section>
                </Form>
            </Modal>
            <Modal title={editingComfy === "new" ? "添加 ComfyUI 供应商" : "编辑 ComfyUI 供应商"} open={Boolean(editingComfy)} onCancel={() => setEditingComfy(null)} onOk={() => void saveComfy()} destroyOnHidden>
                <Form form={comfyForm} layout="vertical" className="mt-4"><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="url" label="HTTP/HTTPS 地址" rules={[{ required: true, type: "url" }]}><Input /></Form.Item><Form.Item name="models" label="可用固定工作流" rules={[{ required: true }]}><Select mode="multiple" options={comfyModels.map(({ value, label }) => ({ value, label }))} /></Form.Item><Form.Item name="enabled" valuePropName="checked"><Checkbox>启用供应商</Checkbox></Form.Item></Form>
            </Modal>
        </section>
    );
}

function TaskManager() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const { data = [], isFetching } = useQuery({ queryKey: ["admin-generations"], queryFn: serverApi.adminGenerations, refetchInterval: 3000 });
    return <section><div className="mb-4 flex items-center justify-between"><p className="text-sm text-stone-500">仅显示任务元数据，不展示用户提示词和生成内容。</p><Button icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => void queryClient.invalidateQueries({ queryKey: ["admin-generations"] })}>刷新</Button></div><Table rowKey="id" pagination={{ pageSize: 20 }} dataSource={data} columns={[
        { title: "用户", dataIndex: ["user", "username"], width: 150 },
        { title: "类型", dataIndex: "kind", width: 90, render: (value) => <Tag>{value}</Tag> },
        { title: "模型", dataIndex: "modelId", ellipsis: true },
        { title: "状态", dataIndex: "status", width: 110, render: (value) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : value === "running" ? "processing" : undefined}>{value}</Tag> },
        { title: "进度", dataIndex: "progress", width: 90, render: (value) => `${Math.round(Number(value) * 100)}%` },
        { title: "耗时", width: 100, render: (_, row) => `${Math.max(0, Math.round((Date.parse(row.updatedAt) - Date.parse(row.createdAt)) / 1000))}s` },
        { title: "错误", dataIndex: "error", ellipsis: true },
        { title: "操作", width: 90, render: (_, row) => ["queued", "running"].includes(row.status) ? <Button size="small" danger onClick={() => void serverApi.adminCancelGeneration(row.id).then(() => queryClient.invalidateQueries({ queryKey: ["admin-generations"] })).catch((error) => message.error(error.message))}>取消</Button> : null },
    ]} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成任务" /> }} /></section>;
}
