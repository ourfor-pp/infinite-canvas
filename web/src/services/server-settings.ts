import { serverApi } from "@/services/api/server";

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleServerSettingsSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        timer = null;
        const { useConfigStore } = await import("@/stores/use-config-store");
        const { config } = useConfigStore.getState();
        const { models: _models, ...preferences } = config;
        try {
            await serverApi.updateSettings({ config: preferences });
        } catch (error) {
            window.dispatchEvent(new CustomEvent("infinite-canvas:server-error", { detail: error instanceof Error ? error.message : "配置保存失败" }));
        }
    }, 400);
}
