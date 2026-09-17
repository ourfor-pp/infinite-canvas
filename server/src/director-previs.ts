import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { db } from "./database.js";
import { directorExternalId, directorProjectRoot, registerDirectorMediaFile, safeWorkspacePath, reconcileDirectorProjectFiles } from "./director-workspace.js";
import { markDirectorProjectChanged } from "./director-sync.js";
import { isActor, parsePrevis, sceneSchema, type PrevisPlan, type PrevisScene, type PrevisAssetReference } from "./previs/model.js";
import { segmentDesignFileSchema,  videoReferenceSchema } from "./director-file-contract.js";
import { getStoredFile } from "./file-store.js";
import type { GenerationReference } from "./ai-adapters.js";

export const previsHash = (scene: unknown, plan: unknown) => createHash("sha256").update(JSON.stringify({ scene, plan })).digest("hex");
const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
const relativePath = (root: string, path: string) => relative(root, path).replaceAll("\\", "/");
export function previsLocation(userId: string, projectId: string, segmentId: string) {
    const row = db.prepare(`SELECT path FROM director_file_index WHERE user_id=? AND project_id=? AND entity_id=? AND kind='segment-design'
        AND EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND kind='director')`).get(userId, projectId, segmentId, projectId, userId) as { path: string } | undefined;
    if (!row) throw fail(404, "DIRECTOR_SEGMENT_NOT_FOUND", "分镜段不存在");
    const root = directorProjectRoot(userId, projectId), document = safeWorkspacePath(root, row.path), folder = dirname(document);
    return { root, folder, document, scenePath: safeWorkspacePath(root, relativePath(root, resolve(folder, "../../scene.json"))), planPath: safeWorkspacePath(root, relativePath(root, resolve(folder, "previs.json"))) };
}
const lookSchema = z.object({ id: z.string().regex(/^[\w-]+$/), time: z.number().nonnegative(), sourceHash: z.string().min(1), captureHash: z.string().optional(), captureId: z.string().optional(), useForVideo: z.boolean().default(false) }).strict();

function segmentAssetReferences(userId: string, projectId: string, scene: PrevisScene | null, plan: PrevisPlan | null, explicit: Array<{ objectId: string; variantId?: string }> = []) {
    if (!scene) return [];
    // Initial transforms cover the shared scene, including actors parked outside this segment.
    const used = new Set([
        ...(plan?.tracks.map((item) => item.objectId) || []),
        ...(plan?.actions.flatMap((item) => [item.objectId, item.target]) || []),
        ...(plan?.attachments.flatMap((item) => [item.objectId, item.parentId]) || []),
        ...(plan?.dialogue.map((item) => item.objectId) || []),
        ...(plan?.shots.flatMap((item) => item.keys.map((key) => key.follow)) || []),
    ]);
    const assetQuery = db.prepare("SELECT path,kind,json_extract(metadata,'$.name') AS name FROM director_file_index WHERE user_id=? AND project_id=? AND entity_id=? AND kind IN ('character','scene','location','prop')");
    const variantQuery = db.prepare("SELECT path,json_extract(metadata,'$.name') AS name FROM director_file_index WHERE user_id=? AND project_id=? AND entity_id=? AND kind='asset-variant'");
    const imageQuery = db.prepare("SELECT id,json_extract(metadata,'$.directorPath') AS path FROM stored_files WHERE user_id=? AND json_extract(metadata,'$.directorProjectId')=? AND json_extract(metadata,'$.directorPath') IN (?,?,?,?)");
    const result = new Map<string, PrevisAssetReference>();
    const requested = [...explicit, ...scene.objects.filter((object) => {
        if (explicit.some((item) => item.objectId === object.id)) return false;
        if (used.has(object.id)) return Boolean(object.assetId) || isActor(object);
        const asset = object.assetId ? assetQuery.get(userId, projectId, object.assetId) as { kind: string } | undefined : undefined;
        return !explicit.length && (asset?.kind === "scene" || asset?.kind === "location");
    }).map((object) => ({ objectId: object.id, variantId: undefined }))];
    for (const reference of requested) {
        const object = scene.objects.find((item) => item.id === reference.objectId);
        const asset = object?.assetId ? assetQuery.get(userId, projectId, object.assetId) as { path: string; kind: string; name?: string } | undefined : undefined;
        const variant = reference.variantId ? variantQuery.get(userId, projectId, reference.variantId) as { path: string; name?: string } | undefined : undefined;
        const variantMatches = variant && asset && variant.path.startsWith(`${dirname(asset.path)}/variants/`);
        const folder = asset && (!reference.variantId || variantMatches) ? reference.variantId ? dirname(variant!.path) : `${dirname(asset.path)}/${asset.kind === "character" ? "identity" : "design"}` : undefined;
        const images = folder ? imageQuery.all(userId, projectId, ...["png", "jpg", "jpeg", "webp"].map((ext) => `${folder}/primary.${ext}`)) as Array<{ id: string; path: string }> : [];
        const image = images.find((item) => existsSync(safeWorkspacePath(directorProjectRoot(userId, projectId), item.path)));
        const key = JSON.stringify([object?.assetId || reference.objectId, reference.variantId]);
        const existing = result.get(key);
        if (existing) { if (!existing.objectIds.includes(reference.objectId)) existing.objectIds.push(reference.objectId); continue; }
        const reason = !object ? "预演对象不存在" : !object.assetId ? "先复用或建立素材身份" : !asset ? "绑定的素材不存在" : reference.variantId && !variantMatches ? "绑定的素材变体不存在" : undefined;
        result.set(key, { objectIds: [reference.objectId], name: [asset?.name || object?.name || reference.objectId, reference.variantId ? variant?.name || reference.variantId : undefined].filter(Boolean).join(" · "),
            assetId: object?.assetId, variantId: reference.variantId, fileId: image?.id, status: reason ? "unbound" : image ? "ready" : "missing-image", reason });
    }
    return [...result.values()];
}

export function readDirectorPrevis(userId: string, projectId: string, segmentId: string) {
    const location = previsLocation(userId, projectId, segmentId), { root, folder, scenePath, planPath } = location;
    const diagnostics: string[] = [], warnings: string[] = [];
    const readJson = (path: string) => { if (!existsSync(path)) return null; try { return JSON.parse(readFileSync(path, "utf8")); } catch { diagnostics.push(`JSON 格式错误：${relativePath(root, path)}`); return null; } };
    let scene = readJson(scenePath), plan = readJson(planPath);
    const hash = previsHash(scene, plan);
    if (scene) { const checked = sceneSchema.safeParse(scene); if (!checked.success) { diagnostics.push(checked.error.message); scene = null; } }
    if (scene && plan) { try { const parsed = parsePrevis(scene, plan); scene = parsed.scene; plan = parsed.plan; if (parsed.plan.segmentId !== segmentId) diagnostics.push("预演所属分镜段不匹配"); } catch (error) { diagnostics.push(error instanceof Error ? error.message : String(error)); scene = null; plan = null; } }
    else { diagnostics.push("尚未编排预演，请交给 Agent 搭建场景与动作"); plan = null; }
    const lookRoot = resolve(folder, "look-frames");
    const lookFrames = existsSync(lookRoot) ? readdirSync(lookRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).slice(0, 100).flatMap((item) => {
        const directory = safeWorkspacePath(root, relativePath(root, resolve(lookRoot, item.name))), manifest = resolve(directory, "frame.json");
        if (!existsSync(manifest)) return [];
        let raw: unknown; try { raw = JSON.parse(readFileSync(manifest, "utf8")); } catch { warnings.push(`定妆帧信息无效：${item.name}`); return []; }
        const parsed = lookSchema.safeParse(raw);
        if (!parsed.success) { warnings.push(`定妆帧信息无效：${item.name}`); return []; }
        const images = readdirSync(directory).filter((name) => /^primary\.(png|jpe?g|webp)$/i.test(name));
        if (images.length > 1) warnings.push(`定妆帧存在多个主图：${item.name}`);
        const imagePath = images.length === 1 ? safeWorkspacePath(root, relativePath(root, resolve(directory, images[0]))) : undefined;
        const promptPath = resolve(directory, "prompt.md"), prompt = existsSync(promptPath) ? matter(readFileSync(promptPath, "utf8")) : null;
        return [{ ...parsed.data, path: relativePath(root, directory), stale: parsed.data.sourceHash !== hash,
            fileId: imagePath ? (db.prepare("SELECT id FROM stored_files WHERE user_id=? AND json_extract(metadata, '$.directorProjectId')=? AND json_extract(metadata, '$.directorPath')=?").get(userId, projectId, relativePath(root, imagePath)) as { id: string } | undefined)?.id : undefined,
            imagePath: imagePath ? relativePath(root, imagePath) : undefined,
            prompt: prompt?.content || "", references: prompt?.data.references || [] }];
    }).sort((a, b) => a.time - b.time) : [];
    const manifest = parseYaml(readFileSync(resolve(root, "project.yaml"), "utf8"));
    const segment = matter(readFileSync(location.document, "utf8"));
    const design = segmentDesignFileSchema.safeParse(segment.data);
    if (!design.success) diagnostics.push(design.error.message);
    else if (plan && Math.abs(plan.duration - design.data.estimatedSeconds) > 1e-6) diagnostics.push("预演时长必须等于完整分镜段时长，请回分镜修订");
    const references = segmentDesignFileSchema.shape.assetReferences.safeParse(segment.data.assetReferences);
    if (!references.success) warnings.push(`本段素材引用格式错误：${references.error.message}`);
    const assetReferences = segmentAssetReferences(userId, projectId, scene, plan, references.success ? references.data : undefined);
    return { segmentId, scene, plan, hash, diagnostics, warnings, lookFrames, assetReferences, aspectRatio: String(manifest.aspectRatio || "16:9"), previsMode: segment.data.previsMode === "skip" ? "skip" as const : "required" as const };
}

export function validDirectorPrevis(userId: string, projectId: string, segmentId: string, expectedHash?: string) {
    const state = readDirectorPrevis(userId, projectId, segmentId);
    if (expectedHash && state.hash !== expectedHash) throw fail(409, "DIRECTOR_PREVIS_CHANGED", "预演已经修改，请重新读取后操作");
    if (state.diagnostics.length) throw fail(400, "DIRECTOR_PREVIS_INVALID", state.diagnostics.join("；"));
    return { ...state, ...parsePrevis(state.scene, state.plan) };
}

export function createDirectorLookFrame(userId: string, projectId: string, segmentId: string, time: number, expectedHash: string, frameId?: string) {
    z.object({ time: z.number().finite().nonnegative(), expectedHash: z.string().min(1) }).parse({ time, expectedHash });
    const state = validDirectorPrevis(userId, projectId, segmentId, expectedHash);
    if (!Number.isFinite(time) || time < 0 || time > state.plan.duration) throw fail(400, "DIRECTOR_FRAME_TIME", "定妆帧时间超出预演范围");
    const previous = frameId ? state.lookFrames.find((frame) => frame.id === frameId) : undefined;
    if (previous && previous.time !== time) throw new Error("已有定妆帧的时间锚点不能修改，请在新时刻提取一帧");
    if (frameId && !previous) throw fail(404, "DIRECTOR_FRAME_NOT_FOUND", "定妆帧不存在");
    const { root, folder } = previsLocation(userId, projectId, segmentId), id = previous?.id || `frame-${randomUUID().slice(0, 8)}`;
    const target = resolve(folder, "look-frames", id);
    mkdirSync(resolve(target, "inputs"), { recursive: true });
    writeFileSync(resolve(target, "frame.json"), JSON.stringify({ id, time, sourceHash: previous?.sourceHash || state.hash, captureHash: state.hash, captureId: randomUUID(), useForVideo: previous?.useForVideo || false }, null, 2) + "\n");
    rmSync(resolve(target, "inputs/capture.json"), { force: true });
    if (!previous) writeFileSync(resolve(target, "prompt.md"), matter.stringify("", { references: [{ path: `${relativePath(root, target)}/inputs/previs.png`, purpose: "composition_reference", label: "当前预演画面" }] }));
    markDirectorProjectChanged(userId, projectId, ["segments"]);
    return { id, path: relativePath(root, target), time, sourceHash: state.hash };
}

export function updateDirectorLookFrame(userId: string, projectId: string, segmentId: string, frameId: string, input: unknown) {
    const request = z.object({ remove: z.boolean().optional(), useForVideo: z.boolean().optional(), expectedHash: z.string() }).strict().parse(input);
    const state = readDirectorPrevis(userId, projectId, segmentId), frame = state.lookFrames.find((item) => item.id === frameId);
    if (state.hash !== request.expectedHash) throw fail(409, "DIRECTOR_PREVIS_CHANGED", "预演已经修改，请刷新后操作");
    if (!frame) throw fail(404, "DIRECTOR_FRAME_NOT_FOUND", "定妆帧不存在");
    const { root } = previsLocation(userId, projectId, segmentId), folder = safeWorkspacePath(root, frame.path);
    if (request.remove) { const trash = resolve(root, ".trash", `look-${randomUUID()}`); mkdirSync(dirname(trash), { recursive: true }); renameSync(folder, trash); }
    else {
        const manifest = lookSchema.parse(JSON.parse(readFileSync(resolve(folder, "frame.json"), "utf8")));
        if (request.useForVideo !== undefined) manifest.useForVideo = request.useForVideo;
        const temporary = resolve(folder, `.frame-${randomUUID()}.tmp`);
        writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n"); renameSync(temporary, resolve(folder, "frame.json"));
    }
    if (frame.imagePath) {
        const rows = db.prepare("SELECT path FROM director_file_index WHERE user_id=? AND project_id=? AND kind='production-task'").all(userId, projectId) as Array<{ path: string }>;
        for (const row of rows) {
            const path = safeWorkspacePath(root, row.path), task = matter(readFileSync(path, "utf8"));
            if (task.data.segmentId !== segmentId) continue;
            const refs: string[] = Array.isArray(task.data.referenceImages) ? task.data.referenceImages : [];
            task.data.referenceImages = request.useForVideo && !request.remove ? [...new Set([...refs, frame.imagePath])] : refs.filter((path) => path !== frame.imagePath);
            writeFileSync(path, matter.stringify(task.content, task.data));
        }
        reconcileDirectorProjectFiles(userId, projectId);
    }
    markDirectorProjectChanged(userId, projectId, ["segments"]);
    return { updated: true };
}

export function getTaskPrevisInputs(userId: string, projectId: string, payload: Record<string, unknown>) {
    if ("segmentRanges" in payload || "segmentIds" in payload) throw new Error("旧制作范围不再支持，请按完整分镜段重新规划");
    const segmentId = z.string().min(1).parse(payload.segmentId), location = previsLocation(userId, projectId, segmentId);
    const design = segmentDesignFileSchema.parse(matter(readFileSync(location.document, "utf8")).data);
    const seconds = design.estimatedSeconds;
    if (Number(payload.durationSeconds) !== seconds) throw new Error(`分镜段共 ${seconds} 秒，与视频时长不符，请回到分镜修订，不要缩放或截取预演`);
    if (payload.videoModel !== undefined && payload.videoModel !== design.videoModel) throw new Error("视频模型与当前分镜不符，请重新读取后生成");
    const videos = z.array(videoReferenceSchema).max(3).default([]).parse(payload.videoReferences);
    const root = directorProjectRoot(userId, projectId), warnings: string[] = [];
    const files = videos.map((reference) => {
        const path = safeWorkspacePath(root, reference.path);
        if (!existsSync(path) || !/\.(mp4|webm|mov)$/i.test(path)) throw new Error(`视频参考不存在：${reference.path}`);
        return { ...reference, fileId: registerDirectorMediaFile(userId, projectId, root, path), name: reference.purpose };
    });
    const state = readDirectorPrevis(userId, projectId, segmentId);
    if (state.previsMode !== "skip") {
        validDirectorPrevis(userId, projectId, segmentId);
        const reference = videos.find((video) => video.segmentId === segmentId && video.sourceHash === state.hash && video.start === 0 && video.end === seconds);
        if (!reference) throw new Error(`分镜段 ${segmentId} 缺少当前整段预演视频；请先导出并在 videoReferences 中显式引用，或明确跳过预演`);
        const recordPath = safeWorkspacePath(root, reference.path.replace(/\.[^.]+$/, ".json"));
        if (!existsSync(recordPath)) throw new Error(`预演视频缺少对应的导出记录：${reference.path}`);
        const exported = JSON.parse(readFileSync(recordPath, "utf8"));
        if (exported.sourceHash !== state.hash || exported.segmentId !== segmentId || exported.start !== 0 || exported.end !== seconds || exported.contentHash !== createHash("sha256").update(readFileSync(safeWorkspacePath(root, reference.path))).digest("hex")) throw new Error(`预演导出记录与当前整段或媒体不符：${reference.path}`);
    }
    for (const frame of state.lookFrames.filter((item) => item.time >= 0 && item.time <= seconds)) {
        const selected = Array.isArray(payload.referenceImages) && payload.referenceImages.includes(frame.imagePath);
        if (frame.useForVideo && !selected) throw new Error(`定妆帧 ${frame.id} 已指定用于视频，请补入 referenceImages`);
        if (!frame.useForVideo && selected) throw new Error(`定妆帧 ${frame.id} 未指定用于视频，请移出 referenceImages 或修改选择`);
        if (selected && frame.stale) warnings.push(`定妆帧 ${frame.id} 来自旧预演，请检查构图与动作是否仍适用`);
    }
    return { files, hashes: { [segmentId]: state.hash }, warnings };
}

export function freezeDirectorGenerationInputs(userId: string, projectId: string, taskId: string, generationId: string, references: GenerationReference[], prompt: string, hashes: Record<string, string>) {
    const root = directorProjectRoot(userId, projectId), path = `productions/${directorExternalId(projectId, taskId)}/runs/${generationId}`;
    const folder = safeWorkspacePath(root, path);
    if (existsSync(folder)) throw new Error("生成输入快照已经存在");
    mkdirSync(resolve(folder, "inputs"), { recursive: true });
    try {
        const media: Array<{ path: string; sourceFileId: string; hash: string; kind: string }> = [];
        const frozen = references.map((reference, index) => {
            const file = getStoredFile(userId, reference.fileId);
            if (!file) throw new Error("生成参考文件不存在");
            const output = resolve(folder, "inputs", `reference-${index + 1}${extname(file.path)}`);
            const hash = createHash("sha256").update(readFileSync(file.path)).digest("hex");
            copyFileSync(file.path, output);
            if (hash !== createHash("sha256").update(readFileSync(output)).digest("hex")) throw new Error("参考文件在提交期间变化，请重新提交");
            media.push({ path: relativePath(root, output), sourceFileId: reference.fileId, hash, kind: reference.kind || "image" });
            return { ...reference, fileId: registerDirectorMediaFile(userId, projectId, root, output) };
        });
        const previs = Object.entries(hashes).map(([segmentId, hash]) => {
            const state = readDirectorPrevis(userId, projectId, segmentId);
            if (state.hash !== hash) throw new Error("预演在提交期间变化，请重新提交");
            return { segmentId, hash, scene: state.scene, plan: state.plan, previsMode: state.previsMode };
        });
        writeFileSync(resolve(folder, "prompt.md"), prompt);
        writeFileSync(resolve(folder, "inputs.json"), JSON.stringify({ generationId, media, previs }, null, 2) + "\n");
        return { references: frozen, path: `${path}/inputs.json` };
    } catch (error) {
        // These files belong only to the new unsubmitted snapshot.
        const rows = db.prepare("SELECT id FROM stored_files WHERE user_id=? AND json_extract(metadata,'$.directorProjectId')=? AND json_extract(metadata,'$.directorPath') GLOB ?").all(userId, projectId, `${path}/*`) as Array<{ id: string }>;
        for (const row of rows) db.prepare("DELETE FROM stored_files WHERE id=? AND user_id=?").run(row.id, userId);
        rmSync(folder, { recursive: true, force: true }); throw error;
    }
}
