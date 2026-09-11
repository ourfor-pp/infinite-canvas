import { DIRECTOR_RESOURCES, type DirectorProjectChanged, type DirectorResource, type DirectorSyncSnapshot } from "@/types/director-sync";

type ProjectSync = {
    seen: number; active: Map<DirectorResource, number>; dirty: Map<DirectorResource, number>; forced: Set<DirectorResource>;
    initialized: boolean; loaded: Set<DirectorResource>; refreshFiles: boolean; refreshEpoch: number; request?: Promise<void>; timer?: ReturnType<typeof setTimeout>;
};
type SyncOptions = {
    read: (projectId: string, resources: DirectorResource[], refresh: boolean) => Promise<DirectorSyncSnapshot>;
    apply: (snapshot: DirectorSyncSnapshot, resources: DirectorResource[]) => void;
    failed: (projectId: string, error: unknown) => void;
};

// One request per project, with resource-level invalidation and authoritative reads.
export class DirectorSync {
    private projects = new Map<string, ProjectSync>();
    constructor(private options: SyncOptions) {}
    private project(id: string) {
        let value = this.projects.get(id);
        if (!value) {
            value = { seen: 0, active: new Map(), dirty: new Map(), forced: new Set(), initialized: false, loaded: new Set(), refreshFiles: false, refreshEpoch: 0 };
            this.projects.set(id, value);
        }
        return value;
    }
    retain(id: string, resources: readonly DirectorResource[]) {
        const state = this.project(id);
        resources.forEach((resource) => state.active.set(resource, (state.active.get(resource) || 0) + 1));
        if (!state.initialized) void this.refresh(id).catch(() => undefined);
        else this.schedule(id);
        return () => { resources.forEach((resource) => { const count = (state.active.get(resource) || 1) - 1; if (count) state.active.set(resource, count); else state.active.delete(resource); }); };
    }
    changed(event: DirectorProjectChanged) {
        if (!event.projectId || !Number.isSafeInteger(event.version) || event.version <= 0) return;
        const state = this.project(event.projectId);
        if (event.version <= state.seen) return;
        const missed = state.seen > 0 && event.version > state.seen + 1;
        const resources = missed ? DIRECTOR_RESOURCES : event.changes.map((change) => change.resource).filter((resource) => DIRECTOR_RESOURCES.includes(resource));
        resources.forEach((resource) => state.dirty.set(resource, event.version));
        if (missed) state.refreshFiles = true;
        state.seen = event.version;
        this.schedule(event.projectId);
    }
    reconnect() {
        for (const [id, state] of this.projects) {
            DIRECTOR_RESOURCES.forEach((resource) => state.dirty.set(resource, state.seen));
            if (state.active.size) void this.refresh(id, [...state.active.keys()]).catch(() => undefined);
        }
    }
    refresh(id: string, resources: readonly DirectorResource[] = DIRECTOR_RESOURCES) {
        const state = this.project(id);
        state.refreshFiles = true;
        state.refreshEpoch++;
        resources.forEach((resource) => { state.dirty.set(resource, state.seen); state.forced.add(resource); });
        return this.drain(id);
    }
    private schedule(id: string) {
        const state = this.project(id);
        if (state.timer || state.request || !state.active.size) return;
        state.timer = setTimeout(() => { state.timer = undefined; void this.drain(id).catch(() => undefined); }, 80);
    }
    private drain(id: string): Promise<void> {
        const state = this.project(id);
        if (state.request) return state.request;
        if (state.timer) { clearTimeout(state.timer); state.timer = undefined; }
        const run = async () => {
            let staleResponses = 0;
            try {
                while (true) {
                    const resources = [...state.dirty.keys()].filter((resource) => state.active.has(resource) || state.forced.has(resource));
                    if (!resources.length) return;
                    const epoch = state.refreshEpoch;
                    const refreshFiles = state.refreshFiles;
                    state.refreshFiles = false;
                    const snapshot = await this.options.read(id, resources, refreshFiles);
                    if (snapshot.projectId !== id || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0) throw new Error("导演同步响应与当前项目不一致");
                    if (epoch !== state.refreshEpoch) continue;
                    const accepted = resources.filter((resource) => snapshot.resources.includes(resource) && snapshot.version >= (state.dirty.get(resource) || 0));
                    this.options.apply(snapshot, accepted);
                    accepted.forEach((resource) => { state.dirty.delete(resource); state.forced.delete(resource); state.loaded.add(resource); });
                    state.initialized = state.loaded.size === DIRECTOR_RESOURCES.length;
                    if (resources.length === DIRECTOR_RESOURCES.length && accepted.length === resources.length) { state.initialized = true; state.seen = Math.max(state.seen, snapshot.version); }
                    if (!accepted.length && resources.length && ++staleResponses > 1) throw new Error("导演同步快照版本落后，请重试");
                }
            } catch (error) {
                state.refreshFiles = true;
                this.options.failed(id, error);
                throw error;
            }
        };
        state.request = run().finally(() => { state.request = undefined; });
        return state.request;
    }
    dispose() { for (const state of this.projects.values()) if (state.timer) clearTimeout(state.timer); this.projects.clear(); }
}
