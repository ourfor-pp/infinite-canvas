import { Check, Scan } from "lucide-react";
import { getAvailableModel, type AiConfig } from "@/stores/use-config-store";
import { imageContractForMode } from "../../../../server/src/image-contract";
import type { CanvasTheme } from "@/lib/canvas-theme";

const ratios = ["16:9", "21:9", "9:16", "4:3", "3:4", "1:1", "3:2", "2:3"];
const ratioValue = (ratio: string) => { const [w, h] = ratio.split(":").map(Number); return w / h; };

export function imageSizeOption(size: string) {
    const pixels = /^(\d+)x(\d+)$/.exec(size);
    if (!pixels) return { size, ratio: size, resolution: "" };
    const width = Number(pixels[1]), height = Number(pixels[2]);
    const nearest = ratios.reduce((best, ratio) => Math.abs(Math.log(width / height / ratioValue(ratio))) < Math.abs(Math.log(width / height / ratioValue(best))) ? ratio : best, "1:1");
    const ratio = Math.abs(width / height / ratioValue(nearest) - 1) < 0.04 ? nearest : `${width}:${height}`;
    const k = Math.sqrt(width * height) / 1024;
    const resolution = `${Math.max(width, height) >= 3840 ? 4 : k < 0.4 ? 0.25 : k < 0.75 ? 0.5 : k < 1.4 ? 1 : k < 1.8 ? 1.5 : k < 3 ? 2 : 4}K`;
    return { size, ratio, resolution };
}

export function CanvasImageSizeSettings({ config, imageMode, theme, onConfigChange }: {
    config: AiConfig; imageMode?: "generate" | "edit"; theme: CanvasTheme;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    const modelContract = getAvailableModel(config.model)?.imageContract;
    if (!modelContract) return <div className="text-xs opacity-60">请先选择支持图片生成的模型</div>;
    const contract = imageContractForMode(modelContract, imageMode === "edit");
    const options = contract.sizes.map(imageSizeOption);
    const selected = options.find((item) => item.size === config.size) || options[0];
    const resolutions = [...new Set(options.map((item) => item.resolution).filter(Boolean))].sort((a, b) => parseFloat(a) - parseFloat(b));
    const resolution = selected?.resolution || resolutions[0];
    const visible = options.filter((item) => !item.resolution || item.resolution === resolution).sort((a, b) => (a.ratio === "auto" ? 99 : ratios.indexOf(a.ratio)) - (b.ratio === "auto" ? 99 : ratios.indexOf(b.ratio)));
    const choiceStyle = (active: boolean) => ({ color: theme.node.text, background: active ? `color-mix(in srgb, ${theme.node.text} 5%, ${theme.node.panel})` : theme.canvas.background, borderColor: active ? `color-mix(in srgb, ${theme.node.text} 30%, ${theme.node.panel})` : "transparent" });
    const labels: Record<string, string> = { auto: "自动", high: "高", medium: "中", low: "低", transparent: "透明", opaque: "不透明" };
    return <div className="space-y-5">
        {resolutions.length ? <section className="space-y-2" aria-label="清晰度"><div className="text-[11px] font-medium" style={{ color: theme.node.muted }}>清晰度</div><div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(resolutions.length, 3)}, minmax(0, 1fr))` }}>
            {resolutions.map((value) => <button key={value} type="button" aria-pressed={resolution === value} className="h-8 rounded-lg border !text-xs !font-medium transition-colors hover:brightness-95" style={choiceStyle(resolution === value)} onClick={() => {
                const next = options.find((item) => item.resolution === value && item.ratio === selected?.ratio) || options.find((item) => item.resolution === value)!;
                onConfigChange("size", next.size);
            }}>{value}</button>)}
        </div></section> : null}
        <section className="space-y-2" aria-label="比例"><div className="text-[11px] font-medium" style={{ color: theme.node.muted }}>比例</div><div className="grid grid-cols-4 gap-2">
            {visible.map((item) => { const ratio = item.ratio === "auto" ? 1 : ratioValue(item.ratio); return <button key={item.size} type="button" aria-label={item.ratio === "auto" ? "自动比例" : `比例 ${item.ratio}`} aria-pressed={selected?.size === item.size} title={item.size} className="relative flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border !text-xs transition-colors hover:brightness-95" style={choiceStyle(selected?.size === item.size)} onClick={() => onConfigChange("size", item.size)}>
                {selected?.size === item.size ? <Check className="absolute right-1.5 top-1.5 size-3" /> : null}
                {item.ratio === "auto" ? <Scan className="size-5 opacity-65" strokeWidth={1.5} /> : <span className="flex h-6 items-center"><span className="rounded-[3px] border-[1.5px] border-current" style={{ width: ratio >= 1 ? 22 : 22 * ratio, height: ratio >= 1 ? 22 / ratio : 22 }} /></span>}
                <span>{item.ratio === "auto" ? "自动" : item.ratio}</span>
            </button>; })}
        </div></section>
        {([ ["quality", "质量", contract.qualities], ["background", "背景", contract.backgrounds] ] as const).map(([key, label, values]) => values.length > 1 ? <section key={key} aria-label={label} className="flex items-center gap-4 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
            <span className="shrink-0 text-[11px] font-medium" style={{ color: theme.node.muted }}>{label}</span>
            <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
                {values.map((value) => <button key={value} type="button" aria-label={`${label} ${labels[value] || value}`} aria-pressed={(config[key] || values[0]) === value} className="h-7 rounded-lg border !text-[11px] transition-colors hover:brightness-95" style={choiceStyle((config[key] || values[0]) === value)} onClick={() => onConfigChange(key, value)}>{labels[value] || value}</button>)}
            </div>
        </section> : null)}
    </div>;
}
