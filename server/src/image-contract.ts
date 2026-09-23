/** Public image inputs; dedicated editing workflows keep their own contracts. */
export type ImageParameters = { sizes?: string[]; qualities?: string[]; backgrounds?: string[]; maxCount?: number };
export type ImageContract = { version: 1; modes: string[]; maxReferenceImages: number; sizes: string[]; qualities: string[]; backgrounds: string[]; maxCount: number; sizeLabel: string; editSizes?: string[]; editSizeLabel?: string };
const pixels = ["auto", "1024x1024", "1536x1024", "1024x1536", "1344x1024", "1024x1344", "1792x1024", "1024x1792", "2048x2048"];
const qwen21Pixels = [...pixels, "2400x1792", "1792x2400", "2528x1696", "1696x2528", "2752x1536", "1536x2752"];
const ratios = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];
export function imageContractFor(model: { id: string; endpoint?: string; imageModes?: string[]; maxReferenceImages?: number; imageParameters?: ImageParameters }): ImageContract | undefined {
    if (!model.imageModes?.length) return undefined;
    let parameters: Required<ImageParameters>;
    let sizeLabel = "尺寸";
    if (model.endpoint === "gemini-image") { parameters = { sizes: ratios, qualities: [], backgrounds: [], maxCount: 1 }; sizeLabel = "画面比例"; }
    else if (model.endpoint === "ark-image") parameters = { sizes: ["auto", "2048x2048", "2560x1440", "1440x2560"], qualities: [], backgrounds: [], maxCount: 1 };
    else if (model.id === "qwen-image-2.1-local") parameters = { sizes: qwen21Pixels, qualities: [], backgrounds: ["auto", "transparent"], maxCount: 1 };
    else if (model.id === "qwen-image-edit-2511-local") { parameters = { sizes: ["auto"], qualities: ["auto", "high"], backgrounds: [], maxCount: 1 }; sizeLabel = "尺寸（跟随参考图）"; }
    else if (model.id.endsWith("-local")) {
        parameters = { sizes: pixels, qualities: model.id.startsWith("hidream-") || model.id.startsWith("flux2-") ? ["auto", "high"] : [], backgrounds: [], maxCount: 15 };
        if (model.id.startsWith("hidream-")) { parameters.sizes = ratios; sizeLabel = "画面比例（匹配原生尺寸）"; }
    } else if (model.id === "dall-e-2") parameters = { sizes: ["1024x1024", "512x512", "256x256"], qualities: [], backgrounds: [], maxCount: 10 };
    else if (model.id === "dall-e-3") parameters = { sizes: ["1024x1024", "1792x1024", "1024x1792"], qualities: ["standard", "hd"], backgrounds: [], maxCount: 1 };
    else if (["sxh-image", "cec-image"].includes(model.id) && model.endpoint?.startsWith("openai-images")) parameters = { sizes: ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2560x1440", "1440x2560", "3840x2160", "2160x3840"], qualities: ["auto", "low", "medium", "high"], backgrounds: ["auto", "opaque", "transparent"], maxCount: 1 };
    else if (model.endpoint?.startsWith("openai-images")) parameters = { sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"], qualities: ["auto", "low", "medium", "high"], backgrounds: ["auto", "opaque", "transparent"], maxCount: 10 };
    else return undefined;
    return { version: 1, modes: model.imageModes, maxReferenceImages: model.imageModes.includes("edit") ? model.maxReferenceImages || 1 : 0, ...parameters, ...model.imageParameters, sizeLabel, ...(model.id === "qwen-image-2.1-local" ? { editSizes: qwen21Pixels, editSizeLabel: "输出尺寸（自动跟随参考图）" } : {}) };
}
export function imageContractForMode(contract: ImageContract, edit: boolean): ImageContract {
    return edit && contract.editSizes ? { ...contract, sizes: contract.editSizes, sizeLabel: contract.editSizeLabel || contract.sizeLabel } : contract;
}
export function imageDefaults(contract: ImageContract) {
    return { size: contract.sizes[0], quality: contract.qualities[0] || "auto", background: contract.backgrounds[0] || "auto", count: 1 };
}
export function imageRequestParams(contract: ImageContract, input: Record<string, unknown>) {
    return { size: input.size || contract.sizes[0], count: Number(input.count || 1), ...(contract.qualities.length ? { quality: input.quality || contract.qualities[0] } : {}), ...(contract.backgrounds.length ? { background: input.background || contract.backgrounds[0] } : {}) };
}
export function validateImageInput(contract: ImageContract, prompt: string, params: Record<string, unknown>, referenceCount: number) {
    contract = imageContractForMode(contract, referenceCount > 0);
    const errors: string[] = [];
    if (!prompt.trim() && !referenceCount) errors.push("请填写图片描述");
    if (!contract.modes.includes(referenceCount ? "edit" : "generate")) errors.push(referenceCount ? "当前模型不支持参考图" : "当前模型需要参考图");
    if (referenceCount > contract.maxReferenceImages) errors.push(`当前模型最多支持 ${contract.maxReferenceImages} 张参考图`);
    for (const [key, options, label] of [["size", contract.sizes, contract.sizeLabel], ["quality", contract.qualities, "质量"], ["background", contract.backgrounds, "背景"]] as const) {
        if (params[key] !== undefined && !options.includes(String(params[key]))) errors.push(`${label}不受当前模型支持，请重新选择`);
    }
    if (!Number.isInteger(params.count ?? 1) || Number(params.count ?? 1) < 1 || Number(params.count ?? 1) > contract.maxCount) errors.push(`当前模型每次支持 1–${contract.maxCount} 张图片`);
    if (Object.keys(params).some((key) => !["size", "quality", "background", "count", "systemPrompt"].includes(key))) errors.push("包含当前图片模型不支持的参数");
    return errors;
}
