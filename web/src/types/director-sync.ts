import type { CreativeAsset } from "./creative-asset";
import type { VisualStyle } from "./visual-style";
import type { DirectorProject, DirectorRender, DirectorState, DirectorValidation } from "./director";
import type { ServerGeneration } from "@/services/api/server";

export const DIRECTOR_RESOURCES = ["project", "sources", "story", "script", "direction", "assets", "segments", "timeline", "generations", "renders", "validation", "media"] as const;
export type DirectorResource = typeof DIRECTOR_RESOURCES[number];
export type DirectorProjectChanged = { type: "director.project.changed"; projectId: string; version: number; changes: Array<{ resource: DirectorResource }> };
export type DirectorSyncSnapshot = {
    projectId: string; version: number; resources: DirectorResource[];
    data: { state: Partial<DirectorState>; project?: DirectorProject; assets?: CreativeAsset[]; styles?: VisualStyle[]; generations?: ServerGeneration[]; renders?: DirectorRender[]; validation?: DirectorValidation; mediaVersions?: Record<string, string> };
};
