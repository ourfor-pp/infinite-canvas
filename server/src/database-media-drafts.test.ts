import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import BetterSqlite3 from "better-sqlite3";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-media-drafts-"));
const databasePath = join(testData, "app.db");
const legacy = new BetterSqlite3(databasePath);
legacy.exec(`
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE creative_assets(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE ai_providers(id TEXT PRIMARY KEY, models TEXT NOT NULL);
CREATE TABLE agent_metadata(id INTEGER PRIMARY KEY, protocol_version INTEGER NOT NULL, storage_version INTEGER NOT NULL, updated_at TEXT NOT NULL);
`);
const now = new Date().toISOString();
for (let version = 1; version <= 11; version += 1) legacy.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(version, now);
legacy.prepare("INSERT INTO agent_metadata VALUES(1,3,2,?)").run(now);
legacy.prepare("INSERT INTO creative_assets VALUES(?,?,?,?,?,?,?,?,?,?)").run("asset-1", "user-1", "project-1", "character", "林夏", "draft", JSON.stringify({
    description: "短发调查记者",
    variants: [],
    primaryImageId: null,
    primaryAudioId: null,
    voiceDescription: "冷静、低声线",
    voiceSampleText: "我会查清楚。",
    imageModel: "provider::image",
    audioModel: "provider::speech",
}), 1, now, now);
legacy.close();

process.env.DATA_DIR = testData;
process.env.APP_SECRET = "database-media-drafts-test";
const { db } = await import("./database.js");

after(() => { db.close(); rmSync(testData, { recursive: true, force: true }); });

test("v12/v13 将旧媒体字段归并为 mediaDrafts 并清理重复的系统图片草稿", () => {
    const row = db.prepare("SELECT payload FROM creative_assets WHERE id='asset-1'").get() as { payload: string };
    const payload = JSON.parse(row.payload);
    assert.equal(payload.voiceDescription, undefined);
    assert.equal(payload.voiceSampleText, undefined);
    assert.equal(payload.imageModel, undefined);
    assert.equal(payload.audioModel, undefined);
    assert.equal(payload.mediaDrafts.image.model, "provider::image");
    assert.equal(payload.mediaDrafts.image.prompt, "");
    assert.equal(payload.mediaDrafts.audio.prompt, "冷静、低声线");
    assert.equal(payload.mediaDrafts.audio.transcript, "我会查清楚。");
    assert.equal(payload.mediaDrafts.audio.audioMode, "speech");
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE version=13").get());
});
