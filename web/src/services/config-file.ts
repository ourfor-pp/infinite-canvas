import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { scheduleServerSettingsSave } from "@/services/server-settings";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    config: Omit<AiConfig, "models">;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const { models: _models, ...preferences } = config;
    const data: AppConfigFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), config: preferences, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 3 || !data.config || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    useConfigStore.setState((state) => ({ config: { ...state.config, ...data.config, models: state.config.models } }));
    usePromptSourceStore.setState(data.promptSources);
    scheduleServerSettingsSave();
}
