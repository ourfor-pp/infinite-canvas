import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { MediaEditor } from "./media-editor";
import type { MediaEditorTarget } from "./types";

export function MediaEditorPopover({ anchorRef, open, onClose, target }: { anchorRef: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; target: MediaEditorTarget }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panelRef = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    useEffect(() => {
        if (!open) return;
        const eventName = "infinite-canvas:media-editor-open";
        const closeOther = (event: Event) => { if ((event as CustomEvent<string>).detail !== target.key) onClose(); };
        const sync = () => setRect(anchorRef.current?.getBoundingClientRect() || null);
        const outside = (event: PointerEvent) => {
            const node = event.target;
            if (!(node instanceof Node) || anchorRef.current?.contains(node) || panelRef.current?.contains(node) || (node instanceof Element && node.closest("[role=listbox],[data-canvas-resource-mention-menu],.ant-select-dropdown,.media-image-preview,.ant-image-preview-root,.ant-image-preview-wrap,.ant-image-preview-mask,.ant-image-preview-close,.ant-image-preview-operations-wrapper,.ant-popover"))) return;
            onClose();
        };
        window.dispatchEvent(new CustomEvent(eventName, { detail: target.key }));
        sync();
        window.addEventListener(eventName, closeOther);
        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);
        window.addEventListener("pointerdown", outside, true);
        return () => { window.removeEventListener(eventName, closeOther); window.removeEventListener("resize", sync); window.removeEventListener("scroll", sync, true); window.removeEventListener("pointerdown", outside, true); };
    }, [anchorRef, onClose, open, target.key]);
    if (!open || !rect) return null;
    const width = Math.min(960, window.innerWidth - 32);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2));
    const below = window.innerHeight - rect.bottom > 420 || rect.top < 420;
    return createPortal(<div ref={panelRef} data-testid="media-editor-popover" className="fixed z-[1180] max-h-[min(720px,calc(100dvh-24px))] overflow-y-auto rounded-[20px] border p-4 shadow-[0_24px_70px_rgba(15,23,42,.2)]" style={{ width, left, ...(below ? { top: Math.min(window.innerHeight - 12, rect.bottom + 10) } : { bottom: window.innerHeight - rect.top + 10 }), backgroundColor: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}><MediaEditor target={target} /></div>, document.body);
}
