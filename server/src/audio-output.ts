import { spawn } from "node:child_process";

/** Gemini returns signed 16-bit little-endian PCM; wrap it for browser playback. */
export async function playableAudio(bytes: Buffer, mimeType: string, signal?: AbortSignal) {
    if (!/^audio\/(?:L16|pcm)(?:;|$)/i.test(mimeType)) return { bytes, mimeType };
    const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] || 24000);
    const channels = Number(/channels=(\d+)/i.exec(mimeType)?.[1] || 1);
    const output = await new Promise<Buffer>((resolve, reject) => {
        const child = spawn("ffmpeg", ["-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", String(channels), "-i", "pipe:0", "-f", "wav", "pipe:1"], { signal, timeout: 30000 });
        const chunks: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.stderr.resume();
        child.on("error", reject);
        child.stdin.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("音频格式转换失败")));
        child.stdin.end(bytes);
    });
    return { bytes: output, mimeType: "audio/wav" };
}
