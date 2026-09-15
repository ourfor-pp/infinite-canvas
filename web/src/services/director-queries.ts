import { directorApi } from "@/services/api/director";
import { queryClient } from "@/lib/query-client";
import { useDirectorStore } from "@/stores/use-director-store";
import type { DirectorResource } from "@/types/director-sync";

export async function readDirectorQuery<T>(projectId: string, resource: DirectorResource, key: readonly unknown[], read: () => Promise<T>, force = false) {
    const dependencies: DirectorResource[] = resource === "project" ? ["project", "assets", "direction", "segments", "sources"] : resource === "assets" ? ["assets", "segments", "media"] : resource === "timeline" ? ["timeline", "segments", "media"] : resource === "segments" ? ["segments", "assets", "direction", "media"] : [resource];
    const version = () => dependencies.map((dependency) => useDirectorStore.getState().data[projectId]?.epochs[dependency] || 0).join(":");
    const queryKey = ["director", projectId, resource, ...key];
    if (force) {
        // A mutation must not reuse a read that began before it committed.
        await queryClient.getQueryCache().find({ queryKey, exact: true })?.promise?.catch(() => undefined);
        await queryClient.invalidateQueries({ queryKey, refetchType: "none", exact: true });
    }
    return queryClient.fetchQuery({ queryKey, staleTime: Infinity, queryFn: async () => {
        // An event during a request invalidates its result. Continue serially so two
        // mounted consumers share one request and a late response cannot win.
        while (true) {
            const started = version();
            const value = await read();
            if (started === version()) return value;
        }
    } });
}


export function readDirectorShotDesigns(projectId: string) {
    return readDirectorQuery(projectId, "segments", ["shot-designs"], async () => {
        const first = await directorApi.shotDesigns(projectId);
        const pages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 50) - 1) }, (_, index) => directorApi.shotDesigns(projectId, (index + 1) * 50)));
        return [...first.items, ...pages.flatMap((page) => page.items)];
    });
}
