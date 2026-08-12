import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Dropdown, Tooltip } from "antd";
import { ArrowUp, AtSign, FileUp, LoaderCircle, Paperclip, Sparkles, Square, X } from "lucide-react";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { randomId } from "@/lib/utils";
import type { AgentComposerDocument, AgentComposerSegment, AgentSkill } from "@/services/api/agent";
import type { ServerFile } from "@/services/api/server";
import { composerHasContent, normalizeComposerDocument, segmentLabel } from "./agent-composer-model";

type MentionCandidate = { key: string; label: string; detail: string; segment: Exclude<AgentComposerSegment, { type: "text" }> };
const COMPOSER_CLIPBOARD = "application/x-infinite-canvas-agent-composer";

export function AgentComposer({ document: composerDocument, projectId, ready, busy, waiting, sending, uploading, attachments, skills, nodes, focusRequest, followUpMode, onDocumentChange, onFollowUpModeChange, onSend, onCancel, onUpload, onRemoveAttachment }: {
    document: AgentComposerDocument; ready: boolean; busy: boolean; waiting: boolean; sending: boolean; uploading: boolean; attachments: ServerFile[];
    projectId: string;
    skills: AgentSkill[]; nodes: CanvasResourceReference[]; focusRequest: number; followUpMode: "steer" | "queue";
    onDocumentChange: (document: AgentComposerDocument) => void; onFollowUpModeChange: (mode: "steer" | "queue") => void; onSend: () => void; onCancel: () => void; onUpload: (files: File[]) => void; onRemoveAttachment: (id: string) => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null); const composing = useRef(false); const dragDepth = useRef(0);
    const [trigger, setTrigger] = useState<{ kind: "skill" | "reference"; query: string; range: Range } | null>(null);
    const [active, setActive] = useState(0); const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null); const [dragging, setDragging] = useState(false);
    const candidates = useMemo<MentionCandidate[]>(() => trigger?.kind === "skill"
        ? skills.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(trigger.query.toLowerCase())).slice(0, 8).map((item) => ({ key: `skill:${item.id}`, label: `/${item.name}`, detail: item.description, segment: { type: "skill", mentionId: randomId(), skillId: item.id, label: item.name } }))
        : nodes.filter((item) => `${item.title} ${item.kind}`.toLowerCase().includes(trigger?.query.toLowerCase() || "")).slice(0, 8).map((item) => ({ key: `node:${item.nodeId}`, label: `@${item.title}`, detail: item.kind, segment: { type: "canvas", mentionId: randomId(), projectId, nodeId: item.nodeId, label: item.title } })), [nodes, projectId, skills, trigger]);

    useEffect(() => { renderDocument(rootRef.current, composerDocument); }, [composerDocument]);
    useEffect(() => { if (focusRequest) requestAnimationFrame(() => focusEnd(rootRef.current)); }, [focusRequest]);
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
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
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
            {attachments.length ? <div className="agent-attachment-strip">{attachments.map((file) => <div className="agent-attachment" key={file.id}><span className="truncate">{file.name}</span><button type="button" onClick={() => onRemoveAttachment(file.id)} aria-label={`移除${file.name}`}><X className="size-3" /></button></div>)}</div> : null}
            <div ref={rootRef} role="textbox" aria-multiline="true" data-placeholder={ready ? "描述任务，输入 / 调用 Skill，@ 引用节点…" : "管理员配置 Agent 模型后即可使用"} contentEditable={ready} suppressContentEditableWarning className="agent-composer-editor thin-scrollbar" onInput={() => { emit(); detect(); }} onClick={detect} onKeyUp={detect} onKeyDown={keyDown} onCopy={copy} onPaste={paste} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; detect(); }} />
            <div className="agent-composer-actions"><div className="flex items-center gap-1"><input ref={fileRef} type="file" multiple hidden onChange={(event) => { onUpload(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /><Tooltip title="添加附件，也可以粘贴或拖入"><button type="button" className="agent-composer-action" onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</button></Tooltip><Tooltip title="引用画布内容"><button type="button" className="agent-composer-action" onClick={() => insertText(rootRef.current, "@", detect)}><AtSign className="size-4" /></button></Tooltip><Tooltip title="调用 Skill"><button type="button" className="agent-composer-action" onClick={() => insertText(rootRef.current, "/", detect)}><Sparkles className="size-4" /></button></Tooltip></div>
                <div className="flex items-center gap-2">{busy ? <Dropdown menu={followMenu} trigger={["click"]} placement="topRight"><button type="button" className="agent-follow-mode">{waiting ? "稍后" : followUpMode === "queue" ? "稍后" : "马上"}</button></Dropdown> : null}<button type="button" className="agent-send" disabled={!canSend} onClick={onSend} aria-label="发送"><ArrowUp className="size-4" /></button>{busy ? <button type="button" className="agent-stop" onClick={onCancel} aria-label="停止"><Square className="size-3.5 fill-current" /></button> : null}</div></div>
            {dragging ? <div className="agent-drop-overlay"><span><FileUp className="size-5" />松手添加到输入框</span></div> : null}
        </div>
        {trigger && position ? createPortal(<div className="agent-mention-menu" style={{ left: position.left, top: position.top, width: position.width, transform: "translateY(-100%)" }}><header><strong>{trigger.kind === "skill" ? "引用技能" : "引用画布"}</strong><span>{trigger.query ? `搜索：${trigger.query}` : "选择要加入的内容"}</span></header><div className="max-h-72 overflow-y-auto p-1.5 thin-scrollbar">{candidates.length ? candidates.map((candidate, index) => <button key={candidate.key} type="button" className={index === active ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(candidate)}><i>{candidate.segment.type === "skill" ? <Sparkles className="size-4" /> : <AtSign className="size-4" />}</i><span><strong>{candidate.label}</strong><small>{candidate.detail}</small></span></button>) : <p>没有匹配项</p>}</div></div>, document.body) : null}
    </div>;
}

function Mode({ title, detail }: { title: string; detail: string }) { return <span className="flex min-w-36 flex-col"><strong>{title}</strong><small className="opacity-55">{detail}</small></span>; }
function tokenNode(segment: Exclude<AgentComposerSegment, { type: "text" }>) { const node = document.createElement("span"); node.contentEditable = "false"; node.className = `agent-mention-token ${segment.type === "skill" ? "is-skill" : ""}`; node.dataset.segment = JSON.stringify(segment); node.textContent = segmentLabel(segment); return node; }
function renderDocument(root: HTMLDivElement | null, value: AgentComposerDocument) { if (!root || root.contains(document.activeElement)) return; root.replaceChildren(...normalizeComposerDocument(value).segments.map((segment) => segment.type === "text" ? document.createTextNode(segment.text) : tokenNode(segment))); }
function readDocument(root: HTMLDivElement | null): AgentComposerDocument { const segments: AgentComposerSegment[] = []; root?.childNodes.forEach((node) => { if (node.nodeType === Node.TEXT_NODE) segments.push({ type: "text", text: node.textContent || "" }); else if (node instanceof HTMLBRElement) segments.push({ type: "text", text: "\n" }); else if (node instanceof HTMLElement && node.dataset.segment) { try { segments.push(JSON.parse(node.dataset.segment)); } catch { segments.push({ type: "text", text: node.textContent || "" }); } } else segments.push({ type: "text", text: node.textContent || "" }); }); return normalizeComposerDocument({ version: 1, segments }); }
function readNodes(nodes: NodeListOf<ChildNode> | NodeList): AgentComposerDocument { const holder = document.createElement("div"); Array.from(nodes).forEach((node) => holder.append(node.cloneNode(true))); return readDocument(holder); }
function insertSegments(root: HTMLDivElement | null, segments: AgentComposerSegment[]) { if (!root) return; root.focus(); const selection = window.getSelection(); const range = selection?.rangeCount && root.contains(selection.anchorNode) ? selection.getRangeAt(0) : document.createRange(); if (!selection?.rangeCount || !root.contains(selection.anchorNode)) range.selectNodeContents(root), range.collapse(false); range.deleteContents(); const fragment = document.createDocumentFragment(); segments.forEach((segment) => fragment.append(segment.type === "text" ? document.createTextNode(segment.text) : tokenNode(segment))); const last = fragment.lastChild; range.insertNode(fragment); if (last) setCaretAfter(last); }
function deleteAdjacentToken(root: HTMLDivElement | null, key: "Backspace" | "Delete") { const selection = window.getSelection(); if (!root || !selection?.rangeCount || !selection.isCollapsed) return false; const range = selection.getRangeAt(0); let target: Node | null = null; if (range.startContainer === root) target = root.childNodes[range.startOffset + (key === "Backspace" ? -1 : 0)] || null; else if (range.startContainer.nodeType === Node.TEXT_NODE && ((key === "Backspace" && range.startOffset === 0) || (key === "Delete" && range.startOffset === range.startContainer.textContent?.length))) target = key === "Backspace" ? range.startContainer.previousSibling : range.startContainer.nextSibling; if (!(target instanceof HTMLElement) || !target.dataset.segment) return false; const next = key === "Backspace" ? target.previousSibling : target.nextSibling; target.remove(); const caret = document.createRange(); if (next?.parentNode) key === "Backspace" ? caret.setStartAfter(next) : caret.setStartBefore(next); else caret.selectNodeContents(root), caret.collapse(key === "Backspace"); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret); return true; }
function setCaretAfter(node: Node) { const selection = window.getSelection(); const range = document.createRange(); range.setStartAfter(node); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range); }
function focusEnd(root: HTMLDivElement | null) { if (!root) return; root.focus(); const range = document.createRange(); range.selectNodeContents(root); range.collapse(false); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
function insertText(root: HTMLDivElement | null, value: string, after: () => void) { if (!root) return; root.focus(); const selection = window.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : null; const node = document.createTextNode(value); if (range && root.contains(range.startContainer)) { range.deleteContents(); range.insertNode(node); } else root.append(node); setCaretAfter(node); after(); }
