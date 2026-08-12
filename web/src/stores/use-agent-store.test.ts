import { describe, expect, it } from "vitest";

import { EMPTY_AGENT_ENTITY_REFERENCES, selectAgentEntityReferences, type AgentEntityReference } from "./use-agent-store";

describe("selectAgentEntityReferences", () => {
    it("缺少项目引用时始终返回同一个空快照，避免 useSyncExternalStore 无限更新", () => {
        const state = { entityReferences: {} };
        const first = selectAgentEntityReferences(state, "project-1");
        const second = selectAgentEntityReferences(state, "project-1");

        expect(first).toBe(EMPTY_AGENT_ENTITY_REFERENCES);
        expect(second).toBe(first);
    });

    it("已有引用时直接返回 store 中的稳定数组", () => {
        const references: AgentEntityReference[] = [{ kind: "asset", projectId: "project-1", assetId: "asset-1", title: "林夏", subtitle: "角色" }];
        const state = { entityReferences: { "project-1": references } };

        expect(selectAgentEntityReferences(state, "project-1")).toBe(references);
    });
});
