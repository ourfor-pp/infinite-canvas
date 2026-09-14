import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import matter from "gray-matter";
import { parse, stringify } from "yaml";
import { config } from "./config.js";
import { db, parseJson } from "./database.js";
import { segmentFileSchema, shotDesignFileSchema, timelineFileSchema } from "./director-file-contract.js";

export function v2Files(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).flatMap((e) => e.isDirectory() ? v2Files(join(root, e.name)) : e.isSymbolicLink() ? (() => { throw new Error("工程不能包含符号链接"); })() : [join(root, e.name)]);
}
const writeMd = (path: string, data: object, content: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, matter.stringify(content, JSON.parse(JSON.stringify(data)))); };

// Pure directory conversion, also used for an isolated ZIP import. Original bytes are copied, never regenerated.
export function convertDirectorV1(root: string, mediaDurations: Record<string, number> = {}, inputReferences: Record<string, Array<{ path: string; source?: string }>> = {}) {
    const manifestPath = join(root, "project.yaml");
    const manifest = parse(readFileSync(manifestPath, "utf8"));
    if (manifest.version === 2) return new Map<string, string>();
    if (manifest.version !== 1) throw new Error("不支持的导演工程版本");
    const replacements = new Map<string, string>();
    const tasks: Array<{ id: string; sequenceOrder: number; order: number; duration: number }> = [];
    for (const path of v2Files(join(root, "storyboards")).filter((p) => basename(p) === "segment.md")) {
        const doc = matter(readFileSync(path, "utf8"));
        if (!/^[a-zA-Z0-9_-]+$/.test(String(doc.data.id))) throw new Error("旧制作单元 ID 含非法路径字符");
        const oldFolder = dirname(path), folder = join(root, "productions", doc.data.id);
        if (existsSync(folder)) throw new Error(`制作任务目录冲突：${doc.data.id}`);
        const sequencePath = join(dirname(oldFolder), "sequence.md");
        const sequence = existsSync(sequencePath) ? matter(readFileSync(sequencePath, "utf8")).data : { order: 1 };
        const boardPath = join(oldFolder, "storyboard.yaml");
        const board = existsSync(boardPath) ? parse(readFileSync(boardPath, "utf8")) : { frames: [] };
        const groups: Array<Array<Record<string, any>>> = [];
        for (const frame of board.frames || []) {
            if (!groups.length || groups.at(-1)!.at(-1)!.shotNumber !== frame.shotNumber) groups.push([]);
            groups.at(-1)!.push(frame);
        }
        if (!groups.length) groups.push([]);
        const shotIds = groups.map((frames, i) => {
            const id = `${doc.data.id}-shot-${i + 1}`;
            const shot = shotDesignFileSchema.parse({ id, kind: "shot-design", name: `${doc.data.name || doc.data.id} · 镜头 ${i + 1}`, sequenceId: doc.data.sequenceId,
                order: Number(doc.data.order) * 100 + i + 1, sourceSceneId: doc.data.sourceSceneId, sourceBeatIds: doc.data.sourceBeatIds || [],
                estimatedSeconds: Math.max(.01, Number(groups[i + 1]?.[0]?.timeSeconds ?? doc.data.durationSeconds) - Number(frames[0]?.timeSeconds || 0)),
                purpose: doc.data.dramaticBeat || "", action: frames.map((f) => f.action || f.description || "").filter(Boolean).join("\n"),
                camera: frames.map((f) => [f.cameraAngle, f.cameraMove].filter(Boolean).join("；")).join("\n"),
                dialogue: frames.flatMap((f) => (f.dialogues || []).map((d: any) => `${d.speakerName}：${d.text}`)).join("\n"), sound: frames.map((f) => f.sound || "").filter(Boolean).join("\n"),
                openingState: i === 0 ? doc.data.openingState || "" : "", endingState: i === groups.length - 1 ? doc.data.endingState || "" : "",
            });
            writeMd(join(dirname(oldFolder), `shot-${id}`, "shot.md"), shot, frames.length ? frames.map((f) => f.description).filter(Boolean).join("\n") : doc.content || "待完善镜头设计");
            return id;
        });
        mkdirSync(dirname(folder), { recursive: true });
        renameSync(oldFolder, folder);
        replacements.set(relative(root, oldFolder).replaceAll("\\", "/") + "/", relative(root, folder).replaceAll("\\", "/") + "/");
        const references = inputReferences[doc.data.id] || (existsSync(join(folder, "storyboard.png")) ? [{ path: relative(root, join(folder, "storyboard.png")) }] : []);
        for (const reference of references) if (reference.source) { const target = resolve(root, reference.path); if (!target.startsWith(resolve(root) + "/")) throw new Error("旧参考图路径越界"); mkdirSync(dirname(target), { recursive: true }); cpSync(reference.source, target); }
        const task = { ...doc.data, kind: "production-task", shotIds, referenceImages: references.map((reference) => reference.path) };
        segmentFileSchema.parse(task);
        writeMd(join(folder, "task.md"), task, doc.content);
        rmSync(join(folder, "segment.md"));
        const oldVideo = join(root, "videos", `seg-${doc.data.id}`);
        if (existsSync(oldVideo)) {
            for (const media of readdirSync(oldVideo)) {
                const target = join(folder, media);
                if (existsSync(target)) throw new Error(`媒体路径冲突：${target}`);
                renameSync(join(oldVideo, media), target);
            }
            rmSync(oldVideo, { recursive: true });
            replacements.set(relative(root, oldVideo).replaceAll("\\", "/") + "/", relative(root, folder).replaceAll("\\", "/") + "/");
        }
        let duration = mediaDurations[doc.data.id];
        const video = ["final.mp4", "preview.mp4"].map((name) => join(folder, name)).find(existsSync);
        if (!duration && video) {
            try { duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video], { timeout: 10000, encoding: "utf8" }).trim()); } catch { /* Missing/unreadable media remains a visible validation issue. */ }
        }
        if (video) writeFileSync(join(folder, "result.json"), JSON.stringify({ video: basename(video), qualityPreset: basename(video) === "final.mp4" ? "final" : "preview", durationSeconds: duration || Number(doc.data.durationSeconds), audio: existsSync(join(folder, "model-audio.wav")) ? "model-audio.wav" : null }, null, 2));
        tasks.push({ id: doc.data.id, sequenceOrder: Number(sequence.order || 1), order: Number(doc.data.order || 1), duration: duration || Number(doc.data.durationSeconds) });
    }
    for (const file of v2Files(root).filter((p) => /\.(md|yaml|yml|json)$/.test(p))) {
        let text = readFileSync(file, "utf8");
        for (const [from, to] of replacements) text = text.split(from).join(to);
        writeFileSync(file, text);
    }
    const timelinePath = join(root, "timeline/timeline.json");
    const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
    const order: string[] = timeline.segmentOrder?.length ? timeline.segmentOrder : tasks.sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.order - b.order).map((t) => t.id);
    const videoClips = order.map((taskId, i) => ({ id: `clip-${i + 1}`, taskId, trimIn: 0, trimOut: tasks.find((t) => t.id === taskId)?.duration || mediaDurations[taskId] || 4, linkedAudio: false }));
    delete timeline.segmentOrder;
    for (const track of timeline.tracks || []) for (const clip of track.clips || []) { if (clip.segmentId && track.kind === "model-original") clip.taskId = clip.segmentId; delete clip.segmentId; }
    writeFileSync(timelinePath, JSON.stringify(timelineFileSchema.parse({ ...timeline, videoClips }), null, 2) + "\n");
    writeFileSync(manifestPath, stringify({ ...manifest, version: 2 }));
    return replacements;
}

export function upgradeDirectorV2(userId: string, projectId: string, root: string, validate: (root: string) => Array<{ severity: string; message: string }>) {
    const manifest = parse(readFileSync(join(root, "project.yaml"), "utf8"));
    if (manifest.version === 2) return;
    if (manifest.version !== 1) throw new Error("不支持的导演工程版本");
    const busy = db.prepare(`SELECT 1 FROM generations WHERE user_id=? AND status IN ('queued','running') AND (json_extract(request,'$.params.__directorSegment.projectId')=? OR json_extract(request,'$.params.__directorStoryboardSheet.projectId')=?) UNION ALL SELECT 1 FROM director_renders WHERE user_id=? AND project_id=? AND status IN ('queued','running') LIMIT 1`).get(userId, projectId, projectId, userId, projectId);
    if (busy || db.inTransaction) throw Object.assign(new Error("工程有运行任务，完成后再转换 v2"), { status: 409, code: "DIRECTOR_UPGRADE_BUSY" });
    const backup = `${root}.v1-backup`, staging = `${root}.v2-${randomUUID()}`;
    if (existsSync(backup) || existsSync(`${backup}.sqlite`)) throw Object.assign(new Error("已有 v1 备份，请检查前次转换，拒绝覆盖"), { status: 409, code: "DIRECTOR_UPGRADE_BACKUP_EXISTS" });
    db.exec(`VACUUM INTO '${`${backup}.sqlite`.replaceAll("'", "''")}'`);
    const filter = (path: string) => ![".cache", ".runtime", ".agents", ".claude", ".codex"].includes(relative(root, path).split("/")[0]);
    cpSync(root, staging, { recursive: true, filter });
    try {
        const durations = Object.fromEntries((db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>).map((r) => [r.id, Number(parseJson<any>(r.payload, {}).videoDurationSeconds || 0)]));
        const inputReferences: Record<string, Array<{ path: string; source?: string }>> = {};
        for (const row of db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>) {
            const payload = parseJson<{ h3PromptSnapshot?: { references?: Array<{ fileId: string; kind: string }> } }>(row.payload, {});
            const images = payload.h3PromptSnapshot?.references?.filter((item) => item.kind === "image") || [];
            if (!images.length) continue;
            inputReferences[row.id] = images.flatMap((image, index) => {
                const file = db.prepare("SELECT path FROM stored_files WHERE id=? AND user_id=?").get(image.fileId, userId) as { path: string } | undefined;
                if (!file || !existsSync(resolve(config.dataDir, file.path))) throw new Error(`旧任务参考图缺失：${image.fileId}`);
                const source = resolve(config.dataDir, file.path);
                if (source.startsWith(root + "/")) return [{ path: relative(root, source) }];
                return [{ path: `productions/${row.id}/inputs/reference-${index + 1}${source.match(/\.[^.\/]+$/)?.[0] || ".png"}`, source }];
            });
        }
        const replacements = convertDirectorV1(staging, durations, inputReferences);
        const errors = validate(staging).filter((d) => d.severity === "error");
        if (errors.length) throw new Error(`v2 转换校验失败：${errors.map((d) => d.message).join("；")}`);
        renameSync(root, backup);
        try {
            renameSync(staging, root);
            db.transaction(() => {
                for (const row of db.prepare("SELECT id,path,metadata FROM stored_files WHERE user_id=?").all(userId) as Array<{ id: string; path: string; metadata: string }>) {
                    const absolutePath = resolve(config.dataDir, row.path);
                    if (!absolutePath.startsWith(root + "/")) continue;
                    let rel = relative(root, absolutePath);
                    for (const [from, to] of replacements) if (rel.startsWith(from)) { rel = to + rel.slice(from.length); break; }
                    if (rel !== relative(root, absolutePath)) db.prepare("UPDATE stored_files SET path=?,metadata=? WHERE id=? AND user_id=?").run(relative(config.dataDir, join(root, rel)), JSON.stringify({ ...parseJson<object>(row.metadata, {}), directorPath: rel }), row.id, userId);
                }
            })();
        } catch (error) { if (existsSync(root)) renameSync(root, staging); renameSync(backup, root); throw error; }
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}
