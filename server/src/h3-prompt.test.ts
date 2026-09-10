import assert from "node:assert/strict";
import test from "node:test";
import { compileH3Prompt, h3AudioPromptReferences, h3AudioReferencesInput, isH3TurboAudioSafe, validateH3PromptPlan, validateStoryboardNarrativePlan } from "./h3-prompt.js";

const planned = { durationSeconds: 4, sourceSceneId: "S001", sourceBeatIds: ["S001-B01"], sourceDurationSeconds: 4, dramaticBeat: "人物从犹豫变为阻止对方", openingState: "人物站在桌边观察", endingState: "人物开口制止并向前一步" };

const sheet = { frames: [
    { shotNumber: 1, timeSeconds: 0, description: "受辱·夺玉", action: "", cameraAngle: "", cameraMove: "", sound: "脚步踩雪" },
    { shotNumber: 1, timeSeconds: 10, description: "受辱·夺玉", action: "", cameraAngle: "", cameraMove: "", sound: "玉佩落地" },
] };

test("H3 FL2VA 遵循官方结构且只允许对白中文进入可发声块", () => {
    const prompt = compileH3Prompt("fl2va", { durationSeconds: 10, dialogue: "赵天昊：「听说你娘给你留了块玉？」", audio: "脚步踩雪、玉佩落地" }, sheet);
    assert.match(prompt, /^How the reference pictures align with the target video/);
    assert.match(prompt, /integrated_multimodal_description: \[Shot 1\]/);
    assert.match(prompt, /<d>\[Chinese\] 听说你娘给你留了块玉？<\/d>/);
    assert.match(prompt, /No other speech, narration, singing, or vocalization occurs/);
    assert.match(prompt, /non_diegetic_music: N\/A$/);
    assert.doesNotMatch(prompt, /Title:/);
    assert.doesNotMatch(prompt, /受辱·夺玉/);
    assert.doesNotMatch(prompt, /赵天昊/);
    assert.match(prompt, /footsteps/);
    assert.match(prompt, /hard-object clink/);
    assert.match(prompt, /No unintended speech/);
});

test("H3 从故事板声音意图编译具体英文声景并排除疑似对白", () => {
    const prompt = compileH3Prompt("fl2va", { durationSeconds: 10 }, { frames: [
        { shotNumber: 1, timeSeconds: 0, description: "", action: "", cameraAngle: "", cameraMove: "", sound: "高跟鞋敲地声，纸张翻动，空调低鸣" },
        { shotNumber: 1, timeSeconds: 10, description: "", action: "", cameraAngle: "", cameraMove: "", sound: "林慕：不要迟到" },
    ] });
    assert.match(prompt, /sharp high-heel footsteps/);
    assert.match(prompt, /paper rustling/);
    assert.match(prompt, /low room hum/);
    assert.doesNotMatch(prompt, /不要迟到|林慕/);
});

test("H3 中文视频段声效进入英文声景，精确声音需求禁用 Turbo", () => {
    const payload = { durationSeconds: 8, soundDesign: "风雪呼啸，玉佩落地轻响" };
    const quietSheet = { frames: [{ shotNumber: 1, timeSeconds: 0, description: "", action: "", cameraAngle: "", cameraMove: "", sound: "安静" }] };
    const prompt = compileH3Prompt("fl2va", payload, quietSheet);
    assert.match(prompt, /steady wind and blowing snow/);
    assert.match(prompt, /hard-object clink/);
    assert.equal(isH3TurboAudioSafe(payload, quietSheet), false);
    assert.equal(isH3TurboAudioSafe({}, quietSheet), true);
    assert.equal(isH3TurboAudioSafe({ dialogue: "林慕：「停下。」" }, undefined), false);
});

test("H3 无对白时明确禁止人声，Ref2VA 保持官方六段顺序", () => {
    const prompt = compileH3Prompt("ref2va", { durationSeconds: 8 }, sheet);
    const fields = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"];
    assert.deepEqual(fields.map((field) => prompt.indexOf(field)), [...fields.map((field) => prompt.indexOf(field))].sort((a, b) => a - b));
    assert.match(prompt, /No character speaks, sings, narrates, or vocalizes/);
    assert.doesNotMatch(prompt, /受辱·夺玉/);
});

test("H3 保留中文可观察动作并只在真实 Shot 边界切镜", () => {
    const prompt = compileH3Prompt("ref2va", { durationSeconds: 8 }, { frames: [
        { position: 0, shotNumber: 1, timeSeconds: 0, description: "雪夜杂役院远景", action: "少年背对镜头走向院中石碑", cameraAngle: "低机位广角", cameraMove: "缓慢推进", dialogue: "", sound: "风雪声" },
        { position: 1, shotNumber: 1, timeSeconds: 2.5, description: "石碑幽蓝光逐渐增强", action: "少年停步抬头", cameraAngle: "中远景", cameraMove: "继续推进", dialogue: "", sound: "低频灵力嗡鸣" },
        { position: 2, shotNumber: 2, timeSeconds: 5, description: "石碑裂缝喷出金色光芒", action: "少年抬臂遮挡强光", cameraAngle: "反打近景", cameraMove: "轻微后撤", dialogue: "这是怎么回事？", sound: "石块爆裂" },
        { position: 3, shotNumber: 2, timeSeconds: 8, description: "光芒照亮积雪与人物轮廓", action: "少年放下手臂凝视裂缝", cameraAngle: "中景", cameraMove: "静止", dialogue: "", sound: "碎石落地" },
    ] });
    assert.match(prompt, /雪夜杂役院远景/);
    assert.match(prompt, /少年停步抬头/);
    assert.match(prompt, /\[Shot 1\]/);
    assert.match(prompt, /\[Shot 2\] At 00:05\.000, hard cut/);
    assert.equal((prompt.match(/hard cut/g) || []).length, 1);
    assert.match(prompt, /<d>\[Chinese\] 这是怎么回事？<\/d>/);
});

test("H3 优先使用独立英文视频描述，不把故事板中文画面混入官方结构", () => {
    const prompt = compileH3Prompt("ref2va", { durationSeconds: 4 }, { frames: [
        { position: 0, shotNumber: 1, timeSeconds: 0, description: "雪夜杂役院远景", action: "少年走向石碑", cameraAngle: "低机位", cameraMove: "推进", h3Visual: "A low-angle wide shot follows the young man walking toward the stone stele through blowing snow.", dialogue: "", sound: "风雪声" },
        { position: 1, shotNumber: 1, timeSeconds: 4, description: "石碑发出幽蓝光", action: "少年停步", cameraAngle: "中景", cameraMove: "静止", h3Visual: "The camera settles into a medium shot as he stops and cold blue light grows inside the cracked stele.", dialogue: "", sound: "灵力低鸣" },
    ] });
    assert.match(prompt, /A low-angle wide shot follows/);
    assert.match(prompt, /cold blue light grows/);
    assert.doesNotMatch(prompt, /雪夜杂役院|少年走向石碑|石碑发出幽蓝光/);
});

test("H3 Ref2VA 把角色图片定义为 Subject，并以稳定说话人编译结构化对白", () => {
    const structured = { frames: [
        { shotNumber: 1, timeSeconds: 0, description: "晨会开场", action: "", cameraAngle: "", cameraMove: "", h3Visual: "A medium-wide shot holds on the team around the conference table.", dialogues: [{ speakerAssetId: "character-a", speakerName: "林慕", text: "开周会前，我先把丑话说在前面。", language: "Chinese", delivery: "in a calm, firm, low-pitched delivery", startSeconds: 1, endSeconds: 4.5 }], sound: "quiet office room tone and soft paper movement" },
        { shotNumber: 2, timeSeconds: 6, description: "侧面反应", action: "", cameraAngle: "", cameraMove: "", h3Visual: "A hard cut reveals the junior employee glancing sideways while everyone else stays still.", dialogues: [{ speakerAssetId: "character-b", speakerName: "小鹿", text: "她今天心情更差了。", language: "Chinese", delivery: "in a very soft, nervous whisper", startSeconds: 7, endSeconds: 9.5 }], sound: "low air-conditioning hum" },
    ] };
    const prompt = compileH3Prompt("ref2va", { durationSeconds: 10 }, structured, [
        { tag: "<Picture 1>", purpose: "is the complete storyboard sheet" },
        { tag: "<Picture 2>", purpose: "preserve the character identity only", assetId: "character-a", subjectTag: "<Subject 1>", subjectKind: "character" },
        { tag: "<Picture 3>", purpose: "preserve the character identity only", assetId: "character-b", subjectTag: "<Subject 2>", subjectKind: "character" },
    ]);
    assert.match(prompt, /<Subject 1> is the character shown in <Picture 2>/);
    assert.match(prompt, /<Subject 1> \(S1\).*<d>\[Chinese\] 开周会前，我先把丑话说在前面。<\/d>/);
    assert.match(prompt, /<Subject 2> \(S2\).*<d>\[Chinese\] 她今天心情更差了。<\/d>/);
    assert.doesNotMatch(prompt.match(/overall_soundscape:[\s\S]*?non_diegetic_music:/)?.[0] || "", /开周会前|心情更差/);
    assert.equal(isH3TurboAudioSafe({}, structured), false);
});

test("H3 生成前阻止旧对白字段、对白混入 sound 和未绑定角色", () => {
    const invalid = { frames: [
        { shotNumber: 1, timeSeconds: 0, description: "", action: "", cameraAngle: "", cameraMove: "", h3Visual: "A locked medium shot.", dialogues: [{ speakerAssetId: "missing", speakerName: "林慕", text: "停下。", language: "Chinese", delivery: "冷静地", startSeconds: 1, endSeconds: 1.2 }], dialogue: "林慕：停下", sound: "林慕：停下" },
        { shotNumber: 1, timeSeconds: 4, description: "", action: "", cameraAngle: "", cameraMove: "", h3Visual: "The subject stops.", dialogues: [], sound: "脚步声" },
    ] };
    const result = validateH3PromptPlan({ durationSeconds: 4, dialogue: "林慕：停下" }, invalid, ["character-a"]);
    assert.ok(result.blockedReasons.some((item) => item.includes("结构化对白")));
    assert.ok(result.blockedReasons.some((item) => item.includes("声音字段")));
    assert.ok(result.blockedReasons.some((item) => item.includes("角色素材")));
    assert.ok(result.blockedReasons.some((item) => item.includes("英文语气")));
    assert.ok(result.blockedReasons.some((item) => item.includes("H3 声景")));
    assert.ok(result.warnings.some((item) => item.includes("窗口偏短")));
});

test("H3 合法结构化对白通过生成前校验", () => {
    const valid = { frames: [
        { shotNumber: 1, timeSeconds: 0, kind: "shot-start" as const, description: "", action: "", cameraAngle: "medium shot", cameraMove: "locked camera", h3Visual: "A locked medium shot frames the speaker beside the table.", dialogues: [{ speakerAssetId: "character-a", speakerName: "林慕", text: "停下。", language: "Chinese", delivery: "in a calm and firm delivery", startSeconds: 1, endSeconds: 2 }], sound: "quiet room tone" },
        { shotNumber: 1, timeSeconds: 4, kind: "shot-end" as const, description: "", action: "", cameraAngle: "medium shot", cameraMove: "locked camera", h3Visual: "The subject stops while the camera remains locked.", dialogues: [], sound: "soft fabric movement" },
    ] };
    assert.deepEqual(validateH3PromptPlan(planned, valid, ["character-a"]), { blockedReasons: [], warnings: [] });
    const voice = { fileId: "voice", purpose: "voice", speakerAssetId: "character-a", description: "a calm low voice" };
    assert.deepEqual(validateH3PromptPlan({ ...planned, audioReferences: [voice] }, valid, ["character-a"]).blockedReasons, []);
    assert.ok(validateH3PromptPlan({ ...planned, audioReferences: [{ ...voice, speakerAssetId: "missing" }] }, valid, ["character-a"]).blockedReasons.length);
    assert.ok(validateH3PromptPlan({ ...planned, audioReferences: [{ fileId: "music", purpose: "music", description: "soft piano" }] }, valid, ["character-a"]).blockedReasons.some((reason) => reason.includes("配乐")));

});

test("故事板生成前阻止压缩来源节拍和同一 Shot 内的固定机位跳变", () => {
    const invalid = { frames: [
        { shotNumber: 1, timeSeconds: 0, kind: "shot-start" as const, description: "人物在门口", action: "人物停步", cameraAngle: "wide shot", cameraMove: "locked camera", h3Visual: "A locked wide shot frames the person at the doorway.", sound: "quiet room tone" },
        { shotNumber: 1, timeSeconds: 6, kind: "shot-end" as const, description: "人物面部", action: "人物皱眉", cameraAngle: "extreme close-up", cameraMove: "locked camera", h3Visual: "A locked extreme close-up shows the person's frown.", sound: "quiet room tone" },
    ] };
    const result = validateStoryboardNarrativePlan({ ...planned, durationSeconds: 6, sourceDurationSeconds: 12 }, invalid);
    assert.ok(result.blockedReasons.some((item) => item.includes("不守恒")));
    assert.ok(result.blockedReasons.some((item) => item.includes("固定机位")));
});

test("故事板 Shot 停留过短时阻止继续生成", () => {
    const invalid = { frames: [
        { shotNumber: 1, timeSeconds: 0, kind: "shot-start" as const, description: "开场", action: "抬头", cameraAngle: "medium shot", cameraMove: "locked", h3Visual: "A medium shot shows the person looking up.", sound: "room tone" },
        { shotNumber: 1, timeSeconds: 0.7, kind: "shot-end" as const, description: "动作结束", action: "停住", cameraAngle: "medium shot", cameraMove: "locked", h3Visual: "The person becomes still.", sound: "room tone" },
        { shotNumber: 2, timeSeconds: 0.8, kind: "shot-start" as const, description: "反应", action: "另一人后退", cameraAngle: "close-up", cameraMove: "locked", h3Visual: "A close-up shows the other person stepping back.", sound: "footsteps" },
        { shotNumber: 2, timeSeconds: 6, kind: "shot-end" as const, description: "反应结束", action: "另一人站定", cameraAngle: "close-up", cameraMove: "locked", h3Visual: "The other person stops.", sound: "room tone" },
    ] };
    const result = validateStoryboardNarrativePlan({ ...planned, durationSeconds: 6, sourceDurationSeconds: 6 }, invalid);
    assert.ok(result.blockedReasons.some((item) => item.includes("只有 0.80 秒")));
});


test("音频参考绑定全局说话人，保留原文和完整发声窗口", () => {
    const cue = { speakerAssetId: "b", speakerName: "乙", text: "等一下……", language: "Chinese", delivery: "a quiet whisper", startSeconds: 1, endSeconds: 3 };
    const prompt = compileH3Prompt("ref2va", { durationSeconds: 4 }, { frames: [{ ...sheet.frames[0]!, dialogues: [cue] }] }, [
        { tag: "<Picture 1>", purpose: "storyboard" },
        { tag: "<Picture 2>", purpose: "identity", assetId: "b", subjectTag: "<Subject 2>", subjectKind: "character" },
        { tag: "<Audio 1>", purpose: "a low breathy voice", assetId: "b", audioPurpose: "voice" },
    ]);
    assert.match(prompt, /voice-timbre reference for <Subject 2> \(S1\)/);
    assert.match(prompt, /<Audio 1>: reference/);
    assert.match(prompt, /following the vocal characteristics referenced from <Audio 1>/);
    assert.match(prompt, /From 00:01.000 to 00:03.000/);
    assert.match(prompt, /<d>\[Chinese\] 等一下……<\/d>/);
    assert.doesNotMatch(prompt, /等一下……。/);
    assert.equal(h3AudioReferencesInput.safeParse([{ fileId: "a", purpose: "voice", description: "deep voice" }]).success, false);
    assert.equal(h3AudioReferencesInput.safeParse([{ fileId: "a", purpose: "sound", description: "wind" }]).success, true);
    assert.equal(isH3TurboAudioSafe({ audioReferences: [{ fileId: "a" }] }, undefined), false);
    assert.equal(isH3TurboAudioSafe({ h3NonDiegeticMusic: "soft piano" }, undefined), false);
});

test("续接视频原声先占 Audio 编号，独立参考与实际上传顺序一致", () => {
    const references = [{ fileId: "a", purpose: "voice", speakerAssetId: "b", description: "a low voice" }];
    assert.deepEqual(h3AudioPromptReferences(references, false).map((item) => item.tag), ["<Audio 1>"]);
    assert.deepEqual(h3AudioPromptReferences(references, true).map((item) => item.tag), ["<Audio 1>", "<Audio 2>"]);
});
