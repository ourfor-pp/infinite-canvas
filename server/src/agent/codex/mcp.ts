import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { db } from "../../database.js";
import type { AgentToolDefinition } from "../mcp/index.js";

// The listener is reachable only on loopback and exists only for this run.
export async function serveDirectorMcp(sessionId: string, runId: string, tools: AgentToolDefinition[]) {
    const token = randomBytes(32).toString("hex");
    const app = express();
    const transports = new Set<StreamableHTTPServerTransport>();
    const pending = new Map<string, Promise<CallToolResult>>();
    let closed = false;
    app.use((req, res, next) => {
        if (closed || req.headers.authorization !== `Bearer ${token}` || req.headers.origin) { res.sendStatus(403); return; }
        const active = db.prepare("SELECT 1 FROM agent_runs r JOIN agent_sessions s ON s.id=r.session_id WHERE r.id=? AND s.id=? AND s.current_run_id=r.id AND r.status IN ('running','waiting_for_user')").get(runId, sessionId);
        if (!active) { res.sendStatus(410); return; }
        next();
    });
    app.use(express.json({ limit: "2mb" }));
    app.post("/mcp", async (req, res) => {
        const mcp = new McpServer({ name: "infinite_canvas", version: "1.0.0" });
        for (const definition of tools) {
            mcp.registerTool(definition.name, { description: definition.description, inputSchema: z.object(definition.inputSchema) }, async (input, extra) => {
                const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
                const requestKey = `${definition.name}:${definition.name.startsWith("director_generate_") ? inputHash : String(extra.requestId)}`;
                const previous = db.prepare("SELECT input_hash,status,result FROM agent_tool_requests WHERE session_id=? AND run_id=? AND request_key=?").get(sessionId, runId, requestKey) as { input_hash: string; status: string; result: string | null } | undefined;
                if (previous?.input_hash !== undefined && previous.input_hash !== inputHash) throw new Error("MCP 请求标识与参数冲突");
                if (pending.has(requestKey)) return pending.get(requestKey)!;
                if (previous?.status === "completed") {
                    const cached = JSON.parse(previous.result!) as CallToolResult;
                    if (!cached.isError || cached._meta?.directorRetrySafe !== true) return cached;
                    db.prepare("DELETE FROM agent_tool_requests WHERE session_id=? AND run_id=? AND request_key=?").run(sessionId, runId, requestKey);
                } else if (previous) return { isError: true, content: [{ type: "text", text: "上次工具执行已提交但结果未知，请先查询任务状态，不要重复生成。" }] };
                db.prepare("INSERT INTO agent_tool_requests(session_id,run_id,request_key,tool_name,input_hash,status) VALUES(?,?,?,?,?,'started')").run(sessionId, runId, requestKey, definition.name, inputHash);
                const result = definition.handler(input, extra).then((value) => {
                    db.prepare("UPDATE agent_tool_requests SET status='completed',result=? WHERE session_id=? AND run_id=? AND request_key=?").run(JSON.stringify(value), sessionId, runId, requestKey);
                    return value;
                });
                pending.set(requestKey, result);
                try { return await result; } finally { pending.delete(requestKey); }
            });
        }
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        transports.add(transport);
        res.on("close", () => { transports.delete(transport); void mcp.close(); });
        try { await mcp.connect(transport); await transport.handleRequest(req, res, req.body); }
        catch { if (!res.headersSent) res.sendStatus(500); }
    });
    const http = createServer(app);
    await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); });
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("无法启动导演 MCP");
    return { url: `http://127.0.0.1:${address.port}/mcp`, token, close: () => {
        closed = true;
        transports.forEach((transport) => void transport.close());
        http.closeAllConnections(); http.close();
    } };
}
