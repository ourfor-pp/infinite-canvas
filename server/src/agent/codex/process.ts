import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

export const CODEX_VERSION = "0.144.1";
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
"/" = "read"
"/workspace" = "write"
"/tmp" = "write"
"/codex-home" = "deny"
"/proc" = "deny"
"/workspace/.claude" = "deny"
"/workspace/.codex" = "deny"
"/workspace/.agents" = "read"
[permissions.director.network]
enabled = true
[permissions.filesystem]
deny_read = ["/codex-home", "/proc", "/workspace/.claude", "/workspace/.codex"]
`;

export function sandboxArguments(workspace: string, home: string, policyDir: string, binary: string) {
    const args = ["--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--cap-drop", "ALL", "--clearenv",
        "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/home", "--dir", "/etc", "--dir", "/etc/codex",
        "--bind", workspace, "/workspace", "--bind", home, "/codex-home", "--ro-bind", policyDir, "/etc/codex",
        "--setenv", "HOME", "/home", "--setenv", "CODEX_HOME", "/codex-home", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LANG", "C.UTF-8",
        "--setenv", "TMPDIR", "/tmp", "--chdir", "/workspace"];
    for (const path of ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/ssl/certs", "/etc/ld.so.cache"]) {
        if (existsSync(path)) args.push("--ro-bind", realpathSync(path), path);
    }
    // Hide engine-specific settings even when the workbench has installed them.
    for (const name of [".claude", ".codex"]) if (existsSync(resolve(workspace, name))) args.push("--tmpfs", `/workspace/${name}`);
    if (!binary.startsWith("/usr/")) args.push("--ro-bind", dirname(binary), dirname(binary));
    return args;
}

export function startCodexProcess(workspace: string, home: string, policyDir: string, binary = "/usr/bin/codex", overrides: Record<string, unknown> = {}) {
    if (process.platform !== "linux") throw new Error("导演 Codex 仅支持 Linux 隔离环境");
    for (const path of [workspace, home, policyDir]) mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(policyDir, "requirements.toml"), permissionRequirements, { mode: 0o600 });
    const config: Record<string, unknown> = { approval_policy: "never", cli_auth_credentials_store: "file", default_permissions: "director", check_for_update_on_startup: false, ...overrides };
    const flags = Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`]);
    return new CodexRpc(spawn("/usr/bin/bwrap", [...sandboxArguments(workspace, home, policyDir, binary), "--", binary, "app-server", "--listen", "stdio://", ...flags], { stdio: "pipe", env: { PATH: "/usr/bin:/bin" } }));
}
function tomlValue(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value)) return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`).join(", ")} }`;
    return JSON.stringify(value);
}

export class CodexRpc {
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
        child.on("exit", () => { lines.close(); this.fail(new Error(`Codex 进程已退出：${this.stderr.slice(-1500)}`)); });
    }
    async initialize() {
        await this.request("initialize", { clientInfo: { name: "infinite_canvas_director", version: "1.0.0" }, capabilities: { experimentalApi: true } });
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
    close() { this.fail(new Error("Codex 连接已关闭")); this.child.kill("SIGTERM"); }
    private fail(error: Error) {
        if (this.closed) return;
        this.closed = true;
        this.pending.forEach((pending) => { clearTimeout(pending.timer); pending.reject(error); }); this.pending.clear();
        this.listeners.forEach((listener) => listener({ method: "connection/closed", params: { message: error.message } }));
    }
}
