import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CanvasProjectPage from "@/pages/canvas/project";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { imagePreviewConfig } from "@/lib/app-theme";
import "@/i18n";
import "antd/dist/reset.css";
import "@/styles/globals.css";

class SilentEventSource extends EventTarget {
    close() {}
}
globalThis.EventSource = SilentEventSource as unknown as typeof EventSource;
const now = new Date().toISOString();
useCanvasStore.setState({ hydrated: true, projects: [{ id: "canvas-e2e", kind: "canvas", title: "通用画布验收", revision: 1, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }] });
useThemeStore.getState().setTheme(new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light");
createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={new QueryClient()}><ConfigProvider image={imagePreviewConfig}><App><MemoryRouter initialEntries={["/canvas/canvas-e2e"]}><Routes><Route path="/canvas/:id" element={<CanvasProjectPage />} /></Routes></MemoryRouter></App></ConfigProvider></QueryClientProvider>,
);
