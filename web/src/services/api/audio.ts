import { normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { generationFiles, runServerGeneration } from "@/services/api/ai-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };
type AudioGenerationResult = { url: string; generationId: string };

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<AudioGenerationResult> {
    const generation = await runServerGeneration({
        kind: "audio",
        model: config.model || config.audioModel,
        prompt,
        params: {
            voice: normalizeAudioVoiceValue(config.audioVoice),
            format: normalizeAudioFormatValue(config.audioFormat),
            speed: normalizeAudioSpeedValue(config.audioSpeed),
            instructions: config.audioInstructions.trim(),
            systemPrompt: config.systemPrompt,
        },
    }, options);
    const file = generationFiles(generation)[0];
    if (!file) throw new Error("音频任务没有返回文件");
    return { url: file.url, generationId: generation.id };
}

export function storeGeneratedAudio(result: AudioGenerationResult, _format = "mp3"): Promise<UploadedFile> {
    return uploadMediaFile(result.url, "audio");
}
