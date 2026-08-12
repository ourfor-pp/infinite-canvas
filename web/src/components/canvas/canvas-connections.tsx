import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";
import { compatibleSourcePort, compatibleTargetPort, portAnchor, portById } from "@/lib/canvas/canvas-ports";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const start = portAnchor(from, connection.fromPortId, "output");
    const end = portAnchor(to, connection.toPortId, "input");
    const startX = start.x;
    const startY = start.y;
    const endX = end.x;
    const endY = end.y;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 3 : 2}
                strokeOpacity={active ? 1 : 0.82}
                fill="none"
                style={{ filter: active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined, pointerEvents: "none" }}
            />
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const anchor = portAnchor(node, handle.portId, handle.handleType === "source" ? "output" : "input");
    const fixedPort = portById(node, handle.portId, handle.handleType === "source" ? "output" : "input");
    const targetPort = target && fixedPort ? (handle.handleType === "source" ? compatibleTargetPort(fixedPort, target, []) : compatibleSourcePort(fixedPort, target)) : undefined;
    const targetAnchor = target ? portAnchor(target, targetPort?.id || (handle.handleType === "source" ? "input" : "output"), handle.handleType === "source" ? "input" : "output") : null;
    const startX = handle.handleType === "source" ? anchor.x : mouseWorld.x;
    const startY = handle.handleType === "source" ? anchor.y : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : anchor.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : anchor.y;
    const snappedStartX = handle.handleType === "target" && targetAnchor ? targetAnchor.x : startX;
    const snappedStartY = handle.handleType === "target" && targetAnchor ? targetAnchor.y : startY;
    const snappedEndX = handle.handleType === "source" && targetAnchor ? targetAnchor.x : endX;
    const snappedEndY = handle.handleType === "source" && targetAnchor ? targetAnchor.y : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
