import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-cast-review-"));
process.env.DATA_DIR = testData;
process.env.APP_SECRET = "cast-review-test";

const [{ db }, { createCreativeAsset, updateCreativeAsset }, { getDirectorCastReview, startDirectorCastReview }] = await Promise.all([
    import("./database.js"),
    import("./creative-assets.js"),
    import("./director-cast-review.js"),
]);

after(() => { db.close(); rmSync(testData, { recursive: true, force: true }); });

test("导演阵容检查在未配置视觉模型时保留人工结果并随角色 revision 过期", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,is_admin,created_at,updated_at) VALUES('cast-user','cast-user',1,?,?)").run(now, now);
    db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,revision,created_at,updated_at) VALUES('cast-project','cast-user','director','选角测试','{}',1,?,?)").run(now, now);
    db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES('cast-image','cast-user',?,'cast.png','image/png',0,'{}',?)").run(join(testData, "cast.png"), now);
    const asset = createCreativeAsset("cast-user", "cast-project", { kind: "character", name: "医生", payload: { visualDescription: "四十岁女性，方脸，短卷发", variants: [{ id: "cast-primary", kind: "image", fileId: "cast-image", label: "角色设计图", prompt: "", usage: "design_sheet", createdAt: now }], primaryImageId: "cast-primary" } });

    const review = startDirectorCastReview("cast-user", "cast-project");
    assert.equal(review.status, "manual");
    assert.equal(review.stale, false);
    assert.deepEqual(review.assetRevisions, { [asset.id]: asset.revision });
    assert.throws(() => getDirectorCastReview("other-user", "cast-project"), /不存在|无权/);

    updateCreativeAsset("cast-user", asset.id, { revision: asset.revision, payload: { visualDescription: "四十岁女性，宽方脸，短卷发，右眉上方浅痣" } });
    assert.equal(getDirectorCastReview("cast-user", "cast-project")?.stale, true);
});
