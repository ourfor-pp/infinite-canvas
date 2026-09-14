import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import matter from "gray-matter";
import { stringify, parse } from "yaml";
const temp = mkdtempSync(join(tmpdir(), "director-v2-test-"));
process.env.DATA_DIR = join(temp, "data");
const { convertDirectorV1 } = await import("./director-v2.js");
const { db } = await import("./database.js");
after(() => { db.close(); rmSync(temp, { recursive: true, force: true }); });
function fixture(name: string) {
    const root = join(temp, name);
    const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
    write("project.yaml", stringify({ version: 1, format: "infinite-canvas-director", id: name, name }));
    write("storyboards/scene/sequence.md", matter.stringify("场景", { id: "scene", kind: "sequence", name: "场景", order: 1 }));
    write("storyboards/scene/segment/segment.md", matter.stringify("完整创作说明", { id: "task", kind: "video-segment", name: "任务", sequenceId: "scene", order: 1, durationSeconds: 8 }));
    write("storyboards/scene/segment/storyboard.yaml", stringify({ version: 1, segmentId: "task", layout: "2x2", frames: [{ id: "a", shotNumber: 1, timeSeconds: 0, description: "主镜头" }, { id: "b", shotNumber: 1, timeSeconds: 3, description: "动作推进" }, { id: "c", shotNumber: 2, timeSeconds: 4, description: "反应镜头" }, { id: "d", shotNumber: 2, timeSeconds: 8, description: "落点" }] }));
    write("storyboards/scene/segment/storyboard.png", "image bytes");
    write("videos/seg-task/video-prompt.md", "Use storyboards/scene/segment/storyboard.png exactly.");
    write("videos/seg-task/preview.mp4", "unchanged media bytes");
    write("timeline/timeline.json", JSON.stringify({ segmentOrder: ["task"], tracks: [{ id: "sound", kind: "model-original", clips: [{ id: "voice", segmentId: "task", path: "videos/seg-task/preview.mp4", start: 0, duration: 7.5 }] }] }));
    return root;
}
test("v1 拆出镜头设计，保留任务 ID、媒体字节、提示和声音引用", () => {
    const root = fixture("conversion"); convertDirectorV1(root, { task: 7.5 });
    assert.equal(parse(readFileSync(join(root, "project.yaml"), "utf8")).version, 2);
    const task = matter(readFileSync(join(root, "productions/task/task.md"), "utf8"));
    assert.equal(task.data.id, "task"); assert.equal(task.data.kind, "production-task"); assert.deepEqual(task.data.shotIds, ["task-shot-1", "task-shot-2"]);
    assert.equal(readFileSync(join(root, "productions/task/preview.mp4"), "utf8"), "unchanged media bytes");
    assert.equal(readFileSync(join(root, "productions/task/video-prompt.md"), "utf8"), "Use productions/task/storyboard.png exactly.");
    const timeline = JSON.parse(readFileSync(join(root, "timeline/timeline.json"), "utf8"));
    assert.deepEqual(timeline.videoClips, [{ id: "clip-1", taskId: "task", trimIn: 0, trimOut: 7.5, linkedAudio: false }]);
    assert.equal(timeline.tracks[0].clips[0].path, "productions/task/preview.mp4");
    assert.ok(existsSync(join(root, "storyboards/scene/shot-task-shot-2/shot.md"))); assert.equal(convertDirectorV1(root).size, 0);
});

test("升级先备份数据库，保留媒体 ID，并在数据库切换失败时回退目录", async () => {
    const { upgradeDirectorV2 } = await import("./director-v2.js");
    const { relative } = await import("node:path");
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO users(id,username,is_admin,created_at,updated_at) VALUES('upgrade-user','升级测试',1,?,?)").run(now, now);
    const register = (root: string, id: string) => db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,'upgrade-user',?,'preview.mp4','video/mp4',21,'{}',?)").run(id, relative(join(temp, "data"), join(root, "videos/seg-task/preview.mp4")), now);
    const success = fixture("upgrade-success"); register(success, "keep-id");
    upgradeDirectorV2("upgrade-user", "success", success, () => []);
    assert.ok(existsSync(`${success}.v1-backup.sqlite`)); assert.ok(existsSync(join(`${success}.v1-backup`, "project.yaml")));
    const path = (db.prepare("SELECT path FROM stored_files WHERE id='keep-id'").get() as { path: string }).path;
    assert.ok(path.endsWith("productions/task/preview.mp4"));
    assert.doesNotThrow(() => upgradeDirectorV2("upgrade-user", "success", success, () => []));
    const failure = fixture("upgrade-failure"); register(failure, "fail-id");
    db.exec("CREATE TRIGGER fail_upgrade BEFORE UPDATE ON stored_files WHEN OLD.id='fail-id' BEGIN SELECT RAISE(ABORT,'injected update failure'); END");
    assert.throws(() => upgradeDirectorV2("upgrade-user", "failure", failure, () => []), /injected update failure/);
    db.exec("DROP TRIGGER fail_upgrade");
    assert.equal(parse(readFileSync(join(failure, "project.yaml"), "utf8")).version, 1);
    assert.equal(readFileSync(join(failure, "videos/seg-task/preview.mp4"), "utf8"), "unchanged media bytes");
    assert.ok((db.prepare("SELECT path FROM stored_files WHERE id='fail-id'").get() as { path: string }).path.endsWith("videos/seg-task/preview.mp4"));
    assert.throws(() => upgradeDirectorV2("upgrade-user", "failure", failure, () => []), /拒绝覆盖/);
});

test("运行中的导出阻止升级且不创建半成品备份", async () => {
    const { upgradeDirectorV2 } = await import("./director-v2.js");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,revision,created_at,updated_at) VALUES('busy','upgrade-user','director','忙碌','{}',1,?,?)").run(now, now);
    db.prepare("INSERT INTO director_renders(id,user_id,project_id,status,payload,created_at,updated_at) VALUES('busy-render','upgrade-user','busy','running','{}',?,?)").run(now, now);
    const root = fixture("busy");
    assert.throws(() => upgradeDirectorV2("upgrade-user", "busy", root, () => []), /运行任务/);
    assert.equal(existsSync(`${root}.v1-backup.sqlite`), false);
});
