import { Image as AntImage } from "antd";
import { ImageIcon, Music2, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import type { MediaEditorKind } from "./types";

export function MediaPreview({ kind, url, title, emptyLabel, className = "", fit = "contain", onEdit }: { kind: MediaEditorKind; url?: string; title: string; emptyLabel: string; className?: string; fit?: "contain" | "fill" | "cover"; onEdit?: () => void }) {
    if (kind === "audio") return url ? <audio src={url} controls className={`w-full ${className}`} data-canvas-no-zoom /> : <Empty icon={<Music2 className="size-5" />} label={emptyLabel} className={className} />;
    if (onEdit) return <button type="button" aria-label={`调整${title}图片`} className={`group/media relative block size-full overflow-hidden text-left ${className}`} data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onEdit(); }}>
        {url ? <img src={url} alt={title} className={`size-full ${fit === "fill" ? "object-fill" : fit === "cover" ? "object-cover" : "object-contain"}`} /> : <Empty icon={<ImageIcon className="size-5" />} label={emptyLabel} className="" />}
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 text-white transition-colors group-hover/media:bg-black/20 group-focus-visible/media:bg-black/20"><span className="flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs opacity-0 shadow-lg transition-opacity group-hover/media:opacity-100 group-focus-visible/media:opacity-100"><SlidersHorizontal className="size-3.5" />调整图片</span></span>
    </button>;
    return url
        ? <AntImage rootClassName={`size-full ${className}`} classNames={{ popup: { root: "media-image-preview" } }} src={url} alt={title} className={`!size-full ${fit === "fill" ? "!object-fill" : fit === "cover" ? "!object-cover" : "!object-contain"}`} preview={{ mask: "查看大图", zIndex: 1320 }} />
        : <Empty icon={<ImageIcon className="size-5" />} label={emptyLabel} className={className} />;
}

function Empty({ icon, label, className }: { icon: ReactNode; label: string; className: string }) {
    return <div className={`grid size-full place-items-center ${className}`}><div className="flex flex-col items-center gap-2 opacity-45">{icon}<span className="text-[11px]">{label}</span></div></div>;
}
