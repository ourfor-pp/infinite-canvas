import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ComponentRef, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Button, Checkbox, Empty, Image, Input, Popconfirm, Select, Tooltip } from "antd";
import {
    Archive, ArrowDown, AtSign, Brain, Check, ChevronDown, ChevronRight, CircleAlert, Download,
    Clock3, Copy, File, FileAudio, FileText, FileVideo, GitFork, History, ImageIcon,
    LoaderCircle, Paperclip, Search, Send, ShieldAlert, Sparkles, Square, Trash2, Wrench, X,
} from "lucide-react";
import { Streamdown } from "streamdown";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { AgentEvent, AgentPendingDecision, AgentSession, AgentSkill } from "@/services/api/agent";
import { serverApiUrl, type ServerFile } from "@/services/api/server";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type ProjectedEvent = AgentEvent & { text?: string; result?: AgentEvent };
type ConversationItem =
    | { type: "time"; id: string; label: string }
    | { type: "user"; id: string; event: ProjectedEvent }
    | { type: "round"; id: string; events: ProjectedEvent[] };

export function AgentConversationFlow({
    events,
    loading,
    theme,
    canLoadEarlier,
    loadingEarlier,
    onLoadEarlier,
    onSuggestion,
    status,
}: {
    events: AgentEvent[];
    loading: boolean;
    theme: CanvasTheme;
    canLoadEarlier: boolean;
    loadingEarlier: boolean;
    onLoadEarlier: () => void;
    onSuggestion: (text: string) => void;
    status?: AgentSession["status"];
}) {
    const items = useMemo(() => buildConversationItems(events), [events]);
    const latestRoundId = useMemo(() => {
        for (let index = items.length - 1; index >= 0; index -= 1) if (items[index].type === "round") return items[index].id;
        return undefined;
    }, [items]);
    if (loading) return <div className="grid h-full place-items-center"><LoaderCircle className="size-5 animate-spin opacity-45" /></div>;
    if (!items.length) return <AgentEmpty theme={theme} onSuggestion={onSuggestion} />;
    return (
        <div className="space-y-4">
            {canLoadEarlier ? (
                <div className="pb-1 text-center">
                    <Button type="text" size="small" loading={loadingEarlier} onClick={onLoadEarlier}>加载更早消息</Button>
                </div>
            ) : null}
            {items.map((item) => {
                if (item.type === "time") return <div key={item.id} className="flex items-center gap-3 py-1 text-[10px] opacity-35"><span className="h-px flex-1 bg-current" /><time>{item.label}</time><span className="h-px flex-1 bg-current" /></div>;
                if (item.type === "user") return <div key={item.id} style={{ contentVisibility: "auto", containIntrinsicSize: "0 96px" }}><UserMessage event={item.event} theme={theme} /></div>;
                return <div key={item.id} style={{ contentVisibility: "auto", containIntrinsicSize: "0 112px" }}><AssistantRound events={item.events} theme={theme} status={item.id === latestRoundId ? status : "completed"} /></div>;
            })}
        </div>
    );
}

function AgentEmpty({ theme, onSuggestion }: { theme: CanvasTheme; onSuggestion: (text: string) => void }) {
    const suggestions = ["拆解小说中的角色、场景和道具", "根据选中节点继续创作", "检查画布结构并给出建议"];
    return (
        <div className="flex h-full min-h-[360px] items-center justify-center px-6 text-center">
            <div className="max-w-sm">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl" style={{ background: theme.toolbar.itemHover }}><Sparkles className="size-5" /></div>
                <h3 className="mt-4 text-base font-medium">和画布一起思考</h3>
                <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>
                    Agent 已绑定当前项目，可以理解节点、修改画布并调用生成任务。
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {suggestions.map((item) => <button key={item} type="button" onClick={() => onSuggestion(item)} className="rounded-full border px-3 py-1.5 text-xs transition hover:bg-black/5 dark:hover:bg-white/10" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item}</button>)}
                </div>
            </div>
        </div>
    );
}

const UserMessage = memo(function UserMessage({ event, theme }: { event: ProjectedEvent; theme: CanvasTheme }) {
    const text = eventText(event);
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const long = text.length > 900 || text.split("\n").length > 12;
    const visibleText = long && !expanded && text.length > 4_000 ? `${text.slice(0, 4_000)}\n…` : text;
    const attachments = arrayOf<Record<string, unknown>>(event.payload.attachments);
    const references = arrayOf<Record<string, unknown>>(event.payload.references);
    const assetReferences = arrayOf<Record<string, unknown>>(event.payload.assetReferences);
    const skill = recordOf(event.payload.skill);
    const images = attachments.filter((item) => String(item.mimeType || "").startsWith("image/") && item.fileId);
    const files = attachments.filter((item) => !String(item.mimeType || "").startsWith("image/") || !item.fileId);
    return (
        <div className="flex scroll-mt-4 justify-end pl-10" data-agent-user-seq={event.seq}>
            <article className="group relative max-w-full rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-6" style={{ background: theme.toolbar.itemHover }}>
                {text ? <div className={`whitespace-pre-wrap break-words ${long && !expanded ? "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]" : ""}`}>{visibleText}</div> : null}
                {long ? <button type="button" className="mt-1 text-xs font-medium opacity-55 hover:opacity-80" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开全文"}</button> : null}
                {images.length ? <Image.PreviewGroup><div className="mt-2 grid grid-cols-3 gap-1.5">{images.map((item, index) => <Image key={String(item.fileId || index)} src={fileUrl(String(item.fileId))} alt={String(item.name || "图片附件")} className="!h-20 !w-full rounded-lg object-cover" />)}</div></Image.PreviewGroup> : null}
                {files.length || references.length || assetReferences.length || skill ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {skill?.name ? <MetaChip icon={<Sparkles className="size-3" />} text={`/${skill.name}`} /> : null}
                        {references.map((item, index) => <MetaChip key={`r-${index}`} icon={<AtSign className="size-3" />} text={String(item.title || "画布节点")} />)}
                        {assetReferences.map((item, index) => <MetaChip key={`a-${index}`} icon={<Sparkles className="size-3" />} text={String(item.name || "创作设定")} />)}
                        {files.map((item, index) => item.fileId ? <a key={`f-${index}`} href={fileUrl(String(item.fileId))} target="_blank" rel="noreferrer"><MetaChip icon={<File className="size-3" />} text={String(item.name || "附件")} /></a> : <MetaChip key={`f-${index}`} icon={<File className="size-3" />} text={String(item.name || "附件")} />)}
                    </div>
                ) : null}
                {text ? <Tooltip title={copied ? "已复制" : "复制消息"}><button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); })} className="absolute -bottom-7 right-0 grid size-6 place-items-center rounded-md opacity-0 transition hover:bg-black/5 group-hover:opacity-45 dark:hover:bg-white/10">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button></Tooltip> : null}
            </article>
        </div>
    );
}, (previous, next) => previous.theme === next.theme && previous.event.seq === next.event.seq && previous.event.payload === next.event.payload);

const AssistantRound = memo(function AssistantRound({ events, theme, status }: { events: ProjectedEvent[]; theme: CanvasTheme; status?: AgentSession["status"] }) {
    const process = events.filter((event) => event.kind === "thinking" || event.kind === "tool_call");
    const answers = events.filter((event) => event.kind === "assistant_text");
    const artifacts = events.filter((event) => event.kind === "artifact");
    const errors = events.filter((event) => event.kind === "error");
    const states = events.filter((event) => event.kind === "run_state");
    const latestState = states.at(-1);
    const copyText = answers.map(eventText).filter(Boolean).join("\n\n");
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (!copyText) return;
        await navigator.clipboard.writeText(copyText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
    };
    return (
        <div className="group/round pr-1">
            {process.length ? <ProcessGroup events={process} roundEvents={events} theme={theme} status={status} /> : null}
            <div className="agent-streamdown relative mt-2 text-sm leading-6">
                {answers.map((event) => <Streamdown key={`${event.sessionId}:${event.seq}`} controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }} isAnimating={Boolean(event.payload.delta)}>{eventText(event)}</Streamdown>)}
                {copyText ? <Tooltip title={copied ? "已复制" : "复制回复"}><button type="button" onClick={() => void copy()} className="absolute -bottom-6 left-0 grid size-6 place-items-center rounded-md opacity-0 transition hover:bg-black/5 group-hover/round:opacity-50 dark:hover:bg-white/10">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button></Tooltip> : null}
            </div>
            {artifacts.length ? <ArtifactStrip events={artifacts} theme={theme} /> : null}
            {errors.map((event) => <div key={event.seq} className="mt-3 rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2.5 text-sm text-red-600 dark:text-red-300"><div className="flex items-center gap-2 font-medium"><CircleAlert className="size-4" />{String(event.payload.code || "Agent 执行失败")}</div><div className="mt-1 opacity-80">{eventText(event)}</div></div>)}
            {latestState ? <RunState event={latestState} hasAnswer={answers.length > 0} /> : null}
        </div>
    );
}, (previous, next) => previous.theme === next.theme && previous.status === next.status && roundSignature(previous.events) === roundSignature(next.events));

function ProcessGroup({ events, roundEvents, theme, status }: { events: ProjectedEvent[]; roundEvents: ProjectedEvent[]; theme: CanvasTheme; status?: AgentSession["status"] }) {
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(Date.now());
    const tools = events.filter((event) => event.kind === "tool_call");
    const thinking = events.filter((event) => event.kind === "thinking");
    const terminal = Boolean(status && !["running", "waiting_for_user"].includes(status));
    const running = !terminal && (status === "running" || tools.some((event) => !event.result));
    const failed = tools.some((event) => Boolean(event.result?.payload.isError)) || status === "failed" || status === "canceled";
    const duration = roundDuration(roundEvents, running, now);
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    return (
        <section className="mb-2 text-xs">
            <button type="button" className="flex w-full items-center gap-2 py-1.5 text-left transition hover:opacity-80" style={{ color: theme.node.muted }} onClick={() => setOpen((value) => !value)}>
                <ChevronRight className={`size-3.5 transition ${open ? "rotate-90" : ""}`} />
                {running ? <LoaderCircle className="size-3.5 animate-spin" /> : failed ? <CircleAlert className="size-3.5 text-red-500" /> : <Check className="size-3.5 text-emerald-500" />}
                <span>{running ? "正在执行" : "已完成"}{thinking.length ? ` ${thinking.length} 段思考` : ""}{tools.length ? ` · ${tools.length} 次工具调用` : ""}</span>
                {duration ? <span className="ml-auto tabular-nums opacity-55">本轮 {duration}</span> : null}
            </button>
            {open ? (
                <div className="ml-1.5 border-l pl-3" style={{ borderColor: theme.node.stroke }}>
                    {events.map((event) => event.kind === "thinking"
                        ? <ThinkingStep key={`${event.seq}`} event={event} theme={theme} />
                        : <ToolStep key={`${event.seq}`} event={event} theme={theme} now={now} terminalStatus={terminal ? status : undefined} />)}
                </div>
            ) : null}
        </section>
    );
}

function ThinkingStep({ event, theme }: { event: ProjectedEvent; theme: CanvasTheme }) {
    const [open, setOpen] = useState(false);
    const text = eventText(event).replace(/^思考[：:]\s*/i, "");
    return (
        <div className="py-1.5">
            <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left" style={{ color: theme.node.muted }}>
                <Brain className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{text || "思考过程"}</span><ChevronDown className={`size-3 transition ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? <div className="mt-2 whitespace-pre-wrap break-words pl-5 leading-5 opacity-65">{text}</div> : null}
        </div>
    );
}

function ToolStep({ event, theme, now, terminalStatus }: { event: ProjectedEvent; theme: CanvasTheme; now: number; terminalStatus?: AgentSession["status"] }) {
    const [open, setOpen] = useState(false);
    const failed = Boolean(event.result?.payload.isError);
    const name = toolLabel(String(event.payload.toolName || "工具"));
    const target = toolTarget(event.payload.input);
    const duration = toolDuration(event, now);
    const settled = Boolean(event.result || terminalStatus);
    const settledFailed = failed || terminalStatus === "failed" || terminalStatus === "canceled";
    return (
        <div className="py-1.5">
            <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left">
                <Wrench className="size-3.5 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate font-medium">{name}{target ? <span className="font-normal opacity-45"> · {target}</span> : null}</span>
                {duration ? <span className="tabular-nums opacity-40">{duration}</span> : null}
                {settled ? settledFailed ? <CircleAlert className="size-3.5 text-red-500" /> : <Check className="size-3.5 text-emerald-500" /> : <LoaderCircle className="size-3.5 animate-spin opacity-45" />}
                <ChevronDown className={`size-3 opacity-40 transition ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? <div className="mt-2 space-y-2 pl-5"><CodeBlock label="输入" value={event.payload.input} theme={theme} />{event.result ? <CodeBlock label={failed ? "错误" : "结果"} value={event.result.payload.output} theme={theme} /> : null}</div> : null}
        </div>
    );
}

function CodeBlock({ label, value, theme }: { label: string; value: unknown; theme: CanvasTheme }) {
    const [copied, setCopied] = useState(false);
    const text = formatUnknown(value);
    return <div><div className="mb-1 flex items-center justify-between text-[10px] font-medium opacity-40"><span>{label}</span><button type="button" className="flex items-center gap-1 hover:opacity-80" onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); })}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制"}</button></div><pre className="thin-scrollbar max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg p-2 text-[11px] leading-5" style={{ background: theme.toolbar.itemHover }}>{text}</pre></div>;
}

function ArtifactStrip({ events, theme }: { events: ProjectedEvent[]; theme: CanvasTheme }) {
    const images = events.filter((event) => String(event.payload.mimeType || "").startsWith("image/"));
    const files = events.filter((event) => !String(event.payload.mimeType || "").startsWith("image/"));
    return (
        <div className="mt-4 space-y-2">
            {images.length ? <Image.PreviewGroup><div className="grid grid-cols-2 gap-2">{images.map((event) => <div key={event.seq} className="group/artifact relative overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }}><Image preview src={String(event.payload.url)} alt={String(event.payload.title || "Agent 产物")} className="!h-32 !w-full object-cover" /><span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/45 px-2 py-1 text-[11px] text-white">{String(event.payload.title || event.payload.name || "图片产物")}</span><a href={String(event.payload.url || "#")} download className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg bg-black/45 text-white opacity-0 transition group-hover/artifact:opacity-100" title="下载产物"><Download className="size-3.5" /></a></div>)}</div></Image.PreviewGroup> : null}
            {files.map((event) => <a key={event.seq} href={String(event.payload.url || "#")} download className="flex items-center gap-3 rounded-xl border p-3 transition hover:opacity-75" style={{ borderColor: theme.node.stroke, color: theme.node.text }}><span className="grid size-9 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}><Archive className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{String(event.payload.title || event.payload.name || "Agent 产物")}</span><span className="text-xs opacity-45">{formatBytes(Number(event.payload.bytes) || 0)}</span></span></a>)}
        </div>
    );
}

function RunState({ event, hasAnswer }: { event: ProjectedEvent; hasAnswer: boolean }) {
    const state = String(event.payload.state || "");
    if (state === "completed" && hasAnswer) return null;
    return <div className="mt-3 flex items-center gap-2 text-[11px] opacity-45">{state === "running" ? <LoaderCircle className="size-3 animate-spin" /> : state === "failed" ? <CircleAlert className="size-3" /> : <Check className="size-3" />}{eventText(event)}</div>;
}

export function AgentDecisionCard({ pending, value, theme, busy, onChange, onDecide }: {
    pending: AgentPendingDecision;
    value: string;
    theme: CanvasTheme;
    busy: boolean;
    onChange: (value: string) => void;
    onDecide: (decision: "approved" | "rejected", scope?: "once" | "session" | "project", proposalEdits?: unknown) => void;
}) {
    const question = pending.kind === "question";
    const proposal = pending.toolName === "creative_assets_create_batch";
    const scopes = pending.scopes?.length ? pending.scopes : ["once"];
    return (
        <section className="mx-3 mb-2 overflow-hidden rounded-2xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <div className="flex gap-3 p-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}><ShieldAlert className="size-4" /></span>
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{question ? "Agent 需要你补充信息" : proposal ? "检查小说拆解清单" : "Agent 请求确认权限"}</div><p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{pending.content}</p>{pending.toolName ? <div className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: theme.node.stroke }}><Wrench className="size-3" />{toolLabel(pending.toolName)}</div> : null}{pending.rulePreview?.length ? <div className="mt-2 space-y-1 text-[11px] opacity-55">{pending.rulePreview.map((rule, index) => <div key={`${rule}-${index}`} className="truncate">规则：{rule}</div>)}</div> : null}</div>
            </div>
            {question ? <div className="px-3.5 pb-3"><Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} autoFocus autoSize={{ minRows: 2, maxRows: 6 }} placeholder="输入回复，Agent 会从这里继续" /></div> : proposal ? <CreativeAssetProposal pending={pending} theme={theme} busy={busy} onReject={() => onDecide("rejected")} onConfirm={(items) => onDecide("approved", "once", items)} /> : null}
            {proposal ? null : (
            <div className="flex flex-wrap justify-end gap-1.5 border-t px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>
                <Button type="text" size="small" disabled={busy} onClick={() => onDecide("rejected")}>{question ? "拒绝并改方案" : "拒绝"}</Button>
                {question ? <Button type="primary" size="small" disabled={!value.trim() || busy} onClick={() => onDecide("approved")}>提交回复</Button> : <>{scopes.includes("once") ? <Button size="small" disabled={busy} onClick={() => onDecide("approved", "once")}>允许一次</Button> : null}{scopes.includes("session") ? <Button size="small" disabled={busy} onClick={() => onDecide("approved", "session")}>本会话记住</Button> : null}{scopes.includes("project") ? <Button type="primary" size="small" disabled={busy} onClick={() => onDecide("approved", "project")}>此项目允许</Button> : null}</>}
            </div>
            )}
        </section>
    );
}

type ProposalItem = { included: boolean; kind: "character" | "scene" | "prop"; name: string; status: "draft"; payload: { description: string; voiceDescription: string; [key: string]: unknown } };
function CreativeAssetProposal({ pending, theme, busy, onReject, onConfirm }: { pending: AgentPendingDecision; theme: CanvasTheme; busy: boolean; onReject: () => void; onConfirm: (items: unknown[]) => void }) {
    const source = recordOf(pending.toolInput) || {};
    const [items, setItems] = useState<ProposalItem[]>(() => arrayOf<Record<string, unknown>>(source.items).map(normalizeProposalItem));
    useEffect(() => setItems(arrayOf<Record<string, unknown>>((recordOf(pending.toolInput) || {}).items).map(normalizeProposalItem)), [pending.id, pending.toolInput]);
    const selected = items.filter((item) => item.included);
    const update = (index: number, patch: Partial<ProposalItem>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    const mergePrevious = (index: number) => setItems((current) => {
        const item = current[index];
        let targetIndex = index - 1;
        while (targetIndex >= 0 && current[targetIndex].kind !== item.kind) targetIndex -= 1;
        if (targetIndex < 0) return current;
        return current.map((value, itemIndex) => itemIndex === targetIndex ? { ...value, payload: { ...value.payload, description: [value.payload.description, item.payload.description].filter(Boolean).join("；") } } : value).filter((_value, itemIndex) => itemIndex !== index);
    });
    return <div className="border-t" style={{ borderColor: theme.node.stroke }}>
        <div className="max-h-[48vh] space-y-4 overflow-y-auto px-3.5 py-3 thin-scrollbar">
            {(["character", "scene", "prop"] as const).map((kind) => {
                const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind);
                if (!rows.length) return null;
                return <section key={kind}><div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold opacity-55"><span>{kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}</span><span>{rows.filter(({ item }) => item.included).length}/{rows.length}</span></div><div className="space-y-2">{rows.map(({ item, index }) => <div key={`${kind}-${index}`} className="rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>
                    <div className="flex items-center gap-2"><Checkbox checked={item.included} onChange={(event) => update(index, { included: event.target.checked })} /><Input size="small" value={item.name} onChange={(event) => update(index, { name: event.target.value })} /><Select size="small" value={item.kind} className="w-20" onChange={(value) => update(index, { kind: value })} options={[{ value: "character", label: "角色" }, { value: "scene", label: "场景" }, { value: "prop", label: "道具" }]} /></div>
                    <Input.TextArea className="mt-2" value={item.payload.description} onChange={(event) => update(index, { payload: { ...item.payload, description: event.target.value } })} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="完整视觉描述" />
                    {item.kind === "character" ? <Input.TextArea className="mt-2" value={item.payload.voiceDescription} onChange={(event) => update(index, { payload: { ...item.payload, voiceDescription: event.target.value } })} autoSize={{ minRows: 1, maxRows: 3 }} placeholder="声音描述（可选）" /> : null}
                    <button type="button" className="mt-1.5 text-[10px] opacity-45 hover:opacity-80" onClick={() => mergePrevious(index)}>合并到上一项同类设定</button>
                </div>)}</div></section>;
            })}
        </div>
        <div className="flex items-center border-t px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}><span className="text-xs opacity-45">将在画布创建 {selected.length} 张独立业务卡片</span><Button className="ml-auto" type="text" size="small" disabled={busy} onClick={onReject}>拒绝</Button><Button type="primary" size="small" disabled={!selected.length || busy} onClick={() => onConfirm(selected.map(({ included: _included, ...item }) => item))}>确认创建</Button></div>
    </div>;
}

function normalizeProposalItem(value: Record<string, unknown>): ProposalItem {
    const payload = recordOf(value.payload) || {};
    return { included: true, kind: value.kind === "scene" || value.kind === "prop" ? value.kind : "character", name: String(value.name || "未命名设定"), status: "draft", payload: { ...payload, description: String(payload.description || ""), voiceDescription: String(payload.voiceDescription || "") } };
}

export function AgentComposer({
    value, theme, ready, busy, sending, uploading, focusRequest, skills, nodes, skill, references, attachments,
    onChange, onSend, onCancel, onUpload, onSkill, onReference, onRemoveReference, onRemoveAttachment,
}: {
    value: string;
    theme: CanvasTheme;
    ready: boolean;
    busy: boolean;
    sending: boolean;
    uploading: boolean;
    focusRequest?: number;
    skills: AgentSkill[];
    nodes: CanvasResourceReference[];
    skill: AgentSkill | null;
    references: CanvasResourceReference[];
    attachments: ServerFile[];
    onChange: (value: string) => void;
    onSend: () => void;
    onCancel: () => void;
    onUpload: (files: File[]) => void;
    onSkill: (skill: AgentSkill | null) => void;
    onReference: (reference: CanvasResourceReference) => void;
    onRemoveReference: (id: string) => void;
    onRemoveAttachment: (id: string) => void;
}) {
    const inputRef = useRef<ComponentRef<typeof Input.TextArea> | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const dragDepthRef = useRef(0);
    const composingRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    const [filePickerOpening, setFilePickerOpening] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [cursor, setCursor] = useState(value.length);
    const [suggestionsOpen, setSuggestionsOpen] = useState(true);
    const suggestion = useMemo(() => suggestionsOpen ? resolveSuggestion(value, cursor, skills, nodes, references) : null, [value, cursor, skills, nodes, references, suggestionsOpen]);
    useEffect(() => setActiveIndex(0), [suggestion?.query, suggestion?.kind]);
    useEffect(() => setCursor((current) => Math.min(current, value.length)), [value]);
    useEffect(() => { if (focusRequest) requestAnimationFrame(() => inputRef.current?.focus()); }, [focusRequest]);
    const textarea = () => inputRef.current?.resizableTextArea?.textArea || null;
    const focusAt = (offset: number) => requestAnimationFrame(() => { const node = textarea(); inputRef.current?.focus(); node?.setSelectionRange(offset, offset); setCursor(offset); });
    const pick = (item: AgentSkill | CanvasResourceReference) => {
        if (!suggestion) return;
        const next = `${value.slice(0, suggestion.start)}${value.slice(suggestion.end)}`;
        const offset = suggestion.start;
        onChange(next);
        if (suggestion.kind === "skill") onSkill(item as AgentSkill);
        else onReference(item as CanvasResourceReference);
        setSuggestionsOpen(false);
        focusAt(offset);
    };
    const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || composingRef.current) return;
        if (suggestion?.items.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : suggestion.items.length - 1)) % suggestion.items.length); return; }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); pick(suggestion.items[activeIndex]); return; }
            if (event.key === "Escape") { event.preventDefault(); setSuggestionsOpen(false); return; }
        }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
    };
    const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); onUpload(files); }
    };
    const drop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault(); dragDepthRef.current = 0; setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onUpload(files);
    };
    const insertTrigger = (trigger: "/" | "@") => {
        const at = textarea()?.selectionStart ?? cursor;
        const prefix = value.slice(0, at);
        const insert = `${prefix && !/\s$/.test(prefix) ? " " : ""}${trigger}`;
        const next = `${prefix}${insert}${value.slice(at)}`;
        const offset = at + insert.length;
        onChange(next);
        setSuggestionsOpen(true);
        focusAt(offset);
    };
    const canSend = ready && !busy && Boolean(value.trim() || skill || attachments.length || references.length);
    return (
        <div className="shrink-0 px-3 pb-3 pt-2">
            {busy ? <div className="mb-2 flex items-center gap-2 px-1 text-xs" style={{ color: theme.node.muted }}><LoaderCircle className="size-3.5 animate-spin" />Agent 正在处理，可以停止后调整任务</div> : null}
            <div className={`relative rounded-2xl border transition ${dragging ? "ring-2 ring-blue-500/35" : ""}`} style={{ borderColor: theme.node.stroke, background: theme.node.panel }} onDragEnter={(event) => { event.preventDefault(); dragDepthRef.current += 1; setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragging(false); }} onDrop={drop}>
                {skill || references.length || attachments.length ? <ComposerContext skill={skill} references={references} attachments={attachments} theme={theme} onSkill={onSkill} onRemoveReference={onRemoveReference} onRemoveAttachment={onRemoveAttachment} /> : null}
                {suggestion ? <SuggestionMenu suggestion={suggestion} activeIndex={activeIndex} theme={theme} onPick={pick} /> : null}
                <Input.TextArea ref={inputRef} value={value} onChange={(event) => { onChange(event.target.value); setCursor(event.target.selectionStart); setSuggestionsOpen(true); }} onSelect={(event) => setCursor(event.currentTarget.selectionStart)} onClick={(event) => { setCursor(event.currentTarget.selectionStart); setSuggestionsOpen(true); }} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={(event) => { composingRef.current = false; setCursor(event.currentTarget.selectionStart); }} onKeyDown={keyDown} onPaste={paste} autoSize={{ minRows: 2, maxRows: 12 }} variant="borderless" placeholder={ready ? "描述任务，输入 / 调用 Skill，@ 引用节点…" : "管理员配置 Agent 模型后即可使用"} disabled={!ready || busy} className="!max-h-72 !px-3 !pt-3 thin-scrollbar" />
                <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    <div className="flex items-center gap-0.5">
                        <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => { onUpload(Array.from(event.target.files || [])); event.currentTarget.value = ""; setFilePickerOpening(false); }} />
                        <Tooltip title="添加附件，也可以粘贴或拖入"><Button type="text" shape="circle" loading={uploading || filePickerOpening} icon={<Paperclip className="size-4" />} onClick={() => { if (filePickerOpening) return; setFilePickerOpening(true); fileRef.current?.click(); window.setTimeout(() => setFilePickerOpening(false), 800); }} /></Tooltip>
                        <Tooltip title="引用画布节点"><Button type="text" shape="circle" disabled={!nodes.length} icon={<AtSign className="size-4" />} onClick={() => insertTrigger("@")} /></Tooltip>
                        <Tooltip title="调用 Skill"><Button type="text" shape="circle" icon={<Sparkles className="size-4" />} onClick={() => insertTrigger("/")} /></Tooltip>
                    </div>
                    {busy ? <Tooltip title="停止当前任务"><Button type="text" shape="circle" danger icon={<Square className="size-3.5 fill-current" />} onClick={onCancel} /></Tooltip> : <Tooltip title="发送"><Button type="primary" shape="circle" loading={sending} disabled={!canSend} icon={<Send className="size-3.5" />} onClick={onSend} /></Tooltip>}
                </div>
                {dragging ? <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-blue-500/10 text-sm font-medium">松开以添加附件</div> : null}
            </div>
            <div className="mt-1.5 text-center text-[10px]" style={{ color: theme.node.muted }}>Enter 发送 · Shift + Enter 换行 · Agent 可能出错，请确认重要修改</div>
        </div>
    );
}

function ComposerContext({ skill, references, attachments, theme, onSkill, onRemoveReference, onRemoveAttachment }: {
    skill: AgentSkill | null; references: CanvasResourceReference[]; attachments: ServerFile[]; theme: CanvasTheme;
    onSkill: (skill: AgentSkill | null) => void; onRemoveReference: (id: string) => void; onRemoveAttachment: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const all = (skill ? 1 : 0) + references.length + attachments.length;
    const compact = all > 3 && !expanded;
    return <div className="flex gap-2 overflow-x-auto px-3 pt-3">
        {skill ? <ContextCard icon={<Sparkles className="size-3.5" />} title={`/${skill.name}`} subtitle="Skill" onRemove={() => onSkill(null)} theme={theme} /> : null}
        {references.slice(0, compact ? Math.max(0, 2 - (skill ? 1 : 0)) : undefined).map((item) => <ContextCard key={item.nodeId} icon={<AtSign className="size-3.5" />} title={item.title} subtitle="画布节点" onRemove={() => onRemoveReference(item.nodeId)} theme={theme} />)}
        {attachments.slice(0, compact ? Math.max(0, 2 - (skill ? 1 : 0) - Math.min(references.length, 2)) : undefined).map((file) => <ContextCard key={file.id} icon={fileIcon(file.mimeType)} title={file.name} subtitle={formatBytes(file.bytes)} image={file.mimeType.startsWith("image/") ? fileUrl(file.id) : undefined} href={fileUrl(file.id)} onRemove={() => onRemoveAttachment(file.id)} theme={theme} />)}
        {all > 3 ? <button type="button" className="h-12 shrink-0 rounded-xl border px-3 text-xs opacity-60 hover:opacity-90" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起附件" : `查看全部 ${all} 项`}</button> : null}
    </div>;
}

function ContextCard({ icon, title, subtitle, image, href, onRemove, theme }: { icon: ReactNode; title: string; subtitle: string; image?: string; href?: string; onRemove: () => void; theme: CanvasTheme }) {
    return <div className="group relative flex h-12 min-w-0 shrink-0 items-center gap-2 rounded-xl border px-2 pr-7" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>{image ? <Image preview src={image} alt={title} className="!size-8 rounded-lg object-cover" /> : href ? <a href={href} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg opacity-60">{icon}</a> : <span className="grid size-8 place-items-center rounded-lg opacity-60">{icon}</span>}<span className="min-w-0 max-w-28"><span className="block truncate text-xs font-medium">{title}</span><span className="block truncate text-[10px] opacity-45">{subtitle}</span></span><button type="button" aria-label={`移除${title}`} onClick={onRemove} className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-md opacity-45 hover:bg-black/10 hover:opacity-80 dark:hover:bg-white/10"><X className="size-3" /></button></div>;
}

type Suggestion = { kind: "skill"; start: number; end: number; query: string; items: AgentSkill[] } | { kind: "reference"; start: number; end: number; query: string; items: CanvasResourceReference[] };
function SuggestionMenu({ suggestion, activeIndex, theme, onPick }: { suggestion: Suggestion; activeIndex: number; theme: CanvasTheme; onPick: (item: AgentSkill | CanvasResourceReference) => void }) {
    return <div role="listbox" aria-label={suggestion.kind === "skill" ? "Skill 候选" : "画布节点候选"} className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border p-1.5 shadow-xl" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
        <div className="px-2 py-1 text-[10px] font-medium opacity-40">{suggestion.kind === "skill" ? "选择 Skill" : "引用画布节点"}</div>
        {suggestion.items.length ? suggestion.items.map((item, index) => {
            const skill = suggestion.kind === "skill" ? item as AgentSkill : null;
            const node = suggestion.kind === "reference" ? item as CanvasResourceReference : null;
            return <button key={skill?.id || node?.nodeId} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(item)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left" style={{ background: index === activeIndex ? theme.toolbar.itemHover : undefined }}><span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}>{skill ? <Sparkles className="size-3.5" /> : <AtSign className="size-3.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{skill ? `/${skill.name}` : node?.title}</span><span className="block truncate text-[11px] opacity-45">{skill ? skill.description : node?.kind}</span></span></button>;
        }) : <div className="px-3 py-5 text-center text-xs opacity-45">没有匹配项</div>}
    </div>;
}

export function AgentHistoryList({ sessions, activeId, unread, query, theme, onQuery, onActivate, onDelete, onFork }: {
    sessions: AgentSession[]; activeId?: string; unread?: Record<string, number>; query: string; theme: CanvasTheme;
    onQuery: (value: string) => void; onActivate: (id: string) => void; onDelete: (id: string) => void; onFork: (id: string) => void;
}) {
    const filtered = sessions.filter((session) => session.title.toLowerCase().includes(query.trim().toLowerCase()));
    return <div><Input prefix={<Search className="size-3.5 opacity-45" />} value={query} onChange={(event) => onQuery(event.target.value)} allowClear placeholder="搜索历史会话" /><div className="mt-3 space-y-1">{filtered.map((session) => <div key={session.id} role="button" tabIndex={0} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 dark:hover:bg-white/5" style={{ background: session.id === activeId ? theme.toolbar.itemHover : undefined }} onClick={() => onActivate(session.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(session.id); } }}><span className="relative grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover }}><History className="size-3.5 opacity-55" /><i className={`absolute bottom-0.5 right-0.5 size-1.5 rounded-full ${statusDot(session.status)}`} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="block min-w-0 flex-1 truncate text-sm font-medium">{session.title || "新会话"}</span>{unread?.[session.id] ? <span className="rounded-full bg-blue-500 px-1.5 text-[10px] text-white">{unread[session.id]}</span> : null}</span><span className="mt-0.5 flex items-center gap-1 text-[11px] opacity-45"><Clock3 className="size-3" />{formatRelativeTime(session.updatedAt)} · {statusText(session.status)}</span></span><span className="flex opacity-0 transition group-hover:opacity-60 group-focus-visible:opacity-60"><Tooltip title="从这里分叉"><button type="button" className="grid size-7 place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/10" onClick={(event) => { event.stopPropagation(); onFork(session.id); }}><GitFork className="size-3.5" /></button></Tooltip>{session.id !== activeId && !["running", "waiting_for_user"].includes(session.status) ? <Popconfirm title="删除这段会话？" onConfirm={() => onDelete(session.id)}><button type="button" className="grid size-7 place-items-center rounded-md hover:bg-red-500/10 hover:text-red-500" onClick={(event) => event.stopPropagation()}><Trash2 className="size-3.5" /></button></Popconfirm> : null}</span></div>)}{!filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "没有匹配的会话" : "暂无历史会话"} /> : null}</div></div>;
}

export function AgentSkillList({ skills, query, theme, onQuery, onSelect }: { skills: AgentSkill[]; query: string; theme: CanvasTheme; onQuery: (value: string) => void; onSelect: (skill: AgentSkill) => void }) {
    const normalized = query.trim().toLowerCase();
    const filtered = skills.filter((skill) => !normalized || `${skill.name} ${skill.description}`.toLowerCase().includes(normalized));
    return <div><Input prefix={<Search className="size-3.5 opacity-45" />} value={query} onChange={(event) => onQuery(event.target.value)} allowClear placeholder="搜索 Skill" /><div className="mt-3 space-y-2">{filtered.map((skill) => <button key={skill.id} type="button" className="w-full rounded-xl border p-3 text-left transition hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: theme.node.stroke }} onClick={() => onSelect(skill)}><div className="flex items-center gap-2 font-medium"><Sparkles className="size-4" />/{skill.name}</div><p className="mt-1.5 text-sm leading-5 opacity-55">{skill.description}</p><div className="mt-2 text-[11px] opacity-35">点击后加入下一条消息</div></button>)}{!filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可用 Skill" /> : null}</div></div>;
}

export function ScrollToBottomButton({ visible, unread, bottom, onClick }: { visible: boolean; unread: number; bottom?: number; onClick: () => void }) {
    if (!visible) return null;
    return <Button className="!absolute left-1/2 z-10 -translate-x-1/2 shadow-sm" style={{ bottom: bottom ?? 144 }} size="small" shape="round" icon={<ArrowDown className="size-3.5" />} onClick={onClick}>{unread ? `${unread > 99 ? "99+" : unread} 条新消息` : "回到底部"}</Button>;
}

export function AgentUserLocator({ events, containerRef, theme }: { events: AgentEvent[]; containerRef: RefObject<HTMLDivElement | null>; theme: CanvasTheme }) {
    const users = useMemo(() => projectEvents(events).filter((event) => event.kind === "user_text"), [events]);
    const [activeSeq, setActiveSeq] = useState(0);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const container = containerRef.current;
        if (!container || users.length < 3) return;
        const update = () => {
            const top = container.getBoundingClientRect().top + 80;
            let active = users[0]?.seq || 0;
            container.querySelectorAll<HTMLElement>("[data-agent-user-seq]").forEach((node) => {
                if (node.getBoundingClientRect().top <= top) active = Number(node.dataset.agentUserSeq) || active;
            });
            setActiveSeq(active);
        };
        update();
        container.addEventListener("scroll", update, { passive: true });
        return () => container.removeEventListener("scroll", update);
    }, [containerRef, users]);
    if (users.length < 3) return null;
    const activeIndex = Math.max(0, users.findIndex((event) => event.seq === activeSeq));
    const start = Math.max(0, Math.min(activeIndex - 10, users.length - 21));
    const visible = users.slice(start, start + 21);
    const jump = (seq: number) => containerRef.current?.querySelector<HTMLElement>(`[data-agent-user-seq='${seq}']`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return <nav className="absolute right-1 top-1/2 z-10 -translate-y-1/2" aria-label="对话轮次定位" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        {open ? <div className="thin-scrollbar max-h-80 w-56 overflow-y-auto rounded-xl border p-1.5 shadow-xl backdrop-blur-xl" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>{users.map((event, index) => <button key={event.seq} type="button" className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10" style={{ opacity: event.seq === activeSeq ? 1 : .62 }} onClick={() => jump(event.seq)}><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" /><span className="min-w-0"><span className="block text-[10px] opacity-45">第 {index + 1} 轮</span><span className="line-clamp-2 leading-4">{eventText(event) || "空消息"}</span></span></button>)}</div>
            : <div className="flex flex-col items-center gap-1 rounded-full bg-black/5 px-1.5 py-2 backdrop-blur dark:bg-white/5">{visible.map((event) => <button key={event.seq} type="button" aria-label={`定位到第 ${users.findIndex((item) => item.seq === event.seq) + 1} 轮`} className={`rounded-full transition-all ${event.seq === activeSeq ? "h-3 w-1.5 bg-current opacity-60" : "size-1.5 bg-current opacity-20 hover:opacity-50"}`} onClick={() => jump(event.seq)} />)}</div>}
    </nav>;
}

function buildConversationItems(events: AgentEvent[]): ConversationItem[] {
    const projected = projectEvents(events);
    const items: ConversationItem[] = [];
    let round: ProjectedEvent[] = [];
    let lastTime = 0;
    const flush = () => { if (round.length) { items.push({ type: "round", id: `round-${round[0].runId || "event"}-${round[0].seq}`, events: round }); round = []; } };
    for (const event of projected) {
        const timestamp = Date.parse(event.createdAt);
        const showTime = Number.isFinite(timestamp) && (!lastTime || timestamp - lastTime >= 5 * 60_000);
        if (event.kind === "user_text") {
            flush();
            if (showTime) items.push({ type: "time", id: `time-${event.seq}`, label: formatTimeDivider(timestamp) });
            items.push({ type: "user", id: `user-${event.seq}`, event });
        } else {
            if (showTime) {
                flush();
                items.push({ type: "time", id: `time-${event.seq}`, label: formatTimeDivider(timestamp) });
            }
            round.push(event);
        }
        if (Number.isFinite(timestamp)) lastTime = timestamp;
    }
    flush();
    return items;
}

function projectEvents(events: AgentEvent[]) {
    const projected: ProjectedEvent[] = [];
    const streams = new Map<string, ProjectedEvent>();
    const tools = new Map<string, ProjectedEvent>();
    for (const event of events) {
        if (event.kind === "assistant_text" || event.kind === "thinking") {
            const streamId = String(event.payload.streamId || "");
            if (event.payload.delta && streamId) {
                const key = `${event.kind}:${streamId}`;
                const current = streams.get(key);
                if (current) current.text = `${current.text || ""}${String(event.payload.text || "")}`;
                else { const next = { ...event, text: String(event.payload.text || "") }; streams.set(key, next); projected.push(next); }
                continue;
            }
            const streamed = streams.get(`${event.kind}:${streamId}`);
            if (streamed) {
                const complete = String(event.payload.text || "");
                streamed.text = complete;
                streamed.payload = { ...event.payload, delta: false };
                continue;
            }
        }
        if (event.kind === "tool_call") {
            const id = String(event.payload.toolId || event.seq);
            const existing = tools.get(id);
            if (existing) { existing.payload = { ...existing.payload, ...event.payload }; continue; }
            const next = { ...event };
            tools.set(id, next);
            projected.push(next);
            continue;
        }
        if (event.kind === "tool_result") {
            const target = tools.get(String(event.payload.toolId || ""));
            if (target) target.result = event;
            else projected.push({ ...event, kind: "tool_call", payload: { toolId: event.payload.toolId, toolName: event.payload.toolName, input: null }, result: event });
            continue;
        }
        if (["approval_request", "approval_response", "question_request", "question_response", "client_action"].includes(event.kind)) continue;
        projected.push({ ...event });
    }
    return projected;
}

function resolveSuggestion(value: string, cursor: number, skills: AgentSkill[], nodes: CanvasResourceReference[], selected: CanvasResourceReference[]): Suggestion | null {
    const before = value.slice(0, cursor);
    const match = before.match(/(?:^|\s)([/@])([^\s/@]*)$/);
    if (!match) return null;
    const trigger = match[1];
    const query = match[2].toLowerCase();
    const start = cursor - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
    if (trigger === "/") return { kind: "skill", start, end: cursor, query, items: skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query)).slice(0, 8) };
    const chosen = new Set(selected.map((item) => item.nodeId));
    return { kind: "reference", start, end: cursor, query, items: nodes.filter((node) => !chosen.has(node.nodeId) && `${node.title} ${node.kind}`.toLowerCase().includes(query)).slice(0, 8) };
}

function eventText(event: ProjectedEvent) { return event.text || String(event.payload.text || event.payload.content || ""); }
function arrayOf<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function recordOf(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function fileUrl(id: string) { return serverApiUrl(`/files/${encodeURIComponent(id)}/content`); }
function MetaChip({ icon, text }: { icon: ReactNode; text: string }) { return <span className="inline-flex max-w-44 items-center gap-1 truncate rounded-md bg-black/5 px-1.5 py-0.5 text-[10px] dark:bg-white/10">{icon}<span className="truncate">{text}</span></span>; }
function formatUnknown(value: unknown) { if (typeof value === "string") return value; return JSON.stringify(value, null, 2) ?? String(value ?? ""); }
function formatBytes(bytes: number) { if (!bytes) return "文件"; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function fileIcon(mime: string) { if (mime.startsWith("image/")) return <ImageIcon className="size-3.5" />; if (mime.startsWith("video/")) return <FileVideo className="size-3.5" />; if (mime.startsWith("audio/")) return <FileAudio className="size-3.5" />; if (mime.includes("pdf") || mime.startsWith("text/")) return <FileText className="size-3.5" />; return <File className="size-3.5" />; }
function formatTimeDivider(timestamp: number) { const date = new Date(timestamp); const now = new Date(); const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); if (date.toDateString() === now.toDateString()) return time; const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`; return `${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })} ${time}`; }
function toolDuration(event: ProjectedEvent, now: number) { const start = Date.parse(String(event.payload.startedAt || event.createdAt)); const end = event.result ? Date.parse(String(event.result.payload.finishedAt || event.result.createdAt)) : now; if (!Number.isFinite(start) || !Number.isFinite(end)) return ""; return formatDuration(end - start); }
function roundDuration(events: ProjectedEvent[], running: boolean, now: number) { if (!events.length) return ""; const starts = events.map((event) => Date.parse(event.createdAt)).filter(Number.isFinite); const ends = events.map((event) => event.result ? Date.parse(event.result.createdAt) : Date.parse(event.createdAt)).filter(Number.isFinite); if (!starts.length) return ""; return formatDuration((running ? now : Math.max(...ends)) - Math.min(...starts)); }
function formatDuration(ms: number) { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`; }
function formatRelativeTime(value: string) { const delta = Date.now() - Date.parse(value); if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return new Date(value).toLocaleDateString("zh-CN"); }
function statusText(status: AgentSession["status"]) { return ({ idle: "空闲", running: "运行中", waiting_for_user: "等待确认", completed: "已完成", failed: "失败", canceled: "已取消" } as const)[status]; }
function statusDot(status: AgentSession["status"]) { return status === "running" ? "bg-blue-500" : status === "waiting_for_user" ? "bg-amber-500" : status === "failed" ? "bg-red-500" : status === "completed" ? "bg-emerald-500" : "bg-zinc-400"; }
function toolLabel(name: string) { const key = name.replace(/^mcp__infinite_canvas__/, ""); return ({ Read: "读取附件", canvas_list_projects: "查看画布列表", canvas_get_state: "读取画布", canvas_apply_ops: "修改画布", canvas_create_text_nodes: "创建文本节点", canvas_delete_nodes: "删除节点", canvas_delete_connections: "删除连线", canvas_connect_nodes: "连接节点", assets_list: "查看素材", assets_add: "新增素材", assets_delete: "删除素材", prompts_search: "搜索提示词", generation_list_models: "查看生成模型", generation_get_status: "查询生成任务", generation_create: "创建生成任务", creative_assets_list: "查看创作设定", creative_asset_get: "读取创作设定", creative_assets_create_batch: "确认小说设定拆解", creative_asset_update: "更新创作设定", creative_asset_place: "放置创作设定", creative_asset_generate: "生成设定媒体", creative_asset_set_primary: "选择主版本", creative_asset_delete: "永久删除创作设定", site_navigate: "页面跳转", canvas_select_nodes: "选择节点", canvas_focus_nodes: "聚焦节点", workspace_write_text: "写入产物", artifact_publish: "发布产物", ask_user: "向用户追问" } as Record<string, string>)[key] || key; }
function toolTarget(value: unknown) { const input = recordOf(value); if (!input) return ""; const candidate = input.title || input.name || input.path || input.nodeId || input.projectId || (Array.isArray(input.ids) ? `${input.ids.length} 个对象` : ""); return String(candidate || "").slice(0, 48); }
function roundSignature(events: ProjectedEvent[]) { return events.map((event) => `${event.seq}:${event.kind}:${eventText(event).length}:${formatUnknown(event.payload.input).length}:${event.result?.seq || 0}:${event.payload.delta ? 1 : 0}`).join("|"); }
