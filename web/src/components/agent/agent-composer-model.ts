import type { AgentComposerDocument, AgentComposerSegment } from "@/services/api/agent";

export const EMPTY_COMPOSER_DOCUMENT: AgentComposerDocument = { version: 1, segments: [{ type: "text", text: "" }] };

export function normalizeComposerDocument(document?: AgentComposerDocument): AgentComposerDocument {
    if (!document || document.version !== 1 || !Array.isArray(document.segments)) return EMPTY_COMPOSER_DOCUMENT;
    const segments: AgentComposerSegment[] = [];
    for (const segment of document.segments) {
        if (segment.type === "text" && !segment.text) continue;
        const previous = segments.at(-1);
        if (segment.type === "text" && previous?.type === "text") previous.text += segment.text;
        else segments.push({ ...segment });
    }
    if (!segments.length) segments.push({ type: "text", text: "" });
    return { version: 1, segments };
}

export function composerPlainText(document: AgentComposerDocument) {
    return document.segments.map((segment) => segment.type === "text" ? segment.text : segmentLabel(segment)).join("");
}

export function composerHasContent(document: AgentComposerDocument) {
    return document.segments.some((segment) => segment.type === "text" ? Boolean(segment.text.trim()) : true);
}

export function segmentLabel(segment: Exclude<AgentComposerSegment, { type: "text" }>) { return `${segment.type === "skill" ? "/" : "@"}${segment.label || (segment.type === "skill" ? segment.skillId : segment.type === "canvas" ? segment.nodeId : segment.type === "asset" ? segment.assetId : segment.type === "style" ? segment.styleId : segment.entityId)}`; }

export function serializeComposer(document: AgentComposerDocument) { return JSON.stringify(normalizeComposerDocument(document)); }
export function parseComposer(value: string | null | undefined) { try { return normalizeComposerDocument(JSON.parse(value || "") as AgentComposerDocument); } catch { return EMPTY_COMPOSER_DOCUMENT; } }
