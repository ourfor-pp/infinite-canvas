import { z } from "zod";

export const h3AudioReferenceInput = z.object({
    fileId: z.string().min(1),
    purpose: z.enum(["voice", "dialogue", "sound", "music"]),
    speakerAssetId: z.string().min(1).optional(),
    description: z.string().trim().min(1).max(1_000).refine((value) => !/[\u3400-\u9fff]/.test(value), "音频参考说明必须使用英文"),
}).superRefine((value, context) => {
    if ((value.purpose === "voice" || value.purpose === "dialogue") && !value.speakerAssetId) context.addIssue({ code: "custom", path: ["speakerAssetId"], message: "音色与对白参考必须绑定说话角色" });
    if ((value.purpose === "sound" || value.purpose === "music") && value.speakerAssetId) context.addIssue({ code: "custom", path: ["speakerAssetId"], message: "环境声与音乐参考不绑定说话角色" });
});
export const h3AudioReferencesInput = z.array(h3AudioReferenceInput).max(3).default([]);
export type H3AudioReference = z.infer<typeof h3AudioReferenceInput>;

export type H3DialogueCue = {
    speakerAssetId: string;
    speakerName: string;
    text: string;
    language: string;
    delivery: string;
    startSeconds: number;
    endSeconds: number;
    offScreen?: boolean;
};

type StoryboardFrame = {
    position?: number;
    shotNumber: number;
    timeSeconds: number;
    kind?: "shot-start" | "keyframe" | "shot-end";
    description: string;
    action: string;
    cameraAngle: string;
    cameraMove: string;
    h3Visual?: string;
    dialogues?: H3DialogueCue[];
    dialogue?: string;
    sound: string;
};
type StoryboardSheet = { frames: StoryboardFrame[] };
type H3Speaker = { id: number; subjectTag?: string; audioTags: string[] };
export type H3ReferenceDefinition = {
    tag: string;
    purpose: string;
    assetId?: string;
    subjectTag?: string;
    subjectKind?: "character" | "scene" | "prop";
    audioPurpose?: H3AudioReference["purpose"];
};
export function h3AudioPromptReferences(value: unknown, continuation: boolean): H3ReferenceDefinition[] {
    return [
        ...(continuation ? [{ tag: "<Audio 1>", purpose: "the synchronized soundtrack of <Video 1>; continue its audible characteristics", audioPurpose: "sound" as const }] : []),
        ...h3AudioReferencesInput.parse(value).map((reference, index) => ({ tag: `<Audio ${index + 1 + Number(continuation)}>`, purpose: reference.description, assetId: reference.speakerAssetId, audioPurpose: reference.purpose })),
    ];
}
export type H3PromptValidation = { blockedReasons: string[]; warnings: string[] };

const han = /[\u3400-\u9fff]/;
const dialogueLike = /^[^:：\n]{1,40}[：:]\s*\S/;

export function compileH3Prompt(mode: "fl2va" | "ref2va", payload: Record<string, unknown>, sheet: StoryboardSheet, references: H3ReferenceDefinition[] = []) {
    const duration = Number(payload.durationSeconds || 4);
    const speakers = buildSpeakers(sheet, references);
    const description = compileDescription(payload, sheet, speakers);
    const soundReferences = references.filter((reference) => reference.audioPurpose === "sound").map((reference) => reference.tag);
    const soundscape = compileSoundscape(payload, sheet) + (soundReferences.length ? ` Use ${soundReferences.join(" and ")} as sound-texture references without copying the original signal.` : "");
    const musicReferences = references.filter((reference) => reference.audioPurpose === "music").map((reference) => reference.tag);
    const music = (promptText(payload.h3NonDiegeticMusic || payload.music) || "N/A") + (musicReferences.length ? `. Follow the musical characteristics of ${musicReferences.join(" and ")} without copying the original signal.` : "");
    if (mode === "fl2va") {
        const lastShot = Math.max(1, ...sheet.frames.map((frame) => frame.shotNumber));
        return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${lastShot}) aligns with the ${duration.toFixed(2)}-second mark of the target video.\n\nintegrated_multimodal_description: ${description}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
    }
    const definitions = references.length
        ? references.map((reference) => referenceDefinition(reference, speakers)).join("\n")
        : "<Picture 1> is the complete storyboard sheet. Read panels from left to right and top to bottom; use it only as a chronological shot-planning reference, never as a collage layout.";
    const retention = references.length
        ? references.map(retentionDefinition).join("\n")
        : "<Picture 1>: fully preserve chronology, shot grouping, composition intent, screen direction, and continuity; never preserve gutters, panel borders, labels, or the collage layout.";
    return `subject_definitions:\n${definitions}\n\nsummary:\n[${payload.boundary === "continue" ? "video continuation + " : ""}reference generation${references.some((reference) => reference.audioPurpose) ? " + audio reference" : ""}] Generate one ${duration.toFixed(2)}-second audiovisual sequence. Follow the storyboard's chronological Shot plan while rendering a normal full-frame cinematic video, never a grid or split screen.\n\nretention_analysis:\n${retention}\n\ndetailed_description:\n${description}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
}

export function validateH3PromptPlan(payload: Record<string, unknown>, sheet: StoryboardSheet | undefined, availableCharacterAssetIds: string[] = []): H3PromptValidation {
    if (!sheet?.frames.length) return { blockedReasons: ["缺少故事板时序结构"], warnings: [] };
    const duration = Number(payload.durationSeconds || 4);
    const narrative = validateStoryboardNarrativePlan(payload, sheet);
    const blockedReasons: string[] = [...narrative.blockedReasons];
    const warnings: string[] = [...narrative.warnings];
    const available = new Set(availableCharacterAssetIds);
    const audioReferences = h3AudioReferencesInput.safeParse(payload.audioReferences);
    if (!audioReferences.success) blockedReasons.push(...audioReferences.error.issues.map((issue) => issue.message));
    else audioReferences.data.forEach((reference) => {
        if (reference.speakerAssetId && (!available.has(reference.speakerAssetId) || !sheet.frames.some((frame) => frame.dialogues?.some((cue) => cue.speakerAssetId === reference.speakerAssetId)))) blockedReasons.push("音频参考必须绑定本段已采用且有结构化对白的角色");
        if (reference.purpose === "music" && /^(N\/A|none)?$/i.test(promptText(payload.h3NonDiegeticMusic || payload.music))) blockedReasons.push("采用音乐参考时必须明确填写配乐计划，不能同时声明无配乐");
    });
    const legacyDialogue = sheet.frames.some((frame) => promptText(frame.dialogue)) || Boolean(promptText(payload.dialogue || payload.narration));
    if (legacyDialogue) blockedReasons.push("对白尚未转换为带说话角色和时间范围的结构化对白");
    if (sheet.frames.some((frame) => dialogueLike.test(promptText(frame.sound)))) blockedReasons.push("对白被写入声音字段，请移到结构化对白；声音字段只能写环境声、动作声和非语言人声");
    const missingVisual = sheet.frames.filter((frame) => !promptText(frame.h3Visual)).length;
    if (missingVisual) blockedReasons.push(`${missingVisual} 个画格缺少 H3 英文视觉描述`);
    else if (sheet.frames.some((frame) => han.test(promptText(frame.h3Visual)))) blockedReasons.push("H3 视觉描述必须使用英文，对白原文除外");
    if (sheet.frames.some((frame) => han.test(promptText(frame.sound)))) blockedReasons.push("H3 声景必须使用具体英文描述，不得在声音字段保留中文对白或中文说明");
    const shotNumbers = sheet.frames.map((frame) => frame.shotNumber);
    if (shotNumbers.some((shot, index) => index > 0 && shot < shotNumbers[index - 1]!)) blockedReasons.push("Shot 编号必须按时间单调递增");
    const uniqueShots = [...new Set(shotNumbers)];
    if (uniqueShots.some((shot, index) => shot !== index + 1)) blockedReasons.push("Shot 编号必须从 1 开始连续编号");
    const dialogues = sheet.frames.flatMap((frame) => frame.dialogues || []).sort((left, right) => left.startSeconds - right.startSeconds);
    dialogues.forEach((cue, index) => {
        if (!cue.speakerAssetId || !available.has(cue.speakerAssetId)) blockedReasons.push(`对白 ${index + 1} 未绑定本视频段已采用的角色素材`);
        if (!cue.speakerName.trim()) blockedReasons.push(`对白 ${index + 1} 缺少说话角色名称`);
        if (!cue.text.trim()) blockedReasons.push(`对白 ${index + 1} 缺少对白原文`);
        if (!cue.delivery.trim() || han.test(cue.delivery)) blockedReasons.push(`对白 ${index + 1} 缺少英文语气与发声方式`);
        if (cue.startSeconds < 0 || cue.endSeconds <= cue.startSeconds || cue.endSeconds > duration) blockedReasons.push(`对白 ${index + 1} 的起止时间必须落在 0–${duration} 秒内`);
        if (index && cue.startSeconds < dialogues[index - 1]!.endSeconds) blockedReasons.push(`对白 ${index} 与对白 ${index + 1} 时间重叠`);
        const secondsNeeded = estimatedSpeechSeconds(cue.text);
        if (cue.endSeconds - cue.startSeconds + 0.05 < secondsNeeded) warnings.push(`“${truncate(cue.text, 18)}”预计需要约 ${secondsNeeded.toFixed(1)} 秒，当前对白窗口偏短`);
    });
    return { blockedReasons: unique(blockedReasons), warnings: unique(warnings) };
}

export function validateStoryboardNarrativePlan(payload: Record<string, unknown>, sheet: StoryboardSheet | undefined): H3PromptValidation {
    if (!sheet?.frames.length) return { blockedReasons: ["缺少故事板时序结构"], warnings: [] };
    const duration = Number(payload.durationSeconds || 4);
    const blockedReasons: string[] = [];
    const warnings: string[] = [];
    const sourceBeatIds = Array.isArray(payload.sourceBeatIds) ? payload.sourceBeatIds.map(promptText).filter(Boolean) : [];
    if (!promptText(payload.sourceSceneId)) blockedReasons.push("视频段缺少来源场次 ID，无法核对剧本覆盖");
    if (!sourceBeatIds.length) blockedReasons.push("视频段缺少来源节拍 ID，无法确认剧本内容没有丢失");
    if (!promptText(payload.dramaticBeat)) blockedReasons.push("视频段缺少唯一的戏剧变化");
    if (!promptText(payload.openingState) || !promptText(payload.endingState)) blockedReasons.push("视频段必须明确开始状态和结束状态");
    const sourceDuration = Number(payload.sourceDurationSeconds || 0);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) blockedReasons.push("视频段缺少承接的剧本计划时长");
    else if (Math.abs(sourceDuration - duration) > Math.max(1, sourceDuration * 0.1)) blockedReasons.push(`视频段 ${duration} 秒与来源节拍 ${sourceDuration} 秒不守恒，请拆段而不是压缩剧情`);

    const ordered = [...sheet.frames].sort((left, right) => left.timeSeconds - right.timeSeconds);
    if (ordered[0]!.timeSeconds !== 0) blockedReasons.push("故事板第一格必须从 0 秒开始");
    if (Math.abs(ordered.at(-1)!.timeSeconds - duration) > 0.05) blockedReasons.push(`故事板最后一格必须落在 ${duration} 秒`);
    if (ordered.some((frame, index) => index > 0 && frame.timeSeconds <= ordered[index - 1]!.timeSeconds)) blockedReasons.push("故事板画格时间必须严格递增");

    const shotNumbers = [...new Set(ordered.map((frame) => frame.shotNumber))];
    const maxShots = duration <= 6 ? 2 : duration <= 10 ? 2 : 3;
    if (shotNumbers.length > maxShots) blockedReasons.push(`${duration} 秒视频段包含 ${shotNumbers.length} 个 Shot，表演停留不足，请拆段或减少切镜`);
    const groups = new Map<number, StoryboardFrame[]>();
    ordered.forEach((frame) => groups.set(frame.shotNumber, [...(groups.get(frame.shotNumber) || []), frame]));
    const shots = [...groups.entries()].sort(([left], [right]) => left - right);
    shots.forEach(([shotNumber, frames], index) => {
        const start = frames[0]!.timeSeconds;
        const end = shots[index + 1]?.[1][0]?.timeSeconds ?? duration;
        if (end - start < 1.5) blockedReasons.push(`Shot ${shotNumber} 只有 ${(end - start).toFixed(2)} 秒，无法承载自然动作或反应`);
        if (frames[0]!.kind && frames[0]!.kind !== "shot-start") blockedReasons.push(`Shot ${shotNumber} 第一格必须标记为 shot-start`);
        if (frames.at(-1)!.kind && frames.at(-1)!.kind !== "shot-end") blockedReasons.push(`Shot ${shotNumber} 最后一格必须标记为 shot-end`);
        if (frames.slice(1, -1).some((frame) => frame.kind && frame.kind !== "keyframe")) blockedReasons.push(`Shot ${shotNumber} 中间画格只能标记为 keyframe`);
        const angles = unique(frames.map((frame) => normalizedCamera(frame.cameraAngle)).filter(Boolean));
        const locked = frames.some((frame) => /(?:locked|static|fixed|tripod|锁定|固定|静止)/i.test(promptText(frame.cameraMove)));
        if (locked && angles.length > 1) blockedReasons.push(`Shot ${shotNumber} 声明固定机位却包含多个不连续景别或机位，请在真实切镜处新建 Shot`);
    });
    if (shots.length > 1) {
        shots.slice(1).forEach(([shotNumber, frames]) => {
            if (frames[0]!.kind && frames[0]!.kind !== "shot-start") blockedReasons.push(`切镜后的 Shot ${shotNumber} 必须从 shot-start 开始`);
        });
    }
    if (duration / Math.max(1, shots.length) < 2.5) warnings.push("平均 Shot 停留不足 2.5 秒，人物表演和对白可能显得赶");
    return { blockedReasons: unique(blockedReasons), warnings: unique(warnings) };
}

function compileDescription(payload: Record<string, unknown>, sheet: StoryboardSheet, speakers: Map<string, H3Speaker>) {
    const groups = new Map<number, StoryboardFrame[]>();
    sheet.frames.forEach((frame) => groups.set(frame.shotNumber, [...(groups.get(frame.shotNumber) || []), frame]));
    const shots = Array.from(groups.entries()).sort(([left], [right]) => left - right).map(([shotNumber, frames], index) => {
        const start = frames[0]?.timeSeconds || 0;
        const prefix = index === 0 ? `[Shot ${shotNumber}]` : `[Shot ${shotNumber}] At ${timestamp(start)}, hard cut to`;
        const beats = frames.map((frame, frameIndex) => {
            const description = promptText(frame.description);
            const h3Visual = promptText(frame.h3Visual);
            const details = h3Visual ? [h3Visual] : unique([isLikelyLabel(description) ? "" : description, promptText(frame.action), cameraDescription(frame.cameraAngle, frame.cameraMove)].filter(Boolean));
            const sound = soundCue(frame.sound);
            const dialogues = (frame.dialogues || []).map((cue) => compileDialogueCue(cue, speakers)).filter(Boolean);
            const legacy = compileTimedSpeech(frame.dialogue, frame.timeSeconds);
            const timing = frameIndex === 0 && index === 0 ? "Initially" : frameIndex === 0 ? "At the cut" : `By ${timestamp(frame.timeSeconds)}`;
            return `${timing}, ${details.join(". ") || "the visible action advances to the storyboard state"}${sound.length ? `. Synchronized diegetic audio: ${joinNatural(sound)}` : ""}${dialogues.length ? `. ${dialogues.join(" ")}` : legacy ? `. ${legacy}` : ""}.`;
        });
        return `${prefix}. ${beats.join(" ")}`;
    });
    if (!hasDialogue(payload, sheet)) shots.push("No character speaks, sings, narrates, or vocalizes.");
    else if (!sheet.frames.some((frame) => (frame.dialogues || []).length)) shots.push(`${compileLegacySpeech(payload)} No other speech, narration, singing, or vocalization occurs.`);
    else shots.push("No other speech, narration, singing, or vocalization occurs.");
    return shots.filter(Boolean).join(" ");
}

function compileSoundscape(payload: Record<string, unknown>, sheet: StoryboardSheet) {
    const sources = [payload.h3Soundscape, payload.soundDesign, payload.sound, payload.audio, ...sheet.frames.map((frame) => frame.sound)];
    const explicit = unique(sources.map(promptText).filter((value) => value && !han.test(value) && !dialogueLike.test(value)).flatMap((value) => value.split(/[;,]+/).map((item) => item.trim()).filter(Boolean)));
    if (explicit.length) return `${joinNatural(explicit)} remain synchronized with the visible actions. No unintended speech, narration, singing, music, or indistinct vocalization is audible.`;
    const cues = unique(sources.flatMap(soundCue).filter(Boolean));
    const body = cues.length ? `${joinNatural(cues)} remain synchronized with the visible actions.` : "Only natural ambient sound and visible physical action sounds are audible.";
    return `${body} No unintended speech, narration, singing, music, or indistinct vocalization is audible.`;
}

export function isH3TurboAudioSafe(payload: Record<string, unknown>, sheet: StoryboardSheet | undefined) {
    if (Array.isArray(payload.audioReferences) && payload.audioReferences.length) return false;
    if (promptText(payload.h3NonDiegeticMusic || payload.music) && !/^(N\/A|none)$/i.test(promptText(payload.h3NonDiegeticMusic || payload.music))) return false;
    if (String(payload.dialogue || payload.narration || "").trim()) return false;
    if ((sheet?.frames || []).some((frame) => promptText(frame.dialogue) || (frame.dialogues || []).length)) return false;
    const cues = [payload.h3Soundscape, payload.soundDesign, payload.sound, payload.audio, ...(sheet?.frames || []).map((frame) => frame.sound)];
    return !cues.some((value) => {
        const text = typeof value === "string" ? value.trim() : "";
        return text && !/^(安静|寂静|静默|无声|N\/A|none)$/i.test(text);
    });
}

function referenceDefinition(reference: H3ReferenceDefinition, speakers: Map<string, H3Speaker>) {
    if (reference.audioPurpose) {
        const speaker = reference.assetId ? speakers.get(reference.assetId) : undefined;
        const identity = speaker ? ` for ${speaker.subjectTag || "the speaker"} (S${speaker.id})` : "";
        const role = { voice: "voice-timbre reference", dialogue: "dialogue-delivery reference", sound: "sound-texture reference", music: "music-style and rhythm reference" }[reference.audioPurpose];
        return `${reference.tag} is the ${role}${identity}; ${reference.purpose}. Reference its audible characteristics without copying the audio signal. Spoken words come only from the planned <d> blocks.`;
    }
    if (reference.subjectTag) return `${reference.subjectTag} is the ${reference.subjectKind || "visual subject"} shown in ${reference.tag}; ${reference.purpose}.`;
    return `${reference.tag} ${reference.purpose}.`;
}
function retentionDefinition(reference: H3ReferenceDefinition) {
    if (reference.audioPurpose) return `${reference.tag}: reference for ${reference.purpose}; do not copy the original signal or unplanned words.`;
    if (reference.tag === "<Picture 1>") return `${reference.tag}: fully_preserved for chronology, Shot grouping, composition intent, screen direction, and continuity; do not preserve gutters, panel borders, labels, or collage layout.`;
    if (reference.subjectTag) return `${reference.subjectTag} from ${reference.tag}: fully_preserved for ${reference.purpose}.`;
    return `${reference.tag}: weak_reference for ${reference.purpose}.`;
}
function buildSpeakers(sheet: StoryboardSheet, references: H3ReferenceDefinition[]) {
    const subjects = new Map(references.filter((item) => item.assetId && item.subjectTag).map((item) => [item.assetId!, item.subjectTag!]));
    const speakers = new Map<string, H3Speaker>();
    sheet.frames.flatMap((frame) => frame.dialogues || []).forEach((cue) => {
        const key = cue.speakerAssetId || cue.speakerName;
        if (!speakers.has(key)) speakers.set(key, { id: speakers.size + 1, subjectTag: subjects.get(cue.speakerAssetId), audioTags: references.filter((reference) => reference.assetId === cue.speakerAssetId && (reference.audioPurpose === "voice" || reference.audioPurpose === "dialogue")).map((reference) => reference.tag) });
    });
    return speakers;
}
function compileDialogueCue(cue: H3DialogueCue, speakers: Map<string, H3Speaker>) {
    const speaker = speakers.get(cue.speakerAssetId || cue.speakerName);
    if (!speaker || !cue.text.trim()) return "";
    const identity = speaker.subjectTag ? `${speaker.subjectTag} (S${speaker.id})` : `the ${cue.offScreen ? "off-screen" : "on-screen"} speaker (S${speaker.id})`;
    const delivery = promptText(cue.delivery) || "in a natural, restrained delivery";
    const audioReference = speaker.audioTags.length ? `, following the vocal characteristics referenced from ${speaker.audioTags.join(" and ")}` : "";
    const action = cue.offScreen ? "says in an off-screen voiceover while all visible characters keep their lips closed" : "speaks on screen with natural, synchronized lip movement";
    return `From ${timestamp(cue.startSeconds)} to ${timestamp(cue.endSeconds)}, ${identity} ${action}, ${delivery}${audioReference}: <d>[${cue.language || (han.test(cue.text) ? "Chinese" : "English")}] ${cue.text}</d>`;
}

function soundCue(value: unknown) {
    const text = String(value || "").trim();
    if (!text || dialogueLike.test(text)) return [];
    if (!han.test(text)) return text.split(/[;,，、；。]+/).map((item) => item.trim()).filter(Boolean);
    const matches: string[] = [];
    const add = (pattern: RegExp, cue: string) => { if (pattern.test(text)) matches.push(cue); };
    add(/风雪|暴风雪|风声|呼啸|寒风/, "steady wind and blowing snow"); add(/雨|雨声|雨滴/, "rainfall"); add(/雷|雷鸣/, "distant thunder");
    add(/脚步|高跟鞋|奔跑/, /高跟鞋/.test(text) ? "sharp high-heel footsteps" : "footsteps"); add(/心跳/, "a restrained heartbeat"); add(/呼吸|喘息|吸气/, "natural breathing");
    add(/衣料|衣服|布料|摩擦/, "soft fabric movement"); add(/纸张|翻页|病历/, "paper rustling"); add(/门铃|铃声/, "a brief bell"); add(/开门|关门|门响/, "a door opening or closing");
    add(/空调|通风|低鸣/, "a low room hum"); add(/脚步声渐远|远去/, "sounds receding into the distance"); add(/低语|耳语/, "low background murmurs"); add(/嘈杂|骚动|惊呼/, "a brief swell of crowd commotion");
    add(/椅子|桌椅/, "chairs scraping and shifting"); add(/碰撞|撞击|闷响|拍板/, "a synchronized physical impact"); add(/玻璃|碎裂|破碎/, "glass breaking"); add(/金属|工牌|玉佩|钥匙|轻响/, "a light hard-object clink");
    add(/火|燃烧|爆炸/, /爆炸/.test(text) ? "a controlled explosion" : "fire crackling"); add(/水声|流水|滴水|点滴/, "soft water drops"); add(/鸟鸣/, "distant birds"); add(/城市|交通/, "distant city ambience");
    add(/手机|拨号/, "a brief phone interaction sound"); add(/咳嗽/, "a natural cough"); add(/笑声|笑/, "brief natural laughter"); add(/哭声|啜泣/, "quiet sobbing"); add(/叹息|呼气/, "a soft exhale"); add(/安静|寂静|静默|无声/, "restrained quiet room tone");
    return unique(matches);
}

function compileLegacySpeech(payload: Record<string, unknown>) {
    const source = String(payload.dialogue || payload.narration || "").trim();
    if (!source) return "";
    return source.split(/\n+/).map((line, index) => {
        const match = line.trim().match(/^([^:：]{1,80})[：:]\s*[「“\"]?([\s\S]*?)[」”\"]?$/);
        const content = match?.[2] || line;
        return `The on-screen speaker (S${index + 1}) says: <d>[${han.test(content) ? "Chinese" : "English"}] ${finishDialogue(content)}</d>.`;
    }).join(" ");
}
function compileTimedSpeech(value: unknown, seconds: number) {
    const line = String(value || "").trim(); if (!line) return "";
    const match = line.match(/^([^:：]{1,80})[：:]\s*[「“\"]?([\s\S]*?)[」”\"]?$/); const content = match?.[2] || line.replace(/^[「“\"]|[」”\"]$/g, "");
    return `At ${timestamp(seconds)}, the on-screen speaker says exactly: <d>[${han.test(content) ? "Chinese" : "English"}] ${finishDialogue(content)}</d>`;
}
function hasDialogue(payload: Record<string, unknown>, sheet: StoryboardSheet) { return Boolean(promptText(payload.dialogue || payload.narration)) || sheet.frames.some((frame) => promptText(frame.dialogue) || (frame.dialogues || []).length); }
function estimatedSpeechSeconds(text: string) { return han.test(text) ? Math.max(0.8, text.replace(/\s/g, "").length / 4) : Math.max(0.8, text.trim().split(/\s+/).length / 2.5); }
function finishDialogue(text: string) { const clean = text.trim().replace(/^[「“\"]|[」”\"]$/g, ""); return /[。！？.!?]$/.test(clean) ? clean : `${clean}${han.test(clean) ? "。" : "."}`; }
function cameraDescription(angle: unknown, move: unknown) { const parts = [promptText(angle), promptText(move)].filter(Boolean); return parts.length ? `Camera: ${parts.join(", ")}` : ""; }
function normalizedCamera(value: unknown) { return promptText(value).toLowerCase().replace(/[\s,，、;；]+/g, " "); }
function promptText(value: unknown) { return String(value || "").trim(); }
function isLikelyLabel(value: string) { return value.length <= 40 && /[·•]/.test(value) && !/[，。；：,.!?]/.test(value); }
function truncate(value: string, length: number) { return value.length > length ? `${value.slice(0, length)}…` : value; }
function unique(values: string[]) { return [...new Set(values)]; }
function joinNatural(values: string[]) { return values.length < 2 ? values[0] || "" : `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`; }
function timestamp(seconds: number) { const millis = Math.max(0, Math.round(seconds * 1000)); return `${String(Math.floor(millis / 60000)).padStart(2, "0")}:${String(Math.floor(millis / 1000) % 60).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`; }
