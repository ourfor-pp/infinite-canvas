export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f2ed",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#fbfaf7",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: {
            background: "#181715",
            dot: "rgba(245,245,244,.24)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#d6d3d1",
            fill: "#292524",
            panel: "#1f1d1a",
            stroke: "#44403c",
            activeStroke: "#fafaf9",
            placeholder: "#a8a29e",
            text: "#f5f5f4",
            muted: "#d6d3d1",
            faint: "#78716c",
        },
        toolbar: {
            panel: "rgba(31,29,26,.96)",
            border: "#44403c",
            item: "#d6d3d1",
            itemHover: "#292524",
            activeBg: "#3a3631",
            activeText: "#f5f5f4",
        },
    },
} as const;

export type CanvasTheme = {
    canvas: Record<keyof typeof canvasThemes.light.canvas, string>;
    node: Record<keyof typeof canvasThemes.light.node, string>;
    toolbar: Record<keyof typeof canvasThemes.light.toolbar, string>;
};

export const sxhAgentLightTheme: CanvasTheme = {
    canvas: { background: "#f1f5f9", dot: "rgba(15,23,42,.16)", line: "rgba(15,23,42,.08)", selectionStroke: "#2563eb", selectionFill: "rgba(37,99,235,.08)" },
    node: { label: "#334155", fill: "#f8fafc", panel: "#ffffff", stroke: "#e2e8f0", activeStroke: "#2563eb", placeholder: "#94a3b8", text: "#0f172a", muted: "#64748b", faint: "#94a3b8" },
    toolbar: { panel: "rgba(255,255,255,.98)", border: "#e2e8f0", item: "#64748b", itemHover: "#f1f5f9", activeBg: "#eff6ff", activeText: "#2563eb" },
};
