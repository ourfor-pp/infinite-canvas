import { Streamdown } from "streamdown";

type CanvasMarkdownContentProps = {
    children: string;
    fontSize: number;
    color: string;
    onWheel?: React.WheelEventHandler<HTMLDivElement>;
};

export function CanvasMarkdownContent({ children, fontSize, color, onWheel }: CanvasMarkdownContentProps) {
    return (
        <div
            data-canvas-no-zoom
            className="thin-scrollbar h-full w-full overflow-y-auto break-words px-5 pb-5 pr-14 selection:bg-blue-500/20 [&_a]:text-blue-500 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-75 [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_h1]:mb-4 [&_h1]:mt-1 [&_h1]:text-[1.55em] [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-[1.25em] [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_hr]:my-6 [&_li]:my-1 [&_p]:my-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 dark:[&_code]:bg-white/10"
            style={{ fontSize: `${fontSize}px`, lineHeight: 1.72, color }}
            onWheel={onWheel}
        >
            <Streamdown controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}>{children}</Streamdown>
        </div>
    );
}
