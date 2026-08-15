import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

const BOTTOM_THRESHOLD = 44;

export function useAgentScroll({ sessionId, eventKey, contentRef }: { sessionId?: string; eventKey: string; contentRef: RefObject<HTMLDivElement | null> }) {
    const scrollRef = useRef<HTMLDivElement>(null); const atBottomRef = useRef(true); const restoringRef = useRef<{ height: number; top: number } | null>(null);
    const [showBottom, setShowBottom] = useState(false); const [unread, setUnread] = useState(0);
    const scrollBottom = useCallback((behavior: ScrollBehavior = "smooth") => { const node = scrollRef.current; if (!node) return; node.scrollTo({ top: node.scrollHeight, behavior }); atBottomRef.current = true; setShowBottom(false); setUnread(0); }, []);
    const preserveBeforePrepend = useCallback(() => { const node = scrollRef.current; if (node) restoringRef.current = { height: node.scrollHeight, top: node.scrollTop }; }, []);
    const restoreAfterPrepend = useCallback(() => { requestAnimationFrame(() => { const node = scrollRef.current; const previous = restoringRef.current; if (node && previous) node.scrollTop = previous.top + node.scrollHeight - previous.height; restoringRef.current = null; }); }, []);
    const beforeCollapse = useCallback((element: HTMLElement) => { const node = scrollRef.current; if (!node || atBottomRef.current) return; const top = element.getBoundingClientRect().top; requestAnimationFrame(() => { const delta = element.getBoundingClientRect().top - top; node.scrollTop += delta; }); }, []);
    useLayoutEffect(() => {
        if (restoringRef.current) return;
        const node = scrollRef.current; if (!node || !atBottomRef.current) { setUnread((value) => Math.min(99, value + 1)); setShowBottom(true); return; }
        requestAnimationFrame(() => scrollBottom("auto"));
    }, [eventKey, scrollBottom]);
    useLayoutEffect(() => { let frames = 3; const settle = () => { scrollBottom("auto"); if (--frames) requestAnimationFrame(settle); }; requestAnimationFrame(settle); }, [sessionId, scrollBottom]);
    useLayoutEffect(() => { const content = contentRef.current; if (!content) return; const observer = new ResizeObserver(() => { if (atBottomRef.current) requestAnimationFrame(() => scrollBottom("auto")); }); observer.observe(content); return () => observer.disconnect(); }, [contentRef, scrollBottom]);
    const onScroll = useCallback(() => { const node = scrollRef.current; if (!node) return; const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_THRESHOLD; atBottomRef.current = atBottom; setShowBottom(!atBottom); if (atBottom) setUnread(0); }, []);
    return { scrollRef, atBottomRef, showBottom, unread, onScroll, scrollBottom, preserveBeforePrepend, restoreAfterPrepend, beforeCollapse };
}
