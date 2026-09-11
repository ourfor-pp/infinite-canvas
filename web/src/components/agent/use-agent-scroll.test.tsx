import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useAgentScroll } from "./use-agent-scroll";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom does not implement the browser scrolling API used by initial RAF callbacks.
Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; } });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;

function Harness() {
    const [eventKey, setEventKey] = useState("1");
    const contentRef = useRef<HTMLDivElement>(null);
    const scroll = useAgentScroll({ sessionId: "session-1", eventKey, contentRef });
    return <><div ref={scroll.scrollRef} data-scroll onScroll={scroll.onScroll}><div ref={contentRef} /></div><output>{scroll.unread}</output><button onClick={() => { scroll.preserveBeforePrepend(); setEventKey("2"); }}>前插历史</button></>;
}

describe("Agent 对话滚动", () => {
    it("加载更早历史不会被计为新消息", async () => {
        const holder = document.createElement("div"); document.body.append(holder); const root = createRoot(holder);
        await act(async () => root.render(<Harness />));
        const viewport = holder.querySelector("[data-scroll]") as HTMLDivElement;
        Object.defineProperties(viewport, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 400 }, scrollTop: { configurable: true, writable: true, value: 200 } });
        await act(async () => viewport.dispatchEvent(new Event("scroll", { bubbles: true })));
        expect(holder.querySelector("output")?.textContent).toBe("0");
        await act(async () => (holder.querySelector("button") as HTMLButtonElement).click());
        expect(holder.querySelector("output")?.textContent).toBe("0");
        await act(async () => root.unmount()); holder.remove();
    });
});
