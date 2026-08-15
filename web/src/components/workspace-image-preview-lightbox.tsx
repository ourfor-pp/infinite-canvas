import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { App } from "antd";
import { ChevronLeft, ChevronRight, Copy, Download, Minus, Plus, RotateCcw, X } from "lucide-react";

import { copyPreviewImage, downloadPreviewImage } from "@/lib/image-preview-actions";
import styles from "./workspace-image-preview-lightbox.module.css";

export type WorkspaceImagePreviewItem = { id: string; url: string; alt: string };
type Point = { x: number; y: number };
type ViewTransform = { zoom: number; pan: Point };
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

function wrapped(index: number, total: number) { return index < 0 ? total - 1 : index >= total ? 0 : index; }
function clampZoom(value: number) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2)))); }

export function WorkspaceImagePreviewLightbox({ items, activeIndex, onClose, onChangeIndex }: { items: WorkspaceImagePreviewItem[]; activeIndex: number | null; onClose: () => void; onChangeIndex: (index: number) => void }) {
    const { message } = App.useApp();
    const current = activeIndex === null ? undefined : items[activeIndex];
    const [view, setView] = useState<ViewTransform>({ zoom: 1, pan: { x: 0, y: 0 } });
    const [dragging, setDragging] = useState(false);
    const [menu, setMenu] = useState<Point | null>(null);
    const [busy, setBusy] = useState<"copy" | "download" | "">("");
    const dragStart = useRef<Point | null>(null);
    const panStart = useRef<Point>({ x: 0, y: 0 });

    const { zoom, pan } = view;
    const reset = useCallback(() => setView({ zoom: 1, pan: { x: 0, y: 0 } }), []);
    const changeZoom = useCallback((delta: number, focus: Point = { x: 0, y: 0 }) => {
        setView((current) => {
            const zoom = clampZoom(current.zoom + delta);
            return { zoom, pan: { x: focus.x - ((focus.x - current.pan.x) / current.zoom) * zoom, y: focus.y - ((focus.y - current.pan.y) / current.zoom) * zoom } };
        });
    }, []);

    useEffect(() => { reset(); setDragging(false); setMenu(null); }, [current?.id, current?.url, reset]);
    useEffect(() => {
        if (!current) return;
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
            if (items.length > 1 && event.key === "ArrowLeft") onChangeIndex(wrapped((activeIndex || 0) - 1, items.length));
            if (items.length > 1 && event.key === "ArrowRight") onChangeIndex(wrapped((activeIndex || 0) + 1, items.length));
        };
        window.addEventListener("keydown", keydown);
        return () => window.removeEventListener("keydown", keydown);
    }, [activeIndex, current, items.length, onChangeIndex, onClose]);

    if (!current || typeof document === "undefined") return null;
    const run = async (kind: "copy" | "download") => {
        if (busy) return;
        setBusy(kind); setMenu(null);
        try {
            if (kind === "copy") { await copyPreviewImage(current); message.success("已复制图片到剪贴板"); }
            else { await downloadPreviewImage(current); message.success("图片下载已开始"); }
        } catch (error) { message.error(error instanceof Error ? error.message : `${kind === "copy" ? "复制" : "下载"}图片失败`); }
        finally { setBusy(""); }
    };
    const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest("button") || event.button !== 0 || event.ctrlKey) return;
        event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
        dragStart.current = { x: event.clientX, y: event.clientY }; panStart.current = pan; setDragging(true); setMenu(null);
    };
    const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!dragStart.current) return;
        setView((current) => ({ zoom: current.zoom, pan: { x: panStart.current.x + event.clientX - dragStart.current!.x, y: panStart.current.y + event.clientY - dragStart.current!.y } }));
    };
    const pointerUp = (event: PointerEvent<HTMLDivElement>) => { if (dragStart.current) event.currentTarget.releasePointerCapture?.(event.pointerId); dragStart.current = null; setDragging(false); };
    const multiple = items.length > 1;
    return createPortal(<div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`查看${current.alt}`}>
        <section className={styles.dialog}>
            <header className={styles.header}>
                <div className={styles.title}><strong>{current.alt}</strong><span>{activeIndex! + 1} / {items.length}</span></div>
                <div className={styles.actions}>
                    <div className={styles.zoom} aria-label="图片缩放控制">
                        <button className={styles.button} disabled={zoom <= MIN_ZOOM} aria-label="缩小图片" onClick={() => changeZoom(-ZOOM_STEP)}><Minus className="size-4" /></button>
                        <button className={styles.zoomValue} aria-label="重置图片缩放" onClick={reset}>{Math.round(zoom * 100)}%</button>
                        <button className={styles.button} disabled={zoom >= MAX_ZOOM} aria-label="放大图片" onClick={() => changeZoom(ZOOM_STEP)}><Plus className="size-4" /></button>
                    </div>
                    <button className={styles.action} disabled={Boolean(busy)} aria-label="复制图片" onClick={() => void run("copy")}><Copy className="size-4" /><span>复制</span></button>
                    <button className={styles.action} disabled={Boolean(busy)} aria-label="下载图片" onClick={() => void run("download")}><Download className="size-4" /><span>下载</span></button>
                    <button className={styles.button} disabled={zoom === 1 && pan.x === 0 && pan.y === 0} aria-label="恢复原始大小" onClick={reset}><RotateCcw className="size-4" /></button>
                    <button className={styles.button} aria-label="关闭图片预览" onClick={onClose}><X className="size-4" /></button>
                </div>
            </header>
            <div className={styles.viewer} role="region" aria-label="图片预览画布" data-dragging={dragging || undefined} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={() => setMenu(null)} onWheel={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); changeZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }); }}>
                {multiple ? <button className={`${styles.button} ${styles.nav} ${styles.previous}`} aria-label="查看上一张图片" onClick={() => onChangeIndex(wrapped(activeIndex! - 1, items.length))}><ChevronLeft className="size-5" /></button> : null}
                <div className={styles.stage}><img className={styles.image} src={current.url} alt={current.alt} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} onContextMenu={(event) => { event.preventDefault(); const rect = event.currentTarget.closest('[role="region"]')?.getBoundingClientRect(); if (rect) setMenu({ x: Math.max(12, Math.min(event.clientX - rect.left, rect.width - 164)), y: Math.max(12, Math.min(event.clientY - rect.top, rect.height - 104)) }); }} /></div>
                {multiple ? <button className={`${styles.button} ${styles.nav} ${styles.next}`} aria-label="查看下一张图片" onClick={() => onChangeIndex(wrapped(activeIndex! + 1, items.length))}><ChevronRight className="size-5" /></button> : null}
                {menu ? <div className={styles.menu} role="menu" aria-label="图片快捷菜单" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><button role="menuitem" onClick={() => void run("copy")}><Copy className="size-4" />复制图片</button><button role="menuitem" onClick={() => void run("download")}><Download className="size-4" />下载图片</button></div> : null}
            </div>
            <footer className={styles.footer}><span>{current.alt}</span><span>滚轮缩放，拖动画布平移；点击比例恢复 100%，Esc 关闭，方向键切换</span></footer>
        </section>
    </div>, document.body);
}
