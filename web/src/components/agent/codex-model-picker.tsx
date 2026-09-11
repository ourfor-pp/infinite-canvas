import { useCallback, useEffect, useRef, useState } from "react";
import { App, Dropdown, type MenuProps } from "antd";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { agentApi, type AgentSession, type CodexModelCatalog, type CodexOptions } from "@/services/api/agent";

const effortLabels: Record<string, string> = { none: "不思考", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "极限" };

export function CodexModelPicker({ session, onChange, onSavingChange }: { session: AgentSession; onSavingChange: (saving: boolean) => void; onChange: (session: AgentSession) => void }) {
    const { message } = App.useApp();
    const [catalog, setCatalog] = useState<CodexModelCatalog | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const mounted = useRef(false);
    const load = useCallback(async () => {
        setLoading(true);
        try { const result = await agentApi.codexModels(session.id); if (mounted.current) { setCatalog(result); setError(""); } }
        catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "模型列表加载失败"); }
        finally { if (mounted.current) setLoading(false); }
    }, [session.id]);
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; onSavingChange(false); }; }, [load, onSavingChange]);
    const options = session.codexOptions || { model: "", effort: "" };
    const current = catalog?.models.find((model) => model.id === (options.model || catalog.defaultModel));
    const save = async (value: CodexOptions) => {
        if (saving) return;
        setSaving(true); onSavingChange(true);
        try { const updated = await agentApi.saveCodexOptions(session.id, value); if (mounted.current) onChange(updated); }
        catch (failure) { message.error(failure instanceof Error ? failure.message : "模型切换失败"); }
        finally { if (mounted.current) { setSaving(false); onSavingChange(false); } }
    };
    const items: MenuProps["items"] = error ? [{ key: "retry", label: "加载失败，点击重试", title: error }] : !catalog ? [{ key: "loading", label: "正在读取 Codex 模型…", disabled: true }] : [
        { type: "group", label: "模型", children: [
            { key: "model:", label: "跟随默认模型" },
            ...catalog.models.map((model) => ({ key: `model:${model.id}`, label: model.name, title: model.description })),
        ] },
        ...(current?.efforts.length ? [{ type: "divider" as const }, { type: "group" as const, label: "思考强度", children: [
            { key: "effort:", label: `默认 · ${effortLabels[current.defaultEffort] || current.defaultEffort}` },
            ...current.efforts.map((effort) => ({ key: `effort:${effort.id}`, label: effortLabels[effort.id] || effort.id, title: effort.description })),
        ] }] : []),
        ...(["running", "waiting_for_user"].includes(session.status) ? [{ type: "divider" as const }, { key: "next-turn", label: "切换后从下一轮生效", disabled: true }] : []),
    ];
    return <Dropdown trigger={["click"]} placement="topLeft" onOpenChange={(open) => { if (open) void load(); }} menu={{ items, selectable: true, selectedKeys: [`model:${options.model}`, `effort:${options.effort}`], style: { maxHeight: "min(520px, 70vh)", overflowY: "auto" }, onClick: ({ key }) => {
        if (key === "retry") void load();
        else if (key.startsWith("model:")) void save({ model: key.slice(6), effort: "" });
        else if (key.startsWith("effort:")) void save({ ...options, effort: key.slice(7) });
    } }}>
        <button type="button" aria-label="选择 Codex 模型" title={`${current?.name || options.model || "Codex 默认模型"}${options.effort ? ` · 思考强度：${effortLabels[options.effort] || options.effort}` : ""}`} disabled={saving} className="flex h-[34px] min-w-0 max-w-40 items-center gap-1 rounded-lg px-1.5 text-xs text-[var(--agent-muted)] hover:bg-[var(--agent-soft)] hover:text-[var(--agent-text)] disabled:opacity-50">
            <span className="truncate">{current?.name || options.model || "默认模型"}</span>
            {saving || loading ? <LoaderCircle className="size-3 shrink-0 animate-spin" /> : <ChevronDown className="size-3 shrink-0" />}
        </button>
    </Dropdown>;
}
