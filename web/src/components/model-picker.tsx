import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getAvailableModel, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type AudioMode, type ImageMode, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    audioMode?: AudioMode;
    imageMode?: Extract<ImageMode, "generate" | "edit">;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    appearance?: "default" | "toolbar";
};

export function ModelPicker({ config, value, onChange, capability, audioMode, imageMode, className, fullWidth = false, placeholder, onMissingConfig, appearance = "default" }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => selectableModelsByCapability(config, capability, audioMode, imageMode), [audioMode, capability, config, imageMode]);
    const current = value && options.includes(value) ? value : "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    const currentLabel = current ? capability === "video" && appearance === "toolbar" ? getAvailableModel(current)?.name || modelOptionName(current) : modelOptionLabel(config, current) : pickerPlaceholder;

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length) onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                data-control-appearance={appearance}
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 text-sm font-normal transition-colors",
                    appearance === "toolbar"
                        ? "rounded-lg border-0 bg-transparent px-2 shadow-none hover:bg-black/5 focus-visible:border-0 focus-visible:ring-0 data-[state=open]:bg-black/5 dark:bg-transparent dark:hover:bg-white/10 dark:data-[state=open]:bg-white/10"
                        : "rounded-full border border-input bg-transparent px-3 shadow-sm data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{currentLabel}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    (capability === "video" ? ["视频生成", "视频提质"] : [""]).map(group => {
                        const models = options.filter(model => !group || (getAvailableModel(model)?.videoContract?.family === "enhance" ? "视频提质" : "视频生成") === group);
                        return models.length ? <SelectGroup key={group}>{group ? <SelectLabel>{group}</SelectLabel> : null}{models.map(model => <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)}><ModelLabel config={config} model={model} /></SelectItem>)}</SelectGroup> : null;
                    })
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
