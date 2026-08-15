import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Input, Radio } from "antd";
import { ChevronLeft, ChevronRight, LoaderCircle, Pencil, ShieldAlert, X } from "lucide-react";

import type { AgentDecisionQuestion, AgentPendingDecision } from "@/services/api/agent";

type Decide = (decision: "approved" | "rejected", scope?: "once" | "session" | "project", proposalEdits?: unknown, answers?: Record<string, string>) => Promise<unknown>;
type Draft = { selected: string[]; custom: string };

function recommendedLabel(label: string) {
    const recommended = /(?: \(Recommended\)|（推荐）)$/.test(label);
    return { recommended, label: label.replace(/(?: \(Recommended\)|（推荐）)$/, "") };
}

function orderedOptions(question: AgentDecisionQuestion) {
    return question.options.map((option, index) => ({ option, index, recommended: recommendedLabel(option.label).recommended }))
        .sort((left, right) => Number(right.recommended) - Number(left.recommended) || left.index - right.index)
        .map(({ option }) => option);
}

function answerMap(questions: AgentDecisionQuestion[], drafts: Draft[]) {
    return Object.fromEntries(questions.flatMap((question, index) => {
        const draft = drafts[index] || { selected: [], custom: "" };
        const answer = draft.custom.trim() || draft.selected.join("、");
        return answer ? [[question.id || `q${index + 1}`, answer]] : [];
    }));
}

export function AgentQuestionComposer({ pending, busy, onDecide }: { pending: AgentPendingDecision; busy: boolean; onDecide: Decide }) {
    const questions = pending.questions || [];
    const [index, setIndex] = useState(0);
    const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ selected: [], custom: "" })));
    const [submitting, setSubmitting] = useState(false);
    const timerRef = useRef<number | null>(null);
    const question = questions[index];
    const draft = drafts[index] || { selected: [], custom: "" };
    const disabled = busy || submitting;
    const last = index >= questions.length - 1;
    const options = useMemo(() => question ? orderedOptions(question) : [], [question]);

    useEffect(() => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        setIndex(0);
        setDrafts(questions.map(() => ({ selected: [], custom: "" })));
    }, [pending.id]);
    useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
    useEffect(() => {
        const cancel = (event: KeyboardEvent) => { if (event.key === "Escape" && !disabled) cancelAnswering(); };
        document.addEventListener("keydown", cancel);
        return () => document.removeEventListener("keydown", cancel);
    });

    const clearAdvance = () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = null;
    };
    const navigateTo = (next: number) => {
        if (disabled) return;
        clearAdvance();
        setIndex(Math.min(Math.max(next, 0), questions.length - 1));
    };
    const update = (next: Draft) => setDrafts((current) => current.map((value, draftIndex) => draftIndex === index ? next : value));
    const respond = async (decision: "approved" | "rejected", nextDrafts = drafts) => {
        if (disabled) return;
        setSubmitting(true);
        try { await onDecide(decision, "once", undefined, decision === "approved" ? answerMap(questions, nextDrafts) : undefined); }
        catch { /* 上层负责提示；这里保留答案供用户重试。 */ }
        finally { setSubmitting(false); }
    };
    const cancelAnswering = () => { clearAdvance(); void respond("rejected"); };
    const advance = (nextDrafts = drafts) => last ? void respond("approved", nextDrafts) : navigateTo(index + 1);
    const chooseSingle = (value: string) => {
        if (disabled || timerRef.current) return;
        const next = drafts.map((item, draftIndex) => draftIndex === index ? { selected: [value], custom: "" } : item);
        setDrafts(next);
        timerRef.current = window.setTimeout(() => { timerRef.current = null; advance(next); }, 180);
    };

    if (!question) return <section className="agent-question-card"><header><strong>提问内容无效</strong><button type="button" aria-label="取消回答" onClick={cancelAnswering}><X className="size-4" /></button></header><p>Agent 没有返回可回答的问题，请取消后重新发起。</p><footer><Button onClick={cancelAnswering}>取消本次提问</Button></footer></section>;

    const textQuestion = !options.length;
    const multiple = question.type === "multiple_choice";
    const allowCustomInput = question.allowCustomInput !== false;
    const canAdvance = Boolean(draft.custom.trim() || draft.selected.length);
    return <section className="agent-question-card" aria-label="Agent 提问">
        <header>
            <div><strong>{question.question || question.header || `问题 ${index + 1}`}</strong></div>
            <nav aria-label="问题导航">
                {questions.length > 1 ? <><button type="button" aria-label="上一个问题" disabled={disabled || index === 0} onClick={() => navigateTo(index - 1)}><ChevronLeft className="size-4" /></button><span>{index + 1} / {questions.length}</span><button type="button" aria-label="下一个问题" disabled={disabled || last} onClick={() => navigateTo(index + 1)}><ChevronRight className="size-4" /></button></> : null}
                <button type="button" aria-label="取消回答" disabled={disabled} onClick={cancelAnswering}><X className="size-4" /></button>
            </nav>
        </header>
        <div className="agent-question-body thin-scrollbar">
            {!textQuestion ? multiple ? <Checkbox.Group value={draft.selected} disabled={disabled} className="agent-question-options">{options.map((option, optionIndex) => { const normalized = recommendedLabel(option.label); return <Checkbox key={option.label} value={option.label} onChange={(event) => update({ custom: "", selected: event.target.checked ? Array.from(new Set([...draft.selected, option.label])) : draft.selected.filter((value) => value !== option.label) })}><Option index={optionIndex} label={normalized.label} description={option.description} recommended={normalized.recommended} /></Checkbox>; })}</Checkbox.Group> : <Radio.Group value={draft.selected[0]} disabled={disabled} className="agent-question-options" onChange={(event) => chooseSingle(String(event.target.value))}>{options.map((option, optionIndex) => { const normalized = recommendedLabel(option.label); return <Radio key={option.label} value={option.label} onClick={() => { if (draft.selected[0] === option.label) chooseSingle(option.label); }}><Option index={optionIndex} label={normalized.label} description={option.description} recommended={normalized.recommended} /></Radio>; })}</Radio.Group> : null}
            {allowCustomInput ? textQuestion ? <Input.TextArea autoFocus value={draft.custom} disabled={disabled} autoSize={{ minRows: 3, maxRows: 7 }} placeholder={question.customInputPlaceholder || "请输入你的答案"} aria-label={question.question} onChange={(event) => update({ selected: [], custom: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.custom.trim()) { event.preventDefault(); advance(); } }} /> : <div className={`agent-question-custom ${multiple ? "without-action" : ""}`}><Pencil className="size-3.5" /><Input variant="borderless" value={draft.custom} disabled={disabled} placeholder={question.customInputPlaceholder || "如果选项都不合适，请在这里补充"} aria-label="其他答案" onChange={(event) => update({ selected: [], custom: event.target.value })} onPressEnter={() => { if (draft.custom.trim()) advance(); }} />{!multiple ? <Button size="small" disabled={disabled} onClick={() => draft.custom.trim() ? advance() : advance(drafts.map((item, draftIndex) => draftIndex === index ? { selected: [], custom: "" } : item))}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}{draft.custom.trim() ? last ? "提交" : "继续" : "跳过"}</Button> : null}</div> : null}
            {!textQuestion && !allowCustomInput && !multiple ? <div className="agent-question-inline-actions"><Button type="text" size="small" disabled={disabled} onClick={() => advance(drafts.map((item, draftIndex) => draftIndex === index ? { selected: [], custom: "" } : item))}>跳过</Button></div> : null}
        </div>
        {(textQuestion || multiple) ? <footer><Button type="text" disabled={disabled} onClick={() => advance(drafts.map((item, draftIndex) => draftIndex === index ? { selected: [], custom: "" } : item))}>跳过本题</Button><Button type="primary" disabled={disabled || !canAdvance} onClick={() => advance()}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}{last ? "提交" : "继续"}</Button></footer> : null}
    </section>;
}

function Option({ index, label, description, recommended }: { index: number; label: string; description?: string; recommended: boolean }) {
    return <span className="agent-question-option"><i>{index + 1}</i><span><span className="agent-question-option-title"><strong>{label}</strong>{recommended ? <em>推荐</em> : null}</span>{description ? <small className="agent-question-option-description">{description}</small> : null}</span></span>;
}

export function AgentApprovalBar({ pending, busy, onDecide }: { pending: AgentPendingDecision; busy: boolean; onDecide: Decide }) {
    const scopes = pending.scopes?.length ? pending.scopes : ["once" as const];
    return <section className="agent-approval-bar" aria-label="Agent 权限确认">
        <span className="agent-approval-icon"><ShieldAlert className="size-4" /></span>
        <div className="min-w-0 flex-1"><strong>待你决策</strong><p>{pending.content}</p>{pending.toolName ? <small>{pending.toolName}</small> : null}{pending.rulePreview?.length ? <small>记忆规则：{pending.rulePreview.join("；")}</small> : null}</div>
        <div className="agent-approval-actions">
            {scopes.includes("once") ? <Button type="primary" size="small" disabled={busy} onClick={() => void onDecide("approved", "once")}>允许一次</Button> : null}
            {scopes.includes("session") ? <Button size="small" disabled={busy} onClick={() => void onDecide("approved", "session")}>本会话记住</Button> : null}
            {scopes.includes("project") ? <Button size="small" disabled={busy} onClick={() => void onDecide("approved", "project")}>此项目记住</Button> : null}
            <Button size="small" disabled={busy} onClick={() => void onDecide("rejected")}>{scopes.length > 1 ? "拒绝本次请求" : "拒绝并改方案"}</Button>
        </div>
    </section>;
}
