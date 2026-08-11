import type { Request } from "express";

export type CurrentUser = { id: string; username: string; isAdmin: boolean };
export type AuthenticatedRequest = Request & { user: CurrentUser };

declare global {
    namespace Express {
        interface Request {
            user: CurrentUser;
        }
    }
}

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
