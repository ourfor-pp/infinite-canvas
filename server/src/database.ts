import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.databasePath), { recursive: true });
export const db: Database.Database = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'canvas',
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS director_sync_versions (
  needs_reconcile INTEGER NOT NULL DEFAULT 0,
  diagnostics TEXT NOT NULL DEFAULT '[]',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, project_id)
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_assets_user_updated ON assets(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS stored_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_user ON stored_files(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS file_refs (
  file_id TEXT NOT NULL REFERENCES stored_files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  PRIMARY KEY (file_id, user_id, owner_type, owner_id)
);
CREATE TABLE IF NOT EXISTS generation_effects (
    generation_id TEXT NOT NULL,
    handler TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    retry_after INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(generation_id,handler)
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT NOT NULL DEFAULT '',
  request TEXT NOT NULL,
  result TEXT,
  error TEXT,
  error_code TEXT,
  remote_task_id TEXT,
  progress REAL NOT NULL DEFAULT 0,
  usage TEXT,
  comfy_server_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_generations_user_created ON generations(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS generation_diagnostics (
  generation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (generation_id, user_id),
  FOREIGN KEY (generation_id, user_id) REFERENCES generations(id, user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comfy_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encrypted_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  models TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  models TEXT NOT NULL DEFAULT '[]',
  concurrency INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_model_defaults (
  kind TEXT PRIMARY KEY,
  model_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_global_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_executor_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS browser_imports (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (user_id, import_id)
);
CREATE TABLE IF NOT EXISTS agent_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model_ref TEXT NOT NULL DEFAULT '',
  media_model_ref TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  sdk_session_id TEXT,
  fork_pending INTEGER NOT NULL DEFAULT 0,
  fork_resume_at TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  event_seq INTEGER NOT NULL DEFAULT 0,
  current_run_id TEXT,
  pending_decision TEXT,
  last_error TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  usage TEXT,
  error TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS agent_events (
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS agent_queued_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  wait_for_run_id TEXT,
  accepted_run_id TEXT,
  client_message_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachment_file_ids TEXT NOT NULL DEFAULT '[]',
  display_text TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, client_message_id),
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_queue_session ON agent_queued_messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS agent_message_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  run_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, client_message_id)
);
CREATE TABLE IF NOT EXISTS agent_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  protocol_version INTEGER NOT NULL,
  storage_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visual_styles (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  template_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  reference_file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  dna TEXT NOT NULL DEFAULT '{}',
  reference_files TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id),
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_visual_styles_project ON visual_styles(user_id, project_id, updated_at DESC);
`);

db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
applyVersionTwo();
applyVersionThree();
applyVersionFour();
applyVersionFive();
applyVersionSix();
prepareAgentMetadata();
applyVersionSeven();
applyVersionEight();
applyVersionNine();
applyVersionTen();
applyVersionEleven();
applyVersionTwelve();
applyVersionThirteen();
applyVersionFourteen();
applyVersionFifteen();
applyVersionSixteen();
applyVersionSeventeen();
applyVersionEighteen();
applyVersionNineteen();
applyVersionTwenty();
applyVersionTwentyOne();
applyVersionTwentyTwo();
applyVersionTwentyThree();
applyVersionTwentyFour();
applyVersionTwentyFive();
applyVersionTwentySix();
applyVersionTwentySeven();
ensureAgentMetadata(4, 2);

function applyVersionTwo() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get()) return;
    const columns = db.prepare("PRAGMA table_info(generations)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (columns.some((column) => column.name === "execution")) {
            db.exec(`
                ALTER TABLE generations RENAME TO generations_v016;
                CREATE TABLE generations (
                  id TEXT NOT NULL,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL,
                  status TEXT NOT NULL,
                  provider_id TEXT,
                  model_id TEXT NOT NULL DEFAULT '',
                  request TEXT NOT NULL,
                  result TEXT,
                  error TEXT,
                  error_code TEXT,
                  remote_task_id TEXT,
                  progress REAL NOT NULL DEFAULT 0,
                  usage TEXT,
                  comfy_server_id TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (id, user_id)
                );
                INSERT INTO generations(id, user_id, kind, status, model_id, request, result, error, error_code, remote_task_id, progress, comfy_server_id, created_at, updated_at)
                SELECT id, user_id, kind, status, '', request, result, error, NULL, prompt_id,
                  CASE WHEN status='succeeded' THEN 1 ELSE 0 END, comfy_server_id, created_at, updated_at
                FROM generations_v016;
                DROP TABLE generations_v016;
                CREATE INDEX idx_generations_user_created ON generations(user_id, created_at DESC);
            `);
        }
        db.prepare("DELETE FROM user_settings").run();
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(new Date().toISOString());
    })();
}

function applyVersionThree() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get()) return;
    const columns = db.prepare("PRAGMA table_info(generations)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!columns.some((column) => column.name === "error_code")) {
            db.exec("ALTER TABLE generations ADD COLUMN error_code TEXT");
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?)").run(new Date().toISOString());
    })();
}

function applyVersionFour() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get()) return;
    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO agent_settings(id, model_ref, updated_at) VALUES(1, '', ?)").run(now);
        db.prepare("UPDATE agent_sessions SET status='failed', current_run_id=NULL, pending_decision=NULL, last_error='服务重启中断，当前任务无法安全恢复', last_error_code='SERVICE_RESTART_INTERRUPTED', updated_at=? WHERE status IN ('running','waiting_for_user')").run(now);
        db.prepare("UPDATE agent_runs SET status='failed', error='服务重启中断，当前任务无法安全恢复', error_code='SERVICE_RESTART_INTERRUPTED', finished_at=? WHERE status IN ('queued','running','waiting_for_user')").run(now);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(4, ?)").run(now);
    })();
}

function applyVersionFive() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=5").get()) return;
    const columns = db.prepare("PRAGMA table_info(agent_sessions)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!columns.some((column) => column.name === "fork_pending")) db.exec("ALTER TABLE agent_sessions ADD COLUMN fork_pending INTEGER NOT NULL DEFAULT 0");
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)").run(new Date().toISOString());
    })();
}

function applyVersionSix() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=6").get()) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS creative_assets (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'draft',
              payload TEXT NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_creative_assets_project ON creative_assets(user_id, project_id, kind, updated_at DESC);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(6, ?)").run(new Date().toISOString());
    })();
}

function applyVersionSeven() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=7").get()) return;
    const columns = db.prepare("PRAGMA table_info(agent_sessions)").all() as Array<{ name: string }>;
    const legacy = columns.some((column) => column.name === "owner_type");
    if (legacy) createAgentStorageMigrationBackup();
    db.pragma("foreign_keys = OFF");
    try {
        db.transaction(() => {
            if (legacy) {
                db.exec(`
                    CREATE TABLE agent_sessions_v2 (
                      id TEXT PRIMARY KEY,
                      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                      project_id TEXT NOT NULL,
                      sdk_session_id TEXT,
                      fork_pending INTEGER NOT NULL DEFAULT 0,
                      title TEXT NOT NULL,
                      status TEXT NOT NULL,
                      event_seq INTEGER NOT NULL DEFAULT 0,
                      current_run_id TEXT,
                      pending_decision TEXT,
                      last_error TEXT,
                      last_error_code TEXT,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL,
                      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
                    );
                    INSERT INTO agent_sessions_v2
                      SELECT s.id, s.user_id, s.owner_id, NULL, 0, s.title, s.status,
                        s.event_seq + 1, s.current_run_id, s.pending_decision, s.last_error, s.last_error_code, s.created_at, s.updated_at
                      FROM agent_sessions s
                      WHERE s.owner_type='project' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=s.owner_id AND p.user_id=s.user_id);
                    CREATE TABLE agent_runs_v2 (
                      id TEXT PRIMARY KEY,
                      session_id TEXT NOT NULL REFERENCES agent_sessions_v2(id) ON DELETE CASCADE,
                      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                      status TEXT NOT NULL,
                      model_ref TEXT NOT NULL,
                      usage TEXT,
                      error TEXT,
                      error_code TEXT,
                      started_at TEXT NOT NULL,
                      finished_at TEXT
                    );
                    INSERT INTO agent_runs_v2 SELECT r.* FROM agent_runs r JOIN agent_sessions_v2 s ON s.id=r.session_id;
                    CREATE TABLE agent_events_v2 (
                      session_id TEXT NOT NULL REFERENCES agent_sessions_v2(id) ON DELETE CASCADE,
                      seq INTEGER NOT NULL,
                      run_id TEXT,
                      kind TEXT NOT NULL,
                      payload TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      PRIMARY KEY (session_id, seq)
                    );
                    INSERT INTO agent_events_v2 SELECT e.* FROM agent_events e JOIN agent_sessions_v2 s ON s.id=e.session_id;
                    INSERT INTO agent_events_v2(session_id, seq, run_id, kind, payload, created_at)
                      SELECT id, event_seq, NULL, 'run_state', '{"state":"idle","content":"Agent 已升级为项目共享工作空间，旧运行上下文已安全归档"}', datetime('now') FROM agent_sessions_v2;
                    INSERT OR IGNORE INTO file_refs(file_id, user_id, owner_type, owner_id)
                      SELECT f.file_id, f.user_id, 'agent_project', s.project_id FROM file_refs f JOIN agent_sessions_v2 s ON s.id=f.owner_id
                      WHERE f.owner_type='agent_session';
                    DELETE FROM file_refs WHERE owner_type='agent_session';
                    DROP TABLE agent_events;
                    DROP TABLE agent_runs;
                    DROP TABLE agent_sessions;
                    ALTER TABLE agent_sessions_v2 RENAME TO agent_sessions;
                    ALTER TABLE agent_runs_v2 RENAME TO agent_runs;
                    ALTER TABLE agent_events_v2 RENAME TO agent_events;
                    CREATE INDEX idx_agent_runs_user ON agent_runs(user_id, started_at DESC);
                    DROP TABLE IF EXISTS agent_permission_rules;
                `);
            }
            db.exec("CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(user_id, project_id, updated_at DESC)");
            db.prepare("UPDATE agent_metadata SET protocol_version=2, storage_version=2, updated_at=? WHERE id=1").run(new Date().toISOString());
            db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(7, ?)").run(new Date().toISOString());
        })();
    } finally {
        db.pragma("foreign_keys = ON");
    }
    cleanupLegacyAgentWorkspaces();
}

function applyVersionEight() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=8").get()) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS visual_styles (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL,
              name TEXT NOT NULL,
              mode TEXT NOT NULL,
              template_id TEXT,
              description TEXT NOT NULL DEFAULT '',
              reference_file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_visual_styles_project ON visual_styles(user_id, project_id, updated_at DESC);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(8, ?)").run(new Date().toISOString());
    })();
}

function applyVersionNine() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=9").get()) return;
    const columns = db.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!columns.some((column) => column.name === "tool_search_mode")) db.exec("ALTER TABLE agent_runs ADD COLUMN tool_search_mode TEXT NOT NULL DEFAULT 'false'");
        if (!columns.some((column) => column.name === "tool_search_call_count")) db.exec("ALTER TABLE agent_runs ADD COLUMN tool_search_call_count INTEGER NOT NULL DEFAULT 0");
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(9, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get()) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS agent_queued_messages (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL,
              session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
              wait_for_run_id TEXT,
              accepted_run_id TEXT,
              client_message_id TEXT NOT NULL,
              content TEXT NOT NULL,
              attachment_file_ids TEXT NOT NULL DEFAULT '[]',
              display_text TEXT NOT NULL,
              status TEXT NOT NULL,
              error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(user_id, client_message_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_agent_queue_session ON agent_queued_messages(session_id, created_at);
            CREATE TABLE IF NOT EXISTS agent_message_receipts (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              client_message_id TEXT NOT NULL,
              session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
              run_id TEXT,
              created_at TEXT NOT NULL,
              PRIMARY KEY (user_id, client_message_id)
            );
        `);
        db.prepare("UPDATE agent_metadata SET protocol_version=3, storage_version=2, updated_at=? WHERE id=1").run(new Date().toISOString());
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(10, ?)").run(new Date().toISOString());
    })();
}

function applyVersionEleven() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=11").get()) return;
    const columns = db.prepare("PRAGMA table_info(agent_sessions)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!columns.some((column) => column.name === "fork_resume_at")) db.exec("ALTER TABLE agent_sessions ADD COLUMN fork_resume_at TEXT");
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(11, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwelve() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=12").get()) return;
    const assets = db.prepare("SELECT id,user_id,kind,name,payload FROM creative_assets").all() as Array<{ id: string; user_id: string; kind: string; name: string; payload: string }>;
    const providers = db.prepare("SELECT id,models FROM ai_providers").all() as Array<{ id: string; models: string }>;
    db.transaction(() => {
        for (const row of assets) {
            const payload = parseJson<Record<string, unknown>>(row.payload, {});
            const variants = Array.isArray(payload.variants) ? payload.variants as Array<Record<string, unknown>> : [];
            const lastImagePrompt = [...variants].reverse().find((item) => item.kind === "image" && !["reference_input", "identity_reference", "wardrobe_reference", "composition_reference"].includes(String(item.usage || "")) && typeof item.prompt === "string")?.prompt;
            const existingDrafts = payload.mediaDrafts && typeof payload.mediaDrafts === "object" ? payload.mediaDrafts as Record<string, unknown> : {};
            const existingImage = existingDrafts.image && typeof existingDrafts.image === "object" ? existingDrafts.image as Record<string, unknown> : {};
            const existingAudio = existingDrafts.audio && typeof existingDrafts.audio === "object" ? existingDrafts.audio as Record<string, unknown> : {};
            const mediaDrafts = {
                image: {
                    prompt: typeof existingImage.prompt === "string" ? existingImage.prompt : typeof lastImagePrompt === "string" && lastImagePrompt.trim() ? lastImagePrompt : "",
                    model: typeof existingImage.model === "string" ? existingImage.model : typeof payload.imageModel === "string" ? payload.imageModel : null,
                    params: existingImage.params && typeof existingImage.params === "object" ? existingImage.params : {},
                },
                audio: {
                    prompt: typeof existingAudio.prompt === "string" ? existingAudio.prompt : typeof payload.voiceDescription === "string" ? payload.voiceDescription : "",
                    model: typeof existingAudio.model === "string" ? existingAudio.model : typeof payload.audioModel === "string" ? payload.audioModel : null,
                    params: existingAudio.params && typeof existingAudio.params === "object" ? existingAudio.params : {},
                    audioMode: row.kind === "character" ? "speech" : row.kind === "scene" ? "ambient" : "sfx",
                    transcript: typeof existingAudio.transcript === "string" ? existingAudio.transcript : typeof payload.voiceSampleText === "string" ? payload.voiceSampleText : "",
                },
            };
            const { voiceDescription: _voiceDescription, voiceSampleText: _voiceSampleText, imageModel: _imageModel, audioModel: _audioModel, ...next } = payload;
            db.prepare("UPDATE creative_assets SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...next, mediaDrafts }), row.id, row.user_id);
        }
        for (const provider of providers) {
            const models = parseJson<Array<Record<string, unknown>>>(provider.models, []).map((model) => model.output === "audio" && !Array.isArray(model.audioModes) ? { ...model, audioModes: ["speech"] } : model);
            db.prepare("UPDATE ai_providers SET models=? WHERE id=?").run(JSON.stringify(models), provider.id);
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(12, ?)").run(new Date().toISOString());
    })();
}

function applyVersionThirteen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=13").get()) return;
    const assets = db.prepare("SELECT id,user_id,kind,name,payload FROM creative_assets").all() as Array<{ id: string; user_id: string; kind: string; name: string; payload: string }>;
    db.transaction(() => {
        for (const row of assets) {
            const payload = parseJson<Record<string, unknown>>(row.payload, {});
            const drafts = payload.mediaDrafts && typeof payload.mediaDrafts === "object" ? payload.mediaDrafts as Record<string, unknown> : {};
            const image = drafts.image && typeof drafts.image === "object" ? drafts.image as Record<string, unknown> : {};
            const prompt = typeof image.prompt === "string" ? image.prompt.trim() : "";
            const description = typeof payload.description === "string" ? payload.description.trim() : "";
            const subject = row.kind === "character" ? "角色" : row.kind === "scene" ? "场景" : "道具";
            const generatedPrefixes = [`${subject}「${row.name}」的视觉设计参考。`, `为${subject}“${row.name}”制作可用于后续镜头保持一致性的设计图。`, `为${subject}「${row.name}」制作可用于后续镜头保持一致性的设计图。`];
            if (prompt && prompt !== description && !generatedPrefixes.some((prefix) => prompt.startsWith(prefix))) continue;
            db.prepare("UPDATE creative_assets SET payload=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...payload, mediaDrafts: { ...drafts, image: { ...image, prompt: "" } } }), row.id, row.user_id);
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(13, ?)").run(new Date().toISOString());
    })();
}

function applyVersionFourteen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=14").get()) return;
    const styleColumns = db.prepare("PRAGMA table_info(visual_styles)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!styleColumns.some((column) => column.name === "status")) db.exec("ALTER TABLE visual_styles ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'");
        if (!styleColumns.some((column) => column.name === "dna")) db.exec("ALTER TABLE visual_styles ADD COLUMN dna TEXT NOT NULL DEFAULT '{}'");
        if (!styleColumns.some((column) => column.name === "reference_files")) db.exec("ALTER TABLE visual_styles ADD COLUMN reference_files TEXT NOT NULL DEFAULT '{}'");
        db.prepare("UPDATE visual_styles SET reference_files=json_object('source', reference_file_id) WHERE reference_file_id IS NOT NULL AND reference_files='{}'").run();
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(14, ?)").run(new Date().toISOString());
    })();
}

function applyVersionFifteen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=15").get()) return;
    const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!columns.some((column) => column.name === "kind")) db.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'canvas'");
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_projects_user_kind_updated ON projects(user_id, kind, updated_at DESC);
            CREATE TABLE IF NOT EXISTS director_workspaces (
              project_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              target_duration_seconds INTEGER NOT NULL DEFAULT 600,
              aspect_ratio TEXT NOT NULL DEFAULT '16:9',
              language TEXT NOT NULL DEFAULT 'zh-CN',
              stage TEXT NOT NULL DEFAULT 'source',
              status TEXT NOT NULL DEFAULT 'draft',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (project_id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS director_sources (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              raw_file_id TEXT NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
              name TEXT NOT NULL,
              mime_type TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'processing',
              error TEXT,
              char_count INTEGER NOT NULL DEFAULT 0,
              chapter_count INTEGER NOT NULL DEFAULT 0,
              summary TEXT NOT NULL DEFAULT '',
              outline TEXT NOT NULL DEFAULT '',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_director_sources_project ON director_sources(user_id, project_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS director_source_chunks (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              source_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              heading TEXT NOT NULL DEFAULT '',
              content TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'pending',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              UNIQUE (source_id, ordinal),
              FOREIGN KEY (source_id, user_id) REFERENCES director_sources(id, user_id) ON DELETE CASCADE,
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_director_chunks_source ON director_source_chunks(user_id, source_id, ordinal);
            CREATE TABLE IF NOT EXISTS director_documents (
              project_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              content TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (project_id, user_id, kind),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS director_sequences (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              position INTEGER NOT NULL,
              title TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              payload TEXT NOT NULL DEFAULT '{}',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_director_sequences_project ON director_sequences(user_id, project_id, position);
            CREATE TABLE IF NOT EXISTS director_shots (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              sequence_id TEXT NOT NULL,
              position INTEGER NOT NULL,
              title TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'draft',
              payload TEXT NOT NULL DEFAULT '{}',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              FOREIGN KEY (sequence_id, user_id) REFERENCES director_sequences(id, user_id) ON DELETE CASCADE,
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_director_shots_project ON director_shots(user_id, project_id, sequence_id, position);
            CREATE TABLE IF NOT EXISTS director_timelines (
              project_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              payload TEXT NOT NULL DEFAULT '{}',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (project_id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS director_renders (
              id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              status TEXT NOT NULL,
              payload TEXT NOT NULL,
              output_file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
              error TEXT,
              progress REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_director_renders_project ON director_renders(user_id, project_id, created_at DESC);
        `);
        db.prepare("UPDATE projects SET kind='canvas' WHERE kind NOT IN ('canvas','director') OR kind IS NULL").run();
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(15, ?)").run(new Date().toISOString());
    })();
}

function applyVersionSixteen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=16").get()) return;
    const sourceColumns = db.prepare("PRAGMA table_info(director_sources)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!sourceColumns.some((column) => column.name === "summary")) db.exec("ALTER TABLE director_sources ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
        if (!sourceColumns.some((column) => column.name === "outline")) db.exec("ALTER TABLE director_sources ADD COLUMN outline TEXT NOT NULL DEFAULT ''");
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(16, ?)").run(new Date().toISOString());
    })();
}

function applyVersionSeventeen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=17").get()) return;
    type SegmentRow = { id: string; user_id: string; project_id: string; sequence_id: string; position: number; title: string; status: string; payload: string; revision: number; created_at: string; updated_at: string };
    const asRefs = (value: unknown) => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && "id" in item).map((item) => ({ id: String((item as { id: unknown }).id), revision: Math.max(1, Number((item as { revision?: unknown }).revision) || 1) })) : [];
    const normalize = (row: SegmentRow, payload: Record<string, unknown>, duration: number) => {
        const legacy = payload.references && typeof payload.references === "object" ? payload.references as Record<string, unknown> : {};
        const characterRefs = asRefs(payload.characterRefs).length ? asRefs(payload.characterRefs) : asRefs(legacy.characters);
        const sceneRefs = asRefs(payload.sceneRefs).length ? asRefs(payload.sceneRefs) : asRefs(legacy.scenes);
        const propRefs = asRefs(payload.propRefs).length ? asRefs(payload.propRefs) : asRefs(legacy.props);
        const frameCount = duration > 10 ? 6 : 4;
        const frames = Array.from({ length: frameCount }, (_, index) => ({
            id: `${row.id}-frame-${index + 1}`, position: index, shotNumber: 1,
            timeSeconds: Number(((duration * index) / Math.max(1, frameCount - 1)).toFixed(2)),
            kind: index === 0 ? "shot-start" : index === frameCount - 1 ? "shot-end" : "keyframe",
            description: String(payload.description || row.title), action: String(payload.action || ""),
            cameraAngle: String(payload.cameraAngle || ""), cameraMove: String(payload.cameraMove || ""), sound: String(payload.sound || payload.audio || ""),
        }));
        return { ...payload, entityKind: "video-segment", durationSeconds: duration, boundary: payload.boundary === "continue" ? "continue" : "cut", characterRefs, sceneRefs, propRefs, audioCues: Array.isArray(payload.audioCues) ? payload.audioCues : [], storyboardSheet: { revision: 1, layout: frameCount === 4 ? "2x2" : "3x2", frames }, h3ModeOverride: null, videoStale: false, needsReview: false };
    };
    db.transaction(() => {
        const splitSegments = new Map<string, string>();
        const rows = db.prepare("SELECT * FROM director_shots ORDER BY user_id,project_id,sequence_id,position,created_at").all() as SegmentRow[];
        for (const row of rows) {
            const payload = JSON.parse(row.payload || "{}") as Record<string, unknown>;
            const duration = Math.max(4, Math.round(Number(payload.duration) || Number(payload.durationSeconds) || 4));
            if (duration === 16 && row.title.includes("跪地求饶") && row.title.includes("夺回碎玉")) {
                const first = normalize(row, { ...payload, action: String(payload.action || "").split(/[，。；]/).slice(0, 2).join("，") || payload.action }, 8);
                const secondId = `${row.id}-part-2`;
                splitSegments.set(row.id, secondId);
                const second = normalize({ ...row, id: secondId }, { ...payload, action: "林尘夺回碎玉，废去对手修为", boundary: "continue", continuationFromSegmentId: row.id }, 8);
                db.prepare("UPDATE director_shots SET title=?,payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run("跪地求饶", JSON.stringify(first), new Date().toISOString(), row.id, row.user_id);
                db.prepare("UPDATE director_shots SET position=position+1 WHERE user_id=? AND project_id=? AND sequence_id=? AND position>?").run(row.user_id, row.project_id, row.sequence_id, row.position);
                db.prepare("INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,status,payload,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(secondId, row.user_id, row.project_id, row.sequence_id, row.position + 1, "夺回碎玉·废去修为", "draft", JSON.stringify(second), 1, row.created_at, new Date().toISOString());
            } else {
                db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(normalize(row, payload, Math.min(15, duration))), new Date().toISOString(), row.id, row.user_id);
            }
        }
        const timelines = db.prepare("SELECT project_id,user_id,payload FROM director_timelines").all() as Array<{ project_id: string; user_id: string; payload: string }>;
        for (const timeline of timelines) {
            const payload = JSON.parse(timeline.payload || "{}") as { shotOrder?: string[]; segmentOrder?: string[]; tracks?: Array<Record<string, unknown>> };
            const ordered = db.prepare("SELECT s.id,s.payload FROM director_shots s JOIN director_sequences q ON q.id=s.sequence_id AND q.user_id=s.user_id WHERE s.user_id=? AND s.project_id=? ORDER BY q.position,s.position,s.created_at").all(timeline.user_id, timeline.project_id) as Array<{ id: string; payload: string }>;
            const ids = ordered.map((item) => item.id);
            const segmentOrder = ids;
            const durationById = new Map(ordered.map((item) => [item.id, Number((JSON.parse(item.payload) as Record<string, unknown>).durationSeconds || 4)]));
            const startById = new Map<string, number>(); let cursor = 0;
            segmentOrder.forEach((segmentId) => { startById.set(segmentId, cursor); cursor += durationById.get(segmentId) || 4; });
            const tracks = (payload.tracks || []).filter((track) => track.type !== "video").map((track, trackIndex) => {
                if (Array.isArray(track.clips)) return track;
                const kind = String(track.type || "ambient");
                const items = Array.isArray(track.items) ? track.items as Array<Record<string, unknown>> : [];
                const clips = items.flatMap((item, itemIndex) => {
                    const segmentId = String(item.segmentId || item.shotId || "");
                    const base = { ...item, id: String(item.id || `${kind}-${itemIndex}`), segmentId: segmentId || undefined, shotId: undefined, start: segmentId ? startById.get(segmentId) ?? Number(item.start || 0) : Number(item.start || 0), duration: segmentId ? durationById.get(segmentId) || Number(item.duration || 4) : Number(item.duration || 4) };
                    const secondId = splitSegments.get(segmentId);
                    return secondId ? [{ ...base, duration: 8 }, { ...base, id: `${base.id}-part-2`, segmentId: secondId, start: startById.get(secondId), duration: 8 }] : [base];
                });
                return { id: String(track.id || kind || `track-${trackIndex}`), kind, name: track.name, clips };
            });
            db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=?").run(JSON.stringify({ segmentOrder, tracks }), new Date().toISOString(), timeline.user_id, timeline.project_id);
        }
        const hasProviderConcurrency = (db.prepare("PRAGMA table_info(ai_providers)").all() as Array<{ name: string }>).some((column) => column.name === "concurrency");
        const providers = db.prepare(hasProviderConcurrency ? "SELECT id,models,concurrency FROM ai_providers" : "SELECT id,models,2 concurrency FROM ai_providers").all() as Array<{ id: string; models: string; concurrency: number }>;
        for (const provider of providers) {
            const models = JSON.parse(provider.models || "[]") as Array<Record<string, unknown>>;
            let changed = false;
            const next = models.map((model) => {
                if (!/(?:gpt[-_ ]?image[-_ ]?2|sxh[-_ ]?image)/i.test(`${String(model.id || "")} ${String(model.name || "")}`)) return model;
                changed = true;
                return { ...model, imageModes: ["generate", "edit"], maxReferenceImages: 6, imagePromptProfile: "gpt-image-2" };
            });
            if (changed) hasProviderConcurrency ? db.prepare("UPDATE ai_providers SET models=?,concurrency=?,updated_at=? WHERE id=?").run(JSON.stringify(next), Math.max(10, provider.concurrency), new Date().toISOString(), provider.id) : db.prepare("UPDATE ai_providers SET models=? WHERE id=?").run(JSON.stringify(next), provider.id);
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(17, ?)").run(new Date().toISOString());
    })();
}

function applyVersionEighteen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=18").get()) return;
    db.transaction(() => {
        const timelines = db.prepare("SELECT project_id,user_id,payload FROM director_timelines").all() as Array<{ project_id: string; user_id: string; payload: string }>;
        for (const timeline of timelines) {
            const current = JSON.parse(timeline.payload || "{}") as { tracks?: Array<Record<string, unknown>> };
            const rows = db.prepare("SELECT s.id,s.payload FROM director_shots s JOIN director_sequences q ON q.id=s.sequence_id AND q.user_id=s.user_id WHERE s.user_id=? AND s.project_id=? ORDER BY q.position,s.position,s.created_at").all(timeline.user_id, timeline.project_id) as Array<{ id: string; payload: string }>;
            const segmentOrder = rows.map((row) => row.id); const durationById = new Map(rows.map((row) => [row.id, Number((JSON.parse(row.payload) as Record<string, unknown>).durationSeconds || 4)]));
            const startById = new Map<string, number>(); let cursor = 0;
            segmentOrder.forEach((segmentId) => { startById.set(segmentId, cursor); cursor += durationById.get(segmentId) || 4; });
            const tracks = (current.tracks || []).filter((track) => track.type !== "video").map((track, trackIndex) => {
                if (Array.isArray(track.clips)) return track;
                const kind = String(track.type || "ambient"); const items = Array.isArray(track.items) ? track.items as Array<Record<string, unknown>> : [];
                const clips = items.flatMap((item, itemIndex) => {
                    const segmentId = String(item.segmentId || item.shotId || ""); const secondId = segmentOrder.includes(`${segmentId}-part-2`) ? `${segmentId}-part-2` : "";
                    const clip = { ...item, id: String(item.id || `${kind}-${itemIndex}`), segmentId: segmentId || undefined, shotId: undefined, start: segmentId ? startById.get(segmentId) ?? Number(item.start || 0) : Number(item.start || 0), duration: segmentId ? durationById.get(segmentId) || Number(item.duration || 4) : Number(item.duration || 4) };
                    return secondId ? [{ ...clip, duration: 8 }, { ...clip, id: `${clip.id}-part-2`, segmentId: secondId, start: startById.get(secondId), duration: 8 }] : [clip];
                });
                return { id: String(track.id || kind || `track-${trackIndex}`), kind, name: track.name, clips };
            });
            db.prepare("UPDATE director_timelines SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=?").run(JSON.stringify({ segmentOrder, tracks }), new Date().toISOString(), timeline.user_id, timeline.project_id);
        }
        const hasProviderConcurrency = (db.prepare("PRAGMA table_info(ai_providers)").all() as Array<{ name: string }>).some((column) => column.name === "concurrency");
        const providers = db.prepare(hasProviderConcurrency ? "SELECT id,models,concurrency FROM ai_providers" : "SELECT id,models,2 concurrency FROM ai_providers").all() as Array<{ id: string; models: string; concurrency: number }>;
        for (const provider of providers) {
            const models = JSON.parse(provider.models || "[]") as Array<Record<string, unknown>>; let changed = false;
            const next = models.map((model) => { if (!/(?:gpt[-_ ]?image[-_ ]?2|sxh[-_ ]?image)/i.test(`${String(model.id || "")} ${String(model.name || "")}`)) return model; changed = true; return { ...model, imageModes: ["generate", "edit"], maxReferenceImages: 6, imagePromptProfile: "gpt-image-2" }; });
            if (changed) hasProviderConcurrency ? db.prepare("UPDATE ai_providers SET models=?,concurrency=?,updated_at=? WHERE id=?").run(JSON.stringify(next), Math.max(10, provider.concurrency), new Date().toISOString(), provider.id) : db.prepare("UPDATE ai_providers SET models=? WHERE id=?").run(JSON.stringify(next), provider.id);
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(18, ?)").run(new Date().toISOString());
    })();
}

function applyVersionNineteen() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=19").get()) return;
    db.transaction(() => {
        const rows = db.prepare("SELECT id,user_id,payload FROM director_shots").all() as Array<{ id: string; user_id: string; payload: string }>;
        for (const row of rows) {
            const payload = JSON.parse(row.payload || "{}") as Record<string, unknown>;
            const sheet = payload.storyboardSheet && typeof payload.storyboardSheet === "object" ? payload.storyboardSheet as { imageFileId?: string; generationId?: string; frames?: Array<Record<string, unknown>> } : undefined;
            if (!sheet || sheet.imageFileId || sheet.generationId || !Array.isArray(sheet.frames)) continue;
            sheet.frames = sheet.frames.map((frame) => ({ ...frame, shotNumber: 1 }));
            db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify({ ...payload, storyboardSheet: sheet }), new Date().toISOString(), row.id, row.user_id);
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(19, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwenty() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=20").get()) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE director_cast_reviews (
              project_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              status TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              asset_revisions TEXT NOT NULL DEFAULT '{}',
              characters TEXT NOT NULL DEFAULT '[]',
              pairs TEXT NOT NULL DEFAULT '[]',
              generation_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (project_id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX idx_director_cast_reviews_generation ON director_cast_reviews(user_id, generation_id);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(20, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwentyOne() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=21").get()) return;
    db.transaction(() => {
        const rows = db.prepare("SELECT id,user_id,payload FROM director_shots").all() as Array<{ id: string; user_id: string; payload: string }>;
        for (const row of rows) {
            const payload = JSON.parse(row.payload || "{}") as Record<string, unknown>;
            const rawSheet = payload.storyboardSheet;
            if (!rawSheet || typeof rawSheet !== "object") continue;
            const sheet = { ...(rawSheet as Record<string, unknown>) };
            const rawFrames = Array.isArray(sheet.frames) ? sheet.frames as Array<Record<string, unknown>> : [];
            const duration = Math.max(4, Math.min(15, Number(payload.durationSeconds || payload.duration || 4)));
            const frames = rawFrames.map((frame, index) => {
                const { guideEnabled: _guideEnabled, guideStrength: _guideStrength, croppedFileId: _croppedFileId, resolvedFrameIndex: _resolvedFrameIndex, shot: _shot, ...clean } = frame;
                const fallbackTime = rawFrames.length > 1 ? duration * index / (rawFrames.length - 1) : 0;
                return {
                    ...clean,
                    position: index,
                    shotNumber: Math.max(1, Math.min(3, Number(frame.shotNumber ?? frame.shot ?? 1))),
                    timeSeconds: index === 0 ? 0 : index === rawFrames.length - 1 ? duration : Math.max(0, Math.min(duration, Number(frame.timeSeconds ?? fallbackTime))),
                    h3Visual: String(frame.h3Visual || ""),
                    dialogue: String(frame.dialogue || ""),
                };
            });
            const { firstFrameFileId: _firstFrameFileId, lastFrameFileId: _lastFrameFileId, ...cleanSheet } = sheet;
            const { firstFrameFileId: _payloadFirstFrameFileId, lastFrameFileId: _payloadLastFrameFileId, references: _references, ...cleanPayload } = payload;
            const nextPayload: Record<string, unknown> = {
                ...cleanPayload,
                storyboardSheet: { ...cleanSheet, frames },
                h3ModeOverride: undefined,
                h3PromptSnapshot: undefined,
                h3PromptStale: true,
                needsReview: true,
            };
            if (payload.videoFileId) nextPayload.videoStale = true;
            delete nextPayload.h3ModeOverride;
            delete nextPayload.h3PromptSnapshot;
            db.prepare("UPDATE director_shots SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?")
                .run(JSON.stringify(nextPayload), new Date().toISOString(), row.id, row.user_id);
        }
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(21, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwentyTwo() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=22").get()) return;
    const columns = db.prepare("PRAGMA table_info(agent_settings)").all() as Array<{ name: string }>;
    db.transaction(() => {
        if (!columns.some((column) => column.name === "media_model_ref")) db.exec("ALTER TABLE agent_settings ADD COLUMN media_model_ref TEXT NOT NULL DEFAULT ''");
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(22, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwentyThree() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=23").get()) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE director_screenplay_breakdowns (
              project_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              script_revision INTEGER NOT NULL DEFAULT 0,
              payload TEXT NOT NULL DEFAULT '{"scenes":[],"estimatedDurationSeconds":0}',
              revision INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (project_id, user_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
        `);
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO director_screenplay_breakdowns(project_id,user_id,created_at,updated_at)
            SELECT id,user_id,?,? FROM projects WHERE kind='director'`).run(now, now);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(23, ?)").run(now);
    })();
}

function applyVersionTwentyFour() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=24").get()) return;
    db.transaction(() => {
        db.exec(`ALTER TABLE director_workspaces ADD COLUMN directing_rules TEXT NOT NULL DEFAULT '{"photography":"","performance":"","pacing":"","sound":"","prohibitions":""}'`);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(24, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwentyFive() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=25").get()) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS director_file_index (
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              path TEXT NOT NULL,
              entity_id TEXT,
              kind TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              bytes INTEGER NOT NULL DEFAULT 0,
              media_type TEXT,
              metadata TEXT NOT NULL DEFAULT '{}',
              diagnostics TEXT NOT NULL DEFAULT '[]',
              updated_at TEXT NOT NULL,
              PRIMARY KEY (user_id, project_id, path),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_director_file_entity ON director_file_index(user_id, project_id, entity_id);
            CREATE TABLE IF NOT EXISTS director_project_storage (
              user_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              format_version INTEGER NOT NULL DEFAULT 1,
              root_hash TEXT NOT NULL DEFAULT '',
              migrated_at TEXT NOT NULL,
              indexed_at TEXT NOT NULL,
              PRIMARY KEY (user_id, project_id),
              FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
            );
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(25, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwentySix() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=26").get()) return;
    createAgentStorageMigrationBackup(3, 2, "agent-codex-v1");
    db.transaction(() => {
        db.exec(`
            ALTER TABLE agent_sessions ADD COLUMN engine TEXT NOT NULL DEFAULT 'builtin' CHECK(engine IN ('builtin','codex'));
            ALTER TABLE agent_sessions ADD COLUMN codex_thread_id TEXT;
            ALTER TABLE agent_runs ADD COLUMN codex_turn_id TEXT;
            CREATE TABLE codex_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
            CREATE TABLE agent_tool_requests (
                session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
                request_key TEXT NOT NULL, tool_name TEXT NOT NULL, input_hash TEXT NOT NULL,
                status TEXT NOT NULL, result TEXT,
                PRIMARY KEY(session_id, run_id, request_key)
            );
            UPDATE agent_metadata SET protocol_version=4 WHERE id=1;
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(26, ?)").run(new Date().toISOString());
    })();
}

function applyVersionTwentySeven() {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=27").get()) return;
    createAgentStorageMigrationBackup(4, 2, "agent-codex-model-options-v1");
    db.transaction(() => {
        db.exec(`
            ALTER TABLE agent_sessions ADD COLUMN codex_options TEXT NOT NULL DEFAULT '{}';
            ALTER TABLE agent_queued_messages ADD COLUMN codex_options TEXT;
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(27, ?)").run(new Date().toISOString());
    })();
}

function ensureAgentMetadata(protocolVersion = 2, storageVersion = 2) {
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO agent_metadata(id, protocol_version, storage_version, updated_at) VALUES(1, ?, ?, ?)").run(protocolVersion, storageVersion, now);
    const row = db.prepare("SELECT protocol_version, storage_version FROM agent_metadata WHERE id=1").get() as { protocol_version: number; storage_version: number };
    if (row.protocol_version !== protocolVersion || row.storage_version !== storageVersion) throw new Error(`不支持的 Agent 数据版本：protocol=${row.protocol_version}, storage=${row.storage_version}`);
}

function prepareAgentMetadata() {
    const columns = db.prepare("PRAGMA table_info(agent_sessions)").all() as Array<{ name: string }>;
    const legacy = columns.some((column) => column.name === "owner_type");
    db.prepare("INSERT OR IGNORE INTO agent_metadata(id, protocol_version, storage_version, updated_at) VALUES(1, ?, ?, ?)").run(legacy ? 1 : 2, legacy ? 1 : 2, new Date().toISOString());
    const row = db.prepare("SELECT protocol_version, storage_version FROM agent_metadata WHERE id=1").get() as { protocol_version: number; storage_version: number };
    if (![[1, 1], [2, 2], [3, 2], [4, 2]].some(([protocol, storage]) => row.protocol_version === protocol && row.storage_version === storage)) throw new Error(`不支持的 Agent 数据版本：protocol=${row.protocol_version}, storage=${row.storage_version}`);
    if (legacy !== (row.storage_version === 1)) throw new Error("Agent 表结构与存储版本冲突，拒绝自动覆盖");
}

type MigrationManifest = { format: "infinite-canvas-agent-migration"; version: 1; sourceProtocol: number; sourceStorage: number; sourceDatabaseSha256: string; files: Array<{ path: string; bytes: number; sha256: string }> };

function createAgentStorageMigrationBackup(sourceProtocol = 1, sourceStorage = 1, name = "agent-storage-v1-to-v2") {
    const root = resolve(config.dataDir, "migration-backups", name);
    const manifestPath = resolve(root, "manifest.json");
    db.pragma("wal_checkpoint(TRUNCATE)");
    if (existsSync(root)) {
        if (!existsSync(manifestPath)) throw new Error("Agent 存储迁移备份目录已存在但缺少清单，拒绝覆盖");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MigrationManifest;
        if (manifest.format !== "infinite-canvas-agent-migration" || manifest.version !== 1 || manifest.sourceProtocol !== sourceProtocol || manifest.sourceStorage !== sourceStorage) throw new Error("Agent 存储迁移备份清单版本未知，拒绝覆盖");
        validateMigrationFiles(root, manifest.files);
        if (manifest.sourceDatabaseSha256 !== sha256(config.databasePath)) throw new Error("Agent 存储迁移备份与当前数据库冲突，拒绝覆盖");
        return;
    }
    const building = `${root}.building`;
    rmSync(building, { recursive: true, force: true });
    mkdirSync(building, { recursive: true });
    copyFileSync(config.databasePath, resolve(building, "app.db"));
    copyTree(config.agentRoot, resolve(building, "agent"));
    const files = walkFiles(building).map((path) => fileManifest(building, path));
    writeFileSync(resolve(building, "manifest.json"), JSON.stringify({ format: "infinite-canvas-agent-migration", version: 1, sourceProtocol, sourceStorage, sourceDatabaseSha256: sha256(resolve(building, "app.db")), files } satisfies MigrationManifest, null, 2));
    renameSync(building, root);
}

function validateMigrationFiles(root: string, files: MigrationManifest["files"]) {
    if (!Array.isArray(files) || !files.length) throw new Error("Agent 存储迁移备份清单为空，拒绝继续");
    const paths = new Set<string>();
    for (const file of files) {
        if (!file.path || file.path.startsWith("/") || file.path.includes("\\") || paths.has(file.path)) throw new Error("Agent 存储迁移备份清单包含冲突路径");
        paths.add(file.path);
        const target = resolve(root, file.path);
        if (!target.startsWith(`${root}${sep}`) || !existsSync(target) || statSync(target).size !== file.bytes || sha256(target) !== file.sha256) throw new Error(`Agent 存储迁移备份校验失败：${file.path}`);
    }
    if (!paths.has("app.db")) throw new Error("Agent 存储迁移备份缺少数据库");
    const actual = new Set(walkFiles(root).filter((path) => path !== resolve(root, "manifest.json")).map((path) => relative(root, path).split(sep).join("/")));
    if (actual.size !== paths.size || Array.from(actual).some((path) => !paths.has(path))) throw new Error("Agent 存储迁移备份文件与清单不一致");
}

function cleanupLegacyAgentWorkspaces() {
    const usersRoot = resolve(config.agentRoot, "users");
    if (!existsSync(usersRoot)) return;
    for (const entry of readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        rmSync(resolve(usersRoot, entry.name, "sessions"), { recursive: true, force: true });
    }
}

function copyTree(source: string, target: string) {
    if (!existsSync(source)) return;
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const from = resolve(source, entry.name);
        const to = resolve(target, entry.name);
        if (entry.isDirectory()) copyTree(from, to);
        else if (entry.isFile()) copyFileSync(from, to);
    }
}

function walkFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(root, entry.name);
        return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
    });
}

function fileManifest(root: string, path: string) {
    return { path: relative(root, path).split(sep).join("/"), bytes: statSync(path).size, sha256: sha256(path) };
}

function sha256(path: string) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function upsertUser(user: { id: string; username: string; isAdmin: boolean }) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users(id, username, is_admin, created_at, updated_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET username=excluded.username, is_admin=excluded.is_admin, updated_at=excluded.updated_at`).run(user.id, user.username, Number(user.isAdmin), now, now);
}

export function parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string") return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}
