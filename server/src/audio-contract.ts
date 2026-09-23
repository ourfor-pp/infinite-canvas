/** Public, credential-free audio input contracts shared by canvas and server. */
export type AudioField = { key: string; label: string; type: "text" | "textarea" | "number" | "select"; default?: string | number; required?: boolean; min?: number; max?: number; step?: number; options?: string[]; advanced?: boolean; referenceRole?: string; operations?: string[] };
export type AudioReferenceRule = { role: "reference" | "emotion"; label: string; required?: boolean; transcript?: boolean; maxSeconds?: number };
export type AudioContract = { version: 1; mode: "speech" | "music" | "sfx" | "ambient"; promptLabel: string; operations: string[]; fields: AudioField[]; references: AudioReferenceRule[]; referencesFor?: string[]; outputFormats: string[] };
export type AudioReferenceInput = { role?: string; transcript?: string; kind?: string; durationMs?: number };
const languages = ["Auto", "Chinese", "English", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"];
const speakers = ["Vivian", "Serena", "Ryan", "Aiden", "Dylan", "Eric", "Ono_Anna", "Sohee", "Uncle_Fu"];
const select = (key: string, label: string, options: string[], value = options[0]): AudioField => ({ key, label, type: "select", options, default: value });
const number = (key: string, label: string, value: number, min: number, max: number, step = 1): AudioField => ({ key, label, type: "number", default: value, min, max, step });
const instructions: AudioField = { key: "instructions", label: "声音描述", type: "textarea" };
const seed: AudioField = { key: "seed", label: "随机种子（留空随机）", type: "number", min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, advanced: true };
const reference: AudioReferenceRule = { role: "reference", label: "音色参考", required: true, transcript: true };

export function audioContractFor(model: { id: string; endpoint?: string; voices?: string[]; languages?: string[] }): AudioContract | undefined {
    const base: AudioContract = { version: 1, mode: "speech", promptLabel: "朗读文本", operations: ["generate"], fields: [], references: [], outputFormats: ["wav"] };
    const language = select("language", "语言", model.languages?.length ? model.languages : languages);
    if (model.id.startsWith("qwen3-tts-")) {
        if (model.id.includes("customvoice")) return { ...base, fields: [select("speaker", "音色", model.voices?.length ? model.voices : speakers), language, instructions, seed] };
        if (model.id.includes("voicedesign")) return { ...base, fields: [{ ...instructions, label: "音色描述", required: true }, language, seed] };
        if (model.id.includes("base")) return { ...base, operations: ["clone"], fields: [language, seed], references: [reference] };
    }
    if (model.id === "indextts-2.5-local") return { ...base, operations: ["clone"], references: [{ ...reference, transcript: false, maxSeconds: 15 }, { role: "emotion", label: "情绪参考", maxSeconds: 15 }], fields: [select("language", "语言", ["ZH", "EN", "JA", "ES", "AR"]), number("durationFactor", "时长倍率", 1, .5, 2, .05), { ...number("emotionStrength", "情绪强度", 1, 0, 1, .05), default: undefined, referenceRole: "emotion" }, { ...number("intervalSilence", "句间停顿（毫秒）", 200, 0, 2000), advanced: true }, seed] };
    if (model.id === "voxcpm2-local") return { ...base, operations: ["generate", "clone"], references: [{ ...reference, transcript: false }], referencesFor: ["clone"], fields: [instructions, { ...number("steps", "采样步数", 10, 4, 50), advanced: true }, { ...number("cfgValue", "引导强度", 2, 1, 5, .1), advanced: true }, seed] };
    if (model.id === "minimax-music3-local" || model.id === "ace-step-v15-xl-sft-local") return { ...base, mode: "music", outputFormats: model.id === "minimax-music3-local" ? ["flac"] : ["wav"], promptLabel: "音乐描述", operations: model.id.startsWith("ace-") ? ["generate", "cover", "remix"] : ["generate"], references: model.id.startsWith("ace-") ? [{ role: "reference", label: "参考音乐", required: true }] : [], referencesFor: ["cover", "remix"], fields: [number("seconds", "时长（秒）", 30, 1, 300), { key: "lyrics", label: "歌词（留空生成纯音乐）", type: "textarea", default: "" }, seed] };
    if (model.id === "moss-soundeffect-v2-local") return { ...base, mode: "sfx", promptLabel: "音效描述", fields: [number("seconds", "时长（秒）", 10, 1, 30), seed] };
    if (model.id === "stable-audio-3-medium-local") return { ...base, mode: "sfx", promptLabel: "声音描述", operations: ["generate", "transform", "extend", "inpaint"], references: [{ role: "reference", label: "参考音频", required: true }], referencesFor: ["transform", "extend", "inpaint"], fields: [number("seconds", "时长（秒）", 30, 1, 300), { ...number("strength", "变化强度", .6, 0, 1, .05), operations: ["transform"] }, { ...number("inpaintStart", "编辑起点（秒）", 0, 0, 300), operations: ["extend", "inpaint"] }, { ...number("inpaintEnd", "编辑终点（秒）", 30, 0, 300), operations: ["extend", "inpaint"] }, seed] };
    if (model.endpoint === "openai-tts") return { ...base, outputFormats: ["mp3", "wav", "opus", "aac", "flac"], fields: [select("voice", "音色", model.voices?.length ? model.voices : model.id === "tts-1" || model.id === "tts-1-hd" ? ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] : ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"]), select("format", "格式", ["mp3", "wav", "opus", "aac", "flac"]), number("speed", "语速", 1, .25, 4, .05), ...(model.id === "tts-1" || model.id === "tts-1-hd" ? [] : [instructions])] };
    if (model.endpoint === "gemini-audio") return { ...base, outputFormats: ["wav"], fields: [select("voice", "音色", model.voices?.length ? model.voices : ["Kore", "Puck", "Charon", "Fenrir", "Aoede"])] };
}

export function audioDefaults(contract: AudioContract, operation = contract.operations[0]): Record<string, unknown> {
    return Object.fromEntries(contract.fields.filter((field) => field.default !== undefined && (!field.operations || field.operations.includes(operation))).map((field) => [field.key, field.default]));
}
export function audioReferenceRules(contract: AudioContract, operation: string) {
    return !contract.referencesFor || contract.referencesFor.includes(operation) ? contract.references : [];
}
export function validateAudioInput(contract: AudioContract, prompt: string, params: Record<string, unknown>, references: AudioReferenceInput[], operation = contract.operations[0]): string[] {
    const errors: string[] = [];
    if (!prompt.trim()) errors.push(`请填写${contract.promptLabel}`);
    if (!contract.operations.includes(operation)) errors.push("当前模型不支持所选操作");
    const known = new Set(contract.fields.map((field) => field.key));
    if (Object.keys(params).some((key) => !known.has(key))) errors.push("包含当前模型不支持的参数，请重新选择模型");
    for (const field of contract.fields) {
        if (field.operations && !field.operations.includes(operation)) {
            if (params[field.key] !== undefined) errors.push(`${field.label}不适用于当前操作`);
            continue;
        }
        const value = params[field.key] ?? field.default;
        if (field.referenceRole && value !== undefined && value !== "" && !references.some((ref) => ref.role === field.referenceRole)) errors.push(`${field.label}需要对应的参考音频`);
        if (value === undefined || value === "") { if (field.required) errors.push(`请填写${field.label}`); continue; }
        if (field.type === "number") {
            if (typeof value !== "number" || !Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max) || (field.step === 1 && !Number.isInteger(value))) errors.push(`${field.label}超出允许范围`);
        } else if (typeof value !== "string" || (field.required && !value.trim()) || (field.options && !field.options.includes(value))) errors.push(`${field.label}无效`);
    }
    const rules = audioReferenceRules(contract, operation);
    for (const rule of rules) {
        const matches = references.filter((ref) => (ref.role || "reference") === rule.role);
        if (rule.required && !matches.length) errors.push(`请添加${rule.label}`);
        if (matches.length > 1) errors.push(`${rule.label}只能添加一段`);
        if (rule.maxSeconds && matches.some((ref) => ref.durationMs !== undefined && ref.durationMs > rule.maxSeconds! * 1000)) errors.push(`${rule.label}不能超过 ${rule.maxSeconds} 秒`);
    }
    if (references.some((ref) => (ref.kind && ref.kind !== "audio") || !rules.some((rule) => rule.role === (ref.role || "reference")))) errors.push("存在当前模型或操作不支持的参考，请先移除");
    if (["extend", "inpaint"].includes(operation) && Number(params.inpaintEnd) <= Number(params.inpaintStart)) errors.push("编辑终点必须晚于起点");
    return errors;
}
