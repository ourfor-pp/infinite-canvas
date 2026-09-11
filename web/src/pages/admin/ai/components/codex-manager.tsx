import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Popconfirm, Switch, Tag, Typography } from "antd";
import { Terminal, Wifi } from "lucide-react";
import { agentApi } from "@/services/api/agent";

export function CodexManager() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm();
    const { data: settings, isLoading } = useQuery({ queryKey: ["admin-codex"], queryFn: agentApi.codexSettings, refetchInterval: (query) => query.state.data?.login ? 3000 : 30_000 });
    useEffect(() => { if (settings && !form.isFieldsTouched()) form.setFieldsValue(settings); }, [settings, form]);
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-codex"] });
    const action = useMutation({ mutationFn: async (name: "login" | "logout" | "test" | "save") => {
        if (name === "save") { await agentApi.saveCodexSettings(await form.validateFields()); form.resetFields(); message.success("Codex 配置已保存"); }
        if (name === "login") {
            const login = await agentApi.codexLogin();
            queryClient.setQueryData(["admin-codex"], (current: typeof settings) => current ? { ...current, login } : current);
        }
        if (name === "logout") await agentApi.codexLogout();
        if (name === "test") { await agentApi.codexTest(); message.success("Codex 认证、模型目录与命令隔离验证通过"); }
        await refresh();
    }, onError: (error) => message.error(error instanceof Error ? error.message : "Codex 操作失败") });
    return <div className="max-w-2xl rounded-xl border border-border bg-background p-5">
        <div className="mb-4 flex items-center gap-2"><Terminal className="size-4" /><h3 className="font-semibold">导演 Codex</h3><Tag color={settings?.ready ? "green" : undefined}>{settings?.ready ? "可用" : "待配置"}</Tag>{settings?.version ? <span className="text-xs text-muted-foreground">{settings.version}</span> : null}</div>
        <p className="mb-4 text-sm text-muted-foreground">使用应用专用账号，在作品工程内执行命令和联网。配置与会话独立于日常 Codex。</p>
        <Form form={form} layout="vertical" disabled={isLoading || action.isPending}>
            <Form.Item name="enabled" label="启用 Codex" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="binary" label="Codex 程序路径" rules={[{ required: true, message: "请输入绝对路径" }]}><Input placeholder="/usr/bin/codex" /></Form.Item>
            <Form.Item name="model" label="模型" extra="留空使用 Codex 账号的默认模型。"><Input placeholder="Codex 默认模型" /></Form.Item>
            <div className="flex flex-wrap justify-end gap-2">
                <Button icon={<Wifi className="size-4" />} onClick={() => action.mutate("test")}>测试连接与隔离</Button>
                {settings?.authenticated ? <Popconfirm title="退出导演台 Codex 账号？" description="请先在运行任务列表中结束 Codex 任务。" onConfirm={() => action.mutate("logout")}><Button>退出登录</Button></Popconfirm> : <Button onClick={() => action.mutate("login")}>登录 Codex</Button>}
                <Button type="primary" onClick={() => action.mutate("save")}>保存配置</Button>
            </div>
        </Form>
        {settings?.login ? <div className="mt-4 space-y-2 rounded-lg bg-muted/40 p-3 text-sm"><p>打开验证页面，输入设备码完成登录：</p><Typography.Text copyable>{settings.login.userCode}</Typography.Text><div><a href={settings.login.verificationUrl} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline underline-offset-2">{settings.login.verificationUrl}</a></div><p className="text-xs text-muted-foreground">正在等待登录结果…</p></div> : null}
        {settings?.reason ? <p role="status" className="mt-3 text-sm text-muted-foreground">{settings.reason}</p> : null}
    </div>;
}
