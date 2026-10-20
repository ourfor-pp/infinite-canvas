import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { videoContractFor } from "../../../../server/src/video-contract";
import { VideoSettingsPanel, videoSecondsLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig, useConfigStore, type AiModelOption } from "@/stores/use-config-store";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";

const model: AiModelOption = { id: "flashvsr-turbo-local", name: "FlashVSR Turbo", value: "quality:test", providerId: "test", providerName: "测试", output: "video", inputs: ["video"], enabled: true, videoContract: videoContractFor({ id: "flashvsr-turbo-local", endpoint: "openai-video" }) };
const config = { ...defaultConfig, model: model.value, size: "", vquality: "4k", videoSeconds: "undefined" };
const summary = (videoSeconds = config.videoSeconds) => renderToStaticMarkup(<CanvasVideoSettingsPopover config={{ ...config, videoSeconds }} onConfigChange={vi.fn()} />);

afterEach(() => useConfigStore.getState().hydrateModels([]));

describe("视频参数中的时长", () => {
    it.each([undefined, "", "undefined", "NaN", "0"])("不展示无效时长 %s", (value) => {
        expect(videoSecondsLabel(value)).toBe("");
    });

    it("正常视频保留有效时长，无时长选项时隐藏旧值", () => {
        useConfigStore.getState().hydrateModels([{ ...model, videoContract: { ...model.videoContract!, family: "h3", seconds: [] } }]);
        expect(summary()).not.toContain("undefineds");
        expect(summary("6")).not.toContain("6s");
        useConfigStore.getState().hydrateModels([{ ...model, videoContract: { ...model.videoContract!, family: "h3", seconds: [6] } }]);
        expect(summary("6")).toContain("4k · 6s");
    });

    it.each(["flashvsr-turbo-local", "seedvr2-local"])("%s 只显示分辨率和帧率", (id) => {
        useConfigStore.getState().hydrateModels([{ ...model, id, videoContract: videoContractFor({ id, endpoint: "openai-video" }) }]);
        expect(summary()).toContain("4K · 48 FPS");
        expect(summary()).not.toContain("undefined");
        const panel = renderToStaticMarkup(<VideoSettingsPanel config={config} onConfigChange={vi.fn()} theme={canvasThemes.light} />);
        expect(panel).toContain('aria-label="目标分辨率"');
        expect(panel).toContain('aria-label="目标帧率"');
        expect(panel).not.toContain('aria-label="时长"');
        expect(panel).not.toContain("参考素材用于内容引导");
    });
});
