import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getStoredFile, syncFileRefs } from "./file-store.js";
import { createGeneration, type GenerationRow } from "./generation-service.js";
import { listModelDefaults, resolveSelectableModel } from "./provider-service.js";
import { previsLocation, readDirectorPrevis } from "./director-previs.js";
import { registerDirectorMediaFile, safeWorkspacePath } from "./director-workspace.js";
import { markDirectorProjectChanged } from "./director-sync.js";

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
export function createDirectorLookFrameGeneration(userId: string, projectId: string, raw: unknown) {
    const input = z.object({ segmentId: z.string(), frameId: z.string(), expectedHash: z.string(), model: z.string().optional() }).parse(raw);
    const state = readDirectorPrevis(userId, projectId, input.segmentId), frame = state.lookFrames.find((item) => item.id === input.frameId);
    if (!frame) throw new Error("定妆帧不存在");
    const { root } = previsLocation(userId, projectId, input.segmentId), folder = safeWorkspacePath(root, frame.path), promptPath = resolve(folder, "prompt.md");
    if (hash(promptPath) !== input.expectedHash) throw new Error("定妆帧提示词已变化，请重新读取");
    const manifest = JSON.parse(readFileSync(resolve(folder, "frame.json"), "utf8"));
    if ((manifest.captureHash || manifest.sourceHash) !== state.hash) throw new Error("预演已变化，请重新提取该时刻画面");
    const receiptPath = resolve(folder, "inputs/capture.json"), capturePath = resolve(folder, "inputs/previs.png");
    if (!existsSync(receiptPath) || !existsSync(capturePath)) throw new Error("预演画面尚未提取完成，请等待导出成功");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    if (receipt.sourceHash !== state.hash || receipt.time !== frame.time || receipt.captureId !== manifest.captureId || receipt.contentHash !== hash(capturePath)) throw new Error("预演画面与当前时间锚点不匹配，请重新提取");
    const prompt = matter(readFileSync(promptPath, "utf8"));
    if (!prompt.content.trim()) throw new Error("请先编写定妆帧 prompt.md 正文");
    const refs = z.array(z.object({ path: z.string(), purpose: z.string(), label: z.string().optional() })).min(1).parse(prompt.data.references);
    if (!refs.some((ref) => ref.path === `${frame.path}/inputs/previs.png`)) throw new Error("定妆帧必须显式引用当前预演画面");
    const model = input.model || listModelDefaults().image;
    if (!model) throw new Error("管理员尚未配置图片模型");
    const selection = resolveSelectableModel(model, "image");
    if (!selection.model.imageModes?.includes("edit") || refs.length > (selection.model.maxReferenceImages ?? Infinity)) throw new Error("所选图片模型无法接收全部参考图，请选择兼容模型或明确修订输入");
    const paths = refs.map((ref) => { const path = safeWorkspacePath(root, ref.path); if (!existsSync(path) || !/\.(png|jpe?g|webp)$/i.test(path)) throw new Error(`参考图尚未就绪：${ref.path}`); return path; });
    const id = nanoid(), run = resolve(folder, "runs", id); mkdirSync(run, { recursive: true });
    const references = paths.map((path, index) => { const copy = resolve(run, `reference-${index + 1}${extname(path)}`); copyFileSync(path, copy); return { fileId: registerDirectorMediaFile(userId, projectId, root, copy), kind: "image" as const, role: "reference" as const, label: refs[index].label || refs[index].purpose }; });
    writeFileSync(resolve(run, "prompt.md"), prompt.content);
    writeFileSync(resolve(run, "inputs.json"), JSON.stringify({ sourceHash: state.hash, references: refs.map((ref, index) => ({ ...ref, hash: hash(paths[index]) })) }, null, 2));
    const generation = createGeneration(userId, { kind: "image", model, prompt: prompt.content, references, params: { ratio: state.aspectRatio }, metadata: { directorLookFrame: { projectId, segmentId: input.segmentId, frameId: input.frameId, promptHash: input.expectedHash, sourceHash: state.hash, captureId: manifest.captureId } } }, id);
    writeFileSync(resolve(folder, "generation.json"), JSON.stringify({ generationId: id }));
    markDirectorProjectChanged(userId, projectId, ["segments"]);
    return generation;
}

export function syncDirectorLookFrameGeneration(row: GenerationRow) {
    const request = JSON.parse(row.request), target = request.metadata?.directorLookFrame;
    if (!target || row.kind !== "image" || row.status !== "succeeded") return;
    const state = readDirectorPrevis(row.user_id, target.projectId, target.segmentId), frame = state.lookFrames.find((item) => item.id === target.frameId);
    if (!frame) return;
    const { root } = previsLocation(row.user_id, target.projectId, target.segmentId), folder = safeWorkspacePath(root, frame.path);
    if (JSON.parse(readFileSync(resolve(folder, "generation.json"), "utf8")).generationId !== row.id || hash(resolve(folder, "prompt.md")) !== target.promptHash) return;
    const result = JSON.parse(row.result || "{}"), fileId = result.files?.[0]?.id || result.files?.[0]?.fileId;
    const file = fileId ? getStoredFile(row.user_id, fileId) : null;
    if (!file || !file.mime_type.startsWith("image/")) return;
    const manifest = JSON.parse(readFileSync(resolve(folder, "frame.json"), "utf8"));
    if (manifest.captureId !== target.captureId || state.hash !== target.sourceHash) return;
    const archive = resolve(folder, "runs", row.id, "previous"); mkdirSync(archive, { recursive: true });
    for (const name of readdirSync(folder).filter((name) => /^primary\./.test(name))) renameSync(resolve(folder, name), resolve(archive, name));
    const output = resolve(folder, `primary${extname(file.path) || ".png"}`); copyFileSync(file.path, output);
    writeFileSync(resolve(folder, "frame.json"), JSON.stringify({ ...manifest, sourceHash: target.sourceHash }, null, 2) + "\n");
    const adopted = registerDirectorMediaFile(row.user_id, target.projectId, root, output);
    syncFileRefs(row.user_id, "director_look_frame", `${target.projectId}:${target.segmentId}:${target.frameId}`, { fileId: adopted });
    markDirectorProjectChanged(row.user_id, target.projectId, ["segments", "media"]);
}
