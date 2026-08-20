import { createHash } from "node:crypto";
import {
    copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher,
} from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { config } from "./config.js";
import { db, parseJson } from "./database.js";
import { collectFileIds, getStoredFile } from "./file-store.js";

export type DirectorDiagnostic = {
    severity: "error" | "warning" | "info";
    code: string;
    path: string;
    line?: number;
    entityId?: string;
    message: string;
};

type ProjectRow = { id: string; user_id: string; title: string; payload: string; created_at: string; updated_at: string };
type WorkspaceRow = { target_duration_seconds: number; aspect_ratio: string; language: string; stage: string; directing_rules: string };
type DocumentRow = { kind: "story" | "script"; content: string; revision: number; updated_at: string };
type SequenceRow = { id: string; position: number; title: string; summary: string; payload: string; revision: number; updated_at: string };
type SegmentRow = { id: string; sequence_id: string; position: number; title: string; payload: string; revision: number; updated_at: string };
type AssetRow = { id: string; kind: "character" | "scene" | "prop"; name: string; payload: string; revision: number; updated_at: string };
type StyleRow = { id: string; name: string; description: string; dna: string; reference_files: string; revision: number; updated_at: string };

const projectSchema = z.object({ format: z.literal("infinite-canvas-director"), version: z.literal(1), id: z.string().min(1), name: z.string().min(1) }).passthrough();
const entitySchema = z.object({ id: z.string().min(1), kind: z.string().min(1), name: z.string().optional(), title: z.string().optional() }).passthrough();
const storyboardSchema = z.object({ version: z.literal(1), segmentId: z.string().min(1), layout: z.enum(["2x2", "3x2", "3x3"]), frames: z.array(z.record(z.string(), z.unknown())).max(9) }).passthrough();
const timelineSchema = z.record(z.string(), z.unknown());
const ignoredExportRoots = new Set([".trash", ".runtime", ".cache", ".claude"]);
const maxImportFiles = 20_000;
const maxImportBytes = 20 * 1024 * 1024 * 1024;
const workspaceWatchers = new Map<string, { watcher: FSWatcher; timer?: NodeJS.Timeout; pending: Set<string> }>();
let emitWorkspaceUpdate: (userId: string, projectId: string, diagnostics: DirectorDiagnostic[]) => void = () => undefined;

export function setDirectorWorkspaceEmitter(emitter: typeof emitWorkspaceUpdate) { emitWorkspaceUpdate = emitter; }

export function refreshDirectorProjectInstructions(userId: string, projectId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const project = db.prepare("SELECT title FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as { title: string } | undefined;
    if (project) writeFileAtomic(resolve(root, "AGENTS.md"), projectAgents(project.title));
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function directorProjectRoot(userId: string, projectId: string) {
    const user = createHash("sha256").update(userId).digest("hex");
    const safeProject = projectId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const root = resolve(config.directorProjectsDir, user, safeProject);
    if (!root.startsWith(`${config.directorProjectsDir}${sep}`)) throw workspaceError(400, "DIRECTOR_PATH_INVALID", "导演项目路径无效");
    return root;
}

export function ensureDirectorProjectWorkspace(userId: string, projectId: string) {
    const project = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as ProjectRow | undefined;
    if (!project) throw workspaceError(404, "PROJECT_NOT_FOUND", "导演项目不存在");
    const root = directorProjectRoot(userId, projectId);
    const storage = db.prepare("SELECT 1 FROM director_project_storage WHERE user_id=? AND project_id=?").get(userId, projectId);
    if (!storage || !existsSync(resolve(root, "project.yaml"))) migrateDirectorProject(userId, projectId);
    watchDirectorWorkspace(userId, projectId, root);
    return root;
}

export function migrateAllDirectorProjects() {
    const projects = db.prepare("SELECT id,user_id FROM projects WHERE kind='director'").all() as Array<{ id: string; user_id: string }>;
    return projects.map(({ user_id, id }) => migrateDirectorProject(user_id, id));
}

export function migrateDirectorProject(userId: string, projectId: string) {
    const project = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as ProjectRow | undefined;
    if (!project) throw workspaceError(404, "PROJECT_NOT_FOUND", "导演项目不存在");
    const root = directorProjectRoot(userId, projectId);
    const building = `${root}.building`;
    rmSync(building, { recursive: true, force: true });
    createSkeleton(building);
    const workspace = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    writeYaml(resolve(building, "project.yaml"), {
        format: "infinite-canvas-director", version: 1, id: project.id, name: project.title,
        targetDurationSeconds: workspace?.target_duration_seconds || 600, aspectRatio: workspace?.aspect_ratio || "16:9",
        language: workspace?.language || "zh-CN", stage: workspace?.stage || "source",
    });
    writeFileAtomic(resolve(building, "AGENTS.md"), projectAgents(project.title));
    exportSources(userId, projectId, building);
    exportDocuments(userId, projectId, building);
    exportDirection(userId, projectId, building, workspace);
    exportAssets(userId, projectId, building);
    exportStoryboards(userId, projectId, building);
    exportTimeline(userId, projectId, building);
    const diagnostics = validateDirectorRoot(building);
    const fatal = diagnostics.filter((item) => item.severity === "error");
    if (fatal.length) {
        rmSync(building, { recursive: true, force: true });
        throw workspaceError(409, "DIRECTOR_MIGRATION_INVALID", "导演项目迁移校验失败", fatal);
    }
    mkdirSync(dirname(root), { recursive: true });
    const backup = `${root}.pre-file-backup`;
    if (existsSync(root)) {
        rmSync(backup, { recursive: true, force: true });
        renameSync(root, backup);
    }
    renameSync(building, root);
    indexDirectorProject(userId, projectId, diagnostics);
    return { projectId, root, diagnostics, files: walkFiles(root).length };
}

export function validateDirectorProject(userId: string, projectId: string, relativeScope = "") {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const target = safeWorkspacePath(root, relativeScope || ".");
    const diagnostics = validateDirectorRoot(root, target);
    indexDirectorProject(userId, projectId, diagnostics);
    return { projectId, scope: relativeScope || ".", valid: !diagnostics.some((item) => item.severity === "error"), diagnostics };
}

export function getDirectorValidation(userId: string, projectId: string) {
    return validateDirectorProject(userId, projectId);
}

export function assertDirectorProjectValid(userId: string, projectId: string) {
    const result = validateDirectorProject(userId, projectId);
    const errors = result.diagnostics.filter((item) => item.severity === "error");
    if (errors.length) throw workspaceError(409, "DIRECTOR_PROJECT_INVALID", "工程存在错误，修正后才能执行付费生成或成片导出", errors);
    return result;
}

export function exportDirectorProjectZip(userId: string, projectId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const validation = validateDirectorProject(userId, projectId);
    if (!validation.valid) throw workspaceError(409, "DIRECTOR_PROJECT_INVALID", "工程存在错误，修正后才能导出", validation.diagnostics);
    const zip = new AdmZip();
    for (const path of walkFiles(root)) {
        const rel = posixRelative(root, path);
        if (ignoredExportRoots.has(rel.split("/")[0])) continue;
        zip.addLocalFile(path, dirname(rel) === "." ? "" : dirname(rel));
    }
    return { buffer: zip.toBuffer(), filename: `${slug(basename(root)) || "director-project"}.zip` };
}

export function importDirectorProjectZip(userId: string, projectId: string, buffer: Buffer) {
    if (!buffer.length || buffer.length > maxImportBytes) throw workspaceError(413, "DIRECTOR_IMPORT_SIZE", "工程包为空或超过大小限制");
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (entries.length > maxImportFiles) throw workspaceError(413, "DIRECTOR_IMPORT_FILES", "工程包文件数量超过限制");
    const root = directorProjectRoot(userId, projectId);
    const building = `${root}.importing`;
    rmSync(building, { recursive: true, force: true });
    mkdirSync(building, { recursive: true });
    let total = 0;
    try {
    for (const entry of entries) {
        const name = entry.entryName.replace(/\\/g, "/");
        if (!name || name.startsWith("/") || name.split("/").includes("..") || entry.attr && ((entry.attr >>> 16) & 0o170000) === 0o120000) {
            rmSync(building, { recursive: true, force: true });
            throw workspaceError(400, "DIRECTOR_IMPORT_PATH", `工程包包含非法路径：${name}`);
        }
        const target = safeWorkspacePath(building, name);
        if (entry.isDirectory) mkdirSync(target, { recursive: true });
        else {
            const data = entry.getData();
            total += data.length;
            if (total > maxImportBytes) throw workspaceError(413, "DIRECTOR_IMPORT_SIZE", "工程包解压后超过大小限制");
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, data);
        }
    }
    const diagnostics = validateDirectorRoot(building);
    if (diagnostics.some((item) => item.severity === "error")) {
        rmSync(building, { recursive: true, force: true });
        throw workspaceError(400, "DIRECTOR_IMPORT_INVALID", "工程包校验失败", diagnostics);
    }
    const project = parseYaml(readFileSync(resolve(building, "project.yaml"), "utf8")) as Record<string, unknown>;
    const importedTitle = (db.prepare("SELECT title FROM projects WHERE id=? AND user_id=?").get(projectId, userId) as { title: string } | undefined)?.title || String(project.name || "导入的导演项目");
    writeYaml(resolve(building, "project.yaml"), { ...project, id: projectId, name: importedTitle });
    const backup = `${root}.before-import`;
    if (existsSync(root)) {
        rmSync(backup, { recursive: true, force: true });
        renameSync(root, backup);
    }
    renameSync(building, root);
    indexDirectorProject(userId, projectId, diagnostics);
    reconcileDirectorProjectFiles(userId, projectId);
    return { projectId, files: entries.filter((entry) => !entry.isDirectory).length, diagnostics };
    } catch (error) {
        rmSync(building, { recursive: true, force: true });
        throw error;
    }
}

export function writeDirectorMarkdown(userId: string, projectId: string, relativePath: string, content: string, expectedHash?: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const path = safeWorkspacePath(root, relativePath);
    if (extname(path) !== ".md") throw workspaceError(400, "DIRECTOR_FILE_TYPE", "这里只能保存 Markdown 文件");
    const currentHash = existsSync(path) ? hashFile(path) : "";
    if (expectedHash !== undefined && expectedHash !== currentHash) throw workspaceError(409, "DIRECTOR_FILE_CONFLICT", "文件已被其他操作修改", { currentHash });
    writeFileAtomic(path, content);
    const diagnostics = validateDirectorRoot(root, path);
    indexDirectorProject(userId, projectId, diagnostics);
    return { path: posixRelative(root, path), hash: hashFile(path), diagnostics };
}

export function readDirectorTextFile(userId: string, projectId: string, relativePath: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const path = safeWorkspacePath(root, relativePath);
    if (!existsSync(path) || !statSync(path).isFile() || ![".md", ".yaml", ".yml", ".json"].includes(extname(path).toLowerCase())) throw workspaceError(404, "DIRECTOR_FILE_NOT_FOUND", "创作文件不存在");
    return { path: posixRelative(root, path), content: readFileSync(path, "utf8"), hash: hashFile(path) };
}

export function resolveDirectorEntityReference(userId: string, projectId: string, relativePath: string, allowedKinds: string[]) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    let path = safeWorkspacePath(root, relativePath);
    if (existsSync(path) && statSync(path).isDirectory()) {
        const entry = ["character.md", "location.md", "prop.md", "sequence.md", "segment.md"].map((name) => resolve(path, name)).find((candidate) => existsSync(candidate));
        if (!entry) throw workspaceError(404, "DIRECTOR_ENTITY_NOT_FOUND", "目录中没有可识别的导演实体文件");
        path = entry;
    }
    const rel = posixRelative(root, path);
    const row = db.prepare("SELECT entity_id,kind,sha256,revision FROM director_file_index WHERE user_id=? AND project_id=? AND path=?").get(userId, projectId, rel) as { entity_id: string | null; kind: string; sha256: string; revision: number } | undefined;
    if (!row?.entity_id || !allowedKinds.includes(row.kind)) throw workspaceError(404, "DIRECTOR_ENTITY_NOT_FOUND", "路径没有指向所需类型的导演实体");
    const table = row.kind === "video-segment" ? "director_shots" : row.kind === "sequence" ? "director_sequences" : "creative_assets";
    return { path: rel, externalId: row.entity_id, id: directorMirrorId(table, userId, projectId, row.entity_id), kind: row.kind, hash: row.sha256, fileRevision: row.revision };
}

export function trashDirectorProjectPath(userId: string, projectId: string, relativePath: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const path = safeWorkspacePath(root, relativePath);
    const rel = posixRelative(root, path);
    const protectedPaths = new Set(["AGENTS.md", "project.yaml", "story/index.md", "screenplay/index.md", "direction/visual-style.md", "direction/directing-rules.md", "timeline/timeline.json"]);
    if (!existsSync(path) || path === root || rel === ".trash" || rel.startsWith(".trash/") || !rel.includes("/") || protectedPaths.has(rel)) throw workspaceError(400, "DIRECTOR_TRASH_FORBIDDEN", "该路径不存在或属于工程必要文件，不能移入回收区");
    const target = moveToTrash(root, path);
    const diagnostics = validateDirectorRoot(root);
    indexDirectorProject(userId, projectId, diagnostics);
    reconcileDirectorProjectFiles(userId, projectId);
    return { path: rel, trashPath: posixRelative(root, target), diagnostics };
}

export function syncDirectorDocumentFile(userId: string, projectId: string, kind: "story" | "script", content: string, revision: number) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const relativePath = kind === "story" ? "story/index.md" : "screenplay/index.md";
    writeMarkdown(resolve(root, relativePath), { id: kind === "story" ? "story" : "screenplay", kind: kind === "story" ? "story" : "screenplay", name: kind === "story" ? "故事" : "剧本", sourceRevision: revision }, content);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorSourceFiles(userId: string, projectId: string, sourceId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const rows = db.prepare("SELECT * FROM director_sources WHERE user_id=? AND project_id=? ORDER BY created_at").all(userId, projectId) as Array<Record<string, unknown>>;
    const row = rows.find((item) => item.id === sourceId);
    if (!row) return;
    const existing = findEntityFile(resolve(root, "sources"), "source.md", sourceId);
    const index = rows.findIndex((item) => item.id === sourceId);
    const folder = existing ? dirname(existing) : resolve(root, "sources", `source-${pad(index + 1)}`);
    mkdirSync(resolve(folder, "chapters"), { recursive: true });
    writeMarkdown(resolve(folder, "source.md"), { id: row.id, kind: "source", name: row.name, sourceFileId: row.raw_file_id, status: row.status }, String(row.outline || row.summary || ""));
    const file = getStoredFile(userId, String(row.raw_file_id || ""));
    if (file) copyFileSync(file.path, resolve(folder, `original${extname(file.original_name) || ".bin"}`));
    const chunks = db.prepare("SELECT * FROM director_source_chunks WHERE user_id=? AND source_id=? ORDER BY ordinal").all(userId, sourceId) as Array<Record<string, unknown>>;
    chunks.forEach((chunk, chunkIndex) => writeMarkdown(resolve(folder, "chapters", `chapter-${pad(chunkIndex + 1)}.md`), { id: chunk.id, kind: "source-chapter", order: chunkIndex + 1, name: chunk.heading || `第 ${chunkIndex + 1} 章` }, String(chunk.content || "")));
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorBreakdownFile(userId: string, projectId: string, payload: unknown, revision: number) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    writeMarkdown(resolve(root, "screenplay", "breakdown", "overview.md"), { id: "screenplay-breakdown", kind: "screenplay-breakdown", sourceRevision: revision }, `\`\`\`yaml\n${stringifyYaml(payload)}\`\`\`\n`);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorTimelineFile(userId: string, projectId: string, payload: unknown) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    writeFileAtomic(resolve(root, "timeline", "timeline.json"), `${JSON.stringify(payload, null, 2)}\n`);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorDirectionFiles(userId: string, projectId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const workspace = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow | undefined;
    const project = db.prepare("SELECT id,title FROM projects WHERE user_id=? AND id=?").get(userId, projectId) as { id: string; title: string };
    writeYaml(resolve(root, "project.yaml"), { format: "infinite-canvas-director", version: 1, id: project.id, name: project.title, targetDurationSeconds: workspace?.target_duration_seconds || 600, aspectRatio: workspace?.aspect_ratio || "16:9", language: workspace?.language || "zh-CN", stage: workspace?.stage || "source" });
    exportDirection(userId, projectId, root, workspace);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorAssetFile(userId: string, projectId: string, assetId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const row = db.prepare("SELECT * FROM creative_assets WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, assetId) as AssetRow | undefined;
    if (!row) return;
    const base = row.kind === "character" ? "characters" : row.kind === "scene" ? "locations" : "props";
    const filename = row.kind === "character" ? "character.md" : row.kind === "scene" ? "location.md" : "prop.md";
    const externalId = directorExternalId(projectId, assetId);
    const existing = walkFiles(resolve(root, "assets", base)).find((path) => basename(path) === filename && matter(readFileSync(path, "utf8")).data.id === externalId);
    const prefix = row.kind === "character" ? "char" : row.kind === "scene" ? "loc" : "prop";
    const count = readdirSync(resolve(root, "assets", base), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length + 1;
    const folder = existing ? dirname(existing) : resolve(root, "assets", base, `${prefix}-${pad(count)}-${slug(row.name) || "asset"}`);
    const payload = parseJson<Record<string, unknown>>(row.payload, {});
    writeMarkdown(resolve(folder, filename), { ...assetFrontmatter(row, payload), id: externalId }, assetBody(payload));
    if (row.kind === "character") { mkdirSync(resolve(folder, "identity"), { recursive: true }); mkdirSync(resolve(folder, "voice"), { recursive: true }); }
    mkdirSync(resolve(folder, "variants"), { recursive: true });
    copyAssetMedia(userId, payload, folder, row.kind);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function trashDirectorAssetFolder(userId: string, projectId: string, assetId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const path = walkFiles(resolve(root, "assets")).find((item) => ["character.md", "location.md", "prop.md"].includes(basename(item)) && matter(readFileSync(item, "utf8")).data.id === assetId);
    if (!path) return;
    const source = dirname(path);
    const target = resolve(root, ".trash", `${Date.now()}-${basename(source)}`);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorSequenceFile(userId: string, projectId: string, sequenceId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const sequence = db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, sequenceId) as SequenceRow | undefined;
    if (!sequence) return;
    const externalId = directorExternalId(projectId, sequenceId);
    const sequencePath = findEntityFile(resolve(root, "storyboards"), "sequence.md", externalId);
    const folder = sequencePath ? dirname(sequencePath) : resolve(root, "storyboards", `seq-${pad(sequence.position + 1)}-${slug(sequence.title) || "sequence"}`);
    writeMarkdown(resolve(folder, "sequence.md"), { id: externalId, kind: "sequence", name: sequence.title, order: sequence.position + 1, sourceRevision: sequence.revision }, sequence.summary || "");
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function syncDirectorVideoSegmentFile(userId: string, projectId: string, segmentId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const segment = db.prepare("SELECT * FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, segmentId) as SegmentRow | undefined;
    if (!segment) return;
    const sequence = db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, segment.sequence_id) as SequenceRow | undefined;
    if (!sequence) return;
    syncDirectorSequenceFile(userId, projectId, sequence.id);
    const externalSequenceId = directorExternalId(projectId, sequence.id);
    const externalSegmentId = directorExternalId(projectId, segment.id);
    const sequencePath = findEntityFile(resolve(root, "storyboards"), "sequence.md", externalSequenceId);
    if (!sequencePath) return;
    const existing = findEntityFile(resolve(root, "storyboards"), "segment.md", externalSegmentId);
    const folder = existing ? dirname(existing) : resolve(dirname(sequencePath), `seg-${pad(segment.position + 1)}-${slug(segment.title) || "segment"}`);
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const sheet = documentRecord(payload.storyboardSheet || payload.storyboard);
    const references = {
        characters: externalizeReferences(projectId, payload.characterRefs),
        locations: externalizeReferences(projectId, payload.sceneRefs),
        props: externalizeReferences(projectId, payload.propRefs),
    };
    writeMarkdown(resolve(folder, "segment.md"), { id: externalSegmentId, kind: "video-segment", name: segment.title, sequenceId: externalSequenceId, order: segment.position + 1, durationSeconds: payload.durationSeconds || payload.duration || 4, references, sourceRevision: segment.revision }, String(payload.description || payload.action || ""));
    writeYaml(resolve(folder, "storyboard.yaml"), { version: 1, segmentId: externalSegmentId, layout: sheet.layout || "2x2", frames: Array.isArray(sheet.frames) ? sheet.frames : [] });
    writeFileAtomic(resolve(folder, "storyboard-prompt.md"), String(sheet.promptSnapshot || sheet.prompt || payload.storyboardPrompt || ""));
    const storyboardFileId = String(sheet.fileId || sheet.imageFileId || "");
    if (storyboardFileId) copyNamedFile(userId, storyboardFileId, resolve(folder, "storyboard.png"));
    const videoFolder = resolve(root, "videos", `seg-${externalSegmentId}`);
    writeFileAtomic(resolve(videoFolder, "video-prompt.md"), String(payload.videoPrompt || payload.prompt || ""));
    const video = documentRecord(payload.video);
    const currentVideoFileId = String(payload.videoFileId || "");
    const qualityPreset = String(payload.videoQualityPreset || payload.qualityPreset || "preview");
    copyCurrentMedia(userId, String(video.previewFileId || video.fileId || (qualityPreset === "preview" ? currentVideoFileId : "")), resolve(videoFolder, "preview.mp4"));
    copyCurrentMedia(userId, String(video.finalFileId || (qualityPreset === "final" ? currentVideoFileId : "")), resolve(videoFolder, "final.mp4"));
    copyCurrentMedia(userId, String(payload.nativeAudioFileId || video.modelAudioFileId || payload.modelAudioFileId || ""), resolve(videoFolder, "model-audio.wav"));
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function trashDirectorSequenceFolder(userId: string, projectId: string, sequenceId: string) {
    trashEntityFolder(userId, projectId, "storyboards", "sequence.md", sequenceId);
}

export function trashDirectorVideoSegmentFolder(userId: string, projectId: string, segmentId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    trashEntityFolder(userId, projectId, "storyboards", "segment.md", segmentId, false);
    const videoFolder = resolve(root, "videos", `seg-${segmentId}`);
    if (existsSync(videoFolder)) moveToTrash(root, videoFolder);
    indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

export function reconcileDirectorProjectFiles(userId: string, projectId: string) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    registerDirectorProjectMedia(userId, projectId, root);
    const now = new Date().toISOString();
    const manifest = projectSchema.parse(parseYaml(readFileSync(resolve(root, "project.yaml"), "utf8")));
    const projectRow = db.prepare("SELECT title,payload FROM projects WHERE user_id=? AND id=?").get(userId, projectId) as { title: string; payload: string };
    if (projectRow.title !== manifest.name) db.prepare("UPDATE projects SET title=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=?").run(manifest.name, now, userId, projectId);
    const manifestValues = manifest as Record<string, unknown>;
    db.prepare(`UPDATE director_workspaces SET target_duration_seconds=?,aspect_ratio=?,language=?,stage=?,updated_at=? WHERE user_id=? AND project_id=?`).run(
        Math.max(10, Number(manifestValues.targetDurationSeconds) || 600), String(manifestValues.aspectRatio || "16:9"), String(manifestValues.language || "zh-CN"), String(manifestValues.stage || "source"), now, userId, projectId,
    );
    for (const [kind, path] of [["story", "story/index.md"], ["script", "screenplay/index.md"]] as const) {
        const parsed = matter(readFileSync(resolve(root, path), "utf8"));
        const row = db.prepare("SELECT content FROM director_documents WHERE user_id=? AND project_id=? AND kind=?").get(userId, projectId, kind) as { content: string } | undefined;
        const content = parsed.content.trimEnd();
        if (row && row.content.trimEnd() !== content) db.prepare("UPDATE director_documents SET content=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND kind=?").run(content, now, userId, projectId, kind);
    }
    const timelinePath = resolve(root, "timeline", "timeline.json");
    const timeline = JSON.parse(readFileSync(timelinePath, "utf8")) as Record<string, unknown>;
    const current = db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string } | undefined;
    if (current && JSON.stringify(parseJson(current.payload, {})) !== JSON.stringify(timeline)) db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=?").run(JSON.stringify(timeline), now, userId, projectId);
    reconcileDirection(userId, projectId, root, now);
    reconcileSources(userId, projectId, root, now);
    reconcileAssets(userId, projectId, root, now);
    reconcileStoryboards(userId, projectId, root, now);
    const diagnostics = validateDirectorRoot(root);
    indexDirectorProject(userId, projectId, diagnostics);
    return diagnostics;
}

export function removeDirectorProjectWorkspace(userId: string, projectId: string) {
    const root = directorProjectRoot(userId, projectId);
    workspaceWatchers.get(root)?.watcher.close();
    workspaceWatchers.delete(root);
    const ids = db.prepare("SELECT file_id FROM file_refs WHERE user_id=? AND owner_type='director_project' AND owner_id=?").all(userId, projectId) as Array<{ file_id: string }>;
    db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='director_project' AND owner_id=?").run(userId, projectId);
    for (const { file_id } of ids) db.prepare("DELETE FROM stored_files WHERE id=? AND user_id=? AND NOT EXISTS (SELECT 1 FROM file_refs WHERE file_id=?)").run(file_id, userId, file_id);
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    for (const suffix of [".building", ".importing"]) if (existsSync(`${root}${suffix}`)) rmSync(`${root}${suffix}`, { recursive: true, force: true });
}

function watchDirectorWorkspace(userId: string, projectId: string, root: string) {
    if (workspaceWatchers.has(root)) return;
    try {
        const state: { watcher: FSWatcher; timer?: NodeJS.Timeout; pending: Set<string> } = { watcher: null as unknown as FSWatcher, pending: new Set() };
        state.watcher = watch(root, { recursive: true }, (_event, filename) => {
            const path = String(filename || "").replace(/\\/g, "/");
            if (!path || ignoredExportRoots.has(path.split("/")[0]!)) return;
            state.pending.add(path);
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(() => {
                if (!db.open) return;
                const pending = Array.from(state.pending);
                state.pending.clear();
                if (!pending.some((path) => indexedPathChanged(userId, projectId, root, path))) return;
                try { const diagnostics = reconcileDirectorProjectFiles(userId, projectId); emitWorkspaceUpdate(userId, projectId, diagnostics); } catch { /* diagnostics remain available through explicit validation */ }
            }, 250);
        });
        workspaceWatchers.set(root, state);
    } catch { /* explicit validation remains available on platforms without recursive watch */ }
}

function indexedPathChanged(userId: string, projectId: string, root: string, relativePath: string): boolean {
    const target = resolve(root, relativePath);
    if (existsSync(target) && statSync(target).isFile()) {
        const row = db.prepare("SELECT sha256 FROM director_file_index WHERE user_id=? AND project_id=? AND path=?").get(userId, projectId, posixRelative(root, target)) as { sha256: string } | undefined;
        return !row || row.sha256 !== hashFile(target);
    }
    const prefix = `${relativePath.replace(/\/+$/, "")}/%`;
    if (!existsSync(target)) return Boolean(db.prepare("SELECT 1 FROM director_file_index WHERE user_id=? AND project_id=? AND (path=? OR path LIKE ?) LIMIT 1").get(userId, projectId, relativePath, prefix));
    return walkFiles(target).some((path) => indexedPathChanged(userId, projectId, root, posixRelative(root, path)));
}

function exportSources(userId: string, projectId: string, root: string) {
    const rows = db.prepare("SELECT * FROM director_sources WHERE user_id=? AND project_id=? ORDER BY created_at").all(userId, projectId) as Array<Record<string, unknown>>;
    rows.forEach((row, index) => {
        const folder = resolve(root, "sources", `source-${pad(index + 1)}`);
        mkdirSync(resolve(folder, "chapters"), { recursive: true });
        writeMarkdown(resolve(folder, "source.md"), { id: row.id, kind: "source", name: row.name, sourceFileId: row.raw_file_id }, String(row.outline || row.summary || ""));
        const file = getStoredFile(userId, String(row.raw_file_id || ""));
        if (file) copyFileSync(file.path, resolve(folder, `original${extname(file.original_name) || ".bin"}`));
        const chunks = db.prepare("SELECT * FROM director_source_chunks WHERE user_id=? AND source_id=? ORDER BY ordinal").all(userId, row.id) as Array<Record<string, unknown>>;
        chunks.forEach((chunk, chunkIndex) => writeMarkdown(resolve(folder, "chapters", `chapter-${pad(chunkIndex + 1)}.md`), { id: chunk.id, kind: "source-chapter", order: chunkIndex + 1, name: chunk.heading || `第 ${chunkIndex + 1} 章` }, String(chunk.content || "")));
    });
}

function exportDocuments(userId: string, projectId: string, root: string) {
    const rows = db.prepare("SELECT * FROM director_documents WHERE user_id=? AND project_id=?").all(userId, projectId) as DocumentRow[];
    const story = rows.find((row) => row.kind === "story");
    const script = rows.find((row) => row.kind === "script");
    writeMarkdown(resolve(root, "story", "index.md"), { id: "story", kind: "story", name: "故事", sourceRevision: story?.revision || 0 }, story?.content || "");
    writeMarkdown(resolve(root, "screenplay", "index.md"), { id: "screenplay", kind: "screenplay", name: "剧本", sourceRevision: script?.revision || 0 }, script?.content || "");
    const breakdown = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string; revision: number } | undefined;
    writeMarkdown(resolve(root, "screenplay", "breakdown", "overview.md"), { id: "screenplay-breakdown", kind: "screenplay-breakdown", sourceRevision: breakdown?.revision || 0 }, `\`\`\`yaml\n${stringifyYaml(parseJson(breakdown?.payload, {}))}\`\`\`\n`);
}

function exportDirection(userId: string, projectId: string, root: string, workspace?: WorkspaceRow) {
    const project = db.prepare("SELECT id,payload FROM projects WHERE user_id=? AND id=?").get(userId, projectId) as { id: string; payload: string } | undefined;
    const activeStyleId = String(parseJson<{ defaultVisualStyleId?: string }>(project?.payload, {}).defaultVisualStyleId || "");
    const style = (activeStyleId
        ? db.prepare("SELECT * FROM visual_styles WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, activeStyleId)
        : db.prepare("SELECT * FROM visual_styles WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1").get(userId, projectId)) as StyleRow | undefined;
    const dna = parseJson<Record<string, unknown>>(style?.dna, {});
    writeMarkdown(resolve(root, "direction", "visual-style.md"), { id: directorExternalId(projectId, style?.id || `${project?.id || projectId}-visual-style`), kind: "visual-style", name: style?.name || "视觉风格", sourceRevision: style?.revision || 0 }, `${style?.description || ""}\n\n## Style DNA\n\n\`\`\`yaml\n${stringifyYaml(dna)}\`\`\`\n`);
    const rules = parseJson<Record<string, string>>(workspace?.directing_rules, {});
    writeMarkdown(resolve(root, "direction", "directing-rules.md"), { id: "directing-rules", kind: "directing-rules", name: "导演规则" }, Object.entries(rules).map(([key, value]) => `## ${key}\n\n${value || ""}`).join("\n\n"));
    copyReferencedFiles(userId, style ? parseJson(style.reference_files, {}) : {}, resolve(root, "direction", "references"));
}

function exportAssets(userId: string, projectId: string, root: string) {
    const rows = db.prepare("SELECT * FROM creative_assets WHERE user_id=? AND project_id=? ORDER BY created_at").all(userId, projectId) as AssetRow[];
    const counters = { character: 0, scene: 0, prop: 0 };
    for (const row of rows) {
        if (!(row.kind in counters)) continue;
        const count = ++counters[row.kind];
        const prefix = row.kind === "character" ? "char" : row.kind === "scene" ? "loc" : "prop";
        const base = row.kind === "character" ? "characters" : row.kind === "scene" ? "locations" : "props";
        const folder = resolve(root, "assets", base, `${prefix}-${pad(count)}-${slug(row.name) || "asset"}`);
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        const filename = row.kind === "character" ? "character.md" : row.kind === "scene" ? "location.md" : "prop.md";
        writeMarkdown(resolve(folder, filename), assetFrontmatter(row, payload), assetBody(payload));
        if (row.kind === "character") {
            mkdirSync(resolve(folder, "identity"), { recursive: true });
            mkdirSync(resolve(folder, "voice"), { recursive: true });
        }
        mkdirSync(resolve(folder, "variants"), { recursive: true });
        copyAssetMedia(userId, payload, folder, row.kind);
    }
}

function exportStoryboards(userId: string, projectId: string, root: string) {
    const sequences = db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position,created_at").all(userId, projectId) as SequenceRow[];
    const segments = db.prepare("SELECT * FROM director_shots WHERE user_id=? AND project_id=? ORDER BY sequence_id,position,created_at").all(userId, projectId) as SegmentRow[];
    sequences.forEach((sequence, sequenceIndex) => {
        const seqName = `seq-${pad(sequenceIndex + 1)}-${slug(sequence.title) || "sequence"}`;
        writeMarkdown(resolve(root, "storyboards", seqName, "sequence.md"), { id: sequence.id, kind: "sequence", name: sequence.title, order: sequenceIndex + 1, sourceRevision: sequence.revision }, sequence.summary || "");
        segments.filter((segment) => segment.sequence_id === sequence.id).forEach((segment, segmentIndex) => {
            const payload = parseJson<Record<string, unknown>>(segment.payload, {});
            const folder = resolve(root, "storyboards", seqName, `seg-${pad(segmentIndex + 1)}-${slug(segment.title) || "segment"}`);
            const refs = { characters: payload.characterRefs || [], locations: payload.sceneRefs || [], props: payload.propRefs || [] };
            writeMarkdown(resolve(folder, "segment.md"), { id: segment.id, kind: "video-segment", name: segment.title, sequenceId: sequence.id, order: segmentIndex + 1, durationSeconds: payload.durationSeconds || payload.duration || 4, references: refs, sourceRevision: segment.revision }, String(payload.description || payload.action || ""));
            const board = payload.storyboardSheet && typeof payload.storyboardSheet === "object" ? payload.storyboardSheet as Record<string, unknown>
                : payload.storyboard && typeof payload.storyboard === "object" ? payload.storyboard as Record<string, unknown> : {};
            writeYaml(resolve(folder, "storyboard.yaml"), { version: 1, segmentId: segment.id, layout: board.layout || "2x2", frames: Array.isArray(board.frames) ? board.frames : [] });
            writeFileAtomic(resolve(folder, "storyboard-prompt.md"), String(board.prompt || payload.storyboardPrompt || ""));
            copyNamedFile(userId, String(board.imageFileId || board.fileId || ""), resolve(folder, "storyboard.png"));
            const videoFolder = resolve(root, "videos", `seg-${segment.id}`);
            writeFileAtomic(resolve(videoFolder, "video-prompt.md"), String(payload.videoPrompt || payload.prompt || ""));
            const video = payload.video && typeof payload.video === "object" ? payload.video as Record<string, unknown> : {};
            const currentVideoFileId = String(payload.videoFileId || "");
            const qualityPreset = String(payload.videoQualityPreset || payload.qualityPreset || "preview");
            copyNamedFile(userId, String(video.previewFileId || video.fileId || (qualityPreset === "preview" ? currentVideoFileId : "")), resolve(videoFolder, "preview.mp4"));
            copyNamedFile(userId, String(video.finalFileId || (qualityPreset === "final" ? currentVideoFileId : "")), resolve(videoFolder, "final.mp4"));
            copyNamedFile(userId, String(payload.nativeAudioFileId || video.modelAudioFileId || payload.modelAudioFileId || ""), resolve(videoFolder, "model-audio.wav"));
        });
    });
}

function reconcileDirection(userId: string, projectId: string, root: string, now: string) {
    const styleDocument = matter(readFileSync(resolve(root, "direction", "visual-style.md"), "utf8"));
    const styleId = directorMirrorId("visual_styles", userId, projectId, String(styleDocument.data.id || "visual-style"));
    const styleName = String(styleDocument.data.name || "视觉风格");
    const dnaBlock = styleDocument.content.match(/```yaml\s*([\s\S]*?)```/i)?.[1] || "{}";
    const description = styleDocument.content.replace(/## Style DNA[\s\S]*$/i, "").trim();
    const existingStyle = db.prepare("SELECT description,dna FROM visual_styles WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, styleId) as { description: string; dna: string } | undefined;
    const dna = stringifyRecord(parseYaml(dnaBlock));
    if (!existingStyle) db.prepare(`INSERT INTO visual_styles(id,user_id,project_id,name,mode,description,status,dna,reference_files,revision,created_at,updated_at) VALUES(?,?,?,?,'custom',?,'draft',?,'{}',1,?,?)`).run(styleId, userId, projectId, styleName, description, dna, now, now);
    else if (existingStyle.description !== description || existingStyle.dna !== dna) db.prepare("UPDATE visual_styles SET name=?,description=?,dna=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND id=?").run(styleName, description, dna, now, userId, projectId, styleId);
    const payload = parseJson<Record<string, unknown>>((db.prepare("SELECT payload FROM projects WHERE user_id=? AND id=?").get(userId, projectId) as { payload: string }).payload, {});
    if (payload.defaultVisualStyleId !== styleId) db.prepare("UPDATE projects SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=?").run(JSON.stringify({ ...payload, defaultVisualStyleId: styleId }), now, userId, projectId);
    const rulesDocument = matter(readFileSync(resolve(root, "direction", "directing-rules.md"), "utf8"));
    const rules = Object.fromEntries(Array.from(rulesDocument.content.matchAll(/^##\s+(.+?)\s*$\n([\s\S]*?)(?=^##\s+|$)/gm)).map((match) => [match[1]!.trim(), match[2]!.trim()]));
    db.prepare("UPDATE director_workspaces SET directing_rules=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND directing_rules<>?").run(JSON.stringify(rules), now, userId, projectId, JSON.stringify(rules));
}

function reconcileSources(userId: string, projectId: string, root: string, now: string) {
    const seenSources = new Set<string>();
    const seenChunks = new Set<string>();
    for (const path of walkFiles(resolve(root, "sources")).filter((item) => basename(item) === "source.md")) {
        const document = matter(readFileSync(path, "utf8"));
        const entity = entitySchema.parse(document.data);
        const sourceId = directorMirrorId("director_sources", userId, projectId, entity.id);
        seenSources.add(sourceId);
        const folder = dirname(path);
        const original = walkFiles(folder).find((item) => basename(item).startsWith("original."));
        if (!original) continue;
        const rawFileId = registerDirectorStoredFile(userId, projectId, root, original, mimeTypeForPath(original));
        const chapterPaths = walkFiles(resolve(folder, "chapters")).filter((item) => item.endsWith(".md")).sort();
        const chapters = chapterPaths.map((chapterPath, index) => {
            const chapter = matter(readFileSync(chapterPath, "utf8"));
            const externalId = String(chapter.data.id || `${entity.id}-chapter-${pad(index + 1)}`);
            const id = directorMirrorId("director_source_chunks", userId, projectId, externalId);
            seenChunks.add(id);
            return { id, heading: String(chapter.data.name || `第 ${index + 1} 章`), content: chapter.content.trimEnd(), ordinal: index };
        });
        const name = entity.name || entity.title || basename(original);
        const existing = db.prepare("SELECT raw_file_id,name,mime_type,status,char_count,chapter_count,summary FROM director_sources WHERE id=? AND user_id=? AND project_id=?").get(sourceId, userId, projectId) as Record<string, unknown> | undefined;
        const charCount = chapters.reduce((sum, item) => sum + item.content.length, 0);
        const summary = document.content.trim();
        if (!existing) db.prepare(`INSERT INTO director_sources(id,user_id,project_id,raw_file_id,name,mime_type,status,error,char_count,chapter_count,summary,outline,revision,created_at,updated_at)
            VALUES(?,?,?,?,?,?,'ready',NULL,?,?,?, '',1,?,?)`).run(sourceId, userId, projectId, rawFileId, name, mimeTypeForPath(original), charCount, chapters.length, summary, now, now);
        else if (existing.raw_file_id !== rawFileId || existing.name !== name || existing.mime_type !== mimeTypeForPath(original) || existing.status !== "ready" || Number(existing.char_count) !== charCount || Number(existing.chapter_count) !== chapters.length || existing.summary !== summary) db.prepare("UPDATE director_sources SET raw_file_id=?,name=?,mime_type=?,status='ready',char_count=?,chapter_count=?,summary=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND project_id=?")
            .run(rawFileId, name, mimeTypeForPath(original), charCount, chapters.length, summary, now, sourceId, userId, projectId);
        const insert = db.prepare("INSERT INTO director_source_chunks(id,user_id,project_id,source_id,ordinal,heading,content,summary,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'','ready',1,?,?)");
        for (const chapter of chapters) {
            const current = db.prepare("SELECT source_id,ordinal,heading,content,status FROM director_source_chunks WHERE id=? AND user_id=?").get(chapter.id, userId) as Record<string, unknown> | undefined;
            if (!current) insert.run(chapter.id, userId, projectId, sourceId, chapter.ordinal, chapter.heading, chapter.content, now, now);
            else if (current.source_id !== sourceId || Number(current.ordinal) !== chapter.ordinal || current.heading !== chapter.heading || current.content !== chapter.content || current.status !== "ready") db.prepare("UPDATE director_source_chunks SET source_id=?,ordinal=?,heading=?,content=?,status='ready',revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(sourceId, chapter.ordinal, chapter.heading, chapter.content, now, chapter.id, userId);
        }
    }
    for (const row of db.prepare("SELECT id FROM director_source_chunks WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>) if (!seenChunks.has(row.id)) db.prepare("DELETE FROM director_source_chunks WHERE id=? AND user_id=?").run(row.id, userId);
    for (const row of db.prepare("SELECT id FROM director_sources WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>) if (!seenSources.has(row.id)) db.prepare("DELETE FROM director_sources WHERE id=? AND user_id=?").run(row.id, userId);
}

function reconcileAssets(userId: string, projectId: string, root: string, now: string) {
    const seen = new Set<string>();
    for (const [folder, kind, filename] of [["characters", "character", "character.md"], ["locations", "scene", "location.md"], ["props", "prop", "prop.md"]] as const) {
        const base = resolve(root, "assets", folder);
        for (const path of walkFiles(base).filter((path) => basename(path) === filename)) {
            const document = matter(readFileSync(path, "utf8"));
            const entity = entitySchema.parse(document.data);
            const mirrorId = directorMirrorId("creative_assets", userId, projectId, entity.id);
            seen.add(mirrorId);
            const existing = db.prepare("SELECT name,payload FROM creative_assets WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, mirrorId) as { name: string; payload: string } | undefined;
            const currentPayload = parseJson<Record<string, unknown>>(existing?.payload, {});
            const media = assetMediaVariants(userId, projectId, root, dirname(path), kind);
            const payload = {
                ...currentPayload,
                description: section(document.content, "描述") || document.content.trim(),
                narrativeDescription: section(document.content, "剧情身份") || currentPayload.narrativeDescription || "",
                visualDescription: section(document.content, "视觉设定") || currentPayload.visualDescription || "",
                designProfile: document.data.designProfile ?? currentPayload.designProfile ?? null,
                mediaDrafts: document.data.mediaDrafts ?? currentPayload.mediaDrafts,
                dependencies: document.data.dependencies ?? currentPayload.dependencies,
                requiredVariants: document.data.requiredVariants || currentPayload.requiredVariants || [],
                variants: media.length ? media : currentPayload.variants || [],
                primaryImageId: media.find((item) => item.kind === "image")?.id || currentPayload.primaryImageId || null,
                primaryAudioId: media.find((item) => item.kind === "audio")?.id || currentPayload.primaryAudioId || null,
            };
            const name = entity.name || entity.title || entity.id;
            if (!existing) db.prepare("INSERT INTO creative_assets(id,user_id,project_id,kind,name,status,payload,revision,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,1,?,?)").run(mirrorId, userId, projectId, kind, name, JSON.stringify(payload), now, now);
            else if (existing.name !== name || JSON.stringify(parseJson(existing.payload, {})) !== JSON.stringify(payload)) db.prepare("UPDATE creative_assets SET name=?,payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND id=?").run(name, JSON.stringify(payload), now, userId, projectId, mirrorId);
        }
    }
    for (const row of db.prepare("SELECT id FROM creative_assets WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>) if (!seen.has(row.id)) db.prepare("DELETE FROM creative_assets WHERE id=? AND user_id=?").run(row.id, userId);
}

function reconcileStoryboards(userId: string, projectId: string, root: string, now: string) {
    const seenSequences = new Set<string>();
    const seenSegments = new Set<string>();
    const sequenceFiles = walkFiles(resolve(root, "storyboards")).filter((path) => basename(path) === "sequence.md");
    for (const sequencePath of sequenceFiles) {
        const document = matter(readFileSync(sequencePath, "utf8"));
        const entity = entitySchema.parse(document.data);
        const sequenceId = directorMirrorId("director_sequences", userId, projectId, entity.id);
        seenSequences.add(sequenceId);
        const position = Math.max(0, Number(document.data.order) - 1 || 0);
        const name = entity.name || entity.title || entity.id;
        const sequence = db.prepare("SELECT title,summary,position FROM director_sequences WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, sequenceId) as { title: string; summary: string; position: number } | undefined;
        if (!sequence) db.prepare("INSERT INTO director_sequences(id,user_id,project_id,position,title,summary,status,payload,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft','{}',1,?,?)").run(sequenceId, userId, projectId, position, name, document.content.trim(), now, now);
        else if (sequence.title !== name || sequence.summary !== document.content.trim() || sequence.position !== position) db.prepare("UPDATE director_sequences SET position=?,title=?,summary=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND id=?").run(position, name, document.content.trim(), now, userId, projectId, sequenceId);
        const segmentFiles = walkFiles(dirname(sequencePath)).filter((path) => basename(path) === "segment.md");
        for (const segmentPath of segmentFiles) {
            const segmentDocument = matter(readFileSync(segmentPath, "utf8"));
            const segmentEntity = entitySchema.parse(segmentDocument.data);
            const segmentId = directorMirrorId("director_shots", userId, projectId, segmentEntity.id);
            seenSegments.add(segmentId);
            const segmentFolder = dirname(segmentPath);
            const storyboard = storyboardSchema.parse(parseYaml(readFileSync(resolve(segmentFolder, "storyboard.yaml"), "utf8")));
            const existing = db.prepare("SELECT title,position,payload FROM director_shots WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, segmentId) as { title: string; position: number; payload: string } | undefined;
            const currentPayload = parseJson<Record<string, unknown>>(existing?.payload, {});
            const references = documentRecord(segmentDocument.data.references);
            const currentSheet = documentRecord(currentPayload.storyboardSheet);
            const prompt = existsSync(resolve(segmentFolder, "storyboard-prompt.md")) ? readFileSync(resolve(segmentFolder, "storyboard-prompt.md"), "utf8") : "";
            const nextSheet: Record<string, unknown> = { ...currentSheet, revision: Number(currentSheet.revision) || 1, layout: storyboard.layout, frames: storyboard.frames };
            const storyboardImage = resolve(segmentFolder, "storyboard.png");
            if (existsSync(storyboardImage)) nextSheet.imageFileId = registerDirectorMediaFile(userId, projectId, root, storyboardImage);
            if (prompt || "promptSnapshot" in currentSheet) nextSheet.promptSnapshot = prompt;
            const payload: Record<string, unknown> = {
                ...currentPayload,
                durationSeconds: Number(segmentDocument.data.durationSeconds) || 4,
                characterRefs: remapReferences("creative_assets", userId, projectId, references.characters),
                sceneRefs: remapReferences("creative_assets", userId, projectId, references.locations),
                propRefs: remapReferences("creative_assets", userId, projectId, references.props),
                storyboardSheet: nextSheet,
            };
            const videoFolder = resolve(root, "videos", `seg-${segmentEntity.id}`);
            const finalVideo = resolve(videoFolder, "final.mp4");
            const previewVideo = resolve(videoFolder, "preview.mp4");
            const modelAudio = resolve(videoFolder, "model-audio.wav");
            if (existsSync(finalVideo) || existsSync(previewVideo)) payload.videoFileId = registerDirectorMediaFile(userId, projectId, root, existsSync(finalVideo) ? finalVideo : previewVideo);
            if (existsSync(modelAudio)) payload.nativeAudioFileId = registerDirectorMediaFile(userId, projectId, root, modelAudio);
            const description = segmentDocument.content.trim();
            if (description || "description" in currentPayload) payload.description = description;
            const segmentName = segmentEntity.name || segmentEntity.title || segmentEntity.id;
            const segmentPosition = Math.max(0, Number(segmentDocument.data.order) - 1 || 0);
            if (!existing) db.prepare("INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,status,payload,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,1,?,?)").run(segmentId, userId, projectId, sequenceId, segmentPosition, segmentName, JSON.stringify(payload), now, now);
            else if (existing.title !== segmentName || existing.position !== segmentPosition || JSON.stringify(parseJson(existing.payload, {})) !== JSON.stringify(payload)) db.prepare("UPDATE director_shots SET sequence_id=?,position=?,title=?,payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND id=?").run(sequenceId, segmentPosition, segmentName, JSON.stringify(payload), now, userId, projectId, segmentId);
        }
    }
    for (const row of db.prepare("SELECT id FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>) if (!seenSegments.has(row.id)) db.prepare("DELETE FROM director_shots WHERE id=? AND user_id=?").run(row.id, userId);
    for (const row of db.prepare("SELECT id FROM director_sequences WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>) if (!seenSequences.has(row.id)) db.prepare("DELETE FROM director_sequences WHERE id=? AND user_id=?").run(row.id, userId);
}

function exportTimeline(userId: string, projectId: string, root: string) {
    const row = db.prepare("SELECT payload FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as { payload: string } | undefined;
    writeFileAtomic(resolve(root, "timeline", "timeline.json"), `${JSON.stringify(parseJson(row?.payload, {}), null, 2)}\n`);
}

function validateDirectorRoot(root: string, scope = root): DirectorDiagnostic[] {
    const diagnostics: DirectorDiagnostic[] = [];
    const projectPath = resolve(root, "project.yaml");
    if (!existsSync(projectPath)) diagnostics.push(diag("error", "PROJECT_MANIFEST_MISSING", "project.yaml", "缺少 project.yaml"));
    else validateParsed(projectPath, () => projectSchema.parse(parseYaml(readFileSync(projectPath, "utf8"))), diagnostics, root, "PROJECT_MANIFEST_INVALID");
    const files = (existsSync(scope) && statSync(scope).isFile() ? [scope] : walkFiles(scope))
        .filter((path) => !ignoredExportRoots.has(posixRelative(root, path).split("/")[0]!));
    const ids = new Map<string, string>();
    const knownIds = new Set(walkFiles(root).filter((path) => path.endsWith(".md")).flatMap((path) => {
        try { const id = matter(readFileSync(path, "utf8")).data.id; return typeof id === "string" ? [id] : []; } catch { return []; }
    }));
    const documents: Array<{ path: string; data: Record<string, unknown> }> = [];
    for (const path of files) {
        const rel = posixRelative(root, path);
        if (rel.includes("..") || lstatSync(path).isSymbolicLink()) diagnostics.push(diag("error", "ILLEGAL_PATH", rel, "工程包含非法路径或符号链接"));
        if (path.endsWith(".md")) validateParsed(path, () => {
            const parsed = matter(readFileSync(path, "utf8"));
            if (["AGENTS.md", "storyboard-prompt.md", "video-prompt.md"].includes(basename(path)) || basename(path).startsWith("original.")) return;
            const entity = entitySchema.parse(parsed.data);
            documents.push({ path: rel, data: parsed.data as Record<string, unknown> });
            if (ids.has(entity.id)) diagnostics.push({ ...diag("error", "DUPLICATE_ID", rel, `实体 ID 与 ${ids.get(entity.id)} 重复`), entityId: entity.id });
            else ids.set(entity.id, rel);
        }, diagnostics, root, "FRONTMATTER_INVALID");
        if (basename(path) === "storyboard.yaml") validateParsed(path, () => {
            const board = storyboardSchema.parse(parseYaml(readFileSync(path, "utf8")));
            const expected = board.layout === "2x2" ? 4 : board.layout === "3x2" ? 6 : 9;
            if (board.frames.length !== expected) diagnostics.push(diag("error", "STORYBOARD_FRAME_COUNT", rel, `${board.layout} 故事板必须包含 ${expected} 个画格`));
            const segmentPath = resolve(dirname(path), "segment.md");
            if (existsSync(segmentPath) && String(matter(readFileSync(segmentPath, "utf8")).data.id || "") !== board.segmentId) diagnostics.push(diag("error", "STORYBOARD_SEGMENT_MISMATCH", rel, "故事板 segmentId 与所在视频段不一致"));
        }, diagnostics, root, "STORYBOARD_INVALID");
        if (basename(path) === "timeline.json") validateParsed(path, () => timelineSchema.parse(JSON.parse(readFileSync(path, "utf8"))), diagnostics, root, "TIMELINE_INVALID");
    }
    const sequenceOrders = new Map<number, string>();
    const segmentOrders = new Map<string, Map<number, string>>();
    for (const document of documents) {
        const kind = String(document.data.kind || "");
        if (kind === "sequence") {
            const order = Number(document.data.order);
            if (Number.isFinite(order) && sequenceOrders.has(order)) diagnostics.push(diag("error", "DUPLICATE_SEQUENCE_ORDER", document.path, `剧情段落顺序与 ${sequenceOrders.get(order)} 重复`));
            else if (Number.isFinite(order)) sequenceOrders.set(order, document.path);
        }
        if (kind !== "video-segment") continue;
        const duration = Number(document.data.durationSeconds);
        if (!Number.isFinite(duration) || duration < 4 || duration > 15) diagnostics.push(diag("error", "VIDEO_SEGMENT_DURATION", document.path, "视频段时长必须为 4–15 秒"));
        const sequenceId = String(document.data.sequenceId || "");
        if (!knownIds.has(sequenceId)) diagnostics.push(diag("error", "SEGMENT_SEQUENCE_MISSING", document.path, `视频段引用的剧情段落不存在：${sequenceId}`));
        const orders = segmentOrders.get(sequenceId) || new Map<number, string>();
        const order = Number(document.data.order);
        if (Number.isFinite(order) && orders.has(order)) diagnostics.push(diag("error", "DUPLICATE_SEGMENT_ORDER", document.path, `同一剧情段落内的视频段顺序与 ${orders.get(order)} 重复`));
        else if (Number.isFinite(order)) orders.set(order, document.path);
        segmentOrders.set(sequenceId, orders);
        const references = documentRecord(document.data.references);
        for (const [label, values] of [["角色", references.characters], ["场景", references.locations], ["道具", references.props]] as const) {
            if (!Array.isArray(values)) continue;
            for (const value of values) {
                const id = typeof value === "string" ? value : value && typeof value === "object" ? String((value as Record<string, unknown>).id || "") : "";
                if (id && !knownIds.has(id)) diagnostics.push(diag("error", "ASSET_REFERENCE_MISSING", document.path, `${label}引用不存在：${id}`));
                const variantId = value && typeof value === "object" ? String((value as Record<string, unknown>).variantId || "") : "";
                if (variantId && !knownIds.has(variantId)) diagnostics.push(diag("error", "VARIANT_REFERENCE_MISSING", document.path, `素材变体不存在：${variantId}`));
            }
        }
        const folder = resolve(root, dirname(document.path));
        if (!existsSync(resolve(folder, "storyboard-prompt.md"))) diagnostics.push(diag("warning", "STORYBOARD_PROMPT_MISSING", document.path, "缺少故事板提示词"));
        if (!existsSync(resolve(folder, "storyboard.png"))) diagnostics.push(diag("info", "STORYBOARD_MEDIA_PENDING", document.path, "故事板图片尚未生成"));
    }
    for (const required of ["story/index.md", "screenplay/index.md", "direction/visual-style.md", "direction/directing-rules.md", "timeline/timeline.json"]) {
        if (!existsSync(resolve(root, required))) diagnostics.push(diag("error", "REQUIRED_FILE_MISSING", required, "缺少必要工程文件"));
    }
    return diagnostics;
}

function indexDirectorProject(userId: string, projectId: string, diagnostics: DirectorDiagnostic[]) {
    const root = directorProjectRoot(userId, projectId);
    registerDirectorProjectMedia(userId, projectId, root);
    const now = new Date().toISOString();
    const previous = new Map((db.prepare("SELECT path,sha256,revision FROM director_file_index WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ path: string; sha256: string; revision: number }>).map((row) => [row.path, row]));
    const upsert = db.prepare(`INSERT INTO director_file_index(user_id,project_id,path,entity_id,kind,sha256,revision,bytes,media_type,metadata,diagnostics,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,project_id,path) DO UPDATE SET entity_id=excluded.entity_id,kind=excluded.kind,sha256=excluded.sha256,revision=excluded.revision,bytes=excluded.bytes,media_type=excluded.media_type,metadata=excluded.metadata,diagnostics=excluded.diagnostics,updated_at=excluded.updated_at`);
    const seen = new Set<string>();
    db.transaction(() => {
        for (const path of walkFiles(root).filter((path) => !ignoredExportRoots.has(posixRelative(root, path).split("/")[0]!))) {
            const rel = posixRelative(root, path);
            const sha = hashFile(path);
            const prior = previous.get(rel);
            const revision = prior ? prior.revision + Number(prior.sha256 !== sha) : 1;
            const info = fileInfo(path);
            const fileDiagnostics = diagnostics.filter((item) => item.path === rel);
            upsert.run(userId, projectId, rel, info.entityId, info.kind, sha, revision, statSync(path).size, info.mediaType, "{}", JSON.stringify(fileDiagnostics), now);
            seen.add(rel);
        }
        for (const path of previous.keys()) if (!seen.has(path)) db.prepare("DELETE FROM director_file_index WHERE user_id=? AND project_id=? AND path=?").run(userId, projectId, path);
        const rootHash = createHash("sha256").update(Array.from(seen).sort().map((path) => `${path}:${hashFile(resolve(root, path))}`).join("\n")).digest("hex");
        db.prepare(`INSERT INTO director_project_storage(user_id,project_id,format_version,root_hash,migrated_at,indexed_at) VALUES(?,?,1,?,?,?)
            ON CONFLICT(user_id,project_id) DO UPDATE SET root_hash=excluded.root_hash,indexed_at=excluded.indexed_at`).run(userId, projectId, rootHash, now, now);
    })();
}

function registerDirectorProjectMedia(userId: string, projectId: string, root: string) {
    for (const path of walkFiles(root)) if (mediaMimeType(path)) registerDirectorMediaFile(userId, projectId, root, path);
}

function registerDirectorMediaFile(userId: string, projectId: string, root: string, path: string) {
    return registerDirectorStoredFile(userId, projectId, root, path, mediaMimeType(path) || "application/octet-stream");
}

function registerDirectorStoredFile(userId: string, projectId: string, root: string, path: string, mimeType: string) {
    const rel = posixRelative(root, path);
    const storedPath = posixRelative(config.dataDir, path);
    const id = `director-${createHash("sha256").update(`${userId}:${projectId}:${rel}`).digest("hex").slice(0, 32)}`;
    const now = new Date().toISOString();
    const metadata = JSON.stringify({ directorProjectId: projectId, directorPath: rel, sha256: hashFile(path) });
    db.prepare(`INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET original_name=excluded.original_name,mime_type=excluded.mime_type,bytes=excluded.bytes,metadata=excluded.metadata`)
        .run(id, userId, storedPath, basename(path), mimeType, statSync(path).size, metadata, now);
    const row = db.prepare("SELECT id FROM stored_files WHERE path=? AND user_id=?").get(storedPath, userId) as { id: string } | undefined;
    const fileId = row?.id || id;
    db.prepare("INSERT OR IGNORE INTO file_refs(file_id,user_id,owner_type,owner_id) VALUES(?,?,?,?)").run(fileId, userId, "director_project", projectId);
    return fileId;
}

function assetMediaVariants(userId: string, projectId: string, root: string, folder: string, kind: AssetRow["kind"]) {
    const priority = (path: string) => basename(path).startsWith("body-front") ? 0 : basename(path).startsWith("face-closeup") ? 1 : basename(path).startsWith("reference") ? 2 : 3;
    return walkFiles(folder).filter((path) => mediaMimeType(path)).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)).map((path) => {
        const rel = posixRelative(folder, path);
        const mediaKind = mediaMimeType(path)!.startsWith("audio/") ? "audio" as const : "image" as const;
        const usage = rel.startsWith("identity/face-closeup") ? "identity_reference"
            : rel.startsWith("identity/body-front") ? "body_front_reference"
                : rel.startsWith("identity/body-back") ? "body_back_reference"
                    : rel.startsWith("voice/") ? "voice_reference"
                        : rel.startsWith("variants/") ? "variant_reference"
                            : kind === "scene" ? "location_reference" : kind === "prop" ? "prop_reference" : "design_reference";
        return {
            id: `media-${createHash("sha256").update(rel).digest("hex").slice(0, 20)}`,
            kind: mediaKind,
            fileId: registerDirectorMediaFile(userId, projectId, root, path),
            label: basename(path, extname(path)).replace(/[-_]+/g, " "),
            prompt: "",
            usage,
            createdAt: statSync(path).birthtime.toISOString() || statSync(path).mtime.toISOString(),
        };
    });
}

function mediaMimeType(path: string) {
    const extension = extname(path).toLowerCase();
    return ({
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
        ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
    } as Record<string, string>)[extension] || "";
}

function directorMirrorId(table: "visual_styles" | "creative_assets" | "director_sources" | "director_source_chunks" | "director_sequences" | "director_shots", userId: string, projectId: string, externalId: string) {
    const row = db.prepare(`SELECT project_id FROM ${table} WHERE id=? AND user_id=?`).get(externalId, userId) as { project_id: string } | undefined;
    return !row || row.project_id === projectId ? externalId : `${projectId}:${externalId}`;
}

function mimeTypeForPath(path: string) {
    return mediaMimeType(path) || ({ ".pdf": "application/pdf", ".epub": "application/epub+zip", ".md": "text/markdown", ".txt": "text/plain" } as Record<string, string>)[extname(path).toLowerCase()] || "application/octet-stream";
}

function directorExternalId(projectId: string, mirrorId: string) {
    const prefix = `${projectId}:`;
    return mirrorId.startsWith(prefix) ? mirrorId.slice(prefix.length) : mirrorId;
}

function remapReferences(table: "creative_assets", userId: string, projectId: string, value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (typeof item === "string") return directorMirrorId(table, userId, projectId, item);
        if (!item || typeof item !== "object") return item;
        const record = item as Record<string, unknown>;
        return typeof record.id === "string" ? { ...record, id: directorMirrorId(table, userId, projectId, record.id) } : item;
    });
}

function externalizeReferences(projectId: string, value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => typeof item === "string" ? directorExternalId(projectId, item)
        : item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
            ? { ...(item as Record<string, unknown>), id: directorExternalId(projectId, String((item as Record<string, unknown>).id)) }
            : item);
}

function createSkeleton(root: string) {
    ["sources", "story/chapters", "screenplay/scenes", "screenplay/breakdown", "direction/references", "assets/characters", "assets/locations", "assets/props", "storyboards", "videos", "timeline", "renders", ".trash"].forEach((path) => mkdirSync(resolve(root, path), { recursive: true }));
}

function copyAssetMedia(userId: string, payload: Record<string, unknown>, folder: string, kind: AssetRow["kind"]) {
    const variants = Array.isArray(payload.variants) ? payload.variants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).fileId === "string")) : [];
    const files = variants.length ? variants.map((variant) => ({ fileId: String(variant.fileId), usage: String(variant.usage || ""), kind: String(variant.kind || "") })) : Array.from(collectFileIds(payload)).map((fileId) => ({ fileId, usage: "", kind: "" }));
    files.forEach(({ fileId, usage, kind: mediaKind }, index) => {
        const file = getStoredFile(userId, fileId);
        if (!file) return;
        const ext = extname(file.original_name) || extname(file.path) || ".bin";
        const target = kind === "character" && (mediaKind === "audio" || usage === "voice_sample")
            ? resolve(folder, `voice/reference${ext}`)
            : kind === "character"
            ? resolve(folder, usage === "face_closeup_reference" ? `identity/face-closeup${ext}` : usage === "body_back_reference" ? `identity/body-back${ext}` : usage === "body_front_reference" || usage === "design_sheet" || index === 0 ? `identity/body-front${ext}` : `identity/reference-${pad(index + 1)}${ext}`)
            : resolve(folder, index === 0 ? `reference${ext}` : `reference-${pad(index + 1)}${ext}`);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(file.path, target);
    });
}

function copyReferencedFiles(userId: string, value: unknown, folder: string) {
    mkdirSync(folder, { recursive: true });
    Array.from(collectFileIds(value)).forEach((fileId, index) => {
        const file = getStoredFile(userId, fileId);
        if (file) copyFileSync(file.path, resolve(folder, `style-reference-${pad(index + 1)}${extname(file.original_name) || ".bin"}`));
    });
}

function copyNamedFile(userId: string, fileId: string, target: string) {
    if (!fileId) return;
    const file = getStoredFile(userId, fileId);
    if (!file) return;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.path, target);
}

function copyCurrentMedia(userId: string, fileId: string, target: string) {
    if (!fileId) return;
    copyNamedFile(userId, fileId, target);
}

function findEntityFile(root: string, filename: string, entityId: string) {
    return walkFiles(root).find((path) => {
        if (basename(path) !== filename) return false;
        try { return matter(readFileSync(path, "utf8")).data.id === entityId; }
        catch { return false; }
    });
}

function trashEntityFolder(userId: string, projectId: string, rootName: string, filename: string, entityId: string, reindex = true) {
    const root = ensureDirectorProjectWorkspace(userId, projectId);
    const path = findEntityFile(resolve(root, rootName), filename, entityId);
    if (path) moveToTrash(root, dirname(path));
    if (reindex) indexDirectorProject(userId, projectId, validateDirectorRoot(root));
}

function moveToTrash(root: string, source: string) {
    const target = resolve(root, ".trash", `${Date.now()}-${basename(source)}`);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
    return target;
}

function assetFrontmatter(row: AssetRow, payload: Record<string, unknown>) {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        sourceRevision: row.revision,
        requiredVariants: payload.requiredVariants || [],
        designProfile: payload.designProfile || null,
        mediaDrafts: payload.mediaDrafts || {},
        dependencies: payload.dependencies || {},
    };
}

function assetBody(payload: Record<string, unknown>) {
    return [
        "## 描述", String(payload.description || ""),
        "## 剧情身份", String(payload.narrativeDescription || ""),
        "## 视觉设定", String(payload.visualDescription || ""),
    ].join("\n\n");
}

function section(content: string, heading: string) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return content.match(new RegExp(`^##\\s+${escaped}\\s*$\\n([\\s\\S]*?)(?=^##\\s+|$)`, "m"))?.[1]?.trim() || "";
}

function writeMarkdown(path: string, data: Record<string, unknown>, body: string) {
    writeFileAtomic(path, matter.stringify(body.trim() ? `${body.trim()}\n` : "", data));
}

function writeYaml(path: string, value: unknown) { writeFileAtomic(path, stringifyYaml(value)); }

function writeFileAtomic(path: string, content: string | Buffer) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
    writeFileSync(temporary, content);
    renameSync(temporary, path);
}

function safeWorkspacePath(root: string, path: string) {
    if (path.includes("\\") || path.startsWith("/")) throw workspaceError(400, "DIRECTOR_PATH_INVALID", "只能使用项目内相对路径");
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw workspaceError(400, "DIRECTOR_PATH_ESCAPE", "路径超出当前导演项目");
    let cursor = target;
    while (cursor.startsWith(root) && cursor !== root) {
        if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw workspaceError(400, "DIRECTOR_SYMLINK", "禁止通过符号链接访问工程外文件");
        cursor = dirname(cursor);
    }
    return target;
}

function walkFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(root, entry.name);
        if (entry.isSymbolicLink()) return [path];
        return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
    });
}

function validateParsed(path: string, parse: () => void, diagnostics: DirectorDiagnostic[], root: string, code: string) {
    try { parse(); } catch (error) { diagnostics.push(diag("error", code, posixRelative(root, path), error instanceof Error ? error.message : "文件解析失败")); }
}

function fileInfo(path: string) {
    const extension = extname(path).toLowerCase();
    const mediaType = [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? "image" : [".mp4", ".mov", ".webm"].includes(extension) ? "video" : [".wav", ".mp3", ".m4a"].includes(extension) ? "audio" : null;
    if (extension === ".md") {
        try {
            const data = matter(readFileSync(path, "utf8")).data as Record<string, unknown>;
            return { entityId: typeof data.id === "string" ? data.id : null, kind: typeof data.kind === "string" ? data.kind : "markdown", mediaType };
        } catch { /* validator reports it */ }
    }
    return { entityId: null, kind: mediaType || (extension === ".yaml" || extension === ".yml" ? "yaml" : extension === ".json" ? "json" : "file"), mediaType };
}

function hashFile(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function stringifyRecord(value: unknown) { return JSON.stringify(documentRecord(value)); }
function documentRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function posixRelative(root: string, path: string) { return relative(root, path).split(sep).join("/"); }
function pad(value: number) { return String(value).padStart(3, "0"); }
function slug(value: string) { return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 48); }
function diag(severity: DirectorDiagnostic["severity"], code: string, path: string, message: string): DirectorDiagnostic { return { severity, code, path, message }; }
function workspaceError(status: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status, code, details }); }

function projectAgents(title: string) {
    return `# ${title}\n\n此目录是导演项目的唯一创作权威源。\n\n- 只使用项目内相对路径，不创建符号链接，不访问凭据、运行目录或其他项目。\n- Markdown 正文承载创作内容，必要元数据放 YAML Frontmatter；时间线使用 JSON，故事板画格使用 YAML。\n- ID 稳定，改名不得改变 ID 或目录 ID 前缀；依赖和并发以内容哈希为准，不手工递增 REV。\n- 故事写入 \`story/\`，剧本写入 \`screenplay/\`，制作拆解写入 \`screenplay/breakdown/\`。\n- 视觉风格和导演规则分别维护在 \`direction/visual-style.md\` 与 \`direction/directing-rules.md\`。\n- 一个素材文件夹代表一个角色、场景或道具；角色身份图位于 \`identity/\`，声音位于 \`voice/\`，持续造型或状态变化位于 \`variants/\`。\n- 只有跨多个视频段持续存在或缺图会明显破坏连续性的变化才建立变体，不创建视角、服装和状态的排列组合。\n- 一个 4–15 秒视频段对应一个完整多宫格故事板；故事板只生成一张媒体，画格不是独立生成任务。\n- 生成工具读取工作区相对路径中的提示词和媒体；任何付费媒体生成前先运行工程校验，存在 error 时先修复。\n- 删除或移动内容先放入 \`.trash/\`，不要永久删除。\n`;
}
