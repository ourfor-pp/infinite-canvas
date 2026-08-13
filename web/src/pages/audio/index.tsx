import { useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, Select, Segmented, Slider, Upload, message } from "antd";
import { AudioLines, CircleStop, Download, Music2, Sparkles, UploadCloud, Waves } from "lucide-react";

import { generationFiles, runServerGeneration } from "@/services/api/ai-generation";
import { serverApi, uploadServerFile, type AiGlobalSettings, type AudioMode, type AudioOperation, type PublicAiModel } from "@/services/api/server";

const modes: Array<{ value: AudioMode; label: string; description: string }> = [
    { value: "speech", label: "语音", description: "旁白、对白与参考声音克隆" },
    { value: "ambient", label: "环境声", description: "自然环境与空间氛围" },
    { value: "sfx", label: "音效", description: "动作、物件与短促声音" },
    { value: "music", label: "音乐", description: "完整音乐、Cover 与 Remix" },
];
const operationLabels: Record<AudioOperation, string> = { generate: "从文字生成", clone: "声音克隆", transform: "音频变换", extend: "续写", inpaint: "局部重绘", cover: "Cover", remix: "Remix" };

export default function AudioPage() {
    const [models, setModels] = useState<PublicAiModel[]>([]);
    const [audioDefaults, setAudioDefaults] = useState<AiGlobalSettings["audioDefaults"] | null>(null);
    const [mode, setMode] = useState<AudioMode>("speech");
    const [operation, setOperation] = useState<AudioOperation>("generate");
    const [model, setModel] = useState("");
    const [prompt, setPrompt] = useState("");
    const [instructions, setInstructions] = useState("");
    const [lyrics, setLyrics] = useState("");
    const [language, setLanguage] = useState("Auto");
    const [speaker, setSpeaker] = useState("Vivian");
    const [seconds, setSeconds] = useState(10);
    const [strength, setStrength] = useState(.6);
    const [inpaintStart, setInpaintStart] = useState(0);
    const [inpaintEnd, setInpaintEnd] = useState(10);
    const [reference, setReference] = useState<{ fileId: string; name: string } | null>(null);
    const [referenceTranscript, setReferenceTranscript] = useState("");
    const [result, setResult] = useState<{ url: string; name: string } | null>(null);
    const [running, setRunning] = useState(false);
    const [controller, setController] = useState<AbortController | null>(null);

    useEffect(() => { void Promise.all([serverApi.aiModels(), serverApi.aiGlobalSettings()]).then(([items, settings]) => { const audioModels = items.filter((item) => item.output === "audio"); setModels(audioModels); setAudioDefaults(settings.audioDefaults); setModel(settings.audioDefaults.speech.generate || audioModels.find((item) => (item.audioModes || ["speech"]).includes("speech"))?.value || ""); }).catch((error) => message.error(error instanceof Error ? error.message : "读取模型失败")); }, []);
    const compatible = useMemo(() => models.filter((item) => (item.audioModes || ["speech"]).includes(mode)), [models, mode]);
    const operations = useMemo(() => Array.from(new Set(compatible.flatMap((item) => item.audioOperations || ["generate"]))) as AudioOperation[], [compatible]);
    const selected = compatible.find((item) => item.value === model) || compatible.find((item) => (item.audioOperations || ["generate"]).includes(operation));
    const effectiveModel = selected?.value || "";
    const effectiveOperation = operations.includes(operation) ? operation : operations[0] || "generate";
    const needsReference = ["clone", "transform", "extend", "inpaint", "cover", "remix"].includes(effectiveOperation);

    const changeMode = (value: AudioMode) => {
        setMode(value);
        const candidates = models.filter((item) => (item.audioModes || ["speech"]).includes(value));
        const nextOperation = (candidates.flatMap((item) => item.audioOperations || ["generate"])[0] || "generate") as AudioOperation;
        setOperation(nextOperation);
        setModel(audioDefaults?.[value]?.[nextOperation] || candidates.find((item) => (item.audioOperations || ["generate"]).includes(nextOperation))?.value || "");
        setResult(null);
    };
    const generate = async () => {
        if (!effectiveModel || !prompt.trim()) return message.warning("请先选择可用模型并填写生成描述");
        if (needsReference && !reference) return message.warning("当前操作需要参考音频");
        const abort = new AbortController();
        setController(abort); setRunning(true); setResult(null);
        try {
            const generation = await runServerGeneration({ kind: "audio", model: effectiveModel, prompt: prompt.trim(), references: reference ? [{ fileId: reference.fileId, kind: "audio", transcript: referenceTranscript.trim() || undefined }] : [], params: { audioMode: mode, audioOperation: effectiveOperation, instructions: instructions.trim(), lyrics: lyrics.trim(), language, speaker, seconds, strength, inpaintStart, inpaintEnd } }, { signal: abort.signal });
            const file = generationFiles(generation)[0];
            if (!file) throw new Error("任务没有返回音频文件");
            setResult({ url: file.url, name: file.name || `${mode}.wav` });
        } catch (error) { if (!abort.signal.aborted) message.error(error instanceof Error ? error.message : "生成失败"); }
        finally { setRunning(false); setController(null); }
    };

    return <main className="h-full overflow-y-auto bg-background">
        <div className="mx-auto grid min-h-full max-w-7xl gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="min-w-0">
                <div className="mb-10 flex items-start justify-between gap-6">
                    <div><div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[.2em] text-stone-400"><AudioLines className="size-4" /> Audio studio</div><h1 className="text-3xl font-semibold tracking-tight">把声音做成作品的一部分</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">语音、环境、音效和音乐共享同一条可靠的本地生成链路。</p></div>
                </div>
                <Segmented block value={mode} onChange={(value) => changeMode(value as AudioMode)} options={modes.map((item) => ({ value: item.value, label: item.label, disabled: !models.some((model) => (model.audioModes || ["speech"]).includes(item.value)) }))} />
                {!compatible.length ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">当前声音模式没有已部署且在线的模型，请联系管理员完成运行时部署。</div> : null}
                <div className="mt-8 grid gap-6 md:grid-cols-2">
                    <label className="block"><span className="mb-2 block text-sm font-medium">生成方式</span><Select className="w-full" value={effectiveOperation} options={operations.map((value) => ({ value, label: operationLabels[value] }))} onChange={(value) => { setOperation(value); setModel(compatible.find((item) => (item.audioOperations || ["generate"]).includes(value))?.value || ""); }} /></label>
                    <label className="block"><span className="mb-2 block text-sm font-medium">模型</span><Select className="w-full" value={effectiveModel || undefined} placeholder="当前模式没有可用模型" options={compatible.filter((item) => (item.audioOperations || ["generate"]).includes(effectiveOperation)).map((item) => ({ value: item.value, label: `${item.name} · ${item.providerName}` }))} onChange={setModel} /></label>
                </div>
                <label className="mt-6 block"><span className="mb-2 block text-sm font-medium">{mode === "speech" ? "台词" : mode === "music" ? "音乐描述" : "声音描述"}</span><Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 5, maxRows: 12 }} placeholder={mode === "speech" ? "输入要说的内容…" : mode === "music" ? "例如：克制的电影配乐，缓慢弦乐与孤独钢琴…" : "描述声音主体、空间、远近和节奏…"} /></label>
                {mode === "music" ? <label className="mt-6 block"><span className="mb-2 block text-sm font-medium">歌词（可选）</span><Input.TextArea value={lyrics} onChange={(event) => setLyrics(event.target.value)} autoSize={{ minRows: 4, maxRows: 10 }} /></label> : null}
                <label className="mt-6 block"><span className="mb-2 block text-sm font-medium">{mode === "speech" ? "声音指令" : "补充要求"}</span><Input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="情绪、质感、速度或需要避免的内容" /></label>
                <div className="mt-6 grid gap-6 md:grid-cols-3">
                    {mode === "speech" ? <><label><span className="mb-2 block text-sm font-medium">语言</span><Select className="w-full" value={language} options={(selected?.languages || ["Auto"]).map((value) => ({ value, label: value }))} onChange={setLanguage} /></label>{effectiveOperation === "generate" ? <label><span className="mb-2 block text-sm font-medium">音色</span><Select className="w-full" value={speaker} options={(selected?.voices || ["Vivian"]).map((value) => ({ value, label: value }))} onChange={setSpeaker} /></label> : null}</> : <label className="md:col-span-2"><span className="mb-2 block text-sm font-medium">时长 · {seconds} 秒</span><Slider min={1} max={selected?.maxDurationSeconds || (mode === "music" ? 240 : 30)} value={seconds} onChange={setSeconds} /></label>}
                </div>
                {needsReference ? <div className="mt-8 rounded-xl border border-dashed border-stone-300 p-5 dark:border-stone-700"><Upload accept="audio/*" maxCount={1} showUploadList={false} customRequest={({ file, onSuccess, onError }) => { void uploadServerFile(file as Blob, (file as File).name).then((uploaded) => { setReference({ fileId: uploaded.fileId, name: uploaded.name }); onSuccess?.(uploaded); }).catch(onError); }}><Button type="text" icon={<UploadCloud className="size-4" />}>{reference?.name || "选择参考音频"}</Button></Upload>{mode === "speech" ? <Input className="mt-3" value={referenceTranscript} onChange={(event) => setReferenceTranscript(event.target.value)} placeholder="参考音频对应文本（填写后克隆更准确）" /> : null}</div> : null}
                {effectiveOperation === "transform" || effectiveOperation === "remix" ? <label className="mt-6 block"><span className="mb-2 block text-sm font-medium">参考保留强度 · {strength.toFixed(2)}</span><Slider min={0} max={1} step={.05} value={strength} onChange={setStrength} /></label> : null}
                {effectiveOperation === "inpaint" ? <div className="mt-6 grid gap-4 md:grid-cols-2"><label><span className="mb-2 block text-sm font-medium">重绘开始（秒）</span><InputNumber className="w-full" min={0} max={seconds} value={inpaintStart} onChange={(value) => setInpaintStart(Number(value) || 0)} /></label><label><span className="mb-2 block text-sm font-medium">重绘结束（秒）</span><InputNumber className="w-full" min={inpaintStart} max={seconds} value={inpaintEnd} onChange={(value) => setInpaintEnd(Number(value) || seconds)} /></label></div> : null}
                <div className="mt-8 flex gap-3"><Button type="primary" size="large" loading={running} disabled={!effectiveModel} icon={<Sparkles className="size-4" />} onClick={() => void generate()}>开始生成</Button>{running ? <Button size="large" icon={<CircleStop className="size-4" />} onClick={() => controller?.abort()}>停止</Button> : null}</div>
            </section>
            <aside className="min-h-[420px] rounded-2xl border border-stone-200 bg-stone-50/70 p-6 dark:border-stone-800 dark:bg-stone-900/30">
                <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900">{mode === "music" ? <Music2 className="size-5" /> : <Waves className="size-5" />}</div><div><h2 className="font-medium">{modes.find((item) => item.value === mode)?.label}</h2><p className="text-xs text-stone-500">{modes.find((item) => item.value === mode)?.description}</p></div></div>
                <div className="mt-8 flex min-h-72 items-center justify-center rounded-xl bg-background px-5 text-center">{result ? <div className="w-full"><audio className="w-full" controls src={result.url} /><a className="mt-5 inline-flex items-center gap-2 text-sm" href={result.url} download={result.name}><Download className="size-4" />下载结果</a></div> : <p className="max-w-56 text-sm leading-6 text-stone-400">生成结果会在这里出现，并自动保存到服务端生成记录。</p>}</div>
            </aside>
        </div>
    </main>;
}
