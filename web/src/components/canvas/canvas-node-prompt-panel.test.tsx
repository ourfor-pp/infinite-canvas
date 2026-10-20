import { App } from "antd";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { videoContractFor } from "../../../../server/src/video-contract";
import { serverApi } from "@/services/api/server";
import { useConfigStore, type AiModelOption } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { CanvasNodePromptPanel } from "./canvas-node-prompt-panel";

vi.mock("./canvas-prompt-library", () => ({ CanvasPromptLibrary: () => <button>提示词库</button> }));

const quality: AiModelOption = { id: "flashvsr-turbo-local", name: "FlashVSR Turbo", value: "local-media::flashvsr-turbo-local", providerId: "local-media", providerName: "本地媒体执行器", output: "video", inputs: ["video"], enabled: true, videoContract: videoContractFor({ id: "flashvsr-turbo-local", endpoint: "openai-video" }) };
const normal: AiModelOption = { ...quality, id: "normal", value: "test::normal", name: "普通视频", videoContract: { ...quality.videoContract!, family: "openai", sizes: ["1280x720"], seconds: [6] } };
const node: CanvasNodeData = { id: "test", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { model: quality.value, content: "/source.mp4", prompt: "之前生成视频的提示词", seconds: "undefined", vquality: "1080p" } };

afterEach(() => { cleanup(); useConfigStore.getState().hydrateModels([]); });

describe("视频提质编辑器", () => {
    it("刷新旧能力后隐藏提示词与普通生成校验，提交空提示词，切回生成恢复输入", async () => {
        useConfigStore.getState().hydrateModels([{ ...quality, videoContract: { ...quality.videoContract!, family: "openai" } }, normal]);
        const refresh = vi.spyOn(serverApi, "aiModels").mockResolvedValue([quality, normal]);
        const onGenerate = vi.fn();
        const props = { node, isRunning: false, onPromptChange: vi.fn(), onConfigChange: vi.fn(), onGenerate, onStop: vi.fn() };
        const view = render(<App><CanvasNodePromptPanel {...props} /></App>);
        await waitFor(() => expect(view.container.textContent).toContain("对上方源视频超分并补帧"));
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
        expect(view.container.textContent).not.toContain("提示词库");
        expect(view.container.querySelector('[role="status"]')).toBeNull();
        const generate = view.getByRole("button", { name: /^生成$/ });
        expect((generate as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(generate);
        expect(onGenerate).toHaveBeenCalledWith("test", "video", "", expect.objectContaining({ model: quality.value }));
        view.rerender(<App><CanvasNodePromptPanel {...props} node={{ ...node, metadata: { ...node.metadata, model: normal.value, size: "1280x720", seconds: "6" } }} /></App>);
        expect(view.container.querySelector('[contenteditable="true"]')).not.toBeNull();
        expect(view.container.textContent).toContain("之前生成视频的提示词");
        expect(view.container.textContent).toContain("提示词库");
    });
});
