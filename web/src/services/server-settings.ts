import { serverApi } from "@/services/api/server";

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleServerSettingsSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        timer = null;
        const [{ useConfigStore }, { usePromptSourceStore }] = await Promise.all([import("@/stores/use-config-store"), import("@/stores/use-prompt-source-store")]);
        const { config } = useConfigStore.getState();
        const { models: _models, ...preferences } = config;
        const { sources, schedule } = usePromptSourceStore.getState();
        try {
            await serverApi.updateSettings({ config: preferences, promptSources: { sources, schedule } });
        } catch (error) {
            window.dispatchEvent(new CustomEvent("infinite-canvas:server-error", { detail: error instanceof Error ? error.message : "配置保存失败" }));
        }
    }, 400);
}
