import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Settings2 } from "lucide-react";
import { Button } from "antd";

import { CanvasImageSizeSettings, imageSizeOption } from "./canvas-image-size-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasImageSettingsPopoverProps = {
    imageMode?: "generate" | "edit";
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
    appearance?: "default" | "toolbar";
};

export function CanvasImageSettingsPopover({ config, imageMode, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", appearance = "default" }: CanvasImageSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const size = imageSizeOption(config.size || "auto");
    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            setOpen(false);
            onOpenChange?.(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [onOpenChange, open]);

    const panel = open && buttonRect ? <ImageSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} imageMode={imageMode} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0 shrink-0">
                <Button data-control-appearance={appearance} size="small" type="text" className={appearance === "toolbar" ? `!h-9 !max-w-none !justify-start !rounded-lg !border-0 !bg-transparent !px-2 !shadow-none hover:!bg-black/5 dark:hover:!bg-white/10 ${buttonClassName || ""}` : buttonClassName || "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"} style={{ background: appearance === "toolbar" ? "transparent" : theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-4" />} onClick={() => updateOpen(!open)}>
                    <span className="truncate">
                        {[size.resolution, size.ratio === "auto" ? "自动" : size.ratio].filter(Boolean).join(" · ")}
                    </span>
                    {appearance === "toolbar" ? <ChevronDown className={`ml-0.5 size-3.5 shrink-0 opacity-45 transition-transform ${open ? "rotate-180" : ""}`} /> : null}
                </Button>
            </span>
            {panel}
        </>
    );
}

function ImageSettingsPortal({
    buttonRect,
    imageMode,
    panelRef,
    placement,
    theme,
    config,
    onConfigChange,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    imageMode?: "generate" | "edit";
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    const width = 356;
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),
        background: theme.node.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            data-canvas-floating-control
            className="canvas-image-settings-popover"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <CanvasImageSizeSettings config={config} imageMode={imageMode} onConfigChange={onConfigChange} theme={theme} />
        </div>,
        document.body,
    );
}
