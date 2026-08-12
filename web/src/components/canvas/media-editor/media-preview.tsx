import { Image as AntImage } from "antd";
import { ImageIcon, Music2 } from "lucide-react";
import type { ReactNode } from "react";

import type { MediaEditorKind } from "./types";

export function MediaPreview({ kind, url, title, emptyLabel, className = "", fit = "contain" }: { kind: MediaEditorKind; url?: string; title: string; emptyLabel: string; className?: string; fit?: "contain" | "fill" | "cover" }) {
    if (kind === "audio") return url ? <audio src={url} controls className={`w-full ${className}`} data-canvas-no-zoom /> : <Empty icon={<Music2 className="size-5" />} label={emptyLabel} className={className} />;
    return url
        ? <AntImage rootClassName={`size-full ${className}`} classNames={{ popup: { root: "media-image-preview" } }} src={url} alt={title} className={`!size-full ${fit === "fill" ? "!object-fill" : fit === "cover" ? "!object-cover" : "!object-contain"}`} preview={{ mask: "查看大图", zIndex: 1320 }} />
        : <Empty icon={<ImageIcon className="size-5" />} label={emptyLabel} className={className} />;
}

function Empty({ icon, label, className }: { icon: ReactNode; label: string; className: string }) {
    return <div className={`grid size-full place-items-center ${className}`}><div className="flex flex-col items-center gap-2 opacity-45">{icon}<span className="text-[11px]">{label}</span></div></div>;
}
