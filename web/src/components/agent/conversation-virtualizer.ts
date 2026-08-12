export type VirtualItem = { index: number; top: number; height: number };
export function getVirtualWindow(heights: number[], scrollTop: number, viewportHeight: number, enabled = heights.length > 80) {
    const total = heights.reduce((sum, height) => sum + height, 0); if (!enabled) return { total, items: heights.map((height, index) => ({ index, top: heights.slice(0, index).reduce((sum, item) => sum + item, 0), height })) };
    const start = Math.max(0, scrollTop - viewportHeight * 2); const end = scrollTop + viewportHeight * 3; const items: VirtualItem[] = []; let top = 0;
    heights.forEach((height, index) => { if (top + height >= start && top <= end) items.push({ index, top, height }); top += height; }); return { total, items };
}
