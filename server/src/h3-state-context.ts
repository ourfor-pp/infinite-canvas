import { z } from "zod";

export const h3StateContextSchema = z.object({
    schemaVersion: z.literal(1), fps: z.literal(24),
    modelRevision: z.string().trim().min(1), videoVaeRevision: z.string().trim().min(1), audioVaeRevision: z.string().trim().min(1), sourceId: z.string().trim().min(1),
    width: z.number().int().positive().multipleOf(32), height: z.number().int().positive().multipleOf(32),
    frames: z.number().int().min(5).refine((frames) => frames % 17 === 5),
}).strict();
export type H3StateContext = z.infer<typeof h3StateContextSchema>;

export const h3RuntimeCatalogSchema = z.object({
    ready: z.literal(true), schemaVersion: z.literal(1), modelId: z.literal("minimax-h3-ref2va-local"),
    modelRevision: z.string().regex(/^[a-f0-9]{64}:pipeline:[a-f0-9]{64}$/),
    videoVaeRevision: z.string().regex(/^[a-f0-9]{64}$/), audioVaeRevision: z.string().regex(/^[a-f0-9]{64}$/), implementationRevision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type H3RuntimeCatalog = z.infer<typeof h3RuntimeCatalogSchema>;
