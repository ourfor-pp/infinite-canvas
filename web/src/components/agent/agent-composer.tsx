import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { canvasNodeReferenceCode, canvasNodeReferenceLabel, focusCanvasReference } from "@/lib/canvas/canvas-agent-reference";
import type { CanvasNodeData } from "@/types/canvas";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Dropdown, Tooltip } from "antd";
import { ArrowUp, AtSign, ChevronDown, FileAudio, FileText, FileUp, FileVideo, ImageIcon, LoaderCircle, Paperclip, Sparkles, Square, X } from "lucide-react";
import { randomId } from "@/lib/utils";
import type { AgentComposerDocument, AgentComposerSegment, AgentReferenceCandidate, AgentSkill } from "@/services/api/agent";
import type { ServerFile } from "@/services/api/server";
import { composerHasContent, normalizeComposerDocument, segmentLabel, serializeComposer } from "./agent-composer-model";

type MentionCandidate = { node?: CanvasNodeData; key: string; label: string; detail: string; segment: Exclude<AgentComposerSegment, { type: "text" }> };
const COMPOSER_CLIPBOARD = "application/x-infinite-canvas-agent-composer";

export function AgentComposer({ document: composerDocument, ready, busy, waiting, sending, uploading, attachments, skills, references, focusRequest, followUpMode, placeholder, unavailableReason, referenceLabel = "引用画布内容", modelControl, onDocumentChange, onFollowUpModeChange, onSend, onCancel, onUpload, onRemoveAttachment }: {
    document: AgentComposerDocument; ready: boolean; busy: boolean; waiting: boolean; sending: boolean; uploading: boolean; attachments: ServerFile[];
    skills: AgentSkill[]; references: AgentReferenceCandidate[]; focusRequest: number; followUpMode: "steer" | "queue";
    modelControl?: ReactNode;
    placeholder?: string; unavailableReason?: string; referenceLabel?: string;
    onDocumentChange: (document: AgentComposerDocument) => void; onFollowUpModeChange: (mode: "steer" | "queue") => void; onSend: () => void; onCancel: () => void; onUpload: (files: File[]) => void; onRemoveAttachment: (id: string) => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null); const composing = useRef(false); const dragDepth = useRef(0);
    const [trigger, setTrigger] = useState<{ kind: "skill" | "reference"; query: string; range: Range } | null>(null);
    const [active, setActive] = useState(0); const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null); const [dragging, setDragging] = useState(false);
    const [attachmentsOpen, setAttachmentsOpen] = useState(false);
    const referenceNumbers = useCanvasStore(state => state.projects.find(item => item.id === useAgentStore.getState().canvasContext?.snapshot.projectId)?.agentNodeNumbers);
    const canvasSnapshot = useAgentStore(state => state.canvasContext?.snapshot);
    const canvasNodes = canvasSnapshot?.nodes;
    const [preview, setPreview] = useState<{ node: CanvasNodeData; rect: DOMRect; side?: boolean } | null>(null);
    const clearPreview = () => { setPreview(null); useAgentStore.getState().hoverCanvasReference(null); };
    useEffect(() => () => useAgentStore.getState().hoverCanvasReference(null), []);
    useEffect(() => { rootRef.current?.querySelectorAll<HTMLElement>("[data-segment]").forEach(decorateCanvasToken); }, [canvasNodes, composerDocument, referenceNumbers]);
    const candidates = useMemo<MentionCandidate[]>(() => trigger?.kind === "skill"
        ? skills.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(trigger.query.toLowerCase())).slice(0, 8).map((item) => ({ key: `skill:${item.id}`, label: `/${item.name}`, detail: item.description, segment: { type: "skill", mentionId: randomId(), skillId: item.id, label: item.name } }))
        : references.map(item => {
            const segment = item.segment;
            const node = segment.type === "canvas" && segment.projectId === canvasSnapshot?.projectId ? canvasNodes?.find(node => node.id === segment.nodeId) : undefined;
            const label = node && segment.type === "canvas" ? canvasNodeReferenceLabel(node, segment.projectId) : item.label;
            return { ...item, node, label: `@${label}`, detail: node?.title || item.detail, segment: { ...segment, mentionId: randomId(), label } } as MentionCandidate;
        }).filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(trigger?.query.toLowerCase() || "")).slice(0, 8), [references, skills, trigger, canvasSnapshot, referenceNumbers]);

    useEffect(() => { renderDocument(rootRef.current, composerDocument); }, [composerDocument]);
    useEffect(() => { if (focusRequest) requestAnimationFrame(() => focusEnd(rootRef.current)); }, [focusRequest]);
    useEffect(() => { if (!trigger) clearPreview(); }, [trigger]);
    useEffect(() => { setActive(0); }, [trigger?.query, trigger?.kind]);

    const emit = () => onDocumentChange(readDocument(rootRef.current));
    const detect = () => {
        const selection = window.getSelection(); if (!selection?.rangeCount || !rootRef.current?.contains(selection.anchorNode)) return setTrigger(null);
        const range = selection.getRangeAt(0); if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return setTrigger(null);
        const before = range.startContainer.textContent?.slice(0, range.startOffset) || ""; const match = before.match(/(?:^|\s)([/@])([^\s/@]*)$/); if (!match) return setTrigger(null);
        const target = range.cloneRange(); target.setStart(range.startContainer, range.startOffset - match[0].length + (match[0].startsWith(" ") ? 1 : 0));
        const rect = target.getBoundingClientRect(); setPosition({ left: Math.min(window.innerWidth - 340, Math.max(12, rect.left)), top: Math.max(12, rect.top - 10), width: 328 });
        setTrigger({ kind: match[1] === "/" ? "skill" : "reference", query: match[2], range: target });
    };
    const pick = (candidate: MentionCandidate) => {
        if (!trigger) return; trigger.range.deleteContents(); const token = tokenNode(candidate.segment); const space = document.createTextNode(" "); trigger.range.insertNode(space); trigger.range.insertNode(token); setCaretAfter(space); setTrigger(null); emit(); rootRef.current?.focus();
    };
    const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.nativeEvent.isComposing || composing.current) return;
        if (trigger && candidates.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((value) => (value + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length); return; }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); pick(candidates[active]); return; }
            if (event.key === "Escape") { event.preventDefault(); setTrigger(null); return; }
        }
        if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentToken(rootRef.current, event.key)) { event.preventDefault(); emit(); return; }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) onSend(); }
    };
    const copy = (event: ClipboardEvent<HTMLDivElement>) => {
        const selection = window.getSelection(); if (!selection?.rangeCount || !rootRef.current?.contains(selection.anchorNode)) return;
        const value = readNodes(selection.getRangeAt(0).cloneContents().childNodes);
        event.preventDefault(); event.clipboardData.setData(COMPOSER_CLIPBOARD, JSON.stringify(value)); event.clipboardData.setData("text/plain", value.segments.map((segment) => segment.type === "text" ? segment.text : segmentLabel(segment)).join(""));
    };
    const paste = (event: ClipboardEvent<HTMLDivElement>) => {
        const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); onUpload(files); return; }
        const structured = event.clipboardData.getData(COMPOSER_CLIPBOARD); if (!structured) return;
        try { const value = normalizeComposerDocument(JSON.parse(structured)); event.preventDefault(); insertSegments(rootRef.current, value.segments); emit(); } catch { /* Fall back to browser plain-text paste. */ }
    };
    const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); const files = Array.from(event.dataTransfer.files); if (files.length) onUpload(files); };
    const canSend = ready && !sending && !uploading && (composerHasContent(composerDocument) || attachments.length > 0) && (!waiting || followUpMode === "queue");
    const followMenu = { items: [{ key: "steer", label: <Mode title="马上发" detail="立即补充到当前任务" /> }, { key: "queue", label: <Mode title="稍后发" detail="当前任务完成后发送" /> }], selectedKeys: [followUpMode], onClick: ({ key }: { key: string }) => onFollowUpModeChange(key as "steer" | "queue") };
    return <div className="agent-composer-wrap">
        <div className={`agent-composer ${dragging ? "is-dragging" : ""}`} onDragEnter={(event) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={drop}>
            {attachments.length ? attachments.length > 3 ? <div className="agent-attachment-summary"><button type="button" aria-expanded={attachmentsOpen} aria-label={`${attachmentsOpen ? "收起" : "查看"} ${attachments.length} 个待发送附件`} onClick={() => setAttachmentsOpen((value) => !value)}><Paperclip className="size-4" /><span>待发送附件</span><i>{attachments.length}</i><ChevronDown className={`size-3.5 ${attachmentsOpen ? "is-open" : ""}`} /></button>{attachmentsOpen ? <AttachmentStrip files={attachments} onRemove={onRemoveAttachment} /> : null}</div> : <AttachmentStrip files={attachments} onRemove={onRemoveAttachment} /> : null}
            <div ref={rootRef} role="textbox" aria-multiline="true" data-placeholder={placeholder || "描述任务，输入 / 调用 Skill，@ 引用节点…"} contentEditable suppressContentEditableWarning className="agent-composer-editor thin-scrollbar" onInput={() => { emit(); detect(); }} onClick={event => {
                const token = (event.target as Element).closest<HTMLElement>("[data-segment]");
                const segment = token?.dataset.segment ? JSON.parse(token.dataset.segment) as AgentComposerSegment : null;
                if (segment?.type === "canvas") { clearPreview(); focusCanvasReference(segment.projectId, segment.nodeId); } else detect();
            }} onMouseOver={event => {
                const token = (event.target as Element).closest<HTMLElement>("[data-segment]");
                const segment = token?.dataset.segment ? JSON.parse(token.dataset.segment) as AgentComposerSegment : null;
                const snapshot = useAgentStore.getState().canvasContext?.snapshot;
                const node = segment?.type === "canvas" && snapshot?.projectId === segment.projectId ? snapshot.nodes.find(item => item.id === segment.nodeId) : undefined;
                if (node && token && segment?.type === "canvas") { setPreview({ node, rect: token.getBoundingClientRect() }); useAgentStore.getState().hoverCanvasReference({ projectId: segment.projectId, nodeId: node.id }); }
                else clearPreview();
            }} onMouseLeave={clearPreview} onKeyUp={detect} onKeyDown={keyDown} onCopy={copy} onPaste={paste} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; detect(); }} />
            <div className="agent-composer-actions"><div className="flex min-w-0 items-center gap-1"><input ref={fileRef} type="file" multiple hidden onChange={(event) => { onUpload(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /><Tooltip title="添加附件，也可以粘贴或拖入"><button type="button" className="agent-composer-action" onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</button></Tooltip><Tooltip title={referenceLabel}><button type="button" className="agent-composer-action" onClick={() => insertText(rootRef.current, "@", detect)}><AtSign className="size-4" /></button></Tooltip><Tooltip title="调用 Skill"><button type="button" className="agent-composer-action" onClick={() => insertText(rootRef.current, "/", detect)}><Sparkles className="size-4" /></button></Tooltip>{modelControl}</div>
                <div className="flex items-center gap-2">{busy ? <Dropdown menu={followMenu} trigger={["click"]} placement="topRight"><button type="button" className="agent-follow-mode">{waiting ? "稍后" : followUpMode === "queue" ? "稍后" : "马上"}</button></Dropdown> : null}<button type="button" className="agent-send" disabled={!canSend} onClick={onSend} aria-label="发送"><ArrowUp className="size-4" /></button>{busy ? <button type="button" className="agent-stop" onClick={onCancel} aria-label="停止"><Square className="size-3.5 fill-current" /></button> : null}</div></div>
            {dragging ? <div className="agent-drop-overlay"><span><FileUp className="size-5" />松手添加到输入框</span></div> : null}
        </div>
        {!ready && unavailableReason ? <div role="status" className="px-3 pt-1 text-xs opacity-60">{unavailableReason}</div> : null}
        {preview ? createPortal(<div data-agent-reference-preview className="agent-panel-shell pointer-events-none fixed z-[1400] w-64 overflow-hidden rounded-xl border p-3 shadow-lg" style={{ left: preview.side ? Math.max(8, preview.rect.right + 272 <= window.innerWidth ? preview.rect.right + 8 : preview.rect.left - 264) : Math.max(8, Math.min(window.innerWidth - 264, preview.rect.left)), top: preview.side ? Math.max(8, Math.min(window.innerHeight - 300, preview.rect.top)) : preview.rect.top - 8, transform: preview.side ? undefined : "translateY(-100%)", background: "var(--agent-panel)", color: "var(--agent-text)", borderColor: "var(--agent-line)" }}>
            <div className="mb-2 text-xs font-medium">{canvasNodeReferenceCode(preview.node)}</div>
            {preview.node.type === "image" && preview.node.metadata?.content ? <img src={preview.node.metadata.content} alt={preview.node.title} className="mb-2 max-h-44 w-full rounded object-contain" /> : preview.node.type === "video" && preview.node.metadata?.content ? <video src={preview.node.metadata.content} muted preload="metadata" className="mb-2 max-h-44 w-full rounded object-contain" /> : null}
            <div className="line-clamp-3 break-words text-xs">{preview.node.title}</div><div className="mt-2 text-[11px] opacity-60">{preview.side ? "点击插入引用" : "点击定位画布节点"}</div>
        </div>, document.body) : null}
        {trigger && position ? createPortal(<div className="agent-mention-menu" onMouseLeave={clearPreview} onScrollCapture={clearPreview} style={{ left: position.left, top: position.top, width: position.width, transform: "translateY(-100%)" }}><header><strong>{trigger.kind === "skill" ? "引用技能" : referenceLabel}</strong><span>{trigger.query ? `搜索：${trigger.query}` : "选择要加入的内容"}</span></header><div className="max-h-72 overflow-y-auto p-1.5 thin-scrollbar">{candidates.length ? candidates.map((candidate, index) => <button key={candidate.key} type="button" className={index === active ? "is-active" : ""} ref={(node) => { if (index === active) node?.scrollIntoView({ block: "nearest" }); }} onMouseDown={(event) => event.preventDefault()} onMouseEnter={event => {
                setActive(index);
                if (candidate.node && candidate.segment.type === "canvas") {
                    const menu = event.currentTarget.closest(".agent-mention-menu")!;
                    setPreview({ node: candidate.node, rect: menu.getBoundingClientRect(), side: true });
                    useAgentStore.getState().hoverCanvasReference({ projectId: candidate.segment.projectId, nodeId: candidate.node.id });
                } else clearPreview();
            }} onClick={() => pick(candidate)}><i>{candidate.node?.type === "image" && candidate.node.metadata?.content ? <img src={candidate.node.metadata.content} alt="" className="size-8 rounded object-cover" /> : candidate.node?.type === "video" && candidate.node.metadata?.content ? <video src={candidate.node.metadata.content} muted preload="metadata" className="size-8 rounded object-cover" /> : candidate.segment.type === "skill" ? <Sparkles className="size-4" /> : <AtSign className="size-4" />}</i><span><strong>{candidate.label}</strong><small>{candidate.detail}</small></span></button>) : <p>没有匹配项</p>}</div></div>, document.body) : null}
    </div>;
}

function AttachmentStrip({ files, onRemove }: { files: ServerFile[]; onRemove: (id: string) => void }) {
    return <div className="agent-attachment-strip thin-scrollbar">{files.map((file) => <div className="agent-attachment" key={file.id}>{file.mimeType.startsWith("image/") && file.url ? <img src={file.url} alt="" /> : <span className="agent-attachment-icon">{attachmentIcon(file.mimeType)}</span>}<span className="min-w-0"><strong>{file.name}</strong><small>{attachmentType(file.mimeType)}{file.bytes ? ` · ${formatFileSize(file.bytes)}` : ""}</small></span><button type="button" onClick={() => onRemove(file.id)} aria-label={`移除${file.name}`}><X className="size-3" /></button></div>)}</div>;
}

function Mode({ title, detail }: { title: string; detail: string }) { return <span className="flex min-w-36 flex-col"><strong>{title}</strong><small className="opacity-55">{detail}</small></span>; }
function attachmentIcon(mimeType: string) { if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" />; if (mimeType.startsWith("audio/")) return <FileAudio className="size-4" />; if (mimeType.startsWith("video/")) return <FileVideo className="size-4" />; return <FileText className="size-4" />; }
function attachmentType(mimeType: string) { if (mimeType.startsWith("image/")) return "图片"; if (mimeType.startsWith("audio/")) return "音频"; if (mimeType.startsWith("video/")) return "视频"; if (mimeType === "application/pdf") return "PDF"; return "文件"; }
function formatFileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
function tokenNode(segment: Exclude<AgentComposerSegment, { type: "text" }>) { const node = document.createElement("span"); node.contentEditable = "false"; node.className = `agent-mention-token ${segment.type === "skill" ? "is-skill" : ""}`; node.dataset.segment = JSON.stringify(segment); node.textContent = segmentLabel(segment); decorateCanvasToken(node); return node; }
function decorateCanvasToken(token: HTMLElement) {
    const segment = JSON.parse(token.dataset.segment || "null") as AgentComposerSegment | null;
    if (segment?.type !== "canvas") return;
    const snapshot = useAgentStore.getState().canvasContext?.snapshot;
    const node = snapshot?.projectId === segment.projectId ? snapshot.nodes.find(item => item.id === segment.nodeId) : undefined;
    if (node) token.dataset.segment = JSON.stringify({ ...segment, label: canvasNodeReferenceLabel(node, segment.projectId) });
    token.style.cursor = "pointer";
    token.style.display = "inline-flex";
    token.style.alignItems = "center";
    token.style.verticalAlign = "middle";
    token.style.gap = "4px";
    token.title = node ? `${node.title} · 点击定位` : "节点不在当前画布或已删除";
    const label = document.createElement("span");
    label.className = "max-w-48 truncate";
    label.textContent = node ? `@${canvasNodeReferenceLabel(node, segment.projectId)}` : segmentLabel(segment);
    token.replaceChildren(label);
    if (node?.metadata?.content && (node.type === "image" || node.type === "video")) {
        const media = document.createElement(node.type === "image" ? "img" : "video");
        media.className = "size-6 shrink-0 rounded object-cover";
        media.setAttribute("src", node.metadata.content);
        if (media instanceof HTMLImageElement) { media.alt = ""; media.draggable = false; }
        else { media.muted = true; media.preload = "metadata"; }
        token.prepend(media);
    } else if (node) {
        const icon = document.createElement("span");
        icon.className = "text-[10px] opacity-60";
        icon.textContent = ({ text: "T", audio: "♪", video: "▷", image: "▧", group: "▦", config: "⚙" } as Record<string, string>)[node.type] || "◇";
        token.prepend(icon);
    }
}
function renderDocument(root: HTMLDivElement | null, value: AgentComposerDocument) { if (!root) return; const normalized = normalizeComposerDocument(value); if (serializeComposer(readDocument(root)) === serializeComposer(normalized)) return; root.replaceChildren(...normalized.segments.map((segment) => segment.type === "text" ? document.createTextNode(segment.text) : tokenNode(segment))); }
function readDocument(root: HTMLDivElement | null): AgentComposerDocument { const segments: AgentComposerSegment[] = []; root?.childNodes.forEach((node) => { if (node.nodeType === Node.TEXT_NODE) segments.push({ type: "text", text: node.textContent || "" }); else if (node instanceof HTMLBRElement) segments.push({ type: "text", text: "\n" }); else if (node instanceof HTMLElement && node.dataset.segment) { try { segments.push(JSON.parse(node.dataset.segment)); } catch { segments.push({ type: "text", text: node.textContent || "" }); } } else segments.push({ type: "text", text: node.textContent || "" }); }); return normalizeComposerDocument({ version: 1, segments }); }
function readNodes(nodes: NodeListOf<ChildNode> | NodeList): AgentComposerDocument { const holder = document.createElement("div"); Array.from(nodes).forEach((node) => holder.append(node.cloneNode(true))); return readDocument(holder); }
function insertSegments(root: HTMLDivElement | null, segments: AgentComposerSegment[]) { if (!root) return; root.focus(); const selection = window.getSelection(); const range = selection?.rangeCount && root.contains(selection.anchorNode) ? selection.getRangeAt(0) : document.createRange(); if (!selection?.rangeCount || !root.contains(selection.anchorNode)) range.selectNodeContents(root), range.collapse(false); range.deleteContents(); const fragment = document.createDocumentFragment(); segments.forEach((segment) => fragment.append(segment.type === "text" ? document.createTextNode(segment.text) : tokenNode(segment))); const last = fragment.lastChild; range.insertNode(fragment); if (last) setCaretAfter(last); }
function deleteAdjacentToken(root: HTMLDivElement | null, key: "Backspace" | "Delete") { const selection = window.getSelection(); if (!root || !selection?.rangeCount || !selection.isCollapsed) return false; const range = selection.getRangeAt(0); let target: Node | null = null; if (range.startContainer === root) target = root.childNodes[range.startOffset + (key === "Backspace" ? -1 : 0)] || null; else if (range.startContainer.nodeType === Node.TEXT_NODE && ((key === "Backspace" && range.startOffset === 0) || (key === "Delete" && range.startOffset === range.startContainer.textContent?.length))) target = key === "Backspace" ? range.startContainer.previousSibling : range.startContainer.nextSibling; if (!(target instanceof HTMLElement) || !target.dataset.segment) return false; const next = key === "Backspace" ? target.previousSibling : target.nextSibling; target.remove(); const caret = document.createRange(); if (next?.parentNode) key === "Backspace" ? caret.setStartAfter(next) : caret.setStartBefore(next); else caret.selectNodeContents(root), caret.collapse(key === "Backspace"); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret); return true; }
function setCaretAfter(node: Node) { const selection = window.getSelection(); const range = document.createRange(); range.setStartAfter(node); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range); }
function focusEnd(root: HTMLDivElement | null) { if (!root) return; root.focus(); const range = document.createRange(); range.selectNodeContents(root); range.collapse(false); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
function insertText(root: HTMLDivElement | null, value: string, after: () => void) { if (!root) return; root.focus(); const selection = window.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : null; const node = document.createTextNode(value); if (range && root.contains(range.startContainer)) { range.deleteContents(); range.insertNode(node); } else root.append(node); setCaretAfter(node); after(); }
