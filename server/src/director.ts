import { markDirectorProjectChanged, type DirectorResource } from "./director-sync.js";
import { segmentRangeSchema, videoReferenceSchema, projectMediaPath, screenplayScene, screenplayReviewIssue } from "./director-file-contract.js";
import { h3AudioReferencesInput } from "./h3-prompt.js";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { nanoid } from "nanoid";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EPub } from "epub2";
import { convert } from "html-to-text";
import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getStoredFile, syncFileRefs } from "./file-store.js";
import {
    validateDirectorTimelineInput, getDirectorAssetDetail, reconcileDirectorProjectFiles, syncDirectorBreakdownFile, syncDirectorDirectionFiles, syncDirectorDocumentFile,
    syncDirectorSequenceFile, syncDirectorSourceFiles, syncDirectorTimelineFile, syncDirectorVideoSegmentFile, trashDirectorSequenceFolder, trashDirectorVideoSegmentFolder,
} from "./director-workspace.js";

export type DirectorEntityStatus = "draft" | "confirmed" | "locked";
type DirectorDirectingRules = { positioning: string; intent: string; photography: string; performance: string; pacing: string; sound: string; prohibitions: string };
type WorkspaceRow = { project_id: string; user_id: string; target_duration_seconds: number; aspect_ratio: string; language: string; stage: string; status: DirectorEntityStatus; directing_rules: string; revision: number; created_at: string; updated_at: string };
type SourceRow = { id: string; user_id: string; project_id: string; raw_file_id: string; name: string; mime_type: string; status: string; error: string | null; char_count: number; chapter_count: number; summary: string; outline: string; revision: number; created_at: string; updated_at: string };
type DocumentRow = { project_id: string; user_id: string; kind: "story" | "script"; content: string; status: DirectorEntityStatus; revision: number; created_at: string; updated_at: string };
type ScreenplayBreakdownRow = { project_id: string; user_id: string; script_revision: number; payload: string; revision: number; created_at: string; updated_at: string };
type ScreenplayReview = { status: "not_run" | "passed" | "needs_revision"; targetDurationSeconds: number; estimatedDurationSeconds: number; issues: Array<{ type: "duration" | "repetition" | "causality" | "scene_function" | "coverage"; sceneIds: string[]; summary: string; suggestion: string }> };
type SequenceRow = { id: string; user_id: string; project_id: string; position: number; title: string; summary: string; status: DirectorEntityStatus; payload: string; revision: number; created_at: string; updated_at: string };
type ShotRow = { id: string; user_id: string; project_id: string; sequence_id: string; position: number; title: string; status: DirectorEntityStatus; payload: string; revision: number; created_at: string; updated_at: string };
type TimelineRow = { project_id: string; user_id: string; payload: string; revision: number; created_at: string; updated_at: string };
type SourceChapter = { heading: string; content: string };

const id = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const status = z.enum(["draft", "confirmed", "locked"]);
const record = z.record(z.string(), z.unknown());
const sourceInput = z.object({ fileId: id });
const workspacePatch = z.object({
    revision: z.number().int().positive(), targetDurationSeconds: z.number().int().min(10).max(86_400).optional(),
    aspectRatio: z.enum(["16:9", "9:16", "1:1", "2.39:1"]).optional(), language: z.string().trim().min(2).max(20).optional(),
    stage: z.enum(["source", "story", "script", "style", "assets", "storyboard", "shots", "timeline", "render"]).optional(), status: status.optional(),
    directingRules: z.object({
        positioning: z.string().trim().max(10_000),
        intent: z.string().trim().max(10_000),
        photography: z.string().trim().max(10_000), performance: z.string().trim().max(10_000), pacing: z.string().trim().max(10_000),
        sound: z.string().trim().max(10_000), prohibitions: z.string().trim().max(10_000),
    }).partial().optional(),
});
const documentPatch = z.object({ revision: z.number().int().positive(), content: z.string().max(20_000_000).optional() });
const screenplayBreakdownPatch = z.object({
    revision: z.number().int().positive(), scriptRevision: z.number().int().positive(),
    scenes: z.array(screenplayScene).max(1_000), reviewIssues: z.array(screenplayReviewIssue).max(500),
});
const sequenceInput = z.object({ id: id.optional(), position: z.number().int().min(0).optional(), title: z.string().trim().min(1).max(300), summary: z.string().max(20_000).default(""), status: status.default("draft"), payload: record.default({}) });
const sequencePatch = sequenceInput.partial().extend({ revision: z.number().int().positive() });
const shotInput = z.object({ id: id.optional(), sequenceId: id, position: z.number().int().min(0).optional(), title: z.string().trim().min(1).max(300), status: status.default("draft"), payload: record.default({}) });
const shotPatch = shotInput.omit({ sequenceId: true }).partial().extend({ revision: z.number().int().positive(), sequenceId: id.optional() });
const timelinePatch = z.object({ revision: z.number().int().positive(), payload: record });

let emitDirectorUpdate: (userId: string, entity: { type: string; projectId: string; data: unknown }) => void = () => undefined;
const activeSourceJobs = new Set<string>();

export function setDirectorEmitter(emitter: typeof emitDirectorUpdate) { emitDirectorUpdate = emitter; }

export function getDirectorState(userId: string, projectId: string) {
    assertDirectorProject(userId, projectId);
    reconcileDirectorProjectFiles(userId, projectId);
    const workspace = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    const documents = db.prepare("SELECT * FROM director_documents WHERE user_id=? AND project_id=? ORDER BY kind").all(userId, projectId) as DocumentRow[];
    const screenplayBreakdown = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as ScreenplayBreakdownRow;
    const sources = db.prepare("SELECT * FROM director_sources WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as SourceRow[];
    const sequences = db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position, created_at").all(userId, projectId) as SequenceRow[];
    const shots = db.prepare(`SELECT shot.* FROM director_shots shot
        JOIN director_sequences sequence ON sequence.id=shot.sequence_id
        WHERE shot.user_id=? AND shot.project_id=?
        ORDER BY sequence.position, shot.position, shot.created_at`).all(userId, projectId) as ShotRow[];
    const timeline = db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    return { activeStyleId: activeStyleId(userId, projectId), workspace: workspaceResponse(workspace), documents: documents.map(documentResponse), screenplayBreakdown: screenplayBreakdownResponse(screenplayBreakdown, documents.find((item) => item.kind === "script")?.revision || 0), sources: sources.map(sourceResponse), sequences: sequences.map(sequenceResponse), videoSegments: shots.map(videoSegmentResponse), timeline: timelineResponse(timeline) };
}

// Resource projections keep an asset/task update from re-reading large story bodies.
export function getDirectorStateProjection(userId: string, projectId: string, resources: readonly DirectorResource[]): Partial<ReturnType<typeof getDirectorState>> {
    const state: Partial<ReturnType<typeof getDirectorState>> = {};
    if (resources.includes("project") || resources.includes("direction")) {
        state.workspace = workspaceResponse(db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow);
        state.activeStyleId = activeStyleId(userId, projectId);
    }
    const kinds = (["story", "script"] as const).filter((kind) => resources.includes(kind));
    if (kinds.length) state.documents = (db.prepare(`SELECT * FROM director_documents WHERE user_id=? AND project_id=? AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY kind`).all(userId, projectId, ...kinds) as DocumentRow[]).map(documentResponse);
    if (resources.includes("script")) {
        const row = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as ScreenplayBreakdownRow;
        const script = db.prepare("SELECT revision FROM director_documents WHERE user_id=? AND project_id=? AND kind='script'").get(userId, projectId) as { revision: number };
        state.screenplayBreakdown = screenplayBreakdownResponse(row, script.revision);
    }
    if (resources.includes("sources")) state.sources = (db.prepare("SELECT * FROM director_sources WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as SourceRow[]).map(sourceResponse);
    if (resources.includes("segments")) {
        state.sequences = (db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position,created_at").all(userId, projectId) as SequenceRow[]).map(sequenceResponse);
        state.videoSegments = (db.prepare(`SELECT shot.* FROM director_shots shot JOIN director_sequences sequence ON sequence.id=shot.sequence_id
            WHERE shot.user_id=? AND shot.project_id=? ORDER BY sequence.position,shot.position,shot.created_at`).all(userId, projectId) as ShotRow[]).map(videoSegmentResponse);
    }
    if (resources.includes("timeline")) state.timeline = timelineResponse(db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow);
    return state;
}

export function getDirectorAgentOverview(userId: string, projectId: string) {
    assertDirectorProject(userId, projectId);
    const workspace = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    const documents = db.prepare("SELECT project_id,kind,length(trim(content)) > 0 has_content,revision,created_at,updated_at FROM director_documents WHERE user_id=? AND project_id=? ORDER BY kind").all(userId, projectId) as Array<{ project_id: string; kind: "story" | "script"; has_content: number; revision: number; created_at: string; updated_at: string }>;
    const screenplayBreakdown = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as ScreenplayBreakdownRow;
    const sources = db.prepare("SELECT id,project_id,raw_file_id,name,mime_type,status,error,char_count,chapter_count,summary,revision,created_at,updated_at FROM director_sources WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as Array<Omit<SourceRow, "user_id" | "outline">>;
    const sequences = db.prepare("SELECT id,project_id,position,title,summary,status,revision,created_at,updated_at FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position,created_at").all(userId, projectId) as Array<Omit<SequenceRow, "user_id" | "payload">>;
    const videoSegmentCount = Number((db.prepare("SELECT count(*) count FROM director_shots WHERE user_id=? AND project_id=?").get(userId, projectId) as { count: number }).count);
    const timeline = db.prepare("SELECT project_id,revision,updated_at FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as Pick<TimelineRow, "project_id" | "revision" | "updated_at">;
    return {
        activeStyleId: activeStyleId(userId, projectId),
        workspace: workspaceResponse(workspace),
        documents: documents.map((row) => ({ projectId: row.project_id, kind: row.kind, hasContent: Boolean(row.has_content), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })),
        screenplayBreakdown: screenplayBreakdownSummary(screenplayBreakdown, documents.find((item) => item.kind === "script")?.revision || 0),
        sources: sources.map((row) => ({ id: row.id, projectId: row.project_id, fileId: row.raw_file_id, name: row.name, mimeType: row.mime_type, status: row.status, error: row.error, charCount: row.char_count, chapterCount: row.chapter_count, summary: row.summary, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })),
        sequences: sequences.map((row) => ({ id: row.id, projectId: row.project_id, position: row.position, title: row.title, summary: row.summary, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })),
        videoSegmentCount,
        timeline: { projectId: timeline.project_id, revision: timeline.revision, updatedAt: timeline.updated_at },
    };
}

export function updateDirectorWorkspace(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const value = workspacePatch.parse(body);
    const current = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    const currentRules = { ...emptyDirectingRules(), ...parseJson<Partial<DirectorDirectingRules>>(current.directing_rules, {}) };
    const nextRules = { ...currentRules, ...value.directingRules };
    const directingRulesChanged = Boolean(value.directingRules && JSON.stringify(nextRules) !== JSON.stringify(currentRules));
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_workspaces SET target_duration_seconds=?, aspect_ratio=?, language=?, stage=?, status=?, directing_rules=?, revision=revision+1, updated_at=?
        WHERE user_id=? AND project_id=? AND revision=?`).run(value.targetDurationSeconds ?? current.target_duration_seconds, value.aspectRatio ?? current.aspect_ratio, value.language ?? current.language, value.stage ?? current.stage, value.status ?? current.status, JSON.stringify(nextRules), now, userId, projectId, value.revision);
    if (!result.changes) conflict("工作区", workspaceResponse(current));
    if (directingRulesChanged) markDirectingRulesDependentsStale(userId, projectId);
    const updated = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    syncDirectorDirectionFiles(userId, projectId);
    return publish(userId, "workspace", projectId, workspaceResponse(updated));
}

export function createDirectorSource(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const value = sourceInput.parse(body);
    const file = getStoredFile(userId, value.fileId);
    if (!file) throw directorError(404, "FILE_NOT_FOUND", "源文件不存在");
    const extension = extname(file.original_name).toLowerCase();
    if (![".txt", ".md", ".markdown", ".pdf", ".epub"].includes(extension)) throw directorError(415, "DIRECTOR_SOURCE_TYPE", "仅支持 TXT、Markdown、PDF 和 EPUB");
    const sourceId = nanoid();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO director_sources(id,user_id,project_id,raw_file_id,name,mime_type,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'processing',?,?)`).run(sourceId, userId, projectId, value.fileId, file.original_name, file.mime_type, now, now);
    syncFileRefs(userId, "director_source", sourceId, { fileId: value.fileId });
    syncDirectorSourceFiles(userId, projectId, sourceId);
    queueSourceProcessing(userId, sourceId);
    return sourceResponse(db.prepare("SELECT * FROM director_sources WHERE id=? AND user_id=?").get(sourceId, userId) as SourceRow);
}

export function retryDirectorSource(userId: string, sourceId: string) {
    const row = sourceRow(userId, sourceId);
    db.prepare("UPDATE director_sources SET status='processing', error=NULL, revision=revision+1, updated_at=? WHERE id=? AND user_id=?").run(new Date().toISOString(), sourceId, userId);
    queueSourceProcessing(userId, sourceId);
    return sourceResponse({ ...row, status: "processing", error: null, revision: row.revision + 1 });
}

export function listDirectorSourceChunks(userId: string, sourceId: string, query: unknown) {
    sourceRow(userId, sourceId);
    const value = z.object({ q: z.string().trim().max(500).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(query);
    const term = value.q ? `%${value.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null;
    const rows = term
        ? db.prepare("SELECT * FROM director_source_chunks WHERE user_id=? AND source_id=? AND (heading LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY ordinal LIMIT ? OFFSET ?").all(userId, sourceId, term, term, value.limit, value.offset)
        : db.prepare("SELECT * FROM director_source_chunks WHERE user_id=? AND source_id=? ORDER BY ordinal LIMIT ? OFFSET ?").all(userId, sourceId, value.limit, value.offset);
    return (rows as Array<Record<string, unknown>>).map(chunkResponse);
}

export function getDirectorDocument(userId: string, projectId: string, kind: string) {
    assertDirectorProject(userId, projectId);
    reconcileDirectorProjectFiles(userId, projectId);
    const documentKind = z.enum(["story", "script"]).parse(kind);
    const row = db.prepare("SELECT * FROM director_documents WHERE user_id=? AND project_id=? AND kind=?").get(userId, projectId, documentKind) as DocumentRow;
    return documentResponse(row);
}

export function getDirectorDocumentExcerpt(userId: string, projectId: string, kind: string, query: unknown = {}) {
    const document = getDirectorDocument(userId, projectId, kind);
    const value = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100_000).default(40_000) }).parse(query);
    const offset = Math.min(value.offset, document.content.length);
    return { ...document, content: document.content.slice(offset, offset + value.limit), offset, limit: value.limit, totalCharacters: document.content.length, hasMore: offset + value.limit < document.content.length };
}

export function updateDirectorDocument(userId: string, projectId: string, kind: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const documentKind = z.enum(["story", "script"]).parse(kind);
    const value = documentPatch.parse(body);
    const current = db.prepare("SELECT * FROM director_documents WHERE user_id=? AND project_id=? AND kind=?").get(userId, projectId, documentKind) as DocumentRow;
    const now = new Date().toISOString();
    const nextStatus = "draft";
    const result = db.prepare(`UPDATE director_documents SET content=?, status=?, revision=revision+1, updated_at=?
        WHERE user_id=? AND project_id=? AND kind=? AND revision=?`).run(value.content ?? current.content, nextStatus, now, userId, projectId, documentKind, value.revision);
    if (!result.changes) conflict(documentKind === "story" ? "故事" : "剧本", documentResponse(current));
    if (value.content !== undefined && value.content !== current.content) markDocumentDependentsStale(userId, projectId, documentKind, current.revision + 1);
    const updated = db.prepare("SELECT * FROM director_documents WHERE user_id=? AND project_id=? AND kind=?").get(userId, projectId, documentKind) as DocumentRow;
    syncDirectorDocumentFile(userId, projectId, documentKind, updated.content, updated.revision);
    return publish(userId, `document.${documentKind}`, projectId, documentResponse(updated));
}

export function getDirectorScreenplayBreakdown(userId: string, projectId: string) {
    assertDirectorProject(userId, projectId);
    const row = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as ScreenplayBreakdownRow;
    const script = db.prepare("SELECT revision FROM director_documents WHERE user_id=? AND project_id=? AND kind='script'").get(userId, projectId) as { revision: number };
    return screenplayBreakdownResponse(row, script.revision);
}

export function updateDirectorScreenplayBreakdown(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const value = screenplayBreakdownPatch.parse(body);
    const current = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as ScreenplayBreakdownRow;
    const script = db.prepare("SELECT revision FROM director_documents WHERE user_id=? AND project_id=? AND kind='script'").get(userId, projectId) as { revision: number };
    if (value.scriptRevision !== script.revision) throw directorError(409, "DIRECTOR_SCRIPT_REVISION_STALE", "剧本已更新，请重新读取后再拆解", { currentScriptRevision: script.revision });
    const targetDurationSeconds = Number((db.prepare("SELECT target_duration_seconds value FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as { value: number }).value);
    const estimatedDurationSeconds = value.scenes.reduce((total, scene) => total + scene.estimatedSeconds, 0);
    const payload = { scenes: value.scenes, estimatedDurationSeconds, review: { status: value.reviewIssues.length ? "needs_revision" : "passed", targetDurationSeconds, estimatedDurationSeconds, issues: value.reviewIssues } };
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_screenplay_breakdowns SET script_revision=?,payload=?,revision=revision+1,updated_at=?
        WHERE user_id=? AND project_id=? AND revision=?`).run(value.scriptRevision, JSON.stringify(payload), now, userId, projectId, value.revision);
    if (!result.changes) conflict("剧本制作拆解", screenplayBreakdownResponse(current, script.revision));
    const updated = db.prepare("SELECT * FROM director_screenplay_breakdowns WHERE user_id=? AND project_id=?").get(userId, projectId) as ScreenplayBreakdownRow;
    syncDirectorBreakdownFile(userId, projectId, payload, updated.revision);
    return publish(userId, "screenplay-breakdown", projectId, screenplayBreakdownResponse(updated, script.revision));
}

export function listDirectorSequences(userId: string, projectId: string) {
    assertDirectorProject(userId, projectId);
    return (db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position,created_at").all(userId, projectId) as SequenceRow[]).map(sequenceResponse);
}

export function listDirectorSequenceSummaries(userId: string, projectId: string, query: unknown = {}) {
    assertDirectorProject(userId, projectId);
    const value = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(query);
    const total = Number((db.prepare("SELECT count(*) count FROM director_sequences WHERE user_id=? AND project_id=?").get(userId, projectId) as { count: number }).count);
    const rows = db.prepare("SELECT id,project_id,position,title,summary,status,revision,created_at,updated_at FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position,created_at LIMIT ? OFFSET ?").all(userId, projectId, value.limit, value.offset) as Array<Omit<SequenceRow, "user_id" | "payload">>;
    return { items: rows.map((row) => ({ id: row.id, projectId: row.project_id, position: row.position, title: row.title, summary: row.summary, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })), total, offset: value.offset, limit: value.limit };
}

export function listDirectorVideoSegments(userId: string, projectId: string, query: unknown = {}) {
    assertDirectorProject(userId, projectId);
    const value = z.object({ sequenceId: id.optional(), q: z.string().trim().max(300).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(10).default(10), view: z.enum(["prompt", "full"]).default("prompt") }).parse(query);
    const conditions = ["shot.user_id=?", "shot.project_id=?"];
    const params: Array<string | number> = [userId, projectId];
    if (value.sequenceId) { conditions.push("shot.sequence_id=?"); params.push(value.sequenceId); }
    if (value.q) { conditions.push("shot.title LIKE ? ESCAPE '\\'"); params.push(`%${value.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); }
    const where = conditions.join(" AND ");
    const total = Number((db.prepare(`SELECT count(*) count FROM director_shots shot WHERE ${where}`).get(...params) as { count: number }).count);
    const rows = db.prepare(`SELECT shot.* FROM director_shots shot JOIN director_sequences sequence ON sequence.id=shot.sequence_id WHERE ${where} ORDER BY sequence.position,shot.position,shot.created_at LIMIT ? OFFSET ?`).all(...params, value.limit, value.offset) as ShotRow[];
    const response = rows.map(videoSegmentResponse);
    return { items: value.view === "full" ? response : response.map(videoSegmentPromptResponse), total, offset: value.offset, limit: value.limit };
}

export function getDirectorVideoSegment(userId: string, projectId: string, segmentId: string) {
    assertDirectorProject(userId, projectId);
    const row = shotRow(userId, segmentId);
    if (row.project_id !== projectId) throw directorError(404, "DIRECTOR_SHOT_NOT_FOUND", "视频段不存在");
    return videoSegmentResponse(row);
}

export function createDirectorSequence(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    requireDocumentContent(userId, projectId, "script");
    const value = sequenceInput.parse(body);
    const sequenceId = value.id || nanoid();
    const position = value.position ?? Number((db.prepare("SELECT coalesce(max(position),-1)+1 value FROM director_sequences WHERE user_id=? AND project_id=?").get(userId, projectId) as { value: number }).value);
    const now = new Date().toISOString();
    const dependencies = directorDependencies(userId, projectId);
    db.prepare(`INSERT INTO director_sequences(id,user_id,project_id,position,title,summary,status,payload,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sequenceId, userId, projectId, position, value.title, value.summary, value.status, JSON.stringify({ ...value.payload, dependencies, needsReview: false }), now, now);
    syncDirectorSequenceFile(userId, projectId, sequenceId);
    return publish(userId, "sequence", projectId, sequenceResponse(db.prepare("SELECT * FROM director_sequences WHERE id=? AND user_id=?").get(sequenceId, userId) as SequenceRow));
}

export function updateDirectorSequence(userId: string, sequenceId: string, body: unknown, allowLocked = false) {
    const current = sequenceRow(userId, sequenceId);
    const value = sequencePatch.parse(body);
    if (!allowLocked && current.status === "locked" && ((value.status !== undefined && value.status !== "locked") || Object.keys(value).some((key) => !["revision", "status"].includes(key)))) throw directorError(423, "DIRECTOR_LOCKED", "剧情段落已锁定，需要通过 Agent 审批后修改");
    const currentPayload = parseJson<Record<string, unknown>>(current.payload, {});
    const payload = value.payload ? { ...currentPayload, ...value.payload } : currentPayload;
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_sequences SET position=?,title=?,summary=?,status=?,payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?`)
        .run(value.position ?? current.position, value.title ?? current.title, value.summary ?? current.summary, value.status ?? current.status, JSON.stringify(payload), now, sequenceId, userId, value.revision);
    if (!result.changes) conflict("剧情段落", sequenceResponse(current));
    syncDirectorSequenceFile(userId, current.project_id, sequenceId);
    return publish(userId, "sequence", current.project_id, sequenceResponse(sequenceRow(userId, sequenceId)));
}

export function deleteDirectorSequence(userId: string, sequenceId: string, allowLocked = false) {
    const current = sequenceRow(userId, sequenceId);
    if (!allowLocked && current.status === "locked") throw directorError(423, "DIRECTOR_LOCKED", "剧情段落已锁定，需要通过 Agent 审批后删除");
    const segmentIds = (db.prepare("SELECT id FROM director_shots WHERE user_id=? AND sequence_id=?").all(userId, sequenceId) as Array<{ id: string }>).map((row) => row.id);
    segmentIds.forEach((id) => trashDirectorVideoSegmentFolder(userId, current.project_id, id));
    trashDirectorSequenceFolder(userId, current.project_id, sequenceId);
    db.transaction(() => {
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='director_shot' AND owner_id IN (SELECT id FROM director_shots WHERE user_id=? AND sequence_id=?)").run(userId, userId, sequenceId);
        db.prepare("DELETE FROM file_refs WHERE user_id=? AND owner_type='director_sequence' AND owner_id=?").run(userId, sequenceId);
        db.prepare("DELETE FROM director_sequences WHERE id=? AND user_id=?").run(sequenceId, userId);
    })();
    return publish(userId, "sequence.deleted", current.project_id, { id: sequenceId });
}

export function createDirectorShot(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const value = shotInput.parse(body);
    const sequence = sequenceRow(userId, value.sequenceId);
    if (sequence.project_id !== projectId) throw directorError(404, "DIRECTOR_SEQUENCE_NOT_FOUND", "剧情段落不存在");
    const shotId = value.id || nanoid();
    const position = value.position ?? Number((db.prepare("SELECT coalesce(max(position),-1)+1 value FROM director_shots WHERE user_id=? AND sequence_id=?").get(userId, value.sequenceId) as { value: number }).value);
    const now = new Date().toISOString();
    const payload = normalizeShotPayload(value.payload, sequence, userId);
    db.prepare(`INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(shotId, userId, projectId, value.sequenceId, position, value.title, value.status, JSON.stringify(payload), now, now);
    syncDirectorVideoSegmentFile(userId, projectId, shotId);
    return publish(userId, "video-segment", projectId, videoSegmentResponse(db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(shotId, userId) as ShotRow));
}

export function updateDirectorShot(userId: string, shotId: string, body: unknown, allowLocked = false) {
    const current = shotRow(userId, shotId);
    const value = shotPatch.parse(body);
    if (!allowLocked && current.status === "locked" && ((value.status !== undefined && value.status !== "locked") || Object.keys(value).some((key) => !["revision", "status"].includes(key)))) throw directorError(423, "DIRECTOR_LOCKED", "镜头已锁定，需要通过 Agent 审批后修改");
    const sequenceId = value.sequenceId ?? current.sequence_id;
    const sequence = sequenceRow(userId, sequenceId);
    if (sequence.project_id !== current.project_id) throw directorError(404, "DIRECTOR_SEQUENCE_NOT_FOUND", "剧情段落不存在");
    const currentPayload = parseJson<Record<string, unknown>>(current.payload, {});
    const payload: Record<string, unknown> = value.payload ? normalizeShotPayload({ ...currentPayload, ...value.payload }, sequence, userId) : currentPayload;
    if (["description", "dramaticBeat", "openingState", "endingState"].some((key) => currentPayload[key] !== payload[key])) {
        payload.h3PromptStale = Boolean(payload.h3PromptSnapshot);
        payload.videoStale = Boolean(payload.videoFileId);
    }
    if ((JSON.stringify([currentPayload.segmentRanges, currentPayload.referenceImages, currentPayload.videoReferences]) !== JSON.stringify([payload.segmentRanges, payload.referenceImages, payload.videoReferences]) || JSON.stringify(currentPayload.audioReferences) !== JSON.stringify(payload.audioReferences)) && payload.videoFileId) payload.videoStale = true;
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_shots SET sequence_id=?,position=?,title=?,status=?,payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?`)
        .run(sequenceId, value.position ?? current.position, value.title ?? current.title, value.status ?? current.status, JSON.stringify(payload), now, shotId, userId, value.revision);
    if (!result.changes) conflict("视频段", videoSegmentResponse(current));
    if (shotVideoChanged(current.payload, payload)) markContinuationDependentsStale(userId, current.project_id, shotId);
    syncDirectorVideoSegmentFile(userId, current.project_id, shotId);
    return publish(userId, "video-segment", current.project_id, videoSegmentResponse(shotRow(userId, shotId)));
}

const segmentAssetReferenceInput = z.object({
    revision: z.number().int().positive(), kind: z.enum(["character", "scene", "prop"]), assetId: id,
    replaceAssetId: id.optional(), variantId: id.optional(), remove: z.boolean().default(false),
}).strict();

export function updateDirectorSegmentAssetReference(userId: string, segmentId: string, body: unknown) {
    const value = segmentAssetReferenceInput.parse(body);
    const segment = shotRow(userId, segmentId);
    if (value.revision !== segment.revision) conflict("视频段", videoSegmentResponse(segment));
    const payload = parseJson<Record<string, unknown>>(segment.payload, {});
    const key = { character: "characterRefs", scene: "sceneRefs", prop: "propRefs" }[value.kind];
    const current = (payload[key] || []) as Array<{ id: string; revision: number; variantId?: string }>;
    if (value.replaceAssetId && !current.some((ref) => ref.id === value.replaceAssetId)) throw directorError(409, "DIRECTOR_REFERENCE_CHANGED", "要替换的素材已不在当前视频段中");
    let next = current.filter((ref) => ref.id !== value.assetId && ref.id !== value.replaceAssetId);
    if (!value.remove) {
        const asset = db.prepare("SELECT id,revision FROM creative_assets WHERE id=? AND user_id=? AND project_id=? AND kind=?").get(value.assetId, userId, segment.project_id, value.kind) as { id: string; revision: number } | undefined;
        if (!asset) throw directorError(404, "DIRECTOR_ASSET_NOT_FOUND", "素材不存在或不属于当前项目及类型");
        if (value.variantId && !getDirectorAssetDetail(userId, asset.id).variants.some((variant) => variant.variantId === value.variantId)) throw directorError(400, "DIRECTOR_VARIANT_NOT_FOUND", "所选形象不属于这个素材");
        const reference = { id: asset.id, revision: asset.revision, ...(value.variantId ? { variantId: value.variantId } : {}) };
        const index = current.findIndex((ref) => ref.id === (value.replaceAssetId || value.assetId));
        next.splice(index < 0 ? next.length : index, 0, reference);
    }
    if (JSON.stringify(current) === JSON.stringify(next)) return videoSegmentResponse(segment);
    return updateDirectorShot(userId, segmentId, { revision: value.revision, payload: {
        [key]: next,
        h3PromptStale: Boolean(payload.h3PromptSnapshot), videoStale: Boolean(payload.videoFileId),
    } });
}

export function deleteDirectorShot(userId: string, shotId: string, allowLocked = false) {
    const current = shotRow(userId, shotId);
    if (!allowLocked && current.status === "locked") throw directorError(423, "DIRECTOR_LOCKED", "镜头已锁定，需要通过 Agent 审批后删除");
    trashDirectorVideoSegmentFolder(userId, current.project_id, shotId);
    db.prepare("DELETE FROM director_shots WHERE id=? AND user_id=?").run(shotId, userId);
    return publish(userId, "video-segment.deleted", current.project_id, { id: shotId });
}

export function updateDirectorTimeline(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const value = timelinePatch.parse(body);
    validateTimeline(userId, projectId, value.payload);
    validateDirectorTimelineInput(userId, projectId, value.payload);
    const current = db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND revision=?")
        .run(JSON.stringify(value.payload), now, userId, projectId, value.revision);
    if (!result.changes) conflict("时间线", timelineResponse(current));
    const updated = db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    syncDirectorTimelineFile(userId, projectId, value.payload);
    return publish(userId, "timeline", projectId, timelineResponse(updated));
}

export function resumeDirectorSourceProcessing() {
    const rows = db.prepare("SELECT user_id,id FROM director_sources WHERE status='processing'").all() as Array<{ user_id: string; id: string }>;
    rows.forEach((row) => queueSourceProcessing(row.user_id, row.id));
}

function queueSourceProcessing(userId: string, sourceId: string) {
    const key = `${userId}:${sourceId}`;
    if (activeSourceJobs.has(key)) return;
    activeSourceJobs.add(key);
    setImmediate(() => void processSource(userId, sourceId).finally(() => activeSourceJobs.delete(key)));
}

async function processSource(userId: string, sourceId: string) {
    const source = sourceRow(userId, sourceId);
    const file = getStoredFile(userId, source.raw_file_id);
    if (!file) return failSource(userId, sourceId, "原始文件不存在");
    try {
        const chapters = await extractChapters(file.path, file.original_name);
        const normalized = chapters.map((chapter) => ({ heading: chapter.heading.trim(), content: normalizeText(chapter.content) })).filter((chapter) => chapter.content);
        if (!normalized.length) throw new Error("源文件没有可提取的正文");
        const chunks = normalized.flatMap((chapter, chapterIndex) => splitText(chapter.content, 12_000).map((content, part) => ({ heading: `${chapter.heading || `第 ${chapterIndex + 1} 章`}${part ? ` · ${part + 1}` : ""}`, content })));
        const now = new Date().toISOString();
        db.transaction(() => {
            db.prepare("DELETE FROM director_source_chunks WHERE user_id=? AND source_id=?").run(userId, sourceId);
            const insert = db.prepare(`INSERT INTO director_source_chunks(id,user_id,project_id,source_id,ordinal,heading,content,summary,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
            chunks.forEach((chunk, ordinal) => insert.run(nanoid(), userId, source.project_id, sourceId, ordinal, chunk.heading, chunk.content, summarizeChunk(chunk.content), "summarized", now, now));
            const summaries = chunks.map((chunk) => `${chunk.heading}：${summarizeChunk(chunk.content)}`);
            db.prepare(`UPDATE director_sources SET status='ready',error=NULL,char_count=?,chapter_count=?,summary=?,outline=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?`)
                .run(normalized.reduce((sum, chapter) => sum + chapter.content.length, 0), normalized.length, buildLayeredSummary(summaries), summaries.join("\n").slice(0, 200_000), now, sourceId, userId);
        })();
        const updated = sourceRow(userId, sourceId);
        syncDirectorSourceFiles(userId, updated.project_id, sourceId);
        publish(userId, "source", updated.project_id, sourceResponse(updated));
    } catch (error) {
        failSource(userId, sourceId, error instanceof Error ? error.message : "源文件解析失败");
    }
}

async function extractChapters(path: string, name: string): Promise<SourceChapter[]> {
    const extension = extname(name).toLowerCase();
    if (extension === ".pdf") return [{ heading: name, content: await extractPdfText(path) }];
    if (extension === ".epub") {
        const epub = await EPub.createAsync(path);
        const toc = epub.toc as Array<{ id?: string; href?: string; title?: string }>;
        const flow = epub.flow as Array<{ id?: string; title?: string }>;
        const manifest = epub.manifest as Record<string, { id?: string; title?: string; "media-type"?: string; mediaType?: string }>;
        const chapters = flow.length ? flow : Object.entries(manifest).filter(([, item]) => (item["media-type"] || item.mediaType) === "application/xhtml+xml").map(([id, item]) => ({ ...item, id }));
        const tocTitles = new Map(toc.map((item) => [item.id || item.href?.split("#")[0], item.title || ""]));
        return Promise.all(chapters.filter((item) => item.id).map(async (item, index) => ({
            heading: tocTitles.get(item.id) || item.title || `第 ${index + 1} 章`,
            content: convert(await epub.getChapterAsync(item.id!), { wordwrap: false, selectors: [{ selector: "img", format: "skip" }] }),
        })));
    }
    return splitChapters(await readFile(path, "utf8"), name);
}

async function extractPdfText(path: string) {
    const document = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const content = await (await document.getPage(pageNumber)).getTextContent();
        pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    await document.destroy();
    return pages.join("\n\n");
}

function splitChapters(text: string, fallback: string) {
    const normalized = normalizeText(text);
    const heading = /^(?:#{1,4}\s+.+|第[〇零一二三四五六七八九十百千万0-9]+[章节卷部篇回].*)$/gm;
    const matches = [...normalized.matchAll(heading)];
    if (!matches.length) return [{ heading: fallback, content: normalized }];
    const result: Array<{ heading: string; content: string }> = [];
    if ((matches[0].index || 0) > 0) result.push({ heading: "前言", content: normalized.slice(0, matches[0].index).trim() });
    matches.forEach((match, index) => {
        const start = (match.index || 0) + match[0].length;
        result.push({ heading: match[0].replace(/^#+\s*/, ""), content: normalized.slice(start, matches[index + 1]?.index ?? normalized.length).trim() });
    });
    return result.filter((chapter) => chapter.content);
}

function splitText(text: string, size: number) {
    const chunks: string[] = [];
    let remaining = text.trim();
    while (remaining.length > size) {
        const window = remaining.slice(0, size);
        const boundary = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("。"), Math.floor(size * .7));
        chunks.push(remaining.slice(0, boundary + (window[boundary] === "。" ? 1 : 0)).trim());
        remaining = remaining.slice(boundary + (window[boundary] === "。" ? 1 : 0)).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function normalizeText(value: string) { return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim(); }
function summarizeChunk(content: string) { return content.replace(/\s+/g, " ").slice(0, 600); }
function buildLayeredSummary(summaries: string[]) {
    const volumeSize = 30;
    return Array.from({ length: Math.ceil(summaries.length / volumeSize) }, (_, index) => `第 ${index + 1} 部分\n${summaries.slice(index * volumeSize, (index + 1) * volumeSize).join("\n")}`).join("\n\n").slice(0, 200_000);
}

function failSource(userId: string, sourceId: string, message: string) {
    const now = new Date().toISOString();
    db.prepare("UPDATE director_sources SET status='failed',error=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(message.slice(0, 2_000), now, sourceId, userId);
    const updated = sourceRow(userId, sourceId);
    publish(userId, "source", updated.project_id, sourceResponse(updated));
}

function markDocumentDependentsStale(userId: string, projectId: string, kind: string, revision: number) {
    const rows = db.prepare("SELECT id,payload FROM director_sequences WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const update = db.prepare("UPDATE director_sequences SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?");
    const now = new Date().toISOString();
    rows.forEach((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        update.run(JSON.stringify({ ...payload, needsReview: true, staleReason: `${kind} revision ${revision}` }), now, row.id, userId);
    });
    const shots = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const updateShot = db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?");
    shots.forEach((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        updateShot.run(JSON.stringify({ ...payload, needsReview: true, staleReason: `${kind} revision ${revision}` }), now, row.id, userId);
    });
}

function markDirectingRulesDependentsStale(userId: string, projectId: string) {
    const now = new Date().toISOString();
    const reason = "导演规则已更新";
    const sequences = db.prepare("SELECT id,payload FROM director_sequences WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const updateSequence = db.prepare("UPDATE director_sequences SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?");
    sequences.forEach((row) => updateSequence.run(JSON.stringify({ ...parseJson<Record<string, unknown>>(row.payload, {}), needsReview: true, staleReason: reason }), now, row.id, userId));
    const segments = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const updateSegment = db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?");
    segments.forEach((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        updateSegment.run(JSON.stringify({ ...payload, needsReview: true, staleReason: reason, h3PromptStale: Boolean(payload.h3PromptSnapshot), videoStale: Boolean(payload.videoFileId) }), now, row.id, userId);
    });
}

function markContinuationDependentsStale(userId: string, projectId: string, shotId: string) {
    const rows = db.prepare("SELECT id,payload FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string; payload: string }>;
    const update = db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?");
    const now = new Date().toISOString();
    rows.forEach((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        const continuationDepends = payload.boundary === "continue" && (payload.continuationFromSegmentId === shotId || payload.continuationFromShotId === shotId);
        const transitionDepends = payload.generationIntent === "transition" && (payload.transitionFromSegmentId === shotId || payload.transitionToSegmentId === shotId);
        if (continuationDepends || transitionDepends) update.run(JSON.stringify({ ...payload, needsReview: true, videoStale: true }), now, row.id, userId);
    });
}

function shotVideoChanged(previous: string, next: Record<string, unknown>) {
    const before = parseJson<Record<string, unknown>>(previous, {});
    return before.videoFileId !== next.videoFileId || before.actualFirstFrameFileId !== next.actualFirstFrameFileId || before.actualLastFrameFileId !== next.actualLastFrameFileId;
}

function normalizeShotPayload(payload: Record<string, unknown>, sequence: SequenceRow, userId: string) {
    const audioReferences = h3AudioReferencesInput.parse(payload.audioReferences);
    for (const { fileId } of audioReferences) {
        const file = getStoredFile(userId, fileId);
        if (!file || !file.mime_type.startsWith("audio/")) throw directorError(400, "DIRECTOR_AUDIO_REFERENCE_INVALID", "音频参考文件不存在或不是音频");
    }
    const segmentRanges = z.array(segmentRangeSchema).min(1).parse(payload.segmentRanges);
    const segmentIds = [...new Set(segmentRanges.map((range) => range.segmentId))];
    const videoReferences = z.array(videoReferenceSchema).max(3).default([]).parse(payload.videoReferences);
    const referenceImages = z.array(projectMediaPath).default([]).parse(payload.referenceImages);
    for (const shotId of segmentIds) if (!db.prepare("SELECT 1 FROM director_file_index WHERE user_id=? AND project_id=? AND entity_id=? AND kind='segment-design'").get(userId, sequence.project_id, shotId)) throw directorError(400, "DIRECTOR_TASK_SHOT", `制作任务关联的镜头不存在：${shotId}`);
    const dependencies = typeof payload.dependencies === "object" && payload.dependencies ? payload.dependencies : parseJson<Record<string, unknown>>(sequence.payload, {}).dependencies;
    const legacy = payload.references && typeof payload.references === "object" ? payload.references as Record<string, unknown> : {};
    const refs = (value: unknown) => Array.isArray(value) ? value : [];
    const durationSeconds = Number(payload.durationSeconds ?? payload.duration ?? 4);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw directorError(400, "DIRECTOR_TASK_DURATION", "制作任务时长必须大于 0");
    const { references: _references, h3ModeOverride: _h3ModeOverride, firstFrameFileId: _firstFrameFileId, lastFrameFileId: _lastFrameFileId, ...cleanPayload } = payload;
    return { ...cleanPayload, segmentRanges, segmentIds, videoReferences, referenceImages, audioReferences, entityKind: "production-task", durationSeconds, boundary: payload.boundary === "continue" ? "continue" : "cut", characterRefs: refs(payload.characterRefs).length ? refs(payload.characterRefs) : refs(legacy.characters), sceneRefs: refs(payload.sceneRefs).length ? refs(payload.sceneRefs) : refs(legacy.scenes), propRefs: refs(payload.propRefs).length ? refs(payload.propRefs) : refs(legacy.props), audioCues: refs(payload.audioCues), dependencies, needsReview: false };
}


function validateTimeline(userId: string, projectId: string, payload: Record<string, unknown>) {
    const segmentIds = new Set((db.prepare("SELECT id FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>).map((row) => row.id));
    const order = Array.isArray(payload.videoClips) ? payload.videoClips.map((clip: any) => clip.taskId) : [];
    if (order.some((shotId) => typeof shotId !== "string" || !segmentIds.has(shotId))) throw directorError(400, "DIRECTOR_TIMELINE_SEGMENT", "时间线包含不属于本项目的视频段");
}

function requireDocumentContent(userId: string, projectId: string, kind: string) {
    const row = db.prepare("SELECT content FROM director_documents WHERE user_id=? AND project_id=? AND kind=?").get(userId, projectId, kind) as { content: string } | undefined;
    if (!row?.content.trim()) throw directorError(409, "DIRECTOR_STAGE_GATE", `请先完成${kind === "script" ? "剧本" : "故事"}`);
}

function directorDependencies(userId: string, projectId: string) {
    const documents = db.prepare("SELECT kind,revision FROM director_documents WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ kind: string; revision: number }>;
    const currentStyleId = activeStyleId(userId, projectId);
    const style = currentStyleId ? db.prepare("SELECT id,revision FROM visual_styles WHERE user_id=? AND project_id=? AND id=?").get(userId, projectId, currentStyleId) as { id: string; revision: number } | undefined : undefined;
    return { documents: Object.fromEntries(documents.map((row) => [row.kind, row.revision])), style: style ? { id: style.id, revision: style.revision } : null };
}

export function activeStyleId(userId: string, projectId: string) {
    const row = db.prepare("SELECT payload FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId) as { payload: string } | undefined;
    return row ? String(parseJson<{ defaultVisualStyleId?: string | null }>(row.payload, {}).defaultVisualStyleId || "") || null : null;
}

function assertDirectorProject(userId: string, projectId: string) {
    const row = db.prepare("SELECT id FROM projects WHERE id=? AND user_id=? AND kind='director'").get(projectId, userId);
    if (!row) throw directorError(404, "DIRECTOR_PROJECT_NOT_FOUND", "导演项目不存在");
}
function sourceRow(userId: string, sourceId: string) { const row = db.prepare("SELECT * FROM director_sources WHERE id=? AND user_id=?").get(sourceId, userId) as SourceRow | undefined; if (!row) throw directorError(404, "DIRECTOR_SOURCE_NOT_FOUND", "小说来源不存在"); return row; }
function sequenceRow(userId: string, sequenceId: string) { const row = db.prepare("SELECT * FROM director_sequences WHERE id=? AND user_id=?").get(sequenceId, userId) as SequenceRow | undefined; if (!row) throw directorError(404, "DIRECTOR_SEQUENCE_NOT_FOUND", "剧情段落不存在"); return row; }
function shotRow(userId: string, shotId: string) { const row = db.prepare("SELECT * FROM director_shots WHERE id=? AND user_id=?").get(shotId, userId) as ShotRow | undefined; if (!row) throw directorError(404, "DIRECTOR_SHOT_NOT_FOUND", "镜头不存在"); return row; }

function emptyDirectingRules(): DirectorDirectingRules { return { positioning: "", intent: "", photography: "", performance: "", pacing: "", sound: "", prohibitions: "" }; }
function workspaceResponse(row: WorkspaceRow) { return { projectId: row.project_id, targetDurationSeconds: row.target_duration_seconds, aspectRatio: row.aspect_ratio, language: row.language, stage: row.stage, status: row.status, directingRules: { ...emptyDirectingRules(), ...parseJson<Partial<DirectorDirectingRules>>(row.directing_rules, {}) }, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function sourceResponse(row: SourceRow) { return { id: row.id, projectId: row.project_id, fileId: row.raw_file_id, name: row.name, mimeType: row.mime_type, status: row.status, error: row.error, charCount: row.char_count, chapterCount: row.chapter_count, summary: row.summary, outline: row.outline, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function documentResponse(row: DocumentRow) { return { projectId: row.project_id, kind: row.kind, content: row.content, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function screenplayBreakdownResponse(row: ScreenplayBreakdownRow, currentScriptRevision: number) { const payload = parseJson<{ scenes?: unknown[]; estimatedDurationSeconds?: number; review?: ScreenplayReview }>(row.payload, {}); const targetDurationSeconds = Number((db.prepare("SELECT target_duration_seconds value FROM director_workspaces WHERE user_id=? AND project_id=?").get(row.user_id, row.project_id) as { value: number }).value); const estimatedDurationSeconds = Number(payload.estimatedDurationSeconds || 0); const review: ScreenplayReview = payload.review || { status: "not_run", targetDurationSeconds, estimatedDurationSeconds, issues: [] }; return { projectId: row.project_id, scriptRevision: row.script_revision, stale: row.script_revision !== currentScriptRevision, payload: { scenes: payload.scenes || [], estimatedDurationSeconds, review }, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function screenplayBreakdownSummary(row: ScreenplayBreakdownRow, currentScriptRevision: number) { const payload = screenplayBreakdownResponse(row, currentScriptRevision); return { scriptRevision: row.script_revision, stale: payload.stale, sceneCount: payload.payload.scenes.length, estimatedDurationSeconds: payload.payload.estimatedDurationSeconds, reviewStatus: (payload.payload.review as { status: string }).status, revision: row.revision, updatedAt: row.updated_at }; }
function sequenceResponse(row: SequenceRow) { return { id: row.id, projectId: row.project_id, position: row.position, title: row.title, summary: row.summary, status: row.status, payload: parseJson(row.payload, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function videoSegmentResponse(row: ShotRow) { return { id: row.id, projectId: row.project_id, sequenceId: row.sequence_id, position: row.position, title: row.title, status: row.status, payload: parseJson(row.payload, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function videoSegmentPromptResponse(segment: ReturnType<typeof videoSegmentResponse>) {
    const payload = segment.payload as Record<string, unknown>;
    return { ...segment, payload: {
        segmentRanges: payload.segmentRanges, videoReferences: payload.videoReferences, videoStale: Boolean(payload.videoStale), referenceImages: payload.referenceImages, promptPath: payload.promptPath, videoPrompt: payload.videoPrompt, videoFileId: payload.videoFileId, videoDurationSeconds: payload.videoDurationSeconds,
        audioReferences: payload.audioReferences, durationSeconds: payload.durationSeconds, sourceSceneId: payload.sourceSceneId, sourceBeatIds: payload.sourceBeatIds, sourceDurationSeconds: payload.sourceDurationSeconds, dramaticBeat: payload.dramaticBeat, openingState: payload.openingState, endingState: payload.endingState, boundary: payload.boundary, continuationFromSegmentId: payload.continuationFromSegmentId, description: payload.description, action: payload.action, dialogue: payload.dialogue, narration: payload.narration, soundDesign: payload.soundDesign, h3VisualDescription: payload.h3VisualDescription, h3Soundscape: payload.h3Soundscape, h3NonDiegeticMusic: payload.h3NonDiegeticMusic,
        characterRefs: payload.characterRefs, sceneRefs: payload.sceneRefs, propRefs: payload.propRefs,
    } };
}
function timelineResponse(row: TimelineRow) { return { projectId: row.project_id, payload: parseJson(row.payload, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
export const createDirectorVideoSegment = createDirectorShot;
export const updateDirectorVideoSegment = updateDirectorShot;
export const deleteDirectorVideoSegment = deleteDirectorShot;
function chunkResponse(row: Record<string, unknown>) { return { id: row.id, sourceId: row.source_id, ordinal: row.ordinal, heading: row.heading, content: row.content, summary: row.summary, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function publish(userId: string, type: string, projectId: string, data: unknown) {
    const resources: DirectorResource[] = type === "workspace" ? ["project", "direction", "validation"]
        : type === "document.story" ? ["story", "validation"] : type === "document.script" || type === "screenplay-breakdown" ? ["script", "segments", "validation"]
        : type === "source" ? ["sources", "validation"] : type === "timeline" ? ["timeline"] : ["segments", "timeline", "validation"];
    markDirectorProjectChanged(userId, projectId, resources);
    emitDirectorUpdate(userId, { type, projectId, data }); return data;
}
function conflict(name: string, current: unknown): never { throw directorError(409, "DIRECTOR_CONFLICT", `${name}已在其他页面更新`, { current }); }
function directorError(statusCode: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status: statusCode, code, details }); }
