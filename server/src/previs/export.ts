import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { PrevisScene, PrevisPlan } from "./model.js";
export type PrevisExportSnapshot = { scene: PrevisScene; plan: PrevisPlan; hash: string; start: number; end: number; frames: number; width: number; height: number; kind: "video" | "frame"; output: string; captureId?: string };
type Snapshot = PrevisExportSnapshot;
let bundle: Promise<string> | undefined;
function browserBundle() {
    return bundle ||= build({ entryPoints: [fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./browser.ts" : "./browser.js", import.meta.url))], bundle: true, write: false, platform: "browser", format: "iife", minify: true }).then((result) => result.outputFiles[0].text).catch((error) => { bundle = undefined; throw error; });
}
export async function exportPrevis(snapshot: Snapshot, target: string, signal: AbortSignal, progress: (value: number) => void = () => {}) {
    const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
    const cancel = () => { void browser.close(); };
    signal.addEventListener("abort", cancel, { once: true });
    let encoder: ReturnType<typeof spawn> | undefined;
    try {
        signal.throwIfAborted();
        const page = await browser.newPage({ viewport: { width: snapshot.width, height: snapshot.height }, deviceScaleFactor: 1 });
        await page.route("**/*", (route) => route.abort());
        await page.setContent("<!doctype html><html><body></body></html>");
        await page.addScriptTag({ content: await browserBundle() });
        await page.evaluate(({ scene, plan, width, height }) => { (globalThis as any).mountPrevis(scene, plan, width, height); }, snapshot);
        let done: Promise<void> | undefined;
        if (snapshot.kind === "video") {
            encoder = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", "24", "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", target], { stdio: ["pipe", "ignore", "pipe"], signal });
            let errorText = ""; encoder.stderr!.on("data", (chunk) => { errorText = (errorText + chunk).slice(-4000); });
            done = new Promise<void>((resolve, reject) => { encoder!.once("error", reject); encoder!.once("close", (code) => code === 0 ? resolve() : reject(new Error(errorText || `FFmpeg 退出：${code}`))); });
            void done.catch(() => {});
            encoder.stdin!.on("error", () => {});
        }
        for (let frame = 0; frame < snapshot.frames; frame++) {
            signal.throwIfAborted();
            const png = await page.evaluate((time) => (globalThis as any).renderPrevis(time) as string, snapshot.start + frame / 24);
            const buffer = Buffer.from(png, "base64");
            if (encoder) {
                if (encoder.exitCode !== null || encoder.stdin!.destroyed) { await done; throw new Error("视频编码提前结束"); }
                if (!encoder.stdin!.write(buffer)) await Promise.race([once(encoder.stdin!, "drain", { signal }), done!.then(() => { throw new Error("视频编码提前结束"); })]);
            } else writeFileSync(target, buffer);
            if (frame % 12 === 0) progress((frame + 1) / snapshot.frames * .95);
        }
        if (encoder) { encoder.stdin!.end(); await done; }
    } finally {
        if (encoder && encoder.exitCode === null) encoder.kill("SIGKILL");
        signal.removeEventListener("abort", cancel); await browser.close();
    }
}
