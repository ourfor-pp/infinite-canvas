import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export function getNodeToolbarLayout(node: CanvasNodeData, viewport: ViewportTransform) {
    const above = viewport.y + node.position.y * viewport.k - 10;
    const below = above - 48 < 72; // Leave room for the 64px canvas top bar.
    return { below, top: below ? viewport.y + (node.position.y + node.height) * viewport.k + 10 : above };
}
