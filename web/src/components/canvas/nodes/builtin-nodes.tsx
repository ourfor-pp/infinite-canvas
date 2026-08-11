import { Box, FileText, Group, Image as ImageIcon, MapPinned, Music2, Settings2, UserRound, Video } from "lucide-react";

import i18n from "@/i18n";

import { NODE_SPECS } from "@/constant/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import { CREATIVE_ASSET_NODE_LAYOUT, type CreativeAssetKind } from "@/types/creative-asset";
import { CreativeAssetNodeContent } from "./creative-asset-node";

// Extensible metadata for built-in nodes, reusing NODE_SPECS for size and initial metadata.
// Rendering remains in canvas-node's internal renderer, so no Content component is provided.
function builtinResource(node: CanvasNodeData): CanvasNodeResource | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return { kind: "image", url: node.metadata.content };
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return { kind: "video", url: node.metadata.content };
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return { kind: "audio", url: node.metadata.content };
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return { kind: "text", text: node.metadata.content || node.metadata.prompt };
    return null;
}

const iconClass = "size-5";

const STANDARD_DEFINITIONS: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: i18n.t("assets.kinds.text"), icon: <FileText className={iconClass} />, minimapColor: undefined, resource: builtinResource },
    { type: CanvasNodeType.Image, title: i18n.t("assets.kinds.image"), icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource },
    { type: CanvasNodeType.Video, title: i18n.t("assets.kinds.video"), icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource },
    { type: CanvasNodeType.Audio, title: i18n.t("assets.kinds.audio"), icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource },
    { type: CanvasNodeType.Config, title: i18n.t("canvas.configNode.title"), icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa", hasSourceHandle: false },
    { type: CanvasNodeType.Group, title: i18n.t("canvas.node.group"), icon: <Group className={iconClass} />, minimapColor: "#94a3b8" },
].map((def) => {
    const spec = NODE_SPECS[def.type as CanvasNodeType];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = [
    ...STANDARD_DEFINITIONS,
    ...(["character", "scene", "prop"] as CreativeAssetKind[]).map((kind): CanvasNodeDefinition => ({
        type: kind,
        title: CREATIVE_ASSET_NODE_LAYOUT[kind].title,
        description: kind === "character" ? "角色视觉设计图、描述与声音参考" : kind === "scene" ? "场景视觉描述与设计图" : "道具视觉描述与多视图设计图",
        icon: kind === "character" ? <UserRound className={iconClass} /> : kind === "scene" ? <MapPinned className={iconClass} /> : <Box className={iconClass} />,
        defaultSize: CREATIVE_ASSET_NODE_LAYOUT[kind],
        resizable: false,
        defaultMetadata: { assetKind: kind },
        minimapColor: kind === "character" ? "#c8654a" : kind === "scene" ? "#267b70" : "#a5792d",
        showInCreateMenu: false,
        hidePanel: true,
        Content: CreativeAssetNodeContent,
    })),
];

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(BUILTIN_DEFINITIONS, "builtin");
}
