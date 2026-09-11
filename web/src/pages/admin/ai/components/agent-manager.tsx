import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Select, Table, Tag } from "antd";
import { Bot, RefreshCw, Wifi } from "lucide-react";
import { useEffect } from "react";

import { agentApi } from "@/services/api/agent";
import { CodexManager } from "./codex-manager";
import { serverApi } from "@/services/api/server";

export function AgentManager() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm();
    const { data: settings } = useQuery({ queryKey: ["admin-agent-settings"], queryFn: agentApi.adminSettings });
    const { data: providers = [] } = useQuery({ queryKey: ["ai-providers"], queryFn: serverApi.aiProviders });
    const { data: runs = [], isFetching: runsLoading } = useQuery({ queryKey: ["admin-agent-runs"], queryFn: agentApi.adminRuns, refetchInterval: 3000 });
    const modelOptions = providers.flatMap((provider) => provider.enabled ? provider.models.filter((model) => model.enabled && model.output === "text" && model.agentEnabled).map((model) => ({ value: `${provider.id}::${model.id}`, label: `${provider.name} / ${model.name}` })) : []);
    const mediaModelOptions = providers.flatMap((provider) => provider.enabled ? provider.models.filter((model) => model.enabled && model.output === "text" && model.inputs.includes("image")).map((model) => ({ value: `${provider.id}::${model.id}`, label: `${provider.name} / ${model.name}` })) : []);

    useEffect(() => {
        if (settings) form.setFieldsValue(settings);
    }, [settings, form]);

    const save = useMutation({
        mutationFn: agentApi.saveAdminSettings,
        onSuccess: (value) => { queryClient.setQueryData(["admin-agent-settings"], value); message.success("Agent 配置已保存"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });

    return <section className="space-y-5">
        <CodexManager />
        <div className="max-w-2xl rounded-xl border border-stone-200 bg-background p-5 dark:border-stone-800">
            <div className="mb-4 flex items-center gap-2"><Bot className="size-4" /><h3 className="font-semibold">运行配置</h3>{settings?.ready ? <Tag color="green">Agent 可用</Tag> : <Tag color="orange">Agent 待配置</Tag>}{settings?.mediaReady ? <Tag color="blue">媒体理解可用</Tag> : <Tag>媒体理解未配置</Tag>}{settings?.ready ? <Tag>工具搜索 {settings.toolSearchMode}</Tag> : null}</div>
            <Form form={form} layout="vertical">
                <Form.Item name="modelRef" label="全局 Agent 模型" rules={[{ required: true, message: "请选择 Agent 模型" }]}><Select showSearch options={modelOptions} placeholder="选择已启用 Agent 能力的文本模型" optionFilterProp="label" /></Form.Item>
                <Form.Item name="mediaModelRef" label="媒体理解模型" extra="同一个模型用于图片理解和声音语义；视频由本地抽帧/联系表后进行图片理解。"><Select allowClear showSearch options={mediaModelOptions} placeholder="选择支持图片输入的文本模型" optionFilterProp="label" /></Form.Item>
                <div className="flex flex-wrap justify-end gap-2"><Button icon={<Wifi className="size-4" />} onClick={() => void form.validateFields(["modelRef"]).then((value) => agentApi.testAdminSettings(value)).then((result) => message.success(`${result.provider} / ${result.model} 的连接与工具调用正常（工具搜索：${result.toolSearchMode}）`)).catch((error) => message.error(error.message))}>测试连接与工具</Button><Button type="primary" loading={save.isPending} onClick={() => void form.validateFields().then((value) => save.mutate(value))}>保存配置</Button></div>
            </Form>
        </div>

        <div className="rounded-xl border border-stone-200 bg-background p-5 dark:border-stone-800">
            <div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Agent 运行任务</h3><p className="mt-1 text-sm text-stone-500">仅展示用户、模型、状态和脱敏错误。</p></div><Button icon={<RefreshCw className="size-4" />} loading={runsLoading} onClick={() => void queryClient.invalidateQueries({ queryKey: ["admin-agent-runs"] })}>刷新</Button></div>
            <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={runs} columns={[
                { title: "用户", dataIndex: ["user", "username"], width: 140 },
                { title: "模型", dataIndex: "modelRef", ellipsis: true },
                { title: "状态", dataIndex: "status", width: 120, render: (value) => <Tag color={value === "completed" ? "green" : value === "failed" ? "red" : value === "running" ? "processing" : undefined}>{value}</Tag> },
                { title: "开始时间", dataIndex: "startedAt", width: 180, render: (value) => new Date(value).toLocaleString() },
                { title: "耗时", width: 100, render: (_, row) => row.finishedAt ? `${Math.max(0, Math.round((new Date(row.finishedAt).getTime() - new Date(row.startedAt).getTime()) / 1000))}s` : "运行中" },
                { title: "工具搜索", width: 110, render: (_, row) => <span>{row.toolSearchMode === "false" ? "关闭" : `${row.toolSearchCallCount} 次`}</span> },
                { title: "错误", dataIndex: "error", ellipsis: true },
                { title: "操作", width: 80, render: (_, row) => ["queued", "running", "waiting_for_user"].includes(row.status) ? <Button size="small" danger onClick={() => agentApi.cancelAdminRun(row.id).then(() => queryClient.invalidateQueries({ queryKey: ["admin-agent-runs"] })).catch((error) => message.error(error.message))}>取消</Button> : null },
            ]} locale={{ emptyText: "暂无 Agent 任务" }} />
        </div>
    </section>;
}
