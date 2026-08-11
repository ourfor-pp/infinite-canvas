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
prepareAgentMetadata();
applyVersionSeven();
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
    if (![[1, 1], [2, 2]].some(([protocol, storage]) => row.protocol_version === protocol && row.storage_version === storage)) throw new Error(`不支持的 Agent 数据版本：protocol=${row.protocol_version}, storage=${row.storage_version}`);
    if (legacy !== (row.storage_version === 1)) throw new Error("Agent 表结构与存储版本冲突，拒绝自动覆盖");
}

type MigrationManifest = { format: "infinite-canvas-agent-migration"; version: 1; sourceProtocol: 1; sourceStorage: 1; sourceDatabaseSha256: string; files: Array<{ path: string; bytes: number; sha256: string }> };

function createAgentStorageMigrationBackup() {
    const root = resolve(config.dataDir, "migration-backups", "agent-storage-v1-to-v2");
    const manifestPath = resolve(root, "manifest.json");
    db.pragma("wal_checkpoint(TRUNCATE)");
    if (existsSync(root)) {
        if (!existsSync(manifestPath)) throw new Error("Agent 存储迁移备份目录已存在但缺少清单，拒绝覆盖");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MigrationManifest;
        if (manifest.format !== "infinite-canvas-agent-migration" || manifest.version !== 1 || manifest.sourceProtocol !== 1 || manifest.sourceStorage !== 1) throw new Error("Agent 存储迁移备份清单版本未知，拒绝覆盖");
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
    writeFileSync(resolve(building, "manifest.json"), JSON.stringify({ format: "infinite-canvas-agent-migration", version: 1, sourceProtocol: 1, sourceStorage: 1, sourceDatabaseSha256: sha256(resolve(building, "app.db")), files } satisfies MigrationManifest, null, 2));
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
