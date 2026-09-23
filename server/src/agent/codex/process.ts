import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

export type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
export const permissionRequirements = `default_permissions = "director"
allowed_approval_policies = ["never"]
allow_login_shell = false
allow_remote_control = false
allow_managed_hooks_only = true
cli_auth_credentials_store = "file"
[allowed_permission_profiles]
director = true
[permissions.director.filesystem]
":minimal" = "read"
"/usr" = "read"
"/etc" = "read"
"/bin" = "read"
"/lib" = "read"
"/lib64" = "read"
"/workspace" = "write"
"/tmp" = "write"
"/codex-home/tmp" = "read"
"/codex-home/generated_images" = "read"
"/codex-home/auth.json" = "deny"
"/codex-home/config.toml" = "deny"
"/codex-home/sessions" = "deny"
"/proc" = "deny"
"/workspace/.claude" = "deny"
"/workspace/.codex" = "deny"
"/workspace/.agents" = "read"
[permissions.director.network]
enabled = true
[permissions.filesystem]
deny_read = ["/codex-home/auth.json", "/codex-home/config.toml", "/codex-home/sessions", "/proc", "/workspace/.claude", "/workspace/.codex"]
`;

export function sandboxArguments(workspace: string, home: string, policyDir: string, binary: string) {
    if (!realpathSync(binary).startsWith("/usr/")) throw new Error("首版 Codex 可执行文件必须安装在 /usr 下，不能挂载用户目录中的程序");
    const args = ["--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--cap-drop", "ALL", "--clearenv",
        "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/home", "--dir", "/etc", "--dir", "/etc/codex",
        "--bind", workspace, "/workspace", "--bind", home, "/codex-home", "--bind", resolve(workspace, ".cache/codex-images"), "/codex-home/generated_images", "--ro-bind", policyDir, "/etc/codex",
        "--setenv", "HOME", "/home", "--setenv", "CODEX_HOME", "/codex-home", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LANG", "C.UTF-8",
        "--setenv", "TMPDIR", "/tmp", "--chdir", "/workspace"];
    for (const path of ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/ssl/certs", "/etc/ld.so.cache", "/etc/alternatives"]) {
        if (existsSync(path)) args.push("--ro-bind", realpathSync(path), path);
    }
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
        if (process.env[name]) args.push("--setenv", name, process.env[name]!);
    }
    // Hide engine-specific settings even when the workbench has installed them.
    for (const name of [".claude", ".codex"]) args.push("--tmpfs", `/workspace/${name}`);
    if (existsSync(resolve(workspace, ".agents"))) args.push("--ro-bind", resolve(workspace, ".agents"), "/workspace/.agents");
    return args;
}

// This deployment repeatedly loses Responses WebSockets before falling back to HTTP.
// Preserve OpenAI authentication and native web-search capability.
export const codexTransportConfig = {
    "model_provider": "openai-http",
    "model_providers.openai-http": { name: "OpenAI", wire_api: "responses", requires_openai_auth: true, supports_websockets: false, supports_standalone_web_search: true },
};

export function startCodexProcess(workspace: string, home: string, policyDir: string, binary = "/usr/bin/codex", overrides: Record<string, unknown> = {}) {
    if (process.platform !== "linux") throw new Error("导演 Codex 仅支持 Linux 隔离环境");
    for (const path of [workspace, home, policyDir, resolve(workspace, ".cache/codex-images")]) mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(policyDir, "requirements.toml"), permissionRequirements, { mode: 0o600 });
    const config: Record<string, unknown> = { "features.image_generation": true, "features.network_proxy": false, approval_policy: "never", cli_auth_credentials_store: "file", default_permissions: "director", check_for_update_on_startup: false, ...codexTransportConfig, ...overrides };
    const flags = Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`]);
    return new CodexRpc(spawn("/usr/bin/bwrap", [...sandboxArguments(workspace, home, policyDir, binary), "--", binary, "app-server", "--listen", "stdio://", ...flags], { stdio: "pipe", env: { PATH: "/usr/bin:/bin" } }));
}
function tomlValue(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value)) return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`).join(", ")} }`;
    return JSON.stringify(value);
}

export class CodexRpc {
    serverVersion = "";
    private nextId = 0;
    private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
    private listeners = new Set<(message: RpcMessage) => void>();
    private closed = false;
    private stderr = "";
    constructor(private child: ChildProcessWithoutNullStreams) {
        child.stderr.on("data", (data: Buffer) => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
            let message: RpcMessage;
            try { message = JSON.parse(line); } catch { this.fail(new Error("Codex 返回无效协议数据")); return; }
            if (typeof message.id === "number" && !message.method) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                clearTimeout(pending.timer); this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
            } else this.listeners.forEach((listener) => listener(message));
        });
        child.on("error", (error) => this.fail(error));
        child.stdin.on("error", () => this.fail(new Error("Codex 输入连接已关闭")));
        child.on("exit", () => { lines.close(); this.fail(new Error("Codex 进程已退出，请检查隔离环境和登录状态")); });
    }
    async initialize() {
        const result = await this.request<{ userAgent?: string }>("initialize", { clientInfo: { name: "infinite_canvas_director", version: "1.0.0" }, capabilities: { experimentalApi: true } });
        this.serverVersion = result.userAgent || "";
        this.notify("initialized", {});
    }
    request<T = unknown>(method: string, params: unknown = {}, timeout = 30_000): Promise<T> {
        if (this.closed) return Promise.reject(new Error("Codex 连接已关闭"));
        const id = ++this.nextId;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex 请求超时：${method}`)); }, timeout);
            this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
            this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        });
    }
    notify(method: string, params: unknown) { if (!this.closed) this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
    reply(id: string | number, result: unknown) { if (!this.closed) this.child.stdin.write(`${JSON.stringify({ id, result })}\n`); }
    listen(listener: (message: RpcMessage) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    close() {
        this.fail(new Error("Codex 连接已关闭")); this.child.kill("SIGTERM");
        const timer = setTimeout(() => { if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL"); }, 3000);
        timer.unref(); this.child.once("exit", () => clearTimeout(timer));
    }
    private fail(error: Error) {
        if (this.closed) return;
        this.closed = true;
        Object.assign(error, { code: "CODEX_CONNECTION_CLOSED" });
        this.pending.forEach((pending) => { clearTimeout(pending.timer); pending.reject(error); }); this.pending.clear();
        this.listeners.forEach((listener) => listener({ method: "connection/closed", params: { message: error.message } }));
    }
}
