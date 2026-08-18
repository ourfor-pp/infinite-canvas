import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { nanoid } from "nanoid";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EPub } from "epub2";
import { convert } from "html-to-text";
import { z } from "zod";
import { db, parseJson } from "./database.js";
import { getStoredFile, syncFileRefs } from "./file-store.js";

export type DirectorEntityStatus = "draft" | "confirmed" | "locked";
type WorkspaceRow = { project_id: string; user_id: string; target_duration_seconds: number; aspect_ratio: string; language: string; stage: string; status: DirectorEntityStatus; revision: number; created_at: string; updated_at: string };
type SourceRow = { id: string; user_id: string; project_id: string; raw_file_id: string; name: string; mime_type: string; status: string; error: string | null; char_count: number; chapter_count: number; summary: string; outline: string; revision: number; created_at: string; updated_at: string };
type DocumentRow = { project_id: string; user_id: string; kind: "story" | "script"; content: string; status: DirectorEntityStatus; revision: number; created_at: string; updated_at: string };
type SequenceRow = { id: string; user_id: string; project_id: string; position: number; title: string; summary: string; status: DirectorEntityStatus; payload: string; revision: number; created_at: string; updated_at: string };
type ShotRow = { id: string; user_id: string; project_id: string; sequence_id: string; position: number; title: string; status: DirectorEntityStatus; payload: string; revision: number; created_at: string; updated_at: string };
type TimelineRow = { project_id: string; user_id: string; payload: string; revision: number; created_at: string; updated_at: string };
type SourceChapter = { heading: string; content: string };
export type DirectorStoryboardLayout = "2x2" | "3x2" | "3x3";

const id = z.string().trim().min(1).max(128);
const status = z.enum(["draft", "confirmed", "locked"]);
const record = z.record(z.string(), z.unknown());
const sourceInput = z.object({ fileId: id });
const workspacePatch = z.object({
    revision: z.number().int().positive(), targetDurationSeconds: z.number().int().min(10).max(86_400).optional(),
    aspectRatio: z.enum(["16:9", "9:16", "1:1", "2.39:1"]).optional(), language: z.string().trim().min(2).max(20).optional(),
    stage: z.enum(["source", "story", "script", "style", "assets", "storyboard", "shots", "timeline", "render"]).optional(), status: status.optional(),
});
const documentPatch = z.object({ revision: z.number().int().positive(), content: z.string().max(20_000_000).optional() });
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
    const workspace = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    const documents = db.prepare("SELECT * FROM director_documents WHERE user_id=? AND project_id=? ORDER BY kind").all(userId, projectId) as DocumentRow[];
    const sources = db.prepare("SELECT * FROM director_sources WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as SourceRow[];
    const sequences = db.prepare("SELECT * FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position, created_at").all(userId, projectId) as SequenceRow[];
    const shots = db.prepare(`SELECT shot.* FROM director_shots shot
        JOIN director_sequences sequence ON sequence.id=shot.sequence_id
        WHERE shot.user_id=? AND shot.project_id=?
        ORDER BY sequence.position, shot.position, shot.created_at`).all(userId, projectId) as ShotRow[];
    const timeline = db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    return { activeStyleId: activeStyleId(userId, projectId), workspace: workspaceResponse(workspace), documents: documents.map(documentResponse), sources: sources.map(sourceResponse), sequences: sequences.map(sequenceResponse), videoSegments: shots.map(videoSegmentResponse), timeline: timelineResponse(timeline) };
}

export function getDirectorAgentOverview(userId: string, projectId: string) {
    assertDirectorProject(userId, projectId);
    const workspace = db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow;
    const documents = db.prepare("SELECT project_id,kind,length(trim(content)) > 0 has_content,revision,created_at,updated_at FROM director_documents WHERE user_id=? AND project_id=? ORDER BY kind").all(userId, projectId) as Array<{ project_id: string; kind: "story" | "script"; has_content: number; revision: number; created_at: string; updated_at: string }>;
    const sources = db.prepare("SELECT id,project_id,raw_file_id,name,mime_type,status,error,char_count,chapter_count,summary,revision,created_at,updated_at FROM director_sources WHERE user_id=? AND project_id=? ORDER BY updated_at DESC").all(userId, projectId) as Array<Omit<SourceRow, "user_id" | "outline">>;
    const sequences = db.prepare("SELECT id,project_id,position,title,summary,status,revision,created_at,updated_at FROM director_sequences WHERE user_id=? AND project_id=? ORDER BY position,created_at").all(userId, projectId) as Array<Omit<SequenceRow, "user_id" | "payload">>;
    const videoSegmentCount = Number((db.prepare("SELECT count(*) count FROM director_shots WHERE user_id=? AND project_id=?").get(userId, projectId) as { count: number }).count);
    const timeline = db.prepare("SELECT project_id,revision,updated_at FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as Pick<TimelineRow, "project_id" | "revision" | "updated_at">;
    return {
        activeStyleId: activeStyleId(userId, projectId),
        workspace: workspaceResponse(workspace),
        documents: documents.map((row) => ({ projectId: row.project_id, kind: row.kind, hasContent: Boolean(row.has_content), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at })),
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
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_workspaces SET target_duration_seconds=?, aspect_ratio=?, language=?, stage=?, status=?, revision=revision+1, updated_at=?
        WHERE user_id=? AND project_id=? AND revision=?`).run(value.targetDurationSeconds ?? current.target_duration_seconds, value.aspectRatio ?? current.aspect_ratio, value.language ?? current.language, value.stage ?? current.stage, value.status ?? current.status, now, userId, projectId, value.revision);
    if (!result.changes) conflict("工作区", workspaceResponse(current));
    return publish(userId, "workspace", projectId, workspaceResponse(db.prepare("SELECT * FROM director_workspaces WHERE user_id=? AND project_id=?").get(userId, projectId) as WorkspaceRow));
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
    return publish(userId, `document.${documentKind}`, projectId, documentResponse(updated));
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
    assertStoryboardSize(value.payload.storyboard);
    const sequenceId = value.id || nanoid();
    const position = value.position ?? Number((db.prepare("SELECT coalesce(max(position),-1)+1 value FROM director_sequences WHERE user_id=? AND project_id=?").get(userId, projectId) as { value: number }).value);
    const now = new Date().toISOString();
    const dependencies = directorDependencies(userId, projectId);
    db.prepare(`INSERT INTO director_sequences(id,user_id,project_id,position,title,summary,status,payload,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sequenceId, userId, projectId, position, value.title, value.summary, value.status, JSON.stringify({ ...value.payload, dependencies, needsReview: false, storyboard: normalizeStoryboard(value.payload.storyboard) }), now, now);
    return publish(userId, "sequence", projectId, sequenceResponse(db.prepare("SELECT * FROM director_sequences WHERE id=? AND user_id=?").get(sequenceId, userId) as SequenceRow));
}

export function updateDirectorSequence(userId: string, sequenceId: string, body: unknown, allowLocked = false) {
    const current = sequenceRow(userId, sequenceId);
    const value = sequencePatch.parse(body);
    if (value.payload && "storyboard" in value.payload) assertStoryboardSize(value.payload.storyboard);
    if (!allowLocked && current.status === "locked" && ((value.status !== undefined && value.status !== "locked") || Object.keys(value).some((key) => !["revision", "status"].includes(key)))) throw directorError(423, "DIRECTOR_LOCKED", "剧情段落已锁定，需要通过 Agent 审批后修改");
    const currentPayload = parseJson<Record<string, unknown>>(current.payload, {});
    const payload = value.payload ? { ...currentPayload, ...value.payload, storyboard: normalizeStoryboard(value.payload.storyboard ?? currentPayload.storyboard) } : currentPayload;
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_sequences SET position=?,title=?,summary=?,status=?,payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?`)
        .run(value.position ?? current.position, value.title ?? current.title, value.summary ?? current.summary, value.status ?? current.status, JSON.stringify(payload), now, sequenceId, userId, value.revision);
    if (!result.changes) conflict("剧情段落", sequenceResponse(current));
    return publish(userId, "sequence", current.project_id, sequenceResponse(sequenceRow(userId, sequenceId)));
}

export function deleteDirectorSequence(userId: string, sequenceId: string, allowLocked = false) {
    const current = sequenceRow(userId, sequenceId);
    if (!allowLocked && current.status === "locked") throw directorError(423, "DIRECTOR_LOCKED", "剧情段落已锁定，需要通过 Agent 审批后删除");
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
    const payload = normalizeShotPayload(value.payload, sequence);
    db.prepare(`INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(shotId, userId, projectId, value.sequenceId, position, value.title, value.status, JSON.stringify(payload), now, now);
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
    const payload: Record<string, unknown> = value.payload ? normalizeShotPayload({ ...currentPayload, ...value.payload }, sequence) : currentPayload;
    if (storyboardPlanChanged(currentPayload, payload) && payload.videoFileId) payload.videoStale = true;
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE director_shots SET sequence_id=?,position=?,title=?,status=?,payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?`)
        .run(sequenceId, value.position ?? current.position, value.title ?? current.title, value.status ?? current.status, JSON.stringify(payload), now, shotId, userId, value.revision);
    if (!result.changes) conflict("视频段", videoSegmentResponse(current));
    if (shotVideoChanged(current.payload, payload)) markContinuationDependentsStale(userId, current.project_id, shotId);
    return publish(userId, "video-segment", current.project_id, videoSegmentResponse(shotRow(userId, shotId)));
}

export function deleteDirectorShot(userId: string, shotId: string, allowLocked = false) {
    const current = shotRow(userId, shotId);
    if (!allowLocked && current.status === "locked") throw directorError(423, "DIRECTOR_LOCKED", "镜头已锁定，需要通过 Agent 审批后删除");
    db.prepare("DELETE FROM director_shots WHERE id=? AND user_id=?").run(shotId, userId);
    return publish(userId, "video-segment.deleted", current.project_id, { id: shotId });
}

export function updateDirectorTimeline(userId: string, projectId: string, body: unknown) {
    assertDirectorProject(userId, projectId);
    const value = timelinePatch.parse(body);
    validateTimeline(userId, projectId, value.payload);
    const current = db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow;
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND revision=?")
        .run(JSON.stringify(value.payload), now, userId, projectId, value.revision);
    if (!result.changes) conflict("时间线", timelineResponse(current));
    return publish(userId, "timeline", projectId, timelineResponse(db.prepare("SELECT * FROM director_timelines WHERE user_id=? AND project_id=?").get(userId, projectId) as TimelineRow));
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

function normalizeStoryboard(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 9).map((panel, index) => ({ id: typeof panel === "object" && panel && "id" in panel ? String(panel.id) : nanoid(), position: index, durationSeconds: 4, characterRefs: [], sceneRefs: [], propRefs: [], ...(typeof panel === "object" && panel ? panel : {}) }));
}
function assertStoryboardSize(value: unknown) {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length < 4 || value.length > 9) throw directorError(400, "DIRECTOR_STORYBOARD_SIZE", "每个剧情段落的故事板必须包含 4–9 格");
}

function normalizeShotPayload(payload: Record<string, unknown>, sequence: SequenceRow) {
    const dependencies = typeof payload.dependencies === "object" && payload.dependencies ? payload.dependencies : parseJson<Record<string, unknown>>(sequence.payload, {}).dependencies;
    const legacy = payload.references && typeof payload.references === "object" ? payload.references as Record<string, unknown> : {};
    const refs = (value: unknown) => Array.isArray(value) ? value : [];
    const durationSeconds = Math.round(Number(payload.durationSeconds ?? payload.duration) || 4);
    if (durationSeconds < 4 || durationSeconds > 15) throw directorError(400, "DIRECTOR_VIDEO_SEGMENT_DURATION", "视频段时长必须为 4–15 秒；更长内容请先拆段");
    const existingSheet = payload.storyboardSheet && typeof payload.storyboardSheet === "object" ? payload.storyboardSheet as Record<string, unknown> : undefined;
    const existingFrames = Array.isArray(existingSheet?.frames) ? existingSheet.frames as Array<Record<string, unknown>> : [];
    const requestedCount = Number(payload.storyboardFrameCount);
    const frameCount = [4, 6, 9].includes(requestedCount) ? requestedCount : [4, 6, 9].includes(existingFrames.length) ? existingFrames.length : recommendedStoryboardFrameCount(durationSeconds);
    const sheetChanged = Boolean(existingSheet && existingFrames.length !== frameCount);
    const storyboardSheet = existingSheet && !sheetChanged ? { ...existingSheet, layout: storyboardLayout(frameCount), frames: normalizeStoryboardFrames(existingFrames, durationSeconds) } : buildStoryboardSheet(durationSeconds, frameCount, payload, existingFrames, Number(existingSheet?.revision || 0) + 1);
    const { references: _references, h3ModeOverride: _h3ModeOverride, firstFrameFileId: _firstFrameFileId, lastFrameFileId: _lastFrameFileId, ...cleanPayload } = payload;
    return { ...cleanPayload, entityKind: "video-segment", durationSeconds, boundary: payload.boundary === "continue" ? "continue" : "cut", characterRefs: refs(payload.characterRefs).length ? refs(payload.characterRefs) : refs(legacy.characters), sceneRefs: refs(payload.sceneRefs).length ? refs(payload.sceneRefs) : refs(legacy.scenes), propRefs: refs(payload.propRefs).length ? refs(payload.propRefs) : refs(legacy.props), audioCues: refs(payload.audioCues), storyboardFrameCount: frameCount, storyboardSheet, ...(sheetChanged ? { videoStale: Boolean(payload.videoFileId) } : {}), dependencies, needsReview: false };
}

export function recommendedStoryboardFrameCount(durationSeconds: number) { return durationSeconds <= 6 ? 4 : durationSeconds <= 10 ? 6 : 9; }
export function storyboardLayout(frameCount: number): DirectorStoryboardLayout { return frameCount === 9 ? "3x3" : frameCount === 6 ? "3x2" : "2x2"; }

function buildStoryboardSheet(duration: number, frameCount: number, payload: Record<string, unknown>, source: Array<Record<string, unknown>> = [], revision = 1) {
    const intent = String(payload.description || payload.action || "");
    const frames = Array.from({ length: frameCount }, (_, position) => {
        const timeSeconds = Number((duration * position / Math.max(1, frameCount - 1)).toFixed(2));
        const nearest = source.length ? source[Math.round(position * (source.length - 1) / Math.max(1, frameCount - 1))] : undefined;
        return { id: nanoid(), position, shotNumber: Number(nearest?.shotNumber ?? nearest?.shot ?? 1), timeSeconds, kind: position === 0 ? "shot-start" : position === frameCount - 1 ? "shot-end" : "keyframe", description: String(nearest?.description || `${timeSeconds} 秒时清晰呈现“${intent}”的第 ${position + 1} 个连续视觉节拍`), action: String(nearest?.action || payload.action || ""), cameraAngle: String(nearest?.cameraAngle || payload.cameraAngle || ""), cameraMove: String(nearest?.cameraMove || payload.cameraMove || ""), h3Visual: String(nearest?.h3Visual || ""), dialogue: String(nearest?.dialogue || ""), sound: String(nearest?.sound || payload.sound || "") };
    });
    return { revision: Math.max(1, revision), layout: storyboardLayout(frameCount), frames: normalizeStoryboardFrames(frames, duration) };
}

function normalizeStoryboardFrames(frames: Array<Record<string, unknown>>, duration: number) {
    return frames.map((frame, position) => {
        const { guideEnabled: _guideEnabled, guideStrength: _guideStrength, croppedFileId: _croppedFileId, resolvedFrameIndex: _resolvedFrameIndex, shot: _shot, ...rest } = frame;
        return {
            ...rest,
            id: String(frame.id || nanoid()),
            position,
            shotNumber: Math.max(1, Math.round(Number(frame.shotNumber ?? frame.shot ?? 1) || 1)),
            timeSeconds: Math.max(0, Math.min(duration, Number(frame.timeSeconds) || 0)),
            kind: frame.kind === "shot-start" || frame.kind === "shot-end" ? frame.kind : "keyframe",
            description: String(frame.description || ""),
            action: String(frame.action || ""),
            cameraAngle: String(frame.cameraAngle || ""),
            cameraMove: String(frame.cameraMove || ""),
            h3Visual: String(frame.h3Visual || ""),
            dialogue: String(frame.dialogue || ""),
            sound: String(frame.sound || ""),
        };
    });
}

function storyboardPlanChanged(before: Record<string, unknown>, after: Record<string, unknown>) {
    const values = (payload: Record<string, unknown>) => {
        const sheet = payload.storyboardSheet && typeof payload.storyboardSheet === "object" ? payload.storyboardSheet as Record<string, unknown> : {};
        const frames = Array.isArray(sheet.frames) ? sheet.frames as Array<Record<string, unknown>> : [];
        return frames.map((frame) => [String(frame.id), Number(frame.shotNumber || 1), Number(frame.timeSeconds || 0), String(frame.kind || "keyframe"), String(frame.description || ""), String(frame.action || ""), String(frame.cameraAngle || ""), String(frame.cameraMove || ""), String(frame.h3Visual || ""), String(frame.dialogue || ""), String(frame.sound || "")]);
    };
    return JSON.stringify(values(before)) !== JSON.stringify(values(after));
}

function validateTimeline(userId: string, projectId: string, payload: Record<string, unknown>) {
    const shotIds = new Set((db.prepare("SELECT id FROM director_shots WHERE user_id=? AND project_id=?").all(userId, projectId) as Array<{ id: string }>).map((row) => row.id));
    const order = Array.isArray(payload.segmentOrder) ? payload.segmentOrder : [];
    if (order.some((shotId) => typeof shotId !== "string" || !shotIds.has(shotId))) throw directorError(400, "DIRECTOR_TIMELINE_SEGMENT", "时间线包含不属于本项目的视频段");
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

function workspaceResponse(row: WorkspaceRow) { return { projectId: row.project_id, targetDurationSeconds: row.target_duration_seconds, aspectRatio: row.aspect_ratio, language: row.language, stage: row.stage, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function sourceResponse(row: SourceRow) { return { id: row.id, projectId: row.project_id, fileId: row.raw_file_id, name: row.name, mimeType: row.mime_type, status: row.status, error: row.error, charCount: row.char_count, chapterCount: row.chapter_count, summary: row.summary, outline: row.outline, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function documentResponse(row: DocumentRow) { return { projectId: row.project_id, kind: row.kind, content: row.content, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function sequenceResponse(row: SequenceRow) { return { id: row.id, projectId: row.project_id, position: row.position, title: row.title, summary: row.summary, status: row.status, payload: parseJson(row.payload, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function videoSegmentResponse(row: ShotRow) { return { id: row.id, projectId: row.project_id, sequenceId: row.sequence_id, position: row.position, title: row.title, status: row.status, payload: parseJson(row.payload, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function videoSegmentPromptResponse(segment: ReturnType<typeof videoSegmentResponse>) {
    const payload = segment.payload as Record<string, unknown>;
    const sheet = payload.storyboardSheet && typeof payload.storyboardSheet === "object" ? payload.storyboardSheet as Record<string, unknown> : {};
    const frames = Array.isArray(sheet.frames) ? sheet.frames as Array<Record<string, unknown>> : [];
    return { ...segment, payload: {
        durationSeconds: payload.durationSeconds, sourceSceneId: payload.sourceSceneId, sourceBeatIds: payload.sourceBeatIds, sourceDurationSeconds: payload.sourceDurationSeconds, dramaticBeat: payload.dramaticBeat, openingState: payload.openingState, endingState: payload.endingState, boundary: payload.boundary, continuationFromSegmentId: payload.continuationFromSegmentId, description: payload.description, action: payload.action, dialogue: payload.dialogue, narration: payload.narration, soundDesign: payload.soundDesign, h3VisualDescription: payload.h3VisualDescription, h3Soundscape: payload.h3Soundscape, h3NonDiegeticMusic: payload.h3NonDiegeticMusic,
        characterRefs: payload.characterRefs, sceneRefs: payload.sceneRefs, propRefs: payload.propRefs,
        storyboardStale: Boolean(payload.storyboardStale), videoStale: Boolean(payload.videoStale),
        storyboardSheet: { revision: sheet.revision, layout: sheet.layout, hasImage: Boolean(sheet.imageFileId), hasPrompt: Boolean(sheet.promptSnapshot), frames: frames.map((frame) => ({ id: frame.id, position: frame.position, shotNumber: frame.shotNumber, timeSeconds: frame.timeSeconds, kind: frame.kind, description: frame.description, action: frame.action, cameraAngle: frame.cameraAngle, cameraMove: frame.cameraMove, h3Visual: frame.h3Visual, dialogue: frame.dialogue, sound: frame.sound })) },
    } };
}
function timelineResponse(row: TimelineRow) { return { projectId: row.project_id, payload: parseJson(row.payload, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
export const createDirectorVideoSegment = createDirectorShot;
export const updateDirectorVideoSegment = updateDirectorShot;
export const deleteDirectorVideoSegment = deleteDirectorShot;
function chunkResponse(row: Record<string, unknown>) { return { id: row.id, sourceId: row.source_id, ordinal: row.ordinal, heading: row.heading, content: row.content, summary: row.summary, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function publish(userId: string, type: string, projectId: string, data: unknown) { emitDirectorUpdate(userId, { type, projectId, data }); return data; }
function conflict(name: string, current: unknown): never { throw directorError(409, "DIRECTOR_CONFLICT", `${name}已在其他页面更新`, { current }); }
function directorError(statusCode: number, code: string, message: string, details?: unknown) { return Object.assign(new Error(message), { status: statusCode, code, details }); }
