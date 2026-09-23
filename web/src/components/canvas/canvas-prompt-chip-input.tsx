import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, Ref, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Image } from "antd";
import { ChevronRight, FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasPromptInputHandle = { insertReference: (reference: CanvasResourceReference) => void };

type Props = {
    ref?: Ref<CanvasPromptInputHandle>;
    textReferences?: boolean;
    value: string;
    references: CanvasResourceReference[];
    onActivateReference?: (reference: CanvasResourceReference) => Promise<void> | void;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
};

type MentionState = {
    query: string;
    rect: DOMRect | null;
};

type Token =
    | { type: "text"; value: string }
    | { type: "reference"; label: string };

// Atomic references can render as identifiers or thumbnail chips.
// Serialization converts chips back to reference labels so the generated value matches the former textarea semantics.
export function CanvasPromptChipInput({ ref, textReferences = false, value, references, onActivateReference, onChange, onSubmit, className, style, placeholder }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const [composing, setComposing] = useState(false);
    const savedRangeRef = useRef<Range | null>(null);
    const rememberCaret = () => {
        const selection = window.getSelection();
        if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    };
    // Track the last value emitted to the parent. An identical focused value is this component's own echo,
    // so skip rebuilding to preserve the caret and IME. Rebuild external changes even while focused.
    const lastEmittedRef = useRef(value);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [showCanvasReferences, setShowCanvasReferences] = useState(false);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    const activeReferences = useMemo(() => references.filter((item) => item.active), [references]);
    const referenceByLabel = useMemo(() => new Map(references.map((item) => [item.label, item])), [references]);
    // Match longer labels first so a shorter label cannot split a longer one.
    const activeLabels = useMemo(() => Array.from(new Set(references.map((item) => item.label))).sort((a, b) => b.length - a.length), [references]);
    const tokens = useMemo(() => parseTokens(value, activeLabels), [value, activeLabels]);

    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const ordered = [...activeReferences, ...references.filter((item) => !item.active)];
        const visible = query || showCanvasReferences ? ordered : activeReferences;
        if (!query) return visible;
        return visible.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, activeReferences, references, showCanvasReferences]);

    // Rebuild the DOM from value when unfocused, or when a focused value is an external change rather than an emitted echo.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (document.activeElement === editor && value === lastEmittedRef.current) return;
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            const reference = referenceByLabel.get(token.label);
            if (reference) editor.append(createReferenceChip(reference, theme, setImagePreview, textReferences));
            else editor.append(document.createTextNode(token.label));
        });
        lastEmittedRef.current = value;
    }, [tokens, referenceByLabel, theme, value, textReferences]);

    const emit = (next: string) => {
        lastEmittedRef.current = next;
        onChange(next);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        emit(serializeEditor(editor));
        syncMention();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !references.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "", rect: caretRect() });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
        setShowCanvasReferences(false);
    };

    const insertReference = (reference: CanvasResourceReference, fromMenu = true) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        if (!fromMenu) {
            const selection = window.getSelection();
            const saved = savedRangeRef.current;
            if (saved && editor.contains(saved.startContainer)) { selection?.removeAllRanges(); selection?.addRange(saved); }
            else placeCaretAtEnd(editor);
        }
        if (!reference.active) {
            void onActivateReference?.(reference);
            if (textReferences && reference.kind === "image") reference = { ...reference, label: `@${imageReferenceLabel(activeReferences.filter((item) => item.kind === "image").length)}` };
        }
        if (fromMenu) removeActiveMention();
        const chip = createReferenceChip(reference, theme, setImagePreview, textReferences);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        emit(serializeEditor(editor));
        rememberCaret();
    };
    useImperativeHandle(ref, () => ({ insertReference: (reference) => insertReference(reference, false) }));

    const showPlaceholder = !composing && !value.trim();

    return (
        <div className="relative w-full">
            {showPlaceholder && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm leading-5" style={{ color: theme.node.placeholder }}>
                    {placeholder}
                </div>
            ) : null}
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words outline-none`}
                style={{ ...style, cursor: "text" }}
                onInput={() => {
                    if (!composingRef.current) syncFromEditor();
                }}
                onCompositionStart={() => {
                    composingRef.current = true;
                    setComposing(true);
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    setComposing(false);
                    syncFromEditor();
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    if (isImeComposing(event)) return;
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(event.key)) {
                        event.preventDefault();
                        requestAnimationFrame(syncFromEditor);
                        return;
                    }
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    requestAnimationFrame(syncMention);
                }}
                onKeyUp={rememberCaret}
                onMouseUp={rememberCaret}
                onBlur={() => { rememberCaret(); window.setTimeout(closeMention, 120); }}
            />
            {mention && (candidates.length || references.some((item) => !item.active)) ? (
                <MentionMenu rect={mention.rect} references={candidates} activeCount={candidates.filter((item) => item.active).length} hasMore={references.some((item) => !item.active)} expanded={showCanvasReferences || Boolean(mention.query.trim())} activeIndex={Math.min(activeIndex, Math.max(0, candidates.length - 1))} theme={theme} onExpand={(open) => { setShowCanvasReferences(open); setActiveIndex(0); }} onSelect={insertReference} />
            ) : null}
            {imagePreview ? <Image src={imagePreview} alt={i18n.t("canvas.composer.imagePreview")} style={{ display: "none" }} preview={{ visible: true, src: imagePreview, onVisibleChange: (visible) => !visible && setImagePreview(null) }} /> : null}
        </div>
    );
}

function MentionMenu({ rect, references, activeCount, hasMore, expanded, activeIndex, theme, onExpand, onSelect }: { rect: DOMRect | null; references: CanvasResourceReference[]; activeCount: number; hasMore: boolean; expanded: boolean; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onExpand: (open: boolean) => void; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);
    const [hovered, setHovered] = useState<{ reference: CanvasResourceReference; rect: DOMRect } | null>(null);
    useEffect(() => { activeItemRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex, references]);
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };
    const menuWidth = 256;
    const anchor = rect || new DOMRect(16, 16, 0, 0);
    const left = clamp(anchor.left, 8, window.innerWidth - menuWidth - 8);
    const top = clamp(anchor.bottom + 6, 8, window.innerHeight - 264);
    const submenuLeft = left + menuWidth * 2 + 8 <= window.innerWidth ? menuWidth - 1 : -menuWidth + 1;
    const panelStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text };
    const renderReference = (reference: CanvasResourceReference) => {
        const index = references.indexOf(reference);
        return <button key={reference.id} ref={index === activeIndex ? activeItemRef : undefined} type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
            style={{ background: (hovered ? hovered.reference.id === reference.id : index === activeIndex) ? theme.toolbar.activeBg : "transparent" }}
            onMouseEnter={(event) => setHovered({ reference, rect: event.currentTarget.parentElement!.getBoundingClientRect() })}
            onFocus={(event) => setHovered({ reference, rect: event.currentTarget.parentElement!.getBoundingClientRect() })}
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); selectReference(reference); }}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); selectReference(reference); }}>
            <ReferencePreview reference={reference} />
            <span className="min-w-0 flex-1 truncate">{reference.title}</span>
        </button>;
    };
    return createPortal(<>
        <div data-canvas-no-zoom data-canvas-resource-mention-menu="true" className="fixed z-[1290] w-64 rounded-xl border p-1.5 shadow-xl"
            style={{ ...panelStyle, left, top }} onMouseLeave={() => setHovered(null)}
            onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            {activeCount ? <div className="px-2 py-1 text-[11px] opacity-45">素材引用</div> : null}
            <div className="thin-scrollbar max-h-48 overflow-y-auto">{references.filter((item) => item.active).map(renderReference)}</div>
            {hasMore ? <button type="button" aria-expanded={expanded} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10"
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setHovered(null); onExpand(!expanded); }}>
                <ImageIcon className="size-4" /><span className="flex-1">图片</span><span className="opacity-40">{expanded ? "收起" : "展开"}</span><ChevronRight className="size-3.5 opacity-40" />
            </button> : null}
            {hasMore && expanded ? <div data-canvas-reference-group="image" className="absolute top-0 w-64 rounded-xl border p-1.5 shadow-xl" style={{ ...panelStyle, left: submenuLeft }}>
                <div className="flex items-center gap-1 px-2 py-1 text-[11px] opacity-45"><ImageIcon className="size-3" />图片</div>
                <div className="thin-scrollbar max-h-60 overflow-y-auto">{references.filter((item) => !item.active).map(renderReference)}</div>
            </div> : null}
        </div>
        {hovered?.reference.kind === "image" && hovered.reference.previewUrl ? <div data-canvas-reference-hover-preview className="pointer-events-none fixed z-[1291] w-64 overflow-hidden rounded-xl border p-2 shadow-xl"
            style={{ ...panelStyle, left: hovered.rect.right + 264 <= window.innerWidth ? hovered.rect.right + 8 : Math.max(8, hovered.rect.left - 264), top: clamp(hovered.rect.top, 8, window.innerHeight - 300) }}>
            <div className="truncate px-1 pb-2 text-xs">{hovered.reference.title}</div><img src={hovered.reference.previewUrl} alt={hovered.reference.title} className="max-h-60 w-full rounded-lg object-contain" />
        </div> : null}
    </>, document.body);
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(reference: CanvasResourceReference, theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (url: string) => void, textReferences = false) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.refLabel = reference.label;
    if (textReferences) {
        wrapper.className = "mx-px inline font-medium";
        wrapper.style.color = theme.node.text;
        wrapper.textContent = reference.label;
        wrapper.title = reference.title;
    } else if (reference.kind === "image" && reference.previewUrl) {
        const image = document.createElement("img");
        image.src = reference.previewUrl;
        image.alt = reference.title;
        image.className = "size-6 rounded object-cover";
        wrapper.className = "mx-px inline-flex size-6 items-center justify-center overflow-hidden rounded align-middle";
        wrapper.appendChild(image);
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(reference.previewUrl || "");
        });
    } else {
        wrapper.className = "mx-px inline-flex h-6 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
        Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text } as CSSProperties);
        wrapper.title = reference.text || reference.title;
        const text = document.createElement("span");
        text.className = "block truncate";
        text.textContent = reference.kind === "text" ? reference.text || reference.title : reference.label;
        wrapper.appendChild(text);
    }
    return wrapper;
}

function serializeEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/﻿/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const label = node.dataset.refLabel;
        if (label) result += label;
        else if (node.tagName === "BR") result += "\n";
        else result += serializeNodes(node.childNodes);
    });
    return result;
}

function removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret();
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

// Chips are atomic contentEditable="false" blocks and are removed as a unit with adjacent Backspace/Delete presses.
function deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && current.dataset.refLabel ? current : null;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function caretRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height || rect.left || rect.top) return rect;
    // Empty lines and editors produce a zero-sized range, so fall back to the editor bounds.
    const editor = closestEditor(range.startContainer);
    return editor ? editor.getBoundingClientRect() : null;
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

// Split value into text fragments and matching active labels, which are already sorted by descending length.
function parseTokens(value: string, labels: string[]): Token[] {
    if (!labels.length) return value ? [{ type: "text", value }] : [];
    const escaped = labels.map(escapeRegExp).join("|");
    const pattern = new RegExp(`(${escaped})`, "g");
    const tokens: Token[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        tokens.push({ type: "reference", label: match[0] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
