export type ImagePreviewActionItem = { url: string; alt: string };

function safeFileName(value: string) {
    return String(value || "图片").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim() || "图片";
}

async function loadImage(item: ImagePreviewActionItem) {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`读取图片失败：HTTP ${response.status}`);
    return response.blob();
}

function extension(blob: Blob) {
    if (blob.type === "image/jpeg") return "jpg";
    if (blob.type === "image/webp") return "webp";
    if (blob.type === "image/gif") return "gif";
    return "png";
}

async function asPng(blob: Blob) {
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("图片转换失败")), "image/png"));
}

export async function copyPreviewImage(item: ImagePreviewActionItem) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前浏览器不支持复制图片");
    const blob = await asPng(await loadImage(item));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export async function downloadPreviewImage(item: ImagePreviewActionItem) {
    const blob = await loadImage(item);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${safeFileName(item.alt)}.${extension(blob)}`;
    anchor.rel = "noopener";
    anchor.click();
    URL.revokeObjectURL(objectUrl);
}
