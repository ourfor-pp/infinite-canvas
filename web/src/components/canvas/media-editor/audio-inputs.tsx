import { audioDefaults, audioReferenceRules, type AudioContract, type AudioField } from "../../../../../server/src/audio-contract";
import type { MediaEditorDraft, MediaEditorReference } from "./types";

const operationLabels: Record<string, string> = { generate: "生成", clone: "声音克隆", transform: "调整声音", extend: "续接", inpaint: "局部修改", cover: "翻唱", remix: "重新编曲" };
const inputClass = "h-9 w-full rounded-lg border border-current/15 bg-transparent px-2 text-xs outline-none focus:border-current/40";
export function AudioInputs({ contract, draft, references, onChange }: { contract: AudioContract; draft: MediaEditorDraft; references: MediaEditorReference[]; onChange: (patch: Partial<MediaEditorDraft>) => void }) {
    const operation = draft.operation || contract.operations[0];
    const rules = audioReferenceRules(contract, operation);
    const fields = contract.fields.filter((field) => (!field.operations || field.operations.includes(operation)) && (!field.referenceRole || draft.params[field.key] !== undefined || references.some((ref) => draft.referenceInputs?.[ref.id]?.role === field.referenceRole)));
    const renderField = (field: AudioField) => {
        const value = draft.params[field.key] ?? field.default ?? "";
        const change = (value: unknown) => {
            const params = { ...draft.params, [field.key]: value };
            if (value === "" && !field.required) delete params[field.key];
            onChange({ params });
        };
        return <label key={field.key} className={`flex min-w-0 flex-col gap-1.5 text-xs ${field.type === "textarea" ? "col-span-2" : ""}`}><span className="opacity-65">{field.label}{field.required ? " *" : ""}</span>
            {field.type === "select" ? <select aria-label={field.label} className={inputClass} value={String(value)} onChange={(event) => change(event.target.value)}>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                : field.type === "textarea" ? <textarea aria-label={field.label} className={`${inputClass} h-16 resize-y py-2`} value={String(value)} onChange={(event) => change(event.target.value)} />
                    : <input aria-label={field.label} className={inputClass} type={field.type} min={field.min} max={field.max} step={field.step} value={String(value)} onChange={(event) => change(field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />}
        </label>;
    };
    return <div className="mt-3 space-y-3">
        {contract.operations.length > 1 ? <label className="flex items-center gap-3 text-xs"><span className="opacity-65">操作</span><select aria-label="音频操作" className={`${inputClass} max-w-40`} value={operation} onChange={(event) => {
            const operation = event.target.value;
            const params = { ...audioDefaults(contract, operation), ...draft.params };
            for (const field of contract.fields) if (field.operations && !field.operations.includes(operation)) delete params[field.key];
            if (operation === "extend") params.inpaintStart = (references[0]?.durationMs || 0) / 1000;
            onChange({ operation, params });
        }}>{contract.operations.map((item) => <option key={item} value={item}>{operationLabels[item] || item}</option>)}</select></label> : null}
        {rules.length ? <div className="text-xs opacity-60">{rules.map((rule) => `${rule.label}${rule.required ? "（必需）" : "（可选）"}${rule.maxSeconds ? `，最长 ${rule.maxSeconds} 秒` : ""}`).join("；")}</div> : null}
        {references.map((reference) => {
            const input = draft.referenceInputs?.[reference.id] || {};
            const role = input.role || "reference";
            const rule = rules.find((item) => item.role === role);
            const change = (patch: { role?: "reference" | "emotion"; transcript?: string }) => onChange({ referenceInputs: { ...draft.referenceInputs, [reference.id]: { ...input, ...patch } } });
            return <div key={reference.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="max-w-48 truncate" title={reference.label}>{reference.label}</span>{rules.length > 1 ? <select aria-label={`${reference.label}用途`} className={`${inputClass} max-w-32`} value={role} onChange={(event) => change({ role: event.target.value as "reference" | "emotion" })}>{rules.map((item) => <option key={item.role} value={item.role}>{item.label}</option>)}</select> : null}{rule?.transcript ? <input aria-label={`${reference.label}参考文字`} className={`${inputClass} min-w-48 flex-1`} placeholder="参考音频对应文字（可选）" value={input.transcript || ""} onChange={(event) => change({ transcript: event.target.value })} /> : null}</div>;
        })}
        <div className="grid grid-cols-2 gap-3">{fields.filter((field) => !field.advanced).map(renderField)}</div>
        {fields.some((field) => field.advanced) ? <details className="text-xs"><summary className="cursor-pointer opacity-60">更多参数</summary><div className="mt-3 grid grid-cols-2 gap-3">{fields.filter((field) => field.advanced).map(renderField)}</div></details> : null}
        <div className="text-[11px] opacity-45">输出格式：{contract.outputFormats.join(" / ").toUpperCase()}</div>
    </div>;
}
