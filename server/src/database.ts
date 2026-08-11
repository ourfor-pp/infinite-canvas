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
`);

db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
applyVersionTwo();
applyVersionThree();

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
