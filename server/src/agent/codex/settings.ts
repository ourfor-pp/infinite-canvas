import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../database.js";
import { startCodexProcess, type CodexRpc } from "./process.js";

export const codexHome = resolve(config.agentRoot, "codex");
export const codexPolicyDir = resolve(config.agentRoot, "codex-runtime", "policy");
const schema = z.object({ enabled: z.boolean().default(false), binary: z.string().startsWith("/").default("/usr/bin/codex"), model: z.string().trim().max(120).default("") });
export type CodexSettings = z.infer<typeof schema>;
let verified: { binary: string; at: number } | undefined;
let lastError = "尚未验证运行环境";
let admin: CodexRpc | undefined;
let adminBinary = "";
export function codexBinaryIdentity(binary: string) {
    if (!existsSync(binary)) return `${binary}:missing`;
    const path = realpathSync(binary);
    const stat = statSync(path);
    return `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
let login: { loginId: string; verificationUrl: string; userCode: string } | undefined;
let adminTimer: NodeJS.Timeout | undefined;
let accountReady = false;
let clientPending: Promise<CodexRpc> | undefined;
let statusPending: Promise<Awaited<ReturnType<typeof loadStatus>>> | undefined;

export function getCodexSettings(): CodexSettings {
    const row = db.prepare("SELECT payload FROM codex_settings WHERE id=1").get() as { payload: string } | undefined;
    return schema.parse(row ? JSON.parse(row.payload) : {});
}
export function codexPublicStatus() {
    const settings = getCodexSettings();
    const isolated = verified?.binary === codexBinaryIdentity(settings.binary) && Date.now() - verified.at < 300_000;
    return { enabled: settings.enabled, ready: settings.enabled && isolated && accountReady, modelName: settings.model || "Codex 默认模型", reason: !settings.enabled ? "管理员尚未启用 Codex" : !isolated ? lastError : !accountReady ? "管理员尚未登录 Codex" : "" };
}
export function assertCodexReady() {
    const state = codexPublicStatus();
    if (!state.ready) throw Object.assign(new Error(state.reason), { status: 503, code: "CODEX_NOT_READY" });
}
export function codexBusy() {
    return Boolean(db.prepare("SELECT 1 FROM agent_runs r JOIN agent_sessions s ON s.id=r.session_id WHERE s.engine='codex' AND r.status IN ('queued','running','waiting_for_user') LIMIT 1").get());
}
export function saveCodexSettings(input: unknown) {
    if (codexBusy()) throw Object.assign(new Error("请先结束正在运行的 Codex 任务，再修改配置"), { status: 409 });
    const value = schema.parse(input);
    db.prepare("INSERT INTO codex_settings(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(value));
    closeAdmin(); verified = undefined; accountReady = false;
    return value;
}

export async function verifyCodexIsolation() {
    const settings = getCodexSettings();
    if (verified?.binary === codexBinaryIdentity(settings.binary) && Date.now() - verified.at < 300_000) return;
    const id = randomUUID();
    const root = resolve(config.agentRoot, "codex-runtime", "probes", id);
    const workspace = resolve(root, "workspace");
    const home = resolve(root, "home");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(home, "private-probe"), id, { mode: 0o600 });
    let rpc: CodexRpc | undefined;
    try {
        rpc = startCodexProcess(workspace, home, resolve(root, "policy"), settings.binary);
        await rpc.initialize();
        const result = await rpc.request<{ exitCode: number; stdout: string; stderr: string }>("command/exec", {
            command: ["/bin/sh", "-c", 'set -eu; printf verified > /workspace/probe; test ! -e /home/cec; test ! -e /var/run/docker.sock; test ! -r /codex-home/private-probe; ln -s /codex-home/private-probe /workspace/link; test ! -r /workspace/link; if touch /usr/ic-forbidden 2>/dev/null; then exit 11; fi; if touch /codex-home/tmp/ic-forbidden 2>/dev/null; then exit 12; fi; printf isolated'],
            cwd: "/workspace", timeoutMs: 10_000,
        });
        if (result.exitCode !== 0 || result.stdout !== "isolated" || readFileSync(resolve(workspace, "probe"), "utf8") !== "verified") throw new Error(`Codex 隔离验证未通过：${result.stderr.slice(0, 500)}`);
        verified = { binary: codexBinaryIdentity(settings.binary), at: Date.now() }; lastError = "";
    } catch (error) {
        verified = undefined; lastError = error instanceof Error ? error.message : "Codex 隔离验证失败"; throw error;
    } finally { rpc?.close(); rmSync(root, { recursive: true, force: true }); }
}
async function createAdminClient() {
    const binary = codexBinaryIdentity(getCodexSettings().binary);
    if (admin && adminBinary !== binary) closeAdmin();
    await verifyCodexIsolation();
    if (!admin) {
        admin = startCodexProcess(resolve(config.agentRoot, "codex-runtime", "admin"), codexHome, codexPolicyDir, getCodexSettings().binary);
        adminBinary = binary;
        const current = admin;
        current.listen((event) => {
            if (event.method === "account/login/completed") { login = undefined; accountReady = event.params?.success === true; }
            if (event.method === "connection/closed" && admin === current) { admin = undefined; login = undefined; accountReady = false; }
        });
        try { await current.initialize(); } catch (error) { closeAdmin(); throw error; }
    }
    touchAdmin();
    return admin;
}
function touchAdmin() {
    if (adminTimer) clearTimeout(adminTimer);
    adminTimer = setTimeout(closeAdmin, login ? 15 * 60_000 : 60_000); adminTimer.unref();
}
function adminClient() {
    if (!clientPending) clientPending = createAdminClient().finally(() => { clientPending = undefined; });
    return clientPending;
}
function closeAdmin() { const previous = admin; admin = undefined; login = undefined; previous?.close(); if (adminTimer) clearTimeout(adminTimer); }
export function readCodexStatus() {
    if (!statusPending) statusPending = loadStatus().finally(() => { statusPending = undefined; });
    return statusPending;
}
async function loadStatus() {
    let version = "";
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const rpc = await adminClient();
            const result = await rpc.request<{ account: unknown }>("account/read", { refreshToken: false });
            accountReady = Boolean(result.account); version = rpc.serverVersion;
            break;
        } catch (error) {
            closeAdmin(); accountReady = false; lastError = error instanceof Error ? error.message : "Codex 连接失败";
            if (!(error instanceof Error) || !("code" in error) || error.code !== "CODEX_CONNECTION_CLOSED") break;
        }
    }
    return { ...getCodexSettings(), ...codexPublicStatus(), version, authenticated: accountReady, login: login || null };
}
export async function startCodexLogin() {
    if (codexBusy()) throw Object.assign(new Error("请先结束 Codex 任务再登录"), { status: 409 });
    const rpc = await adminClient();
    if (!login) {
        const result = await rpc.request<{ loginId: string; verificationUrl: string; userCode: string }>("account/login/start", { type: "chatgptDeviceCode" });
        login = { loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode };
        touchAdmin();
    }
    return login;
}
export async function logoutCodex() {
    if (codexBusy()) throw Object.assign(new Error("请先结束正在运行的 Codex 任务，再退出登录"), { status: 409 });
    const rpc = await adminClient();
    if (login) await rpc.request("account/login/cancel", { loginId: login.loginId });
    await rpc.request("account/logout"); accountReady = false; closeAdmin();
    return readCodexStatus();
}
export async function testCodexConnection() {
    const state = await readCodexStatus();
    if (!state.ready) throw new Error(state.reason || "请先登录 Codex");
    const rpc = await adminClient();
    const models = await rpc.request<{ data: Array<{ id: string; displayName: string }> }>("model/list", { limit: 100 });
    return { ...state, models: models.data.map(({ id, displayName }) => ({ id, name: displayName })) };
}


export const codexOptionsSchema = z.object({ model: z.string().trim().max(120).default(""), effort: z.string().trim().max(40).default("") });
export type CodexOptions = z.infer<typeof codexOptionsSchema>;
export type CodexModel = { id: string; name: string; description: string; defaultEffort: string; efforts: Array<{ id: string; description: string }>; isDefault: boolean };
let modelsPending: Promise<{ models: CodexModel[]; defaultModel: string }> | undefined;
export function listCodexModels() {
    if (!modelsPending) modelsPending = loadCodexModels().finally(() => { modelsPending = undefined; });
    return modelsPending;
}
async function loadCodexModels() {
    await readCodexStatus(); assertCodexReady();
    const rpc = await adminClient();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
        const page: { data: Array<{ id: string; model: string; displayName: string; description: string; hidden: boolean; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }> }>; nextCursor: string | null } = await rpc.request("model/list", { limit: 100, includeHidden: false, cursor });
        models.push(...page.data.filter((model) => !model.hidden).map((model) => ({ id: model.model, name: model.displayName, description: model.description, isDefault: model.isDefault, defaultEffort: model.defaultReasoningEffort, efforts: model.supportedReasoningEfforts.map((effort) => ({ id: effort.reasoningEffort, description: effort.description })) })));
        cursor = page.nextCursor;
    } while (cursor);
    return { models, defaultModel: getCodexSettings().model || models.find((model) => model.isDefault)?.id || models[0]?.id || "" };
}
export function resolveCodexOptions(input: unknown, catalog: { models: CodexModel[]; defaultModel: string }): CodexOptions {
    const value = codexOptionsSchema.parse(input);
    const model = catalog.models.find((model) => model.id === (value.model || catalog.defaultModel));
    if (!model) throw Object.assign(new Error("所选 Codex 模型已不可用，请重新选择"), { status: 400, code: "CODEX_MODEL_UNAVAILABLE" });
    const effort = value.effort || model.defaultEffort;
    if (effort && !model.efforts.some((item) => item.id === effort)) throw Object.assign(new Error("所选模型不支持这个思考强度"), { status: 400, code: "CODEX_EFFORT_UNSUPPORTED" });
    return { model: model.id, effort };
}
