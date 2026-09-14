import { z } from "zod";

const timing = { start: z.number().nonnegative(), end: z.number().nonnegative() };
export const transcriptionSchema = z.object({
    version: z.literal(1),
    source: z.enum(["transcription", "reference-alignment"]),
    model: z.string(),
    text: z.string().max(1_000_000),
    language: z.string().nullable(),
    languages: z.array(z.string()).max(52),
    duration: z.number().positive().max(3600),
    segments: z.array(z.object({ index: z.number().int().nonnegative(), text: z.string().max(20_000), language: z.string(), ...timing,
        timestampSource: z.enum(["vad", "forced-alignment"]),
        words: z.array(z.object({ text: z.string(), ...timing })).max(4096).optional(),
    })).max(20_000),
});
