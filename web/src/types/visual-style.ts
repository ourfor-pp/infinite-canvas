export type VisualStyleMode = "template" | "custom";
export type VisualStyle = {
    id: string;
    projectId: string;
    name: string;
    mode: VisualStyleMode;
    templateId: string | null;
    description: string;
    referenceFileId: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
};
export type VisualStyleTemplate = { id: string; name: string; category: "live" | "anim"; colors: readonly [string, string, string]; description: string };
