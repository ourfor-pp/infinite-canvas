import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented, Slider } from "antd";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { resolveUpscaleSize } from "@/lib/canvas/canvas-image-data";

export type CanvasSuperResolveParams = { mode: "faithful" | "generative"; targetLongEdge: number; sourceWidth: number; sourceHeight: number; denoise: number };

export function CanvasNodeSuperResolveDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasSuperResolveParams) => void }) {
    const { t } = useTranslation();
    const [source, setSource] = useState<{ width: number; height: number } | null>(null);
    const [mode, setMode] = useState<"faithful" | "generative">("faithful");
    const [targetLongEdge, setTargetLongEdge] = useState(2048);
    const [denoise, setDenoise] = useState(0.2);
    useEffect(() => { if (open) { setMode("faithful"); setDenoise(0.2); void readImageMeta(dataUrl).then((value) => { setSource(value); setTargetLongEdge([1024, 2048, 4096].find((edge) => edge > Math.max(value.width, value.height)) || 4096); }); } }, [dataUrl, open]);
    const output = useMemo(() => source ? resolveUpscaleSize(source.width, source.height, targetLongEdge) : null, [source, targetLongEdge]);
    const canSubmit = Boolean(source && Math.max(source.width, source.height) < targetLongEdge);
    return <Modal title={t("canvas.editors.aiUpscaleTitle")} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={780} centered destroyOnHidden>
        <div className="grid gap-6 md:grid-cols-[minmax(240px,1fr)_340px]">
            <div className="rounded-xl border p-4"><div className="grid min-h-72 place-items-center bg-black/5"><img src={dataUrl} alt="" className="max-h-80 max-w-full object-contain" /></div><div className="mt-3 text-center text-sm opacity-60">{source ? `${source.width} × ${source.height}` : t("canvas.editors.loading")}</div></div>
            <div className="space-y-5">
                <div><div className="mb-2 text-sm font-medium">{t("canvas.editors.processMode")}</div><Segmented block value={mode} options={[{ label: t("canvas.editors.faithfulUpscale"), value: "faithful" }, { label: t("canvas.editors.detailEnhance"), value: "generative" }]} onChange={(value) => setMode(value as typeof mode)} /><p className="mt-2 text-xs leading-5 opacity-55">{t(mode === "faithful" ? "canvas.editors.faithfulUpscaleDescription" : "canvas.editors.detailEnhanceDescription")}</p></div>
                <div><div className="mb-2 text-sm font-medium">{t("canvas.editors.targetSize")}</div><Segmented block value={targetLongEdge} options={[1024, 2048, 4096].map((value) => ({ label: `${value / 1024}K`, value, disabled: Boolean(source && Math.max(source.width, source.height) >= value) }))} onChange={(value) => setTargetLongEdge(Number(value))} /></div>
                {mode === "generative" ? <div><div className="flex justify-between text-sm"><span>{t("canvas.editors.denoise")}</span><span>{denoise.toFixed(2)}</span></div><Slider min={0.1} max={0.35} step={0.01} value={denoise} onChange={setDenoise} /></div> : null}
                <div className="rounded-xl border px-4 py-3 text-sm"><span className="opacity-60">{t("canvas.editors.outputSize")}</span><span className="float-right font-semibold">{output ? `${output.width} × ${output.height}` : "—"}</span></div>
                <div className="flex justify-end"><Button type="primary" size="large" icon={<Sparkles className="size-4" />} disabled={!canSubmit} onClick={() => source && onConfirm({ mode, targetLongEdge, sourceWidth: source.width, sourceHeight: source.height, denoise })}>{t("canvas.editors.startUpscale")}</Button></div>
            </div>
        </div>
    </Modal>;
}
