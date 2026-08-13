import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DirectorProjectPage from "@/pages/director/project";
import "@/i18n";
import "antd/dist/reset.css";
import "@/styles/globals.css";

class SilentEventSource extends EventTarget {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
    readonly readyState = 1; readonly withCredentials = false; readonly url = "";
    onerror = null; onmessage = null; onopen = null;
    close() { return undefined; }
}
globalThis.EventSource = SilentEventSource as unknown as typeof EventSource;
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
    <React.StrictMode><ConfigProvider theme={{ token: { colorBgBase: "#09090a", colorTextBase: "#ede9df" } }}><App><MemoryRouter initialEntries={["/director/director-e2e/overview"]}><Routes><Route path="/director/:id/:section?" element={<DirectorProjectPage />} /></Routes></MemoryRouter></App></ConfigProvider></React.StrictMode>,
);
