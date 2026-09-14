import type { ServerGeneration } from "@/services/api/server";

const phases: Record<string, string> = { queued: "排队", reclaiming: "腾显存", loading: "加载模型", preprocessing: "处理音频", inference: "推理中" };
const statuses = { queued: "排队", running: "生成中", succeeded: "完成", canceled: "取消", failed: "失败" };

export function generationPhaseLabel(generation: Pick<ServerGeneration, "status" | "diagnostics">) {
    return generation.status === "running" ? phases[generation.diagnostics?.phase || ""] || statuses.running : statuses[generation.status];
}
