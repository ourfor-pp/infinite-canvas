import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { VisualStyleTemplate } from "@/types/visual-style";
import { shouldStopVisualStyleNodePointer, TemplatePickerModal } from "./visual-style-node";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;

const template: VisualStyleTemplate = {
    id: "cinematic",
    name: "克制当代电影",
    category: "cinematic",
    tagline: "真实、安静",
    colors: ["#111", "#777", "#eee"],
    description: "克制的当代电影质感",
    preview: "/visual-styles/cinematic.webp",
    dna: { medium: "电影", rendering: "写实", palette: "低饱和", lighting: "自然光", contrast: "柔和", texture: "胶片", lensAndDepth: "浅景深", composition: "克制", postProcessing: "轻颗粒", exclusions: [] },
};

describe("视觉风格模板弹窗", () => {
    it("Portal 内的关闭和模板选择不会被风格节点捕获事件拦截", async () => {
        const close = vi.fn();
        const select = vi.fn();
        const canvasPointerDown = vi.fn();
        const canvasMouseDown = vi.fn();
        const canvasClick = vi.fn();
        const canvasWheel = vi.fn();
        const holder = document.createElement("div");
        document.body.append(holder);
        const root = createRoot(holder);
        await act(async () => root.render(<div onPointerDown={canvasPointerDown} onMouseDown={canvasMouseDown} onClick={canvasClick} onWheel={canvasWheel}><article onMouseDownCapture={(event) => { if (shouldStopVisualStyleNodePointer(event.target)) event.stopPropagation(); }}><TemplatePickerModal open templates={[template]} selectedId={null} onClose={close} onSelect={select} /></article></div>));

        const closeButton = document.querySelector(".ant-modal-close") as HTMLButtonElement;
        await act(async () => {
            closeButton.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
            closeButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            closeButton.click();
            closeButton.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        });
        expect(close).toHaveBeenCalledOnce();
        await act(async () => (document.querySelector('[data-testid="visual-style-template-cinematic"]') as HTMLButtonElement).click());
        expect(select).toHaveBeenCalledWith("cinematic");
        expect(canvasPointerDown).not.toHaveBeenCalled();
        expect(canvasMouseDown).not.toHaveBeenCalled();
        expect(canvasClick).not.toHaveBeenCalled();
        expect(canvasWheel).not.toHaveBeenCalled();

        await act(async () => root.unmount());
        holder.remove();
    });
});
