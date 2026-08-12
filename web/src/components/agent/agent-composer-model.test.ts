import { describe, expect, it } from "vitest";
import { composerHasContent, composerPlainText, normalizeComposerDocument, parseComposer, serializeComposer } from "./agent-composer-model";

describe("agent composer model", () => {
    it("keeps multiple semantic mentions during persistence", () => {
        const document = normalizeComposerDocument({ version: 1, segments: [{ type: "text", text: "请用 " }, { type: "skill", mentionId: "1", skillId: "story", label: "写故事" }, { type: "text", text: " 修改 " }, { type: "asset", mentionId: "2", projectId: "p", assetId: "a", label: "温伯" }] });
        expect(parseComposer(serializeComposer(document))).toEqual(document); expect(composerPlainText(document)).toBe("请用 /写故事 修改 @温伯"); expect(composerHasContent(document)).toBe(true);
    });
});
