import { memo, useEffect, useRef, useState } from "react";
import type { PrevisPlan, PrevisScene } from "@/types/previs";
import type { createPrevisRenderer } from "../../../../server/src/previs/renderer";

export const PrevisViewport = memo(function PrevisViewport({ scene, plan, time, aspectRatio, onSelect }: { scene: PrevisScene; plan: PrevisPlan; time: number; aspectRatio: string; onSelect: (id?: string) => void }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const engine = useRef<ReturnType<typeof createPrevisRenderer> | null>(null);
    const timeRef = useRef(time); timeRef.current = time;
    const [error, setError] = useState("");
    useEffect(() => {
        let cancelled = false;
        setError("");
        void import("../../../../server/src/previs/renderer").then(({ createPrevisRenderer }) => {
            if (cancelled || !canvas.current) return;
            const [w, h] = aspectRatio.split(":").map(Number), ratio = w / h;
            engine.current = createPrevisRenderer(canvas.current, { scene, plan }, Math.round((ratio >= 1 ? 480 * ratio : 480) / 2) * 2, Math.round((ratio >= 1 ? 480 : 480 / ratio) / 2) * 2);
            engine.current.render(timeRef.current);
        }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "当前浏览器无法显示三维预演"); });
        return () => { cancelled = true; engine.current?.dispose(); engine.current = null; };
    }, [scene, plan, aspectRatio]);
    useEffect(() => { if (engine.current) { try { engine.current.render(time); } catch (reason) { setError((reason as Error).message); } } }, [time]);
    return <div className="flex h-full min-h-48 items-center justify-center overflow-hidden bg-slate-50">
        {error && <p role="alert" className="p-5 text-xs text-rose-600">{error}</p>}<canvas ref={canvas} aria-label="三维预演画面" className="block max-h-[55vh] max-w-full cursor-crosshair object-contain" style={{ display: error ? "none" : undefined, aspectRatio: aspectRatio.replace(":", "/"), width: "100%" }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(), ratio = event.currentTarget.width / event.currentTarget.height; const w = Math.min(rect.width, rect.height * ratio), h = w / ratio, x = event.clientX - rect.left - (rect.width - w) / 2, y = event.clientY - rect.top - (rect.height - h) / 2; onSelect(x >= 0 && x <= w && y >= 0 && y <= h ? engine.current?.pick(x / w * 2 - 1, 1 - y / h * 2) : undefined); }} />
    </div>;
});
