import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-assets-"));
process.env.DATA_DIR = testData;
process.env.APP_SECRET = "creative-assets-test";

const [{ db }, { createCreativeAsset, deleteCanvasNodes, getCreativeAsset, placeCreativeAsset, syncCreativeAssetGeneration }, { previewCreativeAssetGeneration }, { createVisualStyle, setDefaultVisualStyle }] = await Promise.all([
    import("./database.js"),
    import("./creative-assets.js"),
    import("./creative-asset-generation.js"),
    import("./visual-styles.js"),
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

test("媒体草稿预览按业务语义组装且生成结果直接替换主版本", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const now = new Date().toISOString();
    db.prepare("INSERT INTO ai_providers(id,name,type,base_url,encrypted_credentials,enabled,models,concurrency,created_at,updated_at) VALUES(?,?,?,?,?,1,?,2,?,?)")
        .run("provider-1", "测试渠道", "openai-compatible", "http://127.0.0.1:9/v1", "{}", JSON.stringify([
            { id: "image-model", name: "图片模型", endpoint: "openai-images-generations", output: "image", inputs: ["text"], imageModes: ["generate"], imagePromptProfile: "gpt-image-2", enabled: true },
            { id: "gpt-image-2-by-name", name: "gpt-image-2", endpoint: "openai-images-generations", output: "image", inputs: ["text"], imageModes: ["generate"], enabled: true },
            { id: "image-reference-model", name: "参考图模型", endpoint: "openai-images-generations", output: "image", inputs: ["text", "image"], imageModes: ["generate", "edit"], maxReferenceImages: 1, enabled: true },
            { id: "sound-model", name: "声音模型", endpoint: "openai-tts", output: "audio", inputs: ["text"], audioModes: ["speech", "ambient"], enabled: true },
        ]), now, now);
    db.prepare("INSERT INTO ai_model_defaults(kind,model_ref,updated_at) VALUES('image','provider-1::image-model',?),('audio','provider-1::sound-model',?)").run(now, now);
    const asset = createCreativeAsset(userId, projectId, { kind: "scene", name: "雨夜街口", payload: { description: "潮湿街道与霓虹倒影", mediaDrafts: { image: { model: "provider-1::image-model" }, audio: { model: "provider-1::sound-model", prompt: "远处车流，近处雨滴落在铁棚上" } } } });
    assert.equal(asset.payload.mediaDrafts.image.prompt, "");
    const imagePreview = previewCreativeAssetGeneration(userId, asset.id, { kind: "image", revision: asset.revision });
    assert.equal(imagePreview.params.imagePromptProfile, "gpt-image-2");
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
    assert.equal(saved.payload.primaryImageId, saved.payload.variants[0].id);
    assert.equal(saved.payload.variants[0].prompt, imagePreview.prompt);
    db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("generated-image-2", userId, join(testData, "generated-image-2.png"), "generated-image-2.png", "image/png", 0, "{}", now);
    syncCreativeAssetGeneration({ id: "generation-2", user_id: userId, status: "succeeded", request: JSON.stringify({ kind: "image", prompt: "第二版", params: { __creativeAsset: { assetId: asset.id, usage: "design_sheet", label: "场景设计图" } } }), result: JSON.stringify({ files: [{ fileId: "generated-image-2" }] }) });
    const replaced = getCreativeAsset(userId, asset.id);
    assert.equal(replaced.payload.variants.length, 1);
    assert.equal(replaced.payload.variants[0].fileId, "generated-image-2");
    assert.equal(replaced.payload.primaryImageId, replaced.payload.variants[0].id);
    const regeneratePreview = previewCreativeAssetGeneration(userId, replaced.id, { kind: "image", revision: replaced.revision });
    assert.equal(regeneratePreview.references.length, 0, "已有主设计图不应把重新生成隐式切换成图生图");
    assert.equal(regeneratePreview.warnings.some((warning) => warning.code === "AI_MODEL_REFERENCE_UNSUPPORTED"), false);

    for (const fileId of ["reference-one", "reference-two"]) db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(fileId, userId, join(testData, `${fileId}.png`), `${fileId}.png`, "image/png", 0, "{}", now);
    const referenced = createCreativeAsset(userId, projectId, { kind: "prop", name: "旧怀表", payload: { description: "黄铜怀表", variants: ["reference-one", "reference-two"].map((fileId) => ({ id: `${fileId}-variant`, kind: "image", fileId, label: "主体参考", prompt: "", usage: "reference_input", createdAt: now })), mediaDrafts: { image: { model: "provider-1::image-reference-model" } } } });
    const limitedPreview = previewCreativeAssetGeneration(userId, referenced.id, { kind: "image", revision: referenced.revision });
    assert.equal(limitedPreview.params.imagePromptProfile, "generic");
    assert.equal(limitedPreview.references.length, 1);
    assert.equal(limitedPreview.warnings.some((warning) => warning.code === "AI_MODEL_REFERENCE_LIMIT" && !warning.blocking), true);

    const character = createCreativeAsset(userId, projectId, { kind: "character", name: "林夏", payload: { description: "二十多岁的短发女性", designProfile: { apparentGender: "female", voiceGender: "female", ageBand: "20-30", identityAnchor: "短发女性，深色风衣", uncertainties: [] }, mediaDrafts: { image: { model: "provider-1::image-model", prompt: "重点锁定短发轮廓、深色风衣配色和四个视图的面部一致性" }, audio: { model: "provider-1::sound-model", prompt: "低沉男声，语速缓慢", transcript: "你好" } } } });
    assert.equal(character.payload.mediaDrafts.image.prompt, "重点锁定短发轮廓、深色风衣配色和四个视图的面部一致性");
    assert.match(previewCreativeAssetGeneration(userId, character.id, { kind: "image", revision: character.revision }).prompt, /重点锁定短发轮廓/);
    const voicePreview = previewCreativeAssetGeneration(userId, character.id, { kind: "audio", revision: character.revision });
    assert.equal(voicePreview.warnings.some((warning) => warning.code === "CREATIVE_ASSET_VOICE_GENDER_CONFLICT" && warning.blocking), true);
});

test("导演角色使用纯视觉设定一次生成四视图", () => {
    const userId = "user-1";
    const projectId = "director-character-project";
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,revision,created_at,updated_at) VALUES(?,?,'director',?,?,1,?,?)")
        .run(projectId, userId, "角色母版测试", JSON.stringify({ id: projectId, kind: "director", title: "角色母版测试", nodes: [], connections: [] }), now, now);
    db.prepare("INSERT INTO stored_files(id,user_id,path,original_name,mime_type,bytes,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("director-character-style-reference", userId, join(testData, "director-character-style-reference.png"), "style.png", "image/png", 0, "{}", now);
    const style = createVisualStyle(userId, projectId, {
        name: "电影风格",
        mode: "custom",
        status: "confirmed",
        description: "雪夜宗门中的戏剧化追逐场面",
        dna: { medium: "真人电影摄影", rendering: "真实相机写实", palette: "青黑与冷白", lighting: "月光与火把强烈侧光", contrast: "高反差", texture: "丝绸与金属", lensAndDepth: "长焦浅景深", composition: "倾斜构图", postProcessing: "电影辉光", exclusions: [] },
        references: { board: "director-character-style-reference" },
    });
    setDefaultVisualStyle(userId, style.id);
    const character = createCreativeAsset(userId, projectId, {
        kind: "character",
        name: "林尘",
        payload: {
            description: "从杂役逆袭为宗门传人",
            narrativeDescription: "林尘在雪夜被欺辱，后来觉醒并击败仇敌。",
            visualDescription: "十六岁清瘦少年，窄长脸，黑色高马尾，灰白粗布交领短衫，深灰束腿裤，黑布鞋，左眉尾有细小断痕。",
            designProfile: { apparentGender: "male", voiceGender: "male", ageBand: "16-18", visibleAgeCues: "少年面部脂肪较薄，眼下有轻微疲惫纹理", bodySilhouette: "窄肩长肢、腰线偏高的清瘦剪影", posture: "肩略内收但脊背挺直", identityAnchor: "窄长脸、狭长眼、左眉尾细小断痕", distinctivenessSummary: "窄长脸配低发际线、清瘦高腰剪影与左眉断痕", facialIdentity: { faceShape: "窄长脸，脸宽明显小于脸长", boneStructure: "颧骨平缓，下颌窄而利落", brows: "平直淡眉，左眉尾断开一小段", eyes: "狭长眼，眼距略窄", nose: "鼻梁直，鼻头小", mouth: "薄唇，嘴角平直", skin: "偏白冷调，有细小毛孔与轻微晒斑", hairline: "低而整齐", distinguishingMarks: "左眉尾细小断痕" }, uncertainties: [] },
            mediaDrafts: { image: { model: "provider-1::image-model", prompt: "保持左眉尾断痕清晰" } },
        },
    });

    const preview = previewCreativeAssetGeneration(userId, character.id, { kind: "image", revision: character.revision });
    assert.equal(preview.params.size, "2560x1440");
    assert.equal(preview.params.imagePromptProfile, "gpt-image-2");
    assert.equal(preview.params.quality, "high");
    assert.match(preview.prompt, /十六岁清瘦少年/);
    assert.match(preview.prompt, /稳定面部身份锚点：脸型比例：窄长脸/);
    assert.match(preview.prompt, /脸型比例：窄长脸/);
    assert.match(preview.prompt, /非对称识别点：左眉尾细小断痕/);
    assert.match(preview.prompt, /正面、左侧 90 度、右侧 90 度、背面 180 度/);
    assert.match(preview.prompt, /真人电影摄影/);
    assert.match(preview.prompt, /真实相机写实/);
    assert.doesNotMatch(preview.prompt, /林尘/);
    assert.doesNotMatch(preview.prompt, /雪夜被欺辱/);
    assert.doesNotMatch(preview.prompt, /雪夜宗门/);
    assert.doesNotMatch(preview.prompt, /月光与火把/);
    assert.doesNotMatch(preview.prompt, /长焦浅景深/);
    assert.match(preview.prompt, /单张角色四视图设定图/);
    assert.match(preview.prompt, /不拆成四张图片/);
    assert.match(preview.prompt, /自然毛孔/);
    assert.match(preview.prompt, /窄肩长肢/);
    assert.equal(preview.references.length, 0, "带人物面貌的角色风格样张不得作为初次角色输入");
    assert.deepEqual(preview.excludedReferences.map((item) => item.fileId), ["director-character-style-reference"]);

    const animatedStyle = createVisualStyle(userId, projectId, { name: "当代赛璐璐动画", mode: "template", templateId: "contemporary-cel", status: "confirmed" });
    setDefaultVisualStyle(userId, animatedStyle.id);
    const animatedCharacter = createCreativeAsset(userId, projectId, {
        kind: "character",
        name: "动画角色",
        payload: {
            visualDescription: "二十岁短发青年，方脸，宽肩，红色短夹克与深色长裤。",
            designProfile: { apparentGender: "male", voiceGender: "male", ageBand: "20-25", visibleAgeCues: "年轻面部轮廓", bodySilhouette: "宽肩短躯干", posture: "自然直立", identityAnchor: "方脸、短发、宽肩", distinctivenessSummary: "方脸与红色短夹克", facialIdentity: null, uncertainties: [] },
            mediaDrafts: { image: { model: "provider-1::image-reference-model", prompt: "真实相机、自然毛孔、禁止插画" } },
        },
    });
    const animatedPreview = previewCreativeAssetGeneration(userId, animatedCharacter.id, { kind: "image", revision: animatedCharacter.revision });
    assert.match(animatedPreview.prompt, /二维手绘赛璐璐动画/);
    assert.match(animatedPreview.prompt, /二维动画要求/);
    assert.doesNotMatch(animatedPreview.prompt, /Photorealistic|真实相机拍摄|自然毛孔|禁止插画/);
    assert.equal(animatedPreview.references.length, 1);
    const animatedPackage = animatedPreview.params.__promptPackage;
    assert.ok(animatedPackage?.style);
    assert.equal(animatedPackage.style.mediumFamily, "animation_2d");
    assert.equal(animatedPackage.references[0]?.purpose, "style_reference");

    const undesigned = createCreativeAsset(userId, projectId, { kind: "character", name: "未设计角色", payload: { narrativeDescription: "只存在于剧情中的人物小传", designProfile: { apparentGender: "unspecified", voiceGender: "unspecified", ageBand: "", identityAnchor: "前期落魄，后期觉醒", uncertainties: [] }, mediaDrafts: { image: { model: "provider-1::image-model" } } } });
    const undesignedPreview = previewCreativeAssetGeneration(userId, undesigned.id, { kind: "image", revision: undesigned.revision });
    assert.equal(undesignedPreview.warnings.some((warning) => warning.code === "DIRECTOR_CHARACTER_VISUAL_DESCRIPTION_REQUIRED" && warning.blocking), true);
    assert.doesNotMatch(undesignedPreview.prompt, /前期落魄/);

});
