import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-assets-"));
process.env.DATA_DIR = testData;
process.env.APP_SECRET = "creative-assets-test";

const [{ db }, { createCreativeAsset, deleteCanvasNodes, getCreativeAsset, placeCreativeAsset, reviewCreativeAssetVariant, setCreativeAssetPrimary, syncCreativeAssetGeneration }, { previewCreativeAssetGeneration }] = await Promise.all([
    import("./database.js"),
    import("./creative-assets.js"),
    import("./creative-asset-generation.js"),
]);

after(() => { db.close(); rmSync(testData, { recursive: true, force: true }); });

test("删除业务节点同步删除资产实体、全部视图和连接", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,is_admin,created_at,updated_at) VALUES(?,?,1,?,?)").run(userId, "测试用户", now, now);
    const payload = { id: projectId, title: "测试画布", nodes: [{ id: "text-1", type: "text", metadata: {} }], connections: [], createdAt: now, updatedAt: now };
    db.prepare("INSERT INTO projects(id,user_id,title,payload,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(projectId, userId, payload.title, JSON.stringify(payload), now, now);
    const asset = createCreativeAsset(userId, projectId, { kind: "character", name: "临时角色", payload: { description: "测试" } });
    const first = placeCreativeAsset(userId, asset.id, { x: 100, y: 100 });
    const second = placeCreativeAsset(userId, asset.id, { x: 600, y: 100 });
    const row = db.prepare("SELECT payload,revision FROM projects WHERE id=?").get(projectId) as { payload: string; revision: number };
    const project = JSON.parse(row.payload) as { connections: unknown[] };
    project.connections.push({ id: "link-1", fromNodeId: "text-1", fromPortId: "output", toNodeId: first.nodeId, toPortId: "setting" });
    db.prepare("UPDATE projects SET payload=? WHERE id=?").run(JSON.stringify(project), projectId);

    const saved = deleteCanvasNodes(userId, projectId, [first.nodeId], row.revision);

    assert.equal(saved.nodes.some((node: { id: string }) => node.id === first.nodeId || node.id === second.nodeId), false);
    assert.equal(saved.connections.length, 0);
    assert.throws(() => getCreativeAsset(userId, asset.id), /不存在/);
});

test("媒体草稿预览按业务语义组装且生成结果只追加候选", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const now = new Date().toISOString();
    db.prepare("INSERT INTO ai_providers(id,name,type,base_url,encrypted_credentials,enabled,models,concurrency,created_at,updated_at) VALUES(?,?,?,?,?,1,?,2,?,?)")
        .run("provider-1", "测试渠道", "openai-compatible", "http://127.0.0.1:9/v1", "{}", JSON.stringify([
            { id: "image-model", name: "图片模型", endpoint: "openai-images-generations", output: "image", inputs: ["text"], imageModes: ["generate"], enabled: true },
            { id: "image-reference-model", name: "参考图模型", endpoint: "openai-images-generations", output: "image", inputs: ["text", "image"], imageModes: ["generate"], imageReferenceRoles: ["subject"], maxReferenceImages: 1, enabled: true },
            { id: "sound-model", name: "声音模型", endpoint: "openai-tts", output: "audio", inputs: ["text"], audioModes: ["speech", "ambient"], enabled: true },
        ]), now, now);
    db.prepare("INSERT INTO ai_model_defaults(kind,model_ref,updated_at) VALUES('image','provider-1::image-model',?),('audio','provider-1::sound-model',?)").run(now, now);
    const asset = createCreativeAsset(userId, projectId, { kind: "scene", name: "雨夜街口", payload: { description: "潮湿街道与霓虹倒影", mediaDrafts: { image: { model: "provider-1::image-model" }, audio: { model: "provider-1::sound-model", prompt: "远处车流，近处雨滴落在铁棚上" } } } });
    assert.equal(asset.payload.mediaDrafts.image.prompt, "");
    const imagePreview = previewCreativeAssetGeneration(userId, asset.id, { kind: "image", revision: asset.revision });
    assert.match(imagePreview.prompt, /雨夜街口/);
    assert.match(imagePreview.prompt, /场景设定图/);
    const audioPreview = previewCreativeAssetGeneration(userId, asset.id, { kind: "audio", revision: asset.revision });
    assert.equal(audioPreview.audioMode, "ambient");
    assert.match(audioPreview.prompt, /远处车流/);
    assert.equal(audioPreview.warnings.some((warning) => warning.blocking), false);

    db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("generated-image", userId, join(testData, "generated-image.png"), "generated-image.png", "image/png", 0, "{}", now);
    syncCreativeAssetGeneration({ id: "generation-1", user_id: userId, status: "succeeded", request: JSON.stringify({ kind: "image", prompt: imagePreview.prompt, params: { __creativeAsset: { assetId: asset.id, usage: "design_sheet", label: "场景设计图" } } }), result: JSON.stringify({ files: [{ fileId: "generated-image" }] }) });
    const saved = getCreativeAsset(userId, asset.id);
    assert.equal(saved.payload.variants.length, 1);
    assert.equal(saved.payload.primaryImageId, null);
    assert.equal(saved.payload.variants[0].prompt, imagePreview.prompt);
    assert.equal(saved.payload.variants[0].review?.status, "pending_review");
    assert.throws(() => setCreativeAssetPrimary(userId, asset.id, saved.payload.variants[0].id, saved.revision, true), /通过审核/);
    const reviewed = reviewCreativeAssetVariant(userId, asset.id, saved.payload.variants[0].id, { revision: saved.revision, accepted: true, setPrimary: true });
    assert.equal(reviewed.payload.variants[0].review?.status, "approved");
    assert.equal(reviewed.payload.primaryImageId, reviewed.payload.variants[0].id);

    for (const fileId of ["reference-one", "reference-two"]) db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(fileId, userId, join(testData, `${fileId}.png`), `${fileId}.png`, "image/png", 0, "{}", now);
    const referenced = createCreativeAsset(userId, projectId, { kind: "prop", name: "旧怀表", payload: { description: "黄铜怀表", variants: ["reference-one", "reference-two"].map((fileId) => ({ id: `${fileId}-variant`, kind: "image", fileId, label: "主体参考", prompt: "", usage: "reference_input", createdAt: now })), mediaDrafts: { image: { model: "provider-1::image-reference-model" } } } });
    const limitedPreview = previewCreativeAssetGeneration(userId, referenced.id, { kind: "image", revision: referenced.revision });
    assert.equal(limitedPreview.references.length, 1);
    assert.equal(limitedPreview.warnings.some((warning) => warning.code === "AI_MODEL_REFERENCE_LIMIT" && !warning.blocking), true);

    const character = createCreativeAsset(userId, projectId, { kind: "character", name: "林夏", payload: { description: "二十多岁的短发女性", designProfile: { apparentGender: "female", voiceGender: "female", ageBand: "20-30", identityAnchor: "短发女性，深色风衣", uncertainties: [] }, mediaDrafts: { image: { model: "provider-1::image-model", prompt: "重点锁定短发轮廓、深色风衣配色和四个视图的面部一致性" }, audio: { model: "provider-1::sound-model", prompt: "低沉男声，语速缓慢", transcript: "你好" } } } });
    assert.equal(character.payload.mediaDrafts.image.prompt, "重点锁定短发轮廓、深色风衣配色和四个视图的面部一致性");
    assert.match(previewCreativeAssetGeneration(userId, character.id, { kind: "image", revision: character.revision }).prompt, /重点锁定短发轮廓/);
    const voicePreview = previewCreativeAssetGeneration(userId, character.id, { kind: "audio", revision: character.revision });
    assert.equal(voicePreview.warnings.some((warning) => warning.code === "CREATIVE_ASSET_VOICE_GENDER_CONFLICT" && warning.blocking), true);
});
