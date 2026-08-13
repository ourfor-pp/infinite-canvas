import { chmodSync, existsSync, lstatSync, unlinkSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { WebSocket as WebSocketClient, WebSocketServer, type WebSocket } from "ws";
import { app } from "./app.js";
import { parseGatewayUser } from "./auth.js";
import { config } from "./config.js";
import { db } from "./database.js";
import { resumeGenerations, setGenerationEmitter } from "./generation-service.js";
import { cleanupUnreferencedFiles } from "./file-store.js";
import { recoverAgentRuns } from "./agent/service.js";
import { setAgentProjectEmitter } from "./agent/project-events.js";
import { setCreativeAssetEmitter } from "./creative-assets.js";
import { setVisualStyleEmitter } from "./visual-styles.js";
import { refreshMediaExecutorCatalog, syncMediaExecutorComfyServer } from "./media-executor-settings.js";

syncMediaExecutorComfyServer();
await refreshMediaExecutorCatalog();

const server = config.socketPath
    ? (() => {
          if (existsSync(config.socketPath) && !lstatSync(config.socketPath).isSocket()) throw new Error(`SOCKET_PATH 已存在且不是 Unix Socket：${config.socketPath}`);
          if (existsSync(config.socketPath)) unlinkSync(config.socketPath);
          return app.listen(config.socketPath);
      })()
    : app.listen(config.port, "127.0.0.1");

setInterval(refreshMediaExecutorCatalog, 15_000).unref();

const clients = new Map<string, Set<WebSocket>>();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== `${config.basePath}/api/events`) return socket.destroy();
    const user = websocketUser(request);
    if (!user) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (client) => {
        let userClients = clients.get(user.id);
        if (!userClients) clients.set(user.id, (userClients = new Set()));
        userClients.add(client);
        client.on("close", () => {
            userClients?.delete(client);
            if (!userClients?.size) clients.delete(user.id);
        });
        client.send(JSON.stringify({ type: "connected" }));
    });
});

setGenerationEmitter((userId, type, data) => {
    const message = JSON.stringify({ type, data });
    clients.get(userId)?.forEach((client) => {
        if (client.readyState === WebSocketClient.OPEN) client.send(message);
    });
});
setAgentProjectEmitter((userId, project) => {
    const message = JSON.stringify({ type: "project.updated", data: project });
    clients.get(userId)?.forEach((client) => {
        if (client.readyState === WebSocketClient.OPEN) client.send(message);
    });
});
setCreativeAssetEmitter((userId, asset) => {
    const message = JSON.stringify({ type: "creative_asset.updated", data: asset });
    clients.get(userId)?.forEach((client) => {
        if (client.readyState === WebSocketClient.OPEN) client.send(message);
    });
});
setVisualStyleEmitter((userId, style) => {
    const message = JSON.stringify({ type: "visual_style.updated", data: style });
    clients.get(userId)?.forEach((client) => {
        if (client.readyState === WebSocketClient.OPEN) client.send(message);
    });
});

resumeGenerations();
recoverAgentRuns();
cleanupUnreferencedFiles();
setInterval(cleanupUnreferencedFiles, 60 * 60 * 1000).unref();

server.on("listening", () => {
    if (config.socketPath) chmodSync(config.socketPath, 0o660);
    const target = config.socketPath || `http://127.0.0.1:${config.port}`;
    process.stdout.write(`Infinite Canvas server listening on ${target}${config.basePath}\n`);
});

function websocketUser(request: IncomingMessage) {
    if (config.authMode === "dev") return { id: config.devUserId, username: config.devUsername, isAdmin: true };
    return parseGatewayUser(request.headers);
}
