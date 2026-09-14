import { db } from "./database.js";
import { createGeneration, setGenerationObserver, type GenerationRow } from "./generation-service.js";
import { markDirectorGenerationChanged } from "./director-sync.js";
import { syncAgentGenerationCanvas } from "./agent/generation-canvas.js";
import { creativeAssetAutomaticReviewRequest, syncCreativeAssetGeneration } from "./creative-assets.js";
import { syncVisualStyleGeneration } from "./visual-styles.js";
import { syncDirectorGeneration } from "./director-render.js";
import { syncDirectorCastReviewGeneration } from "./director-cast-review.js";

const handlers: Record<string, (row: GenerationRow) => unknown> = {
    canvas: syncAgentGenerationCanvas,
    asset: (row) => {
        syncCreativeAssetGeneration(row);
        const id = `${row.id}-review`;
        if (db.prepare("SELECT id FROM generations WHERE id=?").get(id)) return;
        const request = creativeAssetAutomaticReviewRequest(row);
        if (request) createGeneration(row.user_id, request, id);
    },
    style: syncVisualStyleGeneration,
    director: syncDirectorGeneration,
    cast: syncDirectorCastReviewGeneration,
};
let working = false;
let registered = false;
export function registerGenerationEffects() {
    if (registered) return;
    registered = true;
    setGenerationObserver((row) => {
        markDirectorGenerationChanged(row.user_id, row.id);
        if (!["succeeded", "failed", "canceled"].includes(row.status)) { syncAgentGenerationCanvas(row); return; }
        for (const handler of Object.keys(handlers)) db.prepare("INSERT OR IGNORE INTO generation_effects(generation_id,handler,status) VALUES(?,?,'pending')").run(row.id, handler);
        queueMicrotask(() => { void resumeGenerationEffects(); });
    });
}
export async function resumeGenerationEffects() {
    if (working) return;
    working = true;
    try {
        const pending = db.prepare("SELECT generation_id,handler FROM generation_effects WHERE status='pending' AND retry_after<=? ORDER BY generation_id LIMIT 100").all(Date.now()) as Array<{ generation_id: string; handler: string }>;
        for (const effect of pending) {
            const row = db.prepare("SELECT * FROM generations WHERE id=?").get(effect.generation_id) as GenerationRow | undefined;
            if (!row) continue;
            try {
                await handlers[effect.handler](row);
                db.prepare("UPDATE generation_effects SET status='done',error=NULL WHERE generation_id=? AND handler=?").run(row.id, effect.handler);
            } catch (error) {
                db.prepare("UPDATE generation_effects SET attempts=attempts+1,error=?,retry_after=? WHERE generation_id=? AND handler=?").run(String((error as Error).message).slice(0, 1000), Date.now() + 30_000, row.id, effect.handler);
            }
        }
    } finally { working = false; }
}
