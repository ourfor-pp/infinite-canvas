import { exportPrevis, type PrevisExportSnapshot } from "./previs/export.js";

const abort = new AbortController();
let started = false;
process.on("disconnect", () => abort.abort());
process.on("SIGTERM", () => abort.abort());
process.on("message", async (message: { cancel?: boolean; snapshot?: PrevisExportSnapshot; target?: string }) => {
    if (message.cancel) { abort.abort(); return; }
    if (started || !message.snapshot || !message.target) return;
    started = true;
    try {
        await exportPrevis(message.snapshot, message.target, abort.signal, (progress) => { if (process.connected) process.send?.({ progress }); });
        if (process.connected) process.send?.({ complete: true });
    } catch (error) {
        if (process.connected) process.send?.({ error: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
    } finally { if (process.connected) process.disconnect(); }
});
