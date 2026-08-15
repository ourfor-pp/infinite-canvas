import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceImagePreviewLightbox } from "./workspace-image-preview-lightbox";

const actions = vi.hoisted(() => ({ copy: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/image-preview-actions", () => ({ copyPreviewImage: actions.copy, downloadPreviewImage: actions.download }));

const items = [{ id: "one", url: "/one.png", alt: "角色一" }, { id: "two", url: "/two.png", alt: "角色二" }];

describe("WorkspaceImagePreviewLightbox", () => {
    beforeEach(() => { actions.copy.mockReset(); actions.download.mockReset(); });
    afterEach(cleanup);

    it("支持缩放、恢复和键盘切换", () => {
        const close = vi.fn(); const change = vi.fn();
        render(<App><WorkspaceImagePreviewLightbox items={items} activeIndex={0} onClose={close} onChangeIndex={change} /></App>);
        fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
        expect(screen.getByRole("button", { name: "重置图片缩放" }).textContent).toBe("125%");
        expect(screen.getByRole("img", { name: "角色一" }).getAttribute("style")).toContain("scale(1.25)");
        fireEvent.click(screen.getByRole("button", { name: "恢复原始大小" }));
        expect(screen.getByRole("button", { name: "重置图片缩放" }).textContent).toBe("100%");
        fireEvent.keyDown(window, { key: "ArrowRight" }); expect(change).toHaveBeenCalledWith(1);
        fireEvent.keyDown(window, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
    });

    it("顶部和右键菜单提供复制与下载", async () => {
        actions.copy.mockResolvedValue(undefined); actions.download.mockResolvedValue(undefined);
        render(<App><WorkspaceImagePreviewLightbox items={items} activeIndex={0} onClose={vi.fn()} onChangeIndex={vi.fn()} /></App>);
        fireEvent.click(screen.getByRole("button", { name: "复制图片" }));
        await vi.waitFor(() => expect(actions.copy).toHaveBeenCalledWith(items[0]));
        fireEvent.contextMenu(screen.getByRole("img", { name: "角色一" }), { clientX: 120, clientY: 80 });
        fireEvent.click(screen.getByRole("menuitem", { name: "下载图片" }));
        await vi.waitFor(() => expect(actions.download).toHaveBeenCalledWith(items[0]));
    });
});
