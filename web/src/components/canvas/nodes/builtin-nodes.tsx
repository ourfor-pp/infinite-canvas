import { Box, FileText, Group, Image as ImageIcon, MapPinned, Music2, Palette, Settings2, UserRound, Video } from "lucide-react";

import i18n from "@/i18n";

import { NODE_SPECS } from "@/constant/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodePort } from "@/types/canvas";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import { CREATIVE_ASSET_NODE_LAYOUT, type CreativeAssetKind } from "@/types/creative-asset";
import { CreativeAssetNodeContent } from "./creative-asset-node";
import { VisualStyleNodeContent } from "./visual-style-node";

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
const outputPort = (dataType: CanvasNodePort["dataType"]): CanvasNodePort => ({ id: "output", label: "输出", direction: "output", dataType, multiple: true, position: 0.5 });
const inputPort: CanvasNodePort = { id: "input", label: "输入", direction: "input", dataType: "text", accepts: ["text", "image", "audio", "video", "creative-asset"], multiple: true, position: 0.5 };

const STANDARD_DEFINITIONS: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: i18n.t("assets.kinds.text"), icon: <FileText className={iconClass} />, minimapColor: undefined, resource: builtinResource, ports: [inputPort, outputPort("text")] },
    { type: CanvasNodeType.Image, title: i18n.t("assets.kinds.image"), icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource, ports: [inputPort, outputPort("image")] },
    { type: CanvasNodeType.Video, title: i18n.t("assets.kinds.video"), icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource, ports: [inputPort, outputPort("video")] },
    { type: CanvasNodeType.Audio, title: i18n.t("assets.kinds.audio"), icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource, ports: [inputPort, outputPort("audio")] },
    { type: CanvasNodeType.Config, title: i18n.t("canvas.configNode.title"), icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa", hasSourceHandle: false, ports: [inputPort] },
    { type: CanvasNodeType.Group, title: i18n.t("canvas.node.group"), icon: <Group className={iconClass} />, minimapColor: "#94a3b8" },
].map((def) => {
    const spec = NODE_SPECS[def.type as CanvasNodeType];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = [
    ...STANDARD_DEFINITIONS,
    { type: "visual-style", title: "视觉风格", description: "项目统一的画面风格锚点", icon: <Palette className={iconClass} />, defaultSize: { width: 380, height: 500 }, resizable: false, defaultMetadata: {}, minimapColor: "#d26b98", showInCreateMenu: false, hidePanel: true, Content: VisualStyleNodeContent, ports: [{ id: "style", label: "视觉风格", direction: "output", dataType: "visual-style", multiple: true, position: 0.5 }] },
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
        ports: [
            { id: "reference-image", label: "参考图", direction: "input", dataType: "image", multiple: true, position: 0.27 },
            { id: "setting", label: "设定文本", direction: "input", dataType: "text", multiple: true, position: 0.56 },
            { id: "style", label: "视觉风格", direction: "input", dataType: "visual-style", multiple: false, position: 0.67 },
            { id: "reference-audio", label: kind === "character" ? "参考声音" : kind === "scene" ? "参考环境声" : "参考音效", direction: "input", dataType: "audio", multiple: false, position: 0.77 } satisfies CanvasNodePort,
            { id: "asset", label: `${CREATIVE_ASSET_NODE_LAYOUT[kind].title}资产`, direction: "output", dataType: "creative-asset", multiple: true, position: 0.5 },
        ],
    })),
];

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(BUILTIN_DEFINITIONS, "builtin");
}
