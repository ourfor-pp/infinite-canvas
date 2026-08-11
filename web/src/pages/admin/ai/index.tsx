import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, AutoComplete, Button, Checkbox, Drawer, Empty, Form, Input, InputNumber, Modal, Radio, Result, Select, Switch, Table, Tabs, Tag } from "antd";
import { Activity, Bot, CircleGauge, KeyRound, Pencil, Plus, RefreshCw, Server, Trash2, Wifi } from "lucide-react";
import { useState } from "react";

import { serverApi, type AiProvider, type ComfyServer } from "@/services/api/server";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const providerTypes = [
    { value: "openai", label: "OpenAI", url: "https://api.openai.com/v1", hint: "OpenAI 官方接口" },
    { value: "openai-compatible", label: "OpenAI Compatible", url: "https://api.example.com/v1", hint: "兼容 OpenAI 协议的中转或本地服务" },
    { value: "anthropic", label: "Anthropic", url: "https://api.anthropic.com/v1", hint: "Anthropic 官方接口或支持 /v1/messages 的 New API" },
    { value: "gemini", label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta", hint: "Google Generative Language API" },
    { value: "ark", label: "火山方舟", url: "https://ark.cn-beijing.volces.com/api/v3", hint: "火山方舟文本、Seedream 与 Seedance" },
] as const;
const capabilities = ["text", "image", "video", "audio"] as const;
const comfyModels = [
    { value: "hidream-o1-full-fp8-local", label: "HiDream-O1 Full FP8" },
    { value: "minimax-h3-fl2va-local", label: "MiniMax H3 FL2VA" },
    { value: "minimax-h3-ref2va-local", label: "MiniMax H3 Ref2VA" },
    { value: "voxcpm2-local", label: "VoxCPM2" },
];

type ProviderForm = Omit<AiProvider, "id" | "credentialConfigured" | "credentialType" | "createdAt" | "updatedAt"> & { apiKey?: string; authToken?: string; credentialMode: "apiKey" | "authToken" };
type ComfyForm = { name: string; url: string; enabled: boolean; models: string[] };

function inferredOutput(id: string): AiProvider["models"][number]["output"] {
    const value = id.toLowerCase();
    if (["video", "veo", "seedance", "sora", "kling"].some((part) => value.includes(part))) return "video";
    if (["image", "imagen", "seedream", "dall-e", "flux"].some((part) => value.includes(part))) return "image";
    if (["audio", "speech", "tts", "voice"].some((part) => value.includes(part))) return "audio";
    return "text";
}

export default function AdminAiPage() {
    const isAdmin = useUserStore((state) => state.user?.isAdmin);
    if (!isAdmin) return <Result status="403" title="无权访问" subTitle="只有 fnOS 管理员可以管理共享 AI 服务。" />;
    return (
        <main className="h-full overflow-y-auto bg-stone-50/70 dark:bg-stone-950">
            <div className="mx-auto max-w-7xl px-5 py-6 md:px-8">
                <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5 dark:border-stone-800">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-400"><CircleGauge className="size-3.5" />系统控制台</div>
                        <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">AI 服务</h1>
                        <p className="mt-1.5 text-sm text-stone-500">统一管理共享渠道、内网算力与后台生成任务。</p>
                    </div>
                    <ModelSummary />
                </header>
                <Tabs defaultActiveKey="providers" items={[
                    { key: "providers", label: "服务渠道", children: <ProviderManager /> },
                    { key: "comfyui", label: "ComfyUI", children: <ComfyManager /> },
                    { key: "tasks", label: "运行任务", children: <TaskManager /> },
                ]} />
            </div>
        </main>
    );
}

function ModelSummary() {
    const { data = [] } = useQuery({ queryKey: ["ai-models"], queryFn: serverApi.aiModels });
    const providers = new Set(data.map((model) => model.providerId)).size;
    return <div className="flex items-center gap-5 text-right"><div><div className="text-lg font-semibold tabular-nums">{providers}</div><div className="text-[11px] text-stone-500">可用服务</div></div><div><div className="text-lg font-semibold tabular-nums">{data.length}</div><div className="text-[11px] text-stone-500">启用模型</div></div></div>;
}

function ProviderManager() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [discovering, setDiscovering] = useState(false);
    const [form] = Form.useForm<ProviderForm>();
    const providerType = Form.useWatch("type", form) || "openai";
    const credentialMode = Form.useWatch("credentialMode", form) || "apiKey";
    const selectedModels = Form.useWatch("models", form) || [];
    const selectedModelIds = new Set(selectedModels.map((model) => model?.id).filter(Boolean));
    const unboundModels = availableModels.filter((id) => !selectedModelIds.has(id));
    const { data = [], isLoading } = useQuery({ queryKey: ["ai-providers"], queryFn: serverApi.aiProviders });
    const refreshAll = async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["ai-providers"] }), queryClient.invalidateQueries({ queryKey: ["ai-models"] })]);
        useConfigStore.getState().hydrateModels(await serverApi.aiModels());
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
            id,
            name: id,
            output: providerType === "anthropic" ? "text" as const : inferredOutput(id),
            inputs: providerType === "anthropic" ? ["text", "image"] as const : ["text"] as const,
            enabled: true,
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
            if (!created) {
                setEditing(null);
                message.success("AI 渠道已保存");
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
        setEditing(provider || "new");
        form.setFieldsValue(provider
            ? { ...provider, credentialMode: provider.credentialType, apiKey: "", authToken: "" }
            : { name: "", type: "openai", baseUrl: providerTypes[0].url, credentialMode: "apiKey", apiKey: "", authToken: "", enabled: true, concurrency: 2, models: [] });
        if (provider) void discoverModels(provider).catch((error) => message.error(error instanceof Error ? error.message : "模型列表读取失败"));
    };
    const remove = (provider: AiProvider) => modal.confirm({ title: `删除“${provider.name}”？`, content: "已完成的生成记录不会删除；运行中的任务会阻止此操作。", okButtonProps: { danger: true }, onOk: async () => { await serverApi.deleteAiProvider(provider.id); await refreshAll(); } });
    const test = async (provider: AiProvider) => {
        try {
            const result = await serverApi.testAiProvider(provider.id);
            message.success(`渠道连接正常，可读取 ${result.models} 个模型`);
        } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); }
    };
    const clearCredentials = (provider: AiProvider) => modal.confirm({
        title: `清除“${provider.name}”的凭据？`,
        content: "渠道会同时停用，重新填写凭据后才能恢复生成。",
        okText: "清除并停用",
        okButtonProps: { danger: true },
        onOk: async () => { await serverApi.clearAiProviderCredentials(provider.id); await refreshAll(); message.success("渠道凭据已清除"); },
    });

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-stone-500">密钥仅保存在后端，普通用户只会看到已启用模型。</p><Button type="primary" icon={<Plus className="size-4" />} onClick={() => openEditor()}>添加渠道</Button></div>
            <div className="grid gap-3 lg:grid-cols-2">
                {data.map((provider) => (
                    <article key={provider.id} className="rounded-xl border border-stone-200 bg-background p-4 dark:border-stone-800">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate font-semibold">{provider.name}</span><Tag className="m-0">{providerTypes.find((item) => item.value === provider.type)?.label}</Tag>{provider.enabled ? <Tag color="green" className="m-0">运行中</Tag> : <Tag className="m-0">已停用</Tag>}</div><div className="mt-2 truncate font-mono text-xs text-stone-400">{provider.baseUrl}</div></div><span className={`mt-1 size-2 shrink-0 rounded-full ${provider.enabled && (provider.credentialConfigured || provider.type === "openai-compatible") ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"}`} /></div>
                        <div className="my-4 grid grid-cols-3 border-y border-stone-100 py-3 text-center text-xs dark:border-stone-800"><div><strong className="block text-base text-stone-900 dark:text-stone-100">{provider.models.filter((model) => model.enabled).length}</strong>模型</div><div><strong className="block text-base text-stone-900 dark:text-stone-100">{provider.concurrency}</strong>并发</div><div><strong className="block text-base text-stone-900 dark:text-stone-100">{provider.credentialConfigured ? "已配置" : provider.type === "openai-compatible" ? "可免鉴权" : "缺失"}</strong>凭据</div></div>
                        <div className="flex flex-wrap gap-2"><Button size="small" icon={<Wifi className="size-3.5" />} onClick={() => void test(provider)}>测试</Button><Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEditor(provider)}>配置与模型</Button>{provider.credentialConfigured ? <Button size="small" danger onClick={() => clearCredentials(provider)}>清除凭据</Button> : null}<Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(provider)} /></div>
                    </article>
                ))}
            </div>
            {!isLoading && !data.length ? <Empty description="还没有共享 AI 渠道" /> : null}
            <Drawer title={editing === "new" ? "接入 AI 服务" : "编辑 AI 服务"} width={760} open={Boolean(editing)} onClose={() => setEditing(null)} extra={<Button type="primary" loading={save.isPending} onClick={() => void form.validateFields().then((value) => save.mutate(value))}>{editing === "new" ? "保存连接并读取模型" : "保存"}</Button>} destroyOnHidden>
                <Form form={form} layout="vertical" className="space-y-5 pt-2">
                    <Alert showIcon type="info" title="模型支持读取和自定义" description="保存连接后可从渠道读取候选模型。添加模型时既能从下拉列表选择，也能直接输入渠道未返回的模型 ID。" />

                    <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="mb-4 flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">1</span><div><h3 className="font-semibold">服务地址</h3><p className="mt-0.5 text-xs text-stone-500">选择接口协议，填写一个稳定的服务前缀。</p></div></div>
                        <div className="grid gap-x-4 md:grid-cols-2"><Form.Item name="name" label="显示名称" rules={[{ required: true, message: "请输入渠道名称" }]}><Input placeholder="例如：团队 New API" /></Form.Item><Form.Item name="type" label="接口协议" rules={[{ required: true }]}><Select options={providerTypes.map(({ value, label }) => ({ value, label }))} onChange={(type) => { const option = providerTypes.find((item) => item.value === type); setAvailableModels([]); form.setFieldsValue({ baseUrl: option?.url, credentialMode: "apiKey", apiKey: "", authToken: "", models: [] }); }} /></Form.Item></div>
                        <Form.Item name="baseUrl" label="API Base URL" extra={providerType === "anthropic" ? "New API 可填写域名根地址或带 /v1 的地址，保存时会自动规范为 /v1。" : providerTypes.find((item) => item.value === providerType)?.hint} rules={[{ required: true, type: "url", message: "请输入完整的 HTTP/HTTPS 地址" }]}><Input placeholder={providerTypes.find((item) => item.value === providerType)?.url} /></Form.Item>
                    </section>

                    <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="mb-4 flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">2</span><div><h3 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" />身份凭据</h3><p className="mt-0.5 text-xs text-stone-500">凭据加密保存在后端，普通用户和页面响应均不可读取。</p></div></div>
                        {providerType === "anthropic" ? <Form.Item name="credentialMode" label="鉴权方式"><Radio.Group optionType="button" buttonStyle="solid" options={[{ label: "API Key（推荐）", value: "apiKey" }, { label: "Bearer Token", value: "authToken" }]} /></Form.Item> : <Form.Item name="credentialMode" hidden><Input /></Form.Item>}
                        {credentialMode === "authToken" && providerType === "anthropic"
                            ? <Form.Item name="authToken" label="Anthropic Auth Token" extra={editing !== "new" ? "留空表示保留当前 Token；仅用于要求 Authorization: Bearer 的网关。" : "仅用于要求 Authorization: Bearer 的网关。"} rules={[{ required: editing === "new", message: "请输入 Auth Token" }]}><Input.Password autoComplete="new-password" placeholder="Bearer Token" /></Form.Item>
                            : <Form.Item name="apiKey" label="API Key" extra={editing !== "new" ? "留空表示保留当前密钥。New API 的 Anthropic 协议通常选择此项。" : providerType === "anthropic" ? "New API 的 Anthropic 协议通常使用 API Key。" : undefined} rules={[{ required: editing === "new" && providerType !== "openai-compatible", message: "请输入 API Key" }]}><Input.Password autoComplete="new-password" placeholder="输入后仅发送到应用后端" /></Form.Item>}
                        <div className="grid gap-x-4 md:grid-cols-2"><Form.Item name="concurrency" label="最大并发"><InputNumber min={1} max={32} className="w-full" /></Form.Item><Form.Item name="enabled" label="服务状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></div>
                    </section>

                    <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">3</span><div><h3 className="font-semibold">模型与能力</h3><p className="mt-0.5 text-xs text-stone-500">已绑定 {selectedModels.length} 个；读取候选不会修改现有配置。</p></div></div>{!editing || editing === "new" ? <Button size="small" disabled>先保存连接</Button> : <div className="flex gap-2"><Button size="small" disabled={!unboundModels.length} onClick={bindAllModels}>一键绑定全部{unboundModels.length ? `（${unboundModels.length}）` : ""}</Button><Button size="small" icon={<RefreshCw className="size-3.5" />} loading={discovering} onClick={() => void discoverModels(editing).then((models) => message.success(`已更新 ${models.length} 个候选模型，现有绑定未改变`)).catch((error) => message.error(error instanceof Error ? error.message : "读取失败"))}>重新读取候选</Button></div>}</div>
                        <Form.List name="models">{(fields, { add, remove }) => <div className="space-y-2">{fields.map((field) => <div key={field.key} className="rounded-lg bg-stone-50 p-3 dark:bg-stone-900/60"><div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"><Form.Item {...field} name={[field.name, "id"]} label="模型 ID" className="mb-0" rules={[{ required: true, message: "请选择或输入模型 ID" }, { validator: (_, value) => selectedModels.filter((model) => model?.id === value).length > 1 ? Promise.reject(new Error("模型 ID 不能重复")) : Promise.resolve() }]}><AutoComplete options={availableModels.map((value) => ({ value }))} placeholder="下拉选择或直接输入" filterOption={(input, option) => String(option?.value || "").toLowerCase().includes(input.toLowerCase())} onSelect={(value) => { if (!form.getFieldValue(["models", field.name, "name"])) form.setFieldValue(["models", field.name, "name"], value); }} /></Form.Item><Form.Item {...field} name={[field.name, "name"]} label="显示名称" className="mb-0" rules={[{ required: true, message: "请输入显示名称" }]}><Input placeholder="默认可与模型 ID 相同" /></Form.Item><Button className="mt-[30px]" danger type="text" icon={<Trash2 className="size-4" />} onClick={() => remove(field.name)} /></div><div className="mt-3 grid gap-3 md:grid-cols-[120px_minmax(180px,1fr)_70px]"><Form.Item {...field} name={[field.name, "output"]} label="输出" className="mb-0" rules={[{ required: true }]}><Select disabled={providerType === "anthropic"} options={capabilities.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item {...field} name={[field.name, "inputs"]} label="允许输入" className="mb-0" rules={[{ required: true }]}><Select mode="multiple" options={(providerType === "anthropic" ? ["text", "image"] : capabilities).map((value) => ({ value, label: value }))} /></Form.Item><Form.Item {...field} name={[field.name, "enabled"]} label="状态" valuePropName="checked" className="mb-0 pt-1"><Checkbox>启用</Checkbox></Form.Item></div></div>)}<Button block type="dashed" icon={<Plus className="size-4" />} onClick={() => add({ id: "", name: "", output: "text", inputs: providerType === "anthropic" ? ["text", "image"] : ["text"], enabled: true })}>添加模型</Button></div>}</Form.List>
                    </section>
                </Form>
            </Drawer>
        </section>
    );
}

function ComfyManager() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<ComfyServer | "new" | null>(null);
    const [form] = Form.useForm<ComfyForm>();
    const { data = [] } = useQuery({ queryKey: ["comfy-servers"], queryFn: serverApi.comfyServers });
    const reload = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["comfy-servers"] }), queryClient.invalidateQueries({ queryKey: ["ai-models"] })]); useConfigStore.getState().hydrateModels(await serverApi.aiModels()); };
    const save = async () => { const value = await form.validateFields(); editing && editing !== "new" ? await serverApi.updateComfyServer(editing.id, value) : await serverApi.createComfyServer(value); setEditing(null); await reload(); message.success("ComfyUI 节点已保存"); };
    const open = (server?: ComfyServer) => { setEditing(server || "new"); form.setFieldsValue(server || { name: "内网 ComfyUI", url: "http://127.0.0.1:8188", enabled: true, models: comfyModels.map((model) => model.value) }); };
    return <section className="space-y-4"><div className="flex items-center justify-between gap-3"><p className="text-sm text-stone-500">节点地址不会出现在普通用户响应中。</p><Button type="primary" icon={<Plus className="size-4" />} onClick={() => open()}>添加节点</Button></div><div className="space-y-2">{data.map((server) => <div key={server.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-background px-4 py-3 dark:border-stone-800"><div className="min-w-0"><div className="flex items-center gap-2 font-medium"><Server className="size-4" />{server.name}{server.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}</div><div className="mt-1 truncate font-mono text-xs text-stone-400">{server.url} · {server.models.length} 个工作流</div></div><div className="flex gap-2"><Button size="small" icon={<Wifi className="size-3.5" />} onClick={() => void serverApi.testComfyServer(server.id).then(() => message.success("节点连接正常")).catch((error) => message.error(error.message))}>测试</Button><Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => open(server)}>编辑</Button><Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => modal.confirm({ title: `删除“${server.name}”？`, okButtonProps: { danger: true }, onOk: async () => { await serverApi.deleteComfyServer(server.id); await reload(); } })} /></div></div>)}</div>{!data.length ? <Empty description="还没有 ComfyUI 节点" /> : null}<Modal title={editing === "new" ? "添加 ComfyUI 节点" : "编辑 ComfyUI 节点"} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void save()} destroyOnHidden><Form form={form} layout="vertical" className="mt-4"><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="url" label="HTTP/HTTPS 地址" rules={[{ required: true, type: "url" }]}><Input /></Form.Item><Form.Item name="models" label="可用固定工作流" rules={[{ required: true }]}><Select mode="multiple" options={comfyModels} /></Form.Item><Form.Item name="enabled" valuePropName="checked"><Checkbox>启用节点</Checkbox></Form.Item></Form></Modal></section>;
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
