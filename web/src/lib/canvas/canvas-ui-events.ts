export const focusVisualStyleEvent = "infinite-canvas:focus-visual-style";
export const editCreativeAssetMediaEvent = "infinite-canvas:edit-creative-asset-media";

export function requestVisualStyleFocus(styleId?: string) {
    window.dispatchEvent(new CustomEvent(focusVisualStyleEvent, { detail: { styleId } }));
}
