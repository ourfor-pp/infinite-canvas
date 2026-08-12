const IMAGE_PREVIEW_SELECTOR = ".ant-image-preview,.ant-image-preview-root,.ant-image-preview-wrap";

export function isCanvasImagePreviewTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(IMAGE_PREVIEW_SELECTOR));
}
