import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

export class AgentErrorBoundary extends Component<{ children: ReactNode; resetKey: string; onReload: () => void }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    componentDidCatch(error: Error, info: ErrorInfo) { console.error("Agent panel render failed", error, info); }
    componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string; onReload: () => void }>) {
        if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
    }
    reload = () => {
        if (/dynamically imported module|importing a module script failed|outdated optimize dep/i.test(this.state.error?.message || "")) {
            window.location.reload();
            return;
        }
        this.props.onReload();
    };
    render() {
        if (!this.state.error) return this.props.children;
        const moduleFailed = /dynamically imported module|importing a module script failed|outdated optimize dep/i.test(this.state.error.message);
        return <div className="grid h-full place-items-center bg-[var(--agent-panel)] px-8 text-center text-[var(--agent-text)]"><div><CircleAlert className="mx-auto size-7 text-red-500" /><h3 className="mt-3 text-sm font-semibold">Agent 面板暂时无法显示</h3><p className="mt-2 text-xs leading-5 text-[var(--agent-muted)]">{moduleFailed ? "页面资源已经更新，刷新后即可继续使用。" : "项目和任务没有受到影响，可以重新读取服务端会话。"}</p><button type="button" className="mx-auto mt-4 flex items-center gap-2 rounded-full bg-[var(--agent-accent)] px-4 py-2 text-xs font-medium text-white" onClick={this.reload}><RotateCcw className="size-3.5" />{moduleFailed ? "刷新页面" : "重新加载会话"}</button></div></div>;
    }
}
