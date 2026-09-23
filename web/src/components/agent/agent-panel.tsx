import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { LocalAgentPanel } from "./local-agent-panel";
import { canvasThemes, sxhAgentLightTheme } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel({ projectId, themeMode, side = "left" }: { projectId: string; themeMode?: "light" | "dark"; side?: "left" | "right" }) {
    const { t } = useTranslation();
    const currentTheme = useThemeStore((state) => state.theme);
    const theme = themeMode === "light" ? sxhAgentLightTheme : canvasThemes[themeMode || currentTheme];
    const width = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);
    const panelOpen = useAgentStore((state) => Boolean(state.panelOpen[projectId]));
    const panelClosing = useAgentStore((state) => Boolean(state.panelClosing[projectId]));
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + (moveEvent.clientX - startX) * (side === "left" ? 1 : -1)));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <motion.aside
                className={`relative flex h-full shrink-0 flex-col ${side === "left" ? "border-r" : "border-l"}`}
                data-canvas-shortcuts-ignore
                initial={{ x: side === "left" ? -48 : 48 }}
                animate={{ x: panelClosing ? (side === "left" ? -28 : 28) : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className={`absolute inset-y-0 z-40 w-4 cursor-col-resize ${side === "left" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"}`} onPointerDown={startResize} aria-label={t("agent.panel.resize")} />
                <LocalAgentPanel projectId={projectId} themeMode={themeMode} />
            </motion.aside>
        </motion.div>
    );
}
