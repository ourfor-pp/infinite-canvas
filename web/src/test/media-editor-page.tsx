import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, Button, ConfigProvider } from "antd";

import { MediaEditorPopover } from "@/components/canvas/media-editor/media-editor-popover";
import { MediaPreview } from "@/components/canvas/media-editor/media-preview";
import type { MediaEditorTarget } from "@/components/canvas/media-editor/types";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import "@/styles/globals.css";

const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%238b78d7'/%3E%3C/svg%3E";
useConfigStore.getState().hydrateModels([{ id: "image", name: "测试图片", value: "test::image", providerId: "test", providerName: "测试", output: "image", inputs: ["text", "image"], enabled: true }]);
useThemeStore.getState().setTheme("light");

function Page() {
    const anchorRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [agentCalls, setAgentCalls] = useState(0);
    const theme = useThemeStore((state) => state.theme);
    const target: MediaEditorTarget = {
        key: "media-test:image",
        kind: "image",
        title: "林夏",
        semanticLabel: "角色设计图",
        config: { ...defaultConfig, model: "test::image", imageModel: "test::image" },
        snapshot: { draft: { prompt: "四视图角色设计", model: "test::image", params: {} }, references: [], variants: [{ id: "v1", label: "角色设计图", kind: "image", url: image, primary: true }] },
        saveDraft: () => undefined,
        generate: () => undefined,
        preview: async (draft) => ({ prompt: `角色：林夏\n\n${draft.prompt}` }),
        askAgent: () => setAgentCalls((value) => value + 1),
    };
    return <ConfigProvider><AntApp><main className={theme === "dark" ? "dark min-h-screen bg-neutral-950 p-8 text-white" : "min-h-screen bg-neutral-100 p-8 text-neutral-950"}><Button onClick={() => useThemeStore.getState().setTheme(theme === "dark" ? "light" : "dark")}>切换主题</Button><article data-testid="business-card" className="mt-6 h-[540px] w-[420px] rounded-2xl bg-white p-4 shadow"><div ref={anchorRef}><MediaPreview kind="image" url={image} title="林夏" emptyLabel="尚未生成" /><Button className="mt-3" onClick={() => setOpen((value) => !value)}>调图</Button></div></article><MediaEditorPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} target={target} /><output data-testid="agent-calls">{agentCalls}</output></main></AntApp></ConfigProvider>;
}

createRoot(document.getElementById("root")!).render(<Page />);
