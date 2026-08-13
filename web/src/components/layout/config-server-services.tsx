import { App, Button, Form, Input, Spin, Switch, Tag } from "antd";
import { Cpu, DatabaseBackup, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { serverApi, type BackupSnapshot } from "@/services/api/server";

type BackupForm = { url: string; username: string; password: string; directory: string };
type ExecutorForm = { url: string; token: string; stableAudio3LicenseAccepted: boolean };
type ExecutorStatus = { url: string; tokenConfigured: boolean; stableAudio3LicenseAccepted: boolean; configured: boolean; available: boolean; models: string[]; modelDetails?: Record<string, { engine?: string }>; runtimes?: Record<string, boolean> };

export function ConfigServerServices() {
    const { message, modal } = App.useApp();
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(true);
    const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
    const [busy, setBusy] = useState("");
    const [executor, setExecutor] = useState<ExecutorStatus | null>(null);
    const [form] = Form.useForm<BackupForm>();
    const [executorForm] = Form.useForm<ExecutorForm>();

    const load = async () => {
        setLoading(true);
        try {
            const [session, settings, list, executorStatus] = await Promise.all([serverApi.session(), serverApi.backupSettings(), serverApi.backups(), serverApi.mediaExecutorStatus()]);
            if (!session.user.isAdmin) setAllowed(false);
            setSnapshots(list);
            setExecutor(executorStatus);
            executorForm.setFieldsValue({ url: executorStatus.url, token: "", stableAudio3LicenseAccepted: executorStatus.stableAudio3LicenseAccepted });
            if (settings) form.setFieldsValue({ ...settings, password: "" });
        } catch (error) {
            if (error instanceof Error && "status" in error && error.status === 403) setAllowed(false);
            else message.error(error instanceof Error ? error.message : "读取服务端备份配置失败");
        } finally {
            setLoading(false);
        }
    };

    const saveExecutor = async () => {
        setBusy("executor");
        try {
            await serverApi.updateMediaExecutorSettings(await executorForm.validateFields());
            message.success("媒体执行器配置已加密保存");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存媒体执行器失败");
        } finally { setBusy(""); }
    };

    useEffect(() => void load(), []);

    const save = async () => {
        const value = await form.validateFields();
        setBusy("save");
        try {
            await serverApi.updateBackupSettings(value);
            message.success("WebDAV 备份配置已保存到服务端");
        } finally {
            setBusy("");
        }
    };

    const run = async (action: "test" | "create") => {
        setBusy(action);
        try {
            await serverApi.updateBackupSettings(await form.validateFields());
            if (action === "test") {
                await serverApi.testBackup();
                message.success("WebDAV 连接正常");
            } else {
                const result = await serverApi.createBackup();
                message.success(`快照已创建，共 ${result.files} 个文件`);
                setSnapshots(await serverApi.backups());
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 操作失败");
        } finally {
            setBusy("");
        }
    };

    const restore = (snapshot: BackupSnapshot) => modal.confirm({
        title: "恢复这个完整快照？",
        content: "服务端会先保存恢复前快照，校验全部文件和数据库后再替换当前数据。完成后服务需要重启。",
        okText: "校验并恢复",
        onOk: async () => {
            const result = await serverApi.restoreBackup(snapshot.id);
            message.success(`恢复完成，安全副本：${result.safetyId}。请重启服务。`);
        },
    });

    if (loading) return <div className="flex min-h-48 items-center justify-center"><Spin /></div>;
    if (!allowed) return <div className="rounded-lg border border-stone-200 p-6 text-sm text-stone-500 dark:border-stone-800">只有管理员可以管理服务端 WebDAV 快照。</div>;

    return (
        <section>
            <div className="mb-8 rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="mb-4 flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Cpu className="size-5 text-stone-500" /><div><div className="text-sm font-semibold">本地媒体执行器</div><div className="mt-1 text-xs text-stone-500">Token 加密保存在服务端，浏览器只显示是否已配置。</div></div></div><Tag color={executor?.available ? "success" : executor?.configured ? "error" : "default"}>{executor?.available ? `在线 · ${executor.models.length} 个模型` : executor?.configured ? "无法连接" : "未配置"}</Tag></div>{executor?.runtimes ? <div className="mb-4 flex flex-wrap gap-2">{Object.entries(executor.runtimes).map(([name, online]) => <Tag key={name} color={online ? "success" : "default"}>{name} · {online ? "在线" : "离线"}</Tag>)}</div> : null}<Form form={executorForm} layout="vertical" initialValues={{ url: "", token: "", stableAudio3LicenseAccepted: false }}><div className="grid gap-4 md:grid-cols-2"><Form.Item name="url" label="执行器地址" rules={[{ type: "url", message: "请输入完整 URL" }]}><Input placeholder="http://5090-machine.lan:8290" /></Form.Item><Form.Item name="token" label="Bearer Token" extra={executor?.tokenConfigured ? "留空表示沿用已保存 Token" : "首次配置必须填写"}><Input.Password autoComplete="new-password" /></Form.Item></div><Form.Item name="stableAudio3LicenseAccepted" label="Stable Audio 3 许可" valuePropName="checked"><Switch checkedChildren="已确认许可" unCheckedChildren="未启用" /></Form.Item><Button loading={busy === "executor"} onClick={() => void saveExecutor()}>保存并检测</Button></Form></div>
            <div className="mb-3"><div className="flex items-center gap-2 text-sm font-semibold"><DatabaseBackup className="size-4" />WebDAV 完整快照</div><div className="mt-1 text-xs text-stone-500">供应商与 ComfyUI 在“供应商”中管理；这里仅管理 SQLite 与媒体完整快照。</div></div>
            <Form form={form} layout="vertical" initialValues={{ url: "", username: "", password: "", directory: "infinite-canvas" }}>
                <div className="grid gap-4 md:grid-cols-2"><Form.Item name="url" label="WebDAV 地址" rules={[{ required: true, type: "url" }]}><Input placeholder="https://nas.example.com/dav" /></Form.Item><Form.Item name="directory" label="备份目录" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="username" label="用户名"><Input autoComplete="username" /></Form.Item><Form.Item name="password" label="密码" extra="留空表示沿用服务端已保存的密码"><Input.Password autoComplete="current-password" /></Form.Item></div>
                <div className="flex flex-wrap gap-2"><Button onClick={() => void save()} loading={busy === "save"}>保存配置</Button><Button icon={<Wifi className="size-4" />} onClick={() => void run("test")} loading={busy === "test"}>测试连接</Button><Button type="primary" icon={<DatabaseBackup className="size-4" />} onClick={() => void run("create")} loading={busy === "create"}>创建完整快照</Button><Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>刷新列表</Button></div>
            </Form>
            <div className="mt-4 space-y-2">{snapshots.map((snapshot) => <div key={snapshot.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 text-sm dark:border-stone-800"><div><div className="font-medium">{new Date(snapshot.createdAt).toLocaleString()}</div><div className="mt-1 text-xs text-stone-500">{snapshot.files} 个文件 · {formatBytes(snapshot.bytes)}</div></div><Button size="small" onClick={() => restore(snapshot)}>恢复</Button></div>)}</div>
        </section>
    );
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
