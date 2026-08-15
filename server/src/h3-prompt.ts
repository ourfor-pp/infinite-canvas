type StoryboardFrame = { shotNumber: number; timeSeconds: number; description: string; action: string; cameraAngle: string; cameraMove: string; sound: string };
type StoryboardSheet = { frames: StoryboardFrame[] };

const han = /[\u3400-\u9fff]/;

export function compileH3Prompt(mode: "fl2va" | "ref2va", payload: Record<string, unknown>, sheet: StoryboardSheet) {
    const duration = Number(payload.durationSeconds || 4);
    const description = compileDescription(payload, sheet);
    const soundscape = english(payload.h3Soundscape || payload.soundDesign || payload.sound || payload.audio)
        || "Natural ambient sound and synchronized physical action sounds follow the visible events throughout the video.";
    const music = english(payload.h3NonDiegeticMusic || payload.music) || "N/A";
    if (mode === "fl2va") {
        const lastShot = Math.max(1, ...sheet.frames.map((frame) => frame.shotNumber));
        return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${lastShot}) aligns with the ${duration.toFixed(2)}-second mark of the target video.\n\nintegrated_multimodal_description: ${description}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
    }
    return `subject_definitions:\n<Picture 1> is the supplied storyboard and timed visual-anchor source for the target video. Its character identity, wardrobe, environment, props, lighting, composition, and shot order are authoritative.\n\nsummary:\n[keyframe completion + reference generation] Generate a ${duration.toFixed(2)}-second audiovisual sequence that follows <Picture 1> and the supplied subject references.\n\nretention_analysis:\n<Picture 1> (storyboard, timed anchors, and shot order): fully_preserved - Preserve the defined subjects, spatial relationships, visual states, chronology, and final composition.\n\ndetailed_description:\n${description}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
}

function compileDescription(payload: Record<string, unknown>, sheet: StoryboardSheet) {
    const groups = new Map<number, StoryboardFrame[]>();
    sheet.frames.forEach((frame) => groups.set(frame.shotNumber, [...(groups.get(frame.shotNumber) || []), frame]));
    const custom = english(payload.h3VisualDescription);
    const shots = Array.from(groups.entries()).sort(([left], [right]) => left - right).map(([shotNumber, frames], index) => {
        const prefix = index === 0 ? `[Shot ${shotNumber}]` : `[Shot ${shotNumber}] At ${timestamp(frames[0]?.timeSeconds || 0)}, the camera cuts to`;
        const details = unique(frames.flatMap((frame) => [english(frame.description), english(frame.action), english(frame.cameraAngle), english(frame.cameraMove)]).filter(Boolean));
        const visual = details.length
            ? details.join(". ")
            : index === 0
                ? "Cinematic, the composition, subjects, environment, wardrobe, props, lighting, and spatial relationships established by the supplied reference frames remain consistent. The visible action develops continuously through the timed visual anchors and settles into the final reference composition"
                : "a new composition defined by the corresponding storyboard anchors, preserving subject identity, screen direction, lighting, and spatial continuity";
        return `${prefix} ${visual}.`;
    });
    if (custom && shots.length) shots[0] = `${shots[0]} ${custom}`;
    shots.push(compileSpeech(payload));
    return shots.filter(Boolean).join(" ");
}

function compileSpeech(payload: Record<string, unknown>) {
    const dialogue = String(payload.dialogue || "").trim();
    const narration = String(payload.narration || "").trim();
    if (!dialogue && !narration) return "No character speaks, sings, narrates, or vocalizes.";
    const source = dialogue || narration;
    const speakers = new Map<string, number>();
    const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
        const match = line.match(/^([^:：]{1,80})[：:]\s*[「“\"]([\s\S]*?)[」”\"]$/);
        const speaker = match?.[1].trim() || `speaker-${index + 1}`;
        const content = match?.[2] || line.replace(/^[「“\"]|[」”\"]$/g, "");
        if (!speakers.has(speaker)) speakers.set(speaker, speakers.size + 1);
        const id = speakers.get(speaker)!;
        const language = han.test(content) ? "Chinese" : "English";
        return dialogue
            ? `The on-screen speaker (S${id}) says: <d>[${language}] ${content}</d>.`
            : `The off-screen speaker (S${id}) says in an off-screen voiceover: <d>[${language}] ${content}</d> while all on-screen characters' lips remain completely closed.`;
    });
    return `${lines.join(" ")} No other speech, narration, singing, or vocalization occurs.`;
}

function english(value: unknown) {
    const text = String(value || "").trim();
    return text && !han.test(text) ? text : "";
}

function unique(values: string[]) { return [...new Set(values)]; }
function timestamp(seconds: number) { const millis = Math.max(0, Math.round(seconds * 1000)); return `${String(Math.floor(millis / 60000)).padStart(2, "0")}:${String(Math.floor(millis / 1000) % 60).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`; }
