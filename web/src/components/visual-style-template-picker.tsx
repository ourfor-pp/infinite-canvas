import { Input, Modal } from "antd";
import { Check, Palette, Search } from "lucide-react";
import { useState } from "react";

import { filterVisualStyleTemplates } from "@/lib/canvas/visual-style-templates";
import type { VisualStyleTemplate, VisualStyleTemplateCategory } from "@/types/visual-style";

const categories: Array<{ value: "all" | VisualStyleTemplateCategory; label: string }> = [
    { value: "all", label: "全部" },
    { value: "cinematic", label: "电影基底" },
    { value: "genre", label: "类型片" },
    { value: "eastern", label: "东方影像" },
    { value: "animation", label: "动画" },
    { value: "handmade", label: "手工媒介" },
    { value: "graphic", label: "图形实验" },
];

const templateAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

export function VisualStyleTemplatePicker({ open, templates, selectedId, onClose, onSelect }: { open: boolean; templates: VisualStyleTemplate[]; selectedId: string | null; onClose: () => void; onSelect: (id: string) => void }) {
    const [category, setCategory] = useState<"all" | VisualStyleTemplateCategory>("all");
    const [query, setQuery] = useState("");
    const visible = filterVisualStyleTemplates(templates, category, query);
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    return <div className="contents" onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={stop} onWheel={stop} onKeyDown={stop}>
        <Modal rootClassName="visual-style-template-picker" open={open} onCancel={onClose} footer={null} width={1040} centered title={<div className="flex items-center gap-3 pr-8"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-current/10"><Palette className="size-4" /></span><div><div className="text-[15px] font-semibold leading-5">浏览影视视觉风格</div><div className="mt-0.5 text-[11px] font-normal leading-4 opacity-50">人物、场景与道具共享同一套 Style DNA</div></div></div>} destroyOnHidden>
            <div className="mb-4 flex min-w-0 items-end gap-4 border-b border-current/10">
                <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">{categories.map((item) => <button key={item.value} type="button" className={`relative shrink-0 whitespace-nowrap px-0.5 pb-2.5 pt-1 text-[13px] transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full ${category === item.value ? "text-blue-600 after:bg-blue-600" : "opacity-60 after:bg-transparent hover:opacity-100"}`} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
                <Input variant="borderless" value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search className="size-3.5 opacity-40" />} placeholder="搜索风格或题材" className="mb-1.5 !h-8 !w-56 shrink-0 !rounded-lg !bg-black/[0.035] !px-2.5 dark:!bg-white/[0.06]" />
            </div>
            <div className="grid max-h-[68vh] grid-cols-2 gap-3 overflow-y-auto pr-1 md:grid-cols-3">
                {visible.map((item) => <button key={item.id} data-testid={`visual-style-template-${item.id}`} type="button" className={`group overflow-hidden rounded-xl border text-left transition-colors ${selectedId === item.id ? "border-blue-500 ring-2 ring-blue-500/15" : "border-current/10 hover:border-current/25"}`} onClick={() => onSelect(item.id)}>
                    <div className="relative aspect-video overflow-hidden"><img src={templateAssetUrl(item.preview)} alt={`${item.name}人物场景道具预览`} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.02]" />{selectedId === item.id ? <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-blue-600 text-white"><Check className="size-3.5" /></span> : null}</div>
                    <div className="px-3 py-2.5"><strong className="block text-[13px] font-semibold">{item.name}</strong><span className="mt-0.5 block text-[11px] leading-4 opacity-50">{item.tagline}</span></div>
                </button>)}
            </div>
            {!visible.length ? <div className="py-16 text-center text-sm opacity-45">没有匹配的风格</div> : null}
        </Modal>
    </div>;
}
