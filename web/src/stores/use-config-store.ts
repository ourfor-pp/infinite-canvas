import type { VideoContract } from "../../../server/src/video-contract";
import type { ImageContract } from "../../../server/src/image-contract";
import type { AudioContract } from "../../../server/src/audio-contract";
import { useMemo } from "react";
import { create } from "zustand";

import { scheduleServerSettingsSave } from "@/services/server-settings";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type ModelInputCapability = ModelCapability;
export type AudioMode = "speech" | "ambient" | "sfx" | "music";
export type AudioOperation = "generate" | "clone" | "transform" | "extend" | "inpaint" | "cover" | "remix";
export type ImageMode = "generate" | "edit";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
export type AiModelOption = {
    videoContract?: VideoContract;
    imageContract?: ImageContract;
    audioContract?: AudioContract;
    id: string;
    name: string;
    value: string;
    providerId: string;
    providerName: string;
    output: ModelCapability | "transcription";
    inputs: ModelInputCapability[];
    enabled: boolean;
    audioModes?: AudioMode[];
    audioOperations?: AudioOperation[];
    maxReferenceAudios?: number;
    maxDurationSeconds?: number;
    languages?: string[];
    voices?: string[];
    imageModes?: ImageMode[];
};

export type AiConfig = {
    audioParams?: Record<string, unknown>;
    audioOperation?: string;
    audioReferenceInputs?: Record<string, { role?: "reference" | "emotion"; transcript?: string }>;
    model: string;
    imageModel: string;
    imageEditModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    videoFps: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export const defaultConfig: AiConfig = {
    model: "",
    imageModel: "",
    imageEditModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    videoFps: "48",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

type ConfigStore = {
    hydrated: boolean;
    config: AiConfig;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    hydrateFromServer: (config?: Partial<AiConfig>) => void;
    hydrateModels: (models: AiModelOption[], defaults?: Partial<Record<ModelCapability, string>>, imageEditDefault?: string) => void;
};

let modelCatalog: AiModelOption[] = [];

export const useConfigStore = create<ConfigStore>()((set) => ({
    hydrated: false,
    config: defaultConfig,
    updateConfig: (key, value) => set((state) => {
        if (key !== "models") scheduleServerSettingsSave();
        return { config: { ...state.config, [key]: value } };
    }),
    isAiConfigReady: (_config, model) => Boolean(model && modelCatalog.some((item) => item.value === model && item.enabled)),
    hydrateFromServer: (persistedConfig = {}) => set((state) => ({ hydrated: true, config: normalizeConfig({ ...state.config, ...persistedConfig }) })),
    hydrateModels: (models, defaults = {}, imageEditDefault = "") => set((state) => {
        modelCatalog = models.filter((model) => model.enabled);
        const values = modelCatalog.map((model) => model.value);
        const pick = (current: string, capability: ModelCapability, imageMode?: "generate" | "edit") => modelCatalog.some((model) => model.value === defaults[capability] && model.output === capability && (!imageMode || model.imageModes?.includes(imageMode)))
            ? defaults[capability] || ""
            : modelCatalog.some((model) => model.value === current && model.output === capability && (!imageMode || model.imageModes?.includes(imageMode)))
                ? current
                : modelCatalog.find((model) => model.output === capability && (!imageMode || model.imageModes?.includes(imageMode)))?.value || "";
        const imageModel = pick(state.config.imageModel, "image", "generate");
        return {
            config: {
                ...state.config,
                models: values,
                imageModel,
                imageEditModel: modelCatalog.some((model) => model.value === imageEditDefault && model.imageModes?.includes("edit")) ? imageEditDefault : pick(state.config.imageEditModel, "image", "edit"),
                videoModel: pick(state.config.videoModel, "video"),
                textModel: pick(state.config.textModel, "text"),
                audioModel: pick(state.config.audioModel, "audio"),
                model: values.includes(state.config.model) ? state.config.model : imageModel || values[0] || "",
            },
        };
    }),
}));

function normalizeConfig(value: Partial<AiConfig>): AiConfig {
    const config = { ...defaultConfig, ...value, models: Array.isArray(value.models) ? value.models.filter((item): item is string => typeof item === "string") : [] };
    return {
        ...config,
        audioVoice: config.audioVoice || defaultConfig.audioVoice,
        audioFormat: config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
        videoSeconds: config.videoSeconds || defaultConfig.videoSeconds,
        vquality: config.vquality || defaultConfig.vquality,
        videoGenerateAudio: config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: config.videoWatermark || defaultConfig.videoWatermark,
        reasoningEffort: config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: config.quality || defaultConfig.quality,
        size: config.size || defaultConfig.size,
        count: config.count || defaultConfig.count,
        canvasImageCount: config.canvasImageCount || defaultConfig.canvasImageCount,
    };
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => config, [config]);
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability, audioMode?: AudioMode, imageMode?: "generate" | "edit") {
    const requiredImageMode = capability === "image" ? imageMode || "generate" : undefined;
    const available = capability ? modelCatalog.filter((model) => model.output === capability && (!audioMode || (model.audioModes || ["speech"]).includes(audioMode)) && (!requiredImageMode || model.imageModes?.includes(requiredImageMode))).map((model) => model.value) : modelCatalog.map((model) => model.value);
    return available.length ? available : capability ? [] : config.models;
}

export function modelCapabilityOf(_config: AiConfig, value: string) {
    return modelCatalog.find((model) => model.value === value)?.output;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability, imageMode?: "generate" | "edit") {
    return (!capability || modelCapabilityOf(config, value) === capability) && (capability !== "image" || getAvailableModel(value)?.imageModes?.includes(imageMode || "generate") === true);
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability, imageMode?: "generate" | "edit") {
    const fallback = capability === "image" ? imageMode === "edit" ? config.imageEditModel : config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability, imageMode)) return currentModel;
    if (fallback && modelMatchesCapability(config, fallback, capability, imageMode)) return fallback;
    return selectableModelsByCapability(config, capability, undefined, imageMode)[0] || "";
}

export function modelSupportsImageMode(value: string, imageMode: "generate" | "edit") {
    return getAvailableModel(value)?.imageModes?.includes(imageMode) === true;
}

export function decodeModelReference(value: string) {
    const index = value.indexOf("::");
    return index < 0 ? null : { channelId: value.slice(0, index), model: value.slice(index + 2) };
}

export function modelOptionName(value: string) {
    return decodeModelReference(value)?.model || value;
}

export function modelOptionLabel(_config: AiConfig, value: string) {
    const model = modelCatalog.find((item) => item.value === value);
    return model ? `${model.name}（${model.providerName}）` : modelOptionName(value);
}

export function normalizeModelOptionValue(value: string | undefined) {
    const input = value?.trim() || "";
    if (!input) return "";
    if (modelCatalog.some((model) => model.value === input)) return input;
    const matches = modelCatalog.filter((model) => model.id === input || model.name === input);
    return matches.length === 1 ? matches[0].value : "";
}

export function getAvailableModel(value: string) {
    return modelCatalog.find((model) => model.value === value);
}
