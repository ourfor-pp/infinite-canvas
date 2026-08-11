import type { NextFunction, Request, Response } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { config } from "./config.js";
import { upsertUser } from "./database.js";

export function authenticate(req: Request, res: Response, next: NextFunction) {
    const user =
        config.authMode === "dev"
            ? { id: config.devUserId, username: config.devUsername, isAdmin: true }
            : parseGatewayUser(req.headers);
    if (!user) {
        res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "请先登录飞牛 fnOS" } });
        return;
    }
    req.user = user;
    upsertUser(user);
    next();
}

export function parseGatewayUser(headers: IncomingHttpHeaders) {
    const id = String(headers["x-trim-userid"] || "").trim();
    const username = String(headers["x-trim-username"] || "").trim();
    if (!id || id.length > 128 || !username || username.length > 200) return null;
    return { id, username, isAdmin: ["true", "1"].includes(String(headers["x-trim-isadmin"]).toLowerCase()) };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.user.isAdmin) {
        res.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "仅管理员可以执行此操作" } });
        return;
    }
    next();
}
