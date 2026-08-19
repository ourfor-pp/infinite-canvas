import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "infinite-canvas-media-understanding-"));
process.env.DATA_DIR = root;
process.env.APP_SECRET = "media-understanding-test";

const [{ db }, { storeLocalFile, getStoredFile }, { prepareProjectVideoOverview, sampleProjectVideoFrames }] = await Promise.all([
    import("../database.js"), import("../file-store.js"), import("./media-understanding.js"),
]);

db.prepare("INSERT INTO users(id,username,is_admin,created_at,updated_at) VALUES('media-user','media-user',1,datetime('now'),datetime('now'))").run();
db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,revision,created_at,updated_at) VALUES('media-project','media-user','director','媒体项目','{}',1,datetime('now'),datetime('now'))").run();

after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

test("视频概览生成单张联系表并支持均匀与指定时间抽帧", async () => {
    const source = join(root, "source.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-t", "2", "-pix_fmt", "yuv420p", source]);
    const video = storeLocalFile("media-user", source, "source.mp4", "video/mp4");
    db.prepare("INSERT INTO file_refs(file_id,user_id,owner_type,owner_id) VALUES(?,'media-user','agent_project','media-project')").run(video.fileId);
    const overview = await prepareProjectVideoOverview("media-user", "media-project", { fileId: video.fileId, frameCount: 4 });
    assert.equal(overview.layout, "2x2");
    assert.equal(overview.frameCount, 4);
    assert.equal(getStoredFile("media-user", overview.contactSheet.fileId)?.mime_type, "image/jpeg");
    const sampled = await sampleProjectVideoFrames("media-user", "media-project", { fileId: video.fileId, timesSeconds: [0.25, 1.25] });
    assert.deepEqual(sampled.frames.map((item) => item.timeSeconds), [0.25, 1.25]);
    assert.equal(sampled.frames.every((item) => getStoredFile("media-user", item.file.fileId)?.mime_type === "image/jpeg"), true);
});
