import { memo, useEffect, useRef, useState } from "react";
import type { PrevisPlan, PrevisScene } from "@/types/previs";
import type { createPrevisRenderer } from "../../../../server/src/previs/renderer";

export const PrevisViewport = memo(function PrevisViewport({ scene, plan, time, aspectRatio, onSelect }: { scene: PrevisScene; plan: PrevisPlan; time: number; aspectRatio: string; onSelect: (id?: string) => void }) {
    const surface = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement | null>(null);
    const engine = useRef<ReturnType<typeof createPrevisRenderer> | null>(null);
    const timeRef = useRef(time); timeRef.current = time;
    const [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        let view: HTMLCanvasElement | undefined;
        let renderer: ReturnType<typeof createPrevisRenderer> | undefined;
        setError("");
        void import("../../../../server/src/previs/renderer").then(({ createPrevisRenderer }) => {
            if (cancelled || !surface.current) return;
            const [w, h] = aspectRatio.split(":").map(Number), ratio = w / h;
            // dispose() loses the old WebGL context; each renderer needs its own canvas.
            view = document.createElement("canvas");
            view.setAttribute("aria-label", "三维预演画面");
            view.className = "block max-h-[55vh] max-w-full cursor-crosshair object-contain";
            Object.assign(view.style, { aspectRatio: aspectRatio.replace(":", "/"), width: "100%" });
            surface.current.append(view); canvas.current = view;
            renderer = createPrevisRenderer(view, { scene, plan }, Math.round((ratio >= 1 ? 480 * ratio : 480) / 2) * 2, Math.round((ratio >= 1 ? 480 : 480 / ratio) / 2) * 2);
            engine.current = renderer;
            renderer.render(timeRef.current);
        }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "当前浏览器无法显示三维预演"); });
        return () => { cancelled = true; renderer?.dispose(); view?.remove(); engine.current = null; canvas.current = null; };
    }, [scene, plan, aspectRatio]);
    useEffect(() => { if (engine.current) { try { engine.current.render(time); } catch (reason) { setError((reason as Error).message); } } }, [time]);
    return <div className="flex h-full min-h-48 items-center justify-center overflow-hidden bg-slate-50">
        {error && <p role="alert" className="p-5 text-xs text-rose-600">{error}</p>}<div ref={surface} className="flex w-full justify-center" style={{ display: error ? "none" : undefined }} onClick={(event) => { const view = canvas.current; if (!view) return; const rect = view.getBoundingClientRect(), ratio = view.width / view.height; const w = Math.min(rect.width, rect.height * ratio), h = w / ratio, x = event.clientX - rect.left - (rect.width - w) / 2, y = event.clientY - rect.top - (rect.height - h) / 2; onSelect(x >= 0 && x <= w && y >= 0 && y <= h ? engine.current?.pick(x / w * 2 - 1, 1 - y / h * 2) : undefined); }} />
    </div>;
});
