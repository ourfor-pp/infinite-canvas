import { beforeEach, describe, expect, it } from "vitest";

import { defaultConfig, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { canGenerateMedia } from "./media-editor";
import type { MediaEditorDraft, MediaEditorTarget } from "./types";

describe("共享媒体编辑内核", () => {
    beforeEach(() => useConfigStore.getState().hydrateModels([
        { id: "speech", name: "语音", value: "p::speech", providerId: "p", providerName: "P", output: "audio", inputs: ["text"], enabled: true, audioModes: ["speech"] },
        { id: "sound", name: "声音", value: "p::sound", providerId: "p", providerName: "P", output: "audio", inputs: ["text"], enabled: true, audioModes: ["ambient", "sfx"] },
    ]));

    it("按角色声音、环境声和音效过滤模型", () => {
        expect(selectableModelsByCapability(defaultConfig, "audio", "speech")).toEqual(["p::speech"]);
        expect(selectableModelsByCapability(defaultConfig, "audio", "ambient")).toEqual(["p::sound"]);
        expect(selectableModelsByCapability(defaultConfig, "audio", "sfx")).toEqual(["p::sound"]);
    });

    it("角色语音需要试听台词，参考音频可以替代声音描述", () => {
        const snapshot: MediaEditorTarget["snapshot"] = { draft: {} as MediaEditorDraft, references: [], variants: [] };
        const target = { kind: "audio", snapshot, separateSpeechTranscript: true } as Pick<MediaEditorTarget, "kind" | "snapshot" | "separateSpeechTranscript">;
        expect(canGenerateMedia(target, { prompt: "低沉", transcript: "", model: "", params: {}, audioMode: "speech" })).toBe(false);
        expect(canGenerateMedia(target, { prompt: "低沉", transcript: "你好", model: "", params: {}, audioMode: "speech" })).toBe(true);
        snapshot.references = [{ id: "r", label: "参考", kind: "audio", source: "asset" }];
        expect(canGenerateMedia(target, { prompt: "", transcript: "你好", model: "", params: {}, audioMode: "speech" })).toBe(true);
    });

    it("基础音频节点继续把提示词作为待朗读文本", () => {
        const target = { kind: "audio", snapshot: { draft: {} as MediaEditorDraft, references: [], variants: [] } } as Pick<MediaEditorTarget, "kind" | "snapshot" | "separateSpeechTranscript">;
        expect(canGenerateMedia(target, { prompt: "请读出这句话", model: "", params: {}, audioMode: "speech" })).toBe(true);
    });

    it("业务图片可以只使用后端资产设定生成", () => {
        const target = { kind: "image", allowEmptyPrompt: true, snapshot: { draft: {} as MediaEditorDraft, references: [], variants: [] } } as Pick<MediaEditorTarget, "kind" | "snapshot" | "allowEmptyPrompt" | "separateSpeechTranscript">;
        expect(canGenerateMedia(target, { prompt: "", model: "", params: {} })).toBe(true);
    });
});
