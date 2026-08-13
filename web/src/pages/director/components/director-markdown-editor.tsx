import { useEffect, useRef, type ReactNode } from "react";
import { Tooltip } from "antd";
import { Editor, commandsCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history, redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark, createCodeBlockCommand, insertHrCommand, toggleEmphasisCommand, toggleStrongCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand } from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { $Command } from "@milkdown/kit/utils";
import { Bold, CheckCircle2, Code2, Italic, List, ListOrdered, Loader2, Minus, Quote, Redo2, Strikethrough, Table, Undo2 } from "lucide-react";

export function DirectorMarkdownEditor({ content, dirty, saving, label, placeholder, onChange }: { content: string; dirty: boolean; saving: boolean; label: string; placeholder: string; onChange: (content: string) => void }) {
    return <MilkdownProvider><DirectorMarkdownEditorInner content={content} dirty={dirty} saving={saving} label={label} placeholder={placeholder} onChange={onChange} /></MilkdownProvider>;
}

function DirectorMarkdownEditorInner({ content, dirty, saving, label, placeholder, onChange }: { content: string; dirty: boolean; saving: boolean; label: string; placeholder: string; onChange: (content: string) => void }) {
    const loadingRef = useRef(true);
    const onChangeRef = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    const { get, loading } = useEditor((root) => Editor.make().config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, content || "");
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, listItemIndent: "one" as const }));
        ctx.set(editorViewOptionsCtx, { attributes: { class: "director-markdown-editor-prose", role: "textbox", "aria-label": label, "data-placeholder": placeholder } });
    }).use(commonmark).use(gfm).use(history).use(clipboard).use(listener).config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previous) => {
            if (!loadingRef.current && markdown !== previous) onChangeRef.current(markdown);
        });
    }), []);
    useEffect(() => { if (!loading) loadingRef.current = false; }, [loading]);
    const command = <T,>(value: $Command<T>, payload?: T) => get()?.action((ctx) => { ctx.get(commandsCtx).call(value.key, payload); ctx.get(editorViewCtx).focus(); });
    return <section className="director-markdown-editor">
        <div className="director-markdown-toolbar">
            <Tool label="撤销" onClick={() => command(undoCommand)}><Undo2 /></Tool><Tool label="重做" onClick={() => command(redoCommand)}><Redo2 /></Tool><Divider />
            <Tool label="加粗" onClick={() => command(toggleStrongCommand)}><Bold /></Tool><Tool label="斜体" onClick={() => command(toggleEmphasisCommand)}><Italic /></Tool><Tool label="删除线" onClick={() => command(toggleStrikethroughCommand)}><Strikethrough /></Tool><Divider />
            <Tool label="引用" onClick={() => command(wrapInBlockquoteCommand)}><Quote /></Tool><Tool label="代码块" onClick={() => command(createCodeBlockCommand)}><Code2 /></Tool><Tool label="分割线" onClick={() => command(insertHrCommand)}><Minus /></Tool><Divider />
            <Tool label="无序列表" onClick={() => command(wrapInBulletListCommand)}><List /></Tool><Tool label="有序列表" onClick={() => command(wrapInOrderedListCommand)}><ListOrdered /></Tool><Tool label="插入表格" onClick={() => command(insertTableCommand)}><Table /></Tool>
            <span className="director-markdown-save-state" data-state={saving ? "saving" : dirty ? "dirty" : "saved"}>{saving ? <Loader2 /> : <CheckCircle2 />}{saving ? "保存中" : dirty ? "未保存" : "已保存"}</span>
        </div>
        <div className={`director-markdown-canvas thin-scrollbar ${loading ? "is-loading" : ""}`}><Milkdown /></div>
    </section>;
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    return <Tooltip title={label}><button type="button" className="director-markdown-tool" aria-label={label} onClick={onClick}>{children}</button></Tooltip>;
}

function Divider() { return <span className="director-markdown-toolbar-divider" />; }
