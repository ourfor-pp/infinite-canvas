import type { DragEvent } from "react";
import { serverFileUrl } from "@/services/api/server";

const CANVAS_IMAGE_MIME = "application/x-infinite-canvas-image";

export function startCanvasImageDrag(event: DragEvent<HTMLElement>, fileId: string, title: string) {
    if (!fileId) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(CANVAS_IMAGE_MIME, JSON.stringify({ fileId, title }));
    event.dataTransfer.setData("text/uri-list", serverFileUrl(`server:${fileId}`));
}

export function readCanvasImageDrag(dataTransfer: DataTransfer): { url: string; name: string } | null {
    const raw = dataTransfer.getData(CANVAS_IMAGE_MIME);
    if (!raw) return null;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value.fileId !== "string" || !value.fileId) return null;
        return { url: serverFileUrl(`server:${value.fileId}`), name: typeof value.title === "string" && value.title ? value.title : "对话图片" };
    } catch {
        return null;
    }
}
