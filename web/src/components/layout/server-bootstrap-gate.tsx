import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Modal, Result, Spin } from "antd";
import { Database, HardDriveUpload } from "lucide-react";

import { bootstrapServerState, hydrateFromServer, importLegacyData, markLegacyMigrationSkipped } from "@/services/server-bootstrap";
import { subscribeServerEvents } from "@/services/api/server";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCreativeAssetStore } from "@/stores/use-creative-asset-store";
import { useVisualStyleStore } from "@/stores/use-visual-style-store";

type LegacyData = Awaited<ReturnType<typeof bootstrapServerState>>["legacy"];
let bootstrapPromise: ReturnType<typeof bootstrapServerState> | null = null;

export function ServerBootstrapGate({ children }: { children: ReactNode }) {
    const { message, modal } = App.useApp();
    const [status, setStatus] = useState<"loading" | "migration" | "ready" | "error">("loading");
    const [legacy, setLegacy] = useState<LegacyData>(null);
    const [error, setError] = useState("");
    const [migrating, setMigrating] = useState(false);
    const conflictOpenRef = useRef(new Set<string>());

    const connect = () => {
        setStatus("loading");
        setError("");
        bootstrapPromise = bootstrapServerState();
        void bootstrapPromise
            .then((result) => {
                setLegacy(result.legacy);
                setStatus(result.legacy ? "migration" : "ready");
            })
            .catch((reason) => {
                setError(reason instanceof Error ? reason.message : "无法连接无限画布服务");
                setStatus("error");
            });
    };

    useEffect(() => {
        if (!bootstrapPromise) bootstrapPromise = bootstrapServerState();
        void bootstrapPromise
            .then((result) => {
                setLegacy(result.legacy);
                setStatus(result.legacy ? "migration" : "ready");
            })
            .catch((reason) => {
                setError(reason instanceof Error ? reason.message : "无法连接无限画布服务");
                setStatus("error");
            });
    }, []);

    useEffect(() => {
        const onError = (event: Event) => message.error((event as CustomEvent<string>).detail || "服务保存失败");
        const onConflict = (event: Event) => {
            const id = (event as CustomEvent<{ id: string }>).detail.id;
            if (conflictOpenRef.current.has(id)) return;
            conflictOpenRef.current.add(id);
            modal.confirm({
                title: "画布已在其他页面更新",
                content: "重新加载会放弃当前页面尚未保存的修改；覆盖保存会以当前页面内容为准。",
                okText: "重新加载",
                cancelText: "覆盖保存",
                keyboard: false,
                onOk: () => useCanvasStore.getState().resolveConflict(id, "reload"),
                onCancel: () => useCanvasStore.getState().resolveConflict(id, "overwrite"),
                afterClose: () => conflictOpenRef.current.delete(id),
            });
        };
        window.addEventListener("infinite-canvas:server-error", onError);
        window.addEventListener("infinite-canvas:project-conflict", onConflict);
        return () => {
            window.removeEventListener("infinite-canvas:server-error", onError);
            window.removeEventListener("infinite-canvas:project-conflict", onConflict);
        };
    }, [message, modal]);

    useEffect(() => subscribeServerEvents(
        (generation) => {
            useCreativeAssetStore.getState().applyGeneration(generation);
            window.dispatchEvent(new CustomEvent("infinite-canvas:generation-updated", { detail: generation }));
        },
        (delta) => window.dispatchEvent(new CustomEvent("infinite-canvas:generation-delta", { detail: delta })),
        (project) => {
            if (useCanvasStore.getState().applyServerProject(project as unknown as import("@/stores/canvas/use-canvas-store").CanvasProject)) {
                window.dispatchEvent(new CustomEvent("infinite-canvas:project-updated", { detail: project }));
            }
        },
        (asset) => useCreativeAssetStore.getState().apply(asset),
        (style) => useVisualStyleStore.getState().apply(style),
    ), []);

    const migrate = async () => {
        if (!legacy) return;
        setMigrating(true);
        try {
            await importLegacyData(legacy);
            setLegacy(null);
            setStatus("ready");
            message.success("本地画布、素材和配置已导入后端");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "本地数据导入失败");
        } finally {
            setMigrating(false);
        }
    };

    const useEmptyServer = async () => {
        markLegacyMigrationSkipped();
        await hydrateFromServer();
        setLegacy(null);
        setStatus("ready");
    };

    if (status === "loading")
        return (
            <div className="grid h-dvh place-items-center bg-background text-foreground">
                <div className="flex flex-col items-center gap-4 text-sm text-stone-500 dark:text-stone-400">
                    <Spin size="large" />
                    <span>正在连接无限画布服务…</span>
                </div>
            </div>
        );

    if (status === "error")
        return (
            <div className="grid h-dvh place-items-center bg-background px-6">
                <Result status="error" title="后端服务不可用" subTitle={error} extra={<Button type="primary" onClick={connect}>重新连接</Button>} />
            </div>
        );

    return (
        <>
            {children}
            <Modal open={status === "migration"} closable={false} maskClosable={false} footer={null} width={520}>
                <div className="px-1 py-2">
                    <div className="mb-5 flex items-start gap-4">
                        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400"><HardDriveUpload className="size-5" /></div>
                        <div>
                            <div className="text-base font-semibold text-stone-900 dark:text-stone-100">发现浏览器本地数据</div>
                            <div className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">新版由后端统一保存数据。导入成功前不会删除或修改原来的 IndexedDB 内容。</div>
                        </div>
                    </div>
                    <div className="mb-5 grid grid-cols-4 gap-2 rounded-xl bg-black/[0.025] p-3 dark:bg-white/[0.04]">
                        <MigrationCount label="画布" value={legacy?.projects.length || 0} />
                        <MigrationCount label="素材" value={legacy?.assets.length || 0} />
                        <MigrationCount label="生成记录" value={(legacy?.imageLogs.length || 0) + (legacy?.videoLogs.length || 0)} />
                        <MigrationCount label="提示词配置" value={legacy?.promptSources ? 1 : 0} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button disabled={migrating} onClick={() => void useEmptyServer()}>使用空数据</Button>
                        <Button type="primary" icon={<Database className="size-4" />} loading={migrating} onClick={() => void migrate()}>导入到后端</Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}

function MigrationCount({ label, value }: { label: string; value: number }) {
    return <div className="text-center"><div className="text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">{value}</div><div className="text-xs text-stone-500">{label}</div></div>;
}
