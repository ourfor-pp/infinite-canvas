import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
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
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sdk_session_id TEXT,
  fork_pending INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  event_seq INTEGER NOT NULL DEFAULT 0,
  current_run_id TEXT,
  pending_decision TEXT,
  last_error TEXT,
  last_error_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner ON agent_sessions(user_id, owner_type, owner_id, is_active, updated_at DESC);
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
CREATE TABLE IF NOT EXISTS agent_permission_rules (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tool_name)
);
CREATE TABLE IF NOT EXISTS agent_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  protocol_version INTEGER NOT NULL,
  storage_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`);

db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
applyVersionTwo();
applyVersionThree();
applyVersionFour();
applyVersionFive();
applyVersionSix();
ensureAgentMetadata();

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

function ensureAgentMetadata() {
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO agent_metadata(id, protocol_version, storage_version, updated_at) VALUES(1, 1, 1, ?)").run(now);
    const row = db.prepare("SELECT protocol_version, storage_version FROM agent_metadata WHERE id=1").get() as { protocol_version: number; storage_version: number };
    if (row.protocol_version !== 1 || row.storage_version !== 1) throw new Error(`不支持的 Agent 数据版本：protocol=${row.protocol_version}, storage=${row.storage_version}`);
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
