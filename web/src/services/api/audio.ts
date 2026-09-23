import { audioDefaults, validateAudioInput } from "../../../../server/src/audio-contract";
import { getAvailableModel } from "@/stores/use-config-store";
import type { ReferenceAudio } from "@/types/media";
import { ensureServerReference, generationFiles, runServerGeneration } from "@/services/api/ai-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };
type AudioGenerationResult = { url: string; generationId: string };

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions, references: ReferenceAudio[] = []): Promise<AudioGenerationResult> {
    const contract = getAvailableModel(config.model || config.audioModel)?.audioContract;
    if (!contract) throw new Error("当前模型缺少音频输入定义");
    const operation = config.audioOperation || contract.operations[0];
    const params = config.audioParams || audioDefaults(contract, operation);
    const inputs = references.map((reference) => ({ reference, ...config.audioReferenceInputs?.[reference.id] }));
    const errors = validateAudioInput(contract, prompt, params, inputs.map((input) => ({ kind: "audio", durationMs: input.reference.durationMs, role: input.role, transcript: input.transcript })), operation);
    if (errors.length) throw new Error(errors.join("；"));
    const generation = await runServerGeneration({
        kind: "audio", audioInputVersion: 1,
        model: config.model || config.audioModel,
        prompt, mode: contract.mode, operation, params,
        references: await Promise.all(inputs.map(async (input) => ({ ...await ensureServerReference(input.reference, "audio"), role: input.role || "reference", transcript: input.transcript }))),
    }, options);
    const file = generationFiles(generation)[0];
    if (!file || !file.mimeType.startsWith("audio/")) throw new Error("音频任务没有返回有效音频文件");
    return { url: file.url, generationId: generation.id };
}

export function storeGeneratedAudio(result: AudioGenerationResult, _format = "mp3"): Promise<UploadedFile> {
    return uploadMediaFile(result.url, "audio");
}
