import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/stores/use-config-store";
import { MediaEditor } from "./media-editor";
import type { MediaEditorTarget } from "./types";

vi.mock("@/components/model-picker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/canvas/canvas-image-settings-popover", () => ({ CanvasImageSettingsPopover: () => null }));
vi.mock("@/components/canvas/canvas-prompt-chip-input", () => ({ CanvasPromptChipInput: () => <textarea aria-label="提示词" /> }));
afterEach(cleanup);

function setup() {
    const uploadReference = vi.fn().mockResolvedValue(undefined);
    const onPaste = vi.fn();
    const onDrop = vi.fn();
    const target: MediaEditorTarget = {
        key: "upload-test", kind: "image", title: "图片", semanticLabel: "调整图片", config: defaultConfig,
        snapshot: { draft: { prompt: "茶杯", model: "", params: {} }, references: [], variants: [] },
        saveDraft: vi.fn(), generate: vi.fn(), uploadReference,
    };
    const result = render(<App><div onPaste={onPaste} onDrop={onDrop}><MediaEditor target={target} /></div></App>);
    return { ...result, uploadReference, onPaste, onDrop };
}
const picture = () => new File(["image"], "cup.png", { type: "image/png" });

describe("媒体参考上传", () => {
    it("无参考图时仍显示唯一上传占位，并支持文件多选", async () => {
        const { container, uploadReference } = setup();
        expect(screen.getAllByRole("button", { name: "上传参考图" })).toHaveLength(1);
        expect(screen.getByLabelText("参考素材").contains(screen.getByRole("button", { name: "上传参考图" }))).toBe(true);
        const files = [picture(), picture()];
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
        await waitFor(() => expect(uploadReference).toHaveBeenCalledTimes(2));
    });
    it("拖入文件上传一次且不冒泡到画布", async () => {
        const { uploadReference, onDrop } = setup();
        fireEvent.drop(screen.getByLabelText("参考素材"), { dataTransfer: { files: [picture()] } });
        await waitFor(() => expect(uploadReference).toHaveBeenCalledTimes(1));
        expect(onDrop).not.toHaveBeenCalled();
    });
    it("在提示词里粘贴图片作为参考，不传给画布", async () => {
        const { uploadReference, onPaste } = setup();
        fireEvent.paste(screen.getByLabelText("提示词"), { clipboardData: { files: [picture()] } });
        await waitFor(() => expect(uploadReference).toHaveBeenCalledTimes(1));
        expect(onPaste).not.toHaveBeenCalled();
    });
    it("普通文字粘贴不被上传逻辑拦截", () => {
        const { uploadReference, onPaste } = setup();
        expect(fireEvent.paste(screen.getByLabelText("提示词"), { clipboardData: { files: [], getData: () => "文字" } })).toBe(true);
        expect(onPaste).toHaveBeenCalledOnce();
        expect(uploadReference).not.toHaveBeenCalled();
    });
    it("不匹配的文件不上传也不落入画布", () => {
        const { uploadReference, onDrop } = setup();
        fireEvent.drop(screen.getByLabelText("参考素材"), { dataTransfer: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
        expect(uploadReference).not.toHaveBeenCalled();
        expect(onDrop).not.toHaveBeenCalled();
    });
});
