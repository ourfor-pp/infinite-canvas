import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import {
    cancelRunByAdmin,
    cancelSession,
    createSession,
    deleteSession,
    forkSession,
    getAgentSettings,
    getConversation,
    getSessionEvents,
    getTurnIndex,
    listQueuedMessages,
    listAdminRuns,
    listSkills,
    respondDecision,
    respondClientAction,
    saveAgentSettings,
    sendMessage,
    steerQueuedMessage,
    retryQueuedMessage,
    deleteQueuedMessage,
    subscribeConversation,
    testAgentSettings,
} from "./service.js";

const id = z.string().trim().min(1).max(128);

export const agentRouter = Router();
export const agentAdminRouter = Router();

agentRouter.get("/config", route(() => {
    const settings = getAgentSettings();
    return { ready: settings.ready, modelName: settings.modelName || "", providerName: settings.providerName || "", protocolVersion: 3, storageVersion: 2 };
}));
agentRouter.get("/skills", route(() => listSkills()));
agentRouter.get("/projects/:projectId/conversation", route((req) => getConversation(req.user.id, routeParam(req, "projectId"), optionalId(req.query.sessionId))));
agentRouter.get("/sessions/:id/events", route((req) => getSessionEvents(req.user.id, routeParam(req, "id"), optionalPositiveInt(req.query.beforeSeq), optionalPositiveInt(req.query.limit))));
agentRouter.get("/sessions/:id/turn-index", route((req) => getTurnIndex(req.user.id, routeParam(req, "id"))));
agentRouter.get("/sessions/:id/queued-messages", route((req) => listQueuedMessages(req.user.id, routeParam(req, "id"))));
agentRouter.post("/sessions/:id/queued-messages/:messageId/steer", asyncRoute((req) => steerQueuedMessage(req.user.id, routeParam(req, "id"), routeParam(req, "messageId"))));
agentRouter.post("/sessions/:id/queued-messages/:messageId/retry", route((req) => retryQueuedMessage(req.user.id, routeParam(req, "id"), routeParam(req, "messageId"))));
agentRouter.delete("/sessions/:id/queued-messages/:messageId", route((req) => deleteQueuedMessage(req.user.id, routeParam(req, "id"), routeParam(req, "messageId"))));
agentRouter.post("/projects/:projectId/sessions", route((req) => createSession(req.user.id, routeParam(req, "projectId"), String(req.body?.title || "新对话")), 201));
agentRouter.post("/projects/:projectId/messages", asyncRoute((req) => sendMessage(req.user.id, routeParam(req, "projectId"), req.body), 202));
agentRouter.get("/projects/:projectId/stream", (req, res, next) => {
    try {
        const projectId = routeParam(req, "projectId");
        getConversation(req.user.id, projectId);
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        const clientId = req.query.clientId === undefined ? "" : id.parse(String(req.query.clientId));
        const unsubscribe = subscribeConversation(req.user.id, projectId, clientId, (event) => {
            res.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => res.write(`event: keepalive\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`), 15_000);
        req.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    } catch (error) { next(error); }
});
agentRouter.post("/sessions/:id/fork", route((req) => forkSession(req.user.id, routeParam(req, "id"), z.object({ fromEventSeq: z.number().int().positive().optional() }).parse(req.body || {}).fromEventSeq), 201));
agentRouter.delete("/sessions/:id", route((req) => deleteSession(req.user.id, routeParam(req, "id"))));
agentRouter.post("/sessions/:id/cancel", asyncRoute((req) => cancelSession(req.user.id, routeParam(req, "id"))));
agentRouter.post("/sessions/:id/approval", route((req) => respondDecision(req.user.id, routeParam(req, "id"), z.object({ decision: z.enum(["approved", "rejected"]), scope: z.enum(["once", "session", "project"]).optional(), comment: z.string().max(20_000).optional(), answers: z.record(z.string(), z.string()).optional(), proposalEdits: z.unknown().optional() }).parse(req.body))));
agentRouter.post("/sessions/:id/client-result", route((req) => respondClientAction(req.user.id, routeParam(req, "id"), z.object({ actionId: z.string(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().max(2000).optional() }).parse(req.body))));

agentAdminRouter.get("/ai/agent", requireAdmin, route(() => getAgentSettings()));
agentAdminRouter.put("/ai/agent", requireAdmin, route((req) => saveAgentSettings(req.body)));
agentAdminRouter.post("/ai/agent/test", requireAdmin, asyncRoute((req) => testAgentSettings(req.body)));
agentAdminRouter.get("/agent/runs", requireAdmin, route(() => listAdminRuns()));
agentAdminRouter.post("/agent/runs/:id/cancel", requireAdmin, asyncRoute((req) => cancelRunByAdmin(routeParam(req, "id"))));

function routeParam(req: Request, name: string) {
    const value = req.params[name];
    return id.parse(Array.isArray(value) ? value[0] : value);
}

function optionalId(value: unknown) {
    return value === undefined ? undefined : id.parse(String(value));
}

function optionalPositiveInt(value: unknown) {
    if (value === undefined) return undefined;
    return z.coerce.number().int().positive().parse(value);
}

function route(handler: (req: Request) => unknown, status = 200) {
    return (req: Request, res: Response, next: NextFunction) => {
        try { res.status(status).json({ data: handler(req) }); } catch (error) { next(error); }
    };
}

function asyncRoute(handler: (req: Request) => Promise<unknown>, status = 200) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req).then((data) => res.status(status).json({ data })).catch(next);
}
