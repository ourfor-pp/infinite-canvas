import { markDirectorProjectChanged } from "../director-sync.js";
type ProjectPayload = Record<string, unknown> & { id: string; revision?: number };

let emitProjectUpdate: (userId: string, project: ProjectPayload) => void = () => undefined;

export function setAgentProjectEmitter(emitter: typeof emitProjectUpdate) {
    emitProjectUpdate = emitter;
}

export function publishAgentProject(userId: string, project: ProjectPayload) {
    markDirectorProjectChanged(userId, project.id, ["project"]);
    emitProjectUpdate(userId, project);
}
