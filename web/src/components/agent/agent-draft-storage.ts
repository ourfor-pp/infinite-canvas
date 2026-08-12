import localforage from "localforage";
import type { AgentComposerDocument } from "@/services/api/agent";
import type { ServerFile } from "@/services/api/server";

export type AgentDraft = { version: 1; document: AgentComposerDocument; attachments: ServerFile[]; followUpMode: "steer" | "queue" };
const drafts = localforage.createInstance({ name: "infinite-canvas", storeName: "agent_drafts" });
export const agentDraftStorage = {
    get(scope: string) { return drafts.getItem<AgentDraft>(scope); },
    set(scope: string, value: AgentDraft) { return drafts.setItem(scope, value); },
    remove(scope: string) { return drafts.removeItem(scope); },
};
