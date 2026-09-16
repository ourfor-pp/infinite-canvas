import type { DirectorResource, DirectorSyncSnapshot } from "@/types/director-sync";
import { serverRequest, uploadServerFile, type CreativeAssetGenerationPreview, type ServerGeneration } from "./server";
import type { DirectorShotStoryboard, DirectorShotDesign, DirectorPlaybackPlan, DirectorAssetDetail, DirectorDocument, DirectorLogicalDocument, DirectorProject, DirectorRender, DirectorScreenplayBreakdown, DirectorSequence, DirectorSource, DirectorState, DirectorTimeline, DirectorValidation, DirectorVideoSegment, DirectorVideoSegmentPreflight, DirectorWorkspace, H3QualityPreset } from "@/types/director";
import { serverApiUrl } from "./server";

const enc = encodeURIComponent;
export const directorApi = {
    shotStoryboards: (projectId: string, shotId: string, offset = 0) => serverRequest<{ shotId: string; total: number; offset: number; items: DirectorShotStoryboard[] }>(`/director/projects/${enc(projectId)}/shots/${enc(shotId)}/storyboards?offset=${offset}`),
    referenceImage: (id: string, path: string) => serverRequest<{ fileId: string; name: string }>(`/director/projects/${enc(id)}/reference-image?path=${enc(path)}`),
    shotDesigns: (projectId: string, offset = 0, limit = 50) => serverRequest<{ items: DirectorShotDesign[]; total: number; offset: number }>(`/director/projects/${enc(projectId)}/shots?offset=${offset}&limit=${limit}`),
    saveShotDesign: (projectId: string, design: DirectorShotDesign) => { const { hash, content, path: _path, revision: _revision, storyboardImage: _storyboardImage, ...fields } = design; return serverRequest<{ hash: string }>(`/director/projects/${enc(projectId)}/shots`, { method: "PUT", body: JSON.stringify({ design: fields, content, hash }) }); },
    sync: (projectId: string, resources: DirectorResource[], refresh = false) => serverRequest<DirectorSyncSnapshot>(`/director/projects/${enc(projectId)}/sync?resources=${resources.join(",")}${refresh ? "&refresh=1" : ""}`),
    projects: () => serverRequest<DirectorProject[]>("/projects?kind=director"),
    createProject: (title: string, id: string) => serverRequest<DirectorProject>("/projects", { method: "POST", body: JSON.stringify({ id, kind: "director", title }) }),
    project: (id: string) => serverRequest<DirectorProject>(`/projects/${enc(id)}`),
    state: (id: string) => serverRequest<DirectorState>(`/director/projects/${enc(id)}`),
    validation: (id: string) => serverRequest<DirectorValidation>(`/director/projects/${enc(id)}/validation`),
    validate: (id: string, scope = "") => serverRequest<DirectorValidation>(`/director/projects/${enc(id)}/validate`, { method: "POST", body: JSON.stringify({ scope }) }),
    file: (id: string, path: string) => serverRequest<{ path: string; content: string; hash: string }>(`/director/projects/${enc(id)}/file?path=${enc(path)}`),
    updateMarkdownFile: (id: string, path: string, content: string, hash: string) => serverRequest<{ path: string; hash: string; diagnostics: DirectorValidation["diagnostics"] }>(`/director/projects/${enc(id)}/file`, { method: "PUT", headers: { "If-Match": `\"${hash}\"` }, body: JSON.stringify({ path, content }) }),
    exportProject: async (id: string) => {
        const response = await fetch(serverApiUrl(`/director/projects/${enc(id)}/export`));
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message || "工程导出失败");
        return response.blob();
    },
    importProject: async (file: File) => {
        const response = await fetch(serverApiUrl("/director/projects/import"), { method: "POST", headers: { "Content-Type": "application/zip", "X-Project-Name": encodeURIComponent(file.name.replace(/\.zip$/i, "")) }, body: file });
        const result = await response.json().catch(() => null) as { data?: { projectId: string }; error?: { message?: string } } | null;
        if (!response.ok) throw new Error(result?.error?.message || "工程导入失败");
        return result!.data!;
    },
    updateWorkspace: (id: string, value: Partial<DirectorWorkspace> & { revision: number }) => serverRequest<DirectorWorkspace>(`/director/projects/${enc(id)}/workspace`, { method: "PUT", body: JSON.stringify(value) }),
    addSource: async (projectId: string, file: File) => {
        const uploaded = await uploadServerFile(file, file.name);
        return serverRequest<DirectorSource>(`/director/projects/${enc(projectId)}/sources`, { method: "POST", body: JSON.stringify({ fileId: uploaded.fileId }) });
    },
    retrySource: (id: string) => serverRequest<DirectorSource>(`/director/sources/${enc(id)}/retry`, { method: "POST" }),
    chunks: (id: string, q = "", offset = 0, limit = 50) => serverRequest<Array<{ id: string; ordinal: number; heading: string; content: string; summary: string }>>(`/director/sources/${enc(id)}/chunks?q=${enc(q)}&offset=${offset}&limit=${limit}`),
    logicalDocument: (projectId: string, kind: "story" | "script") => serverRequest<DirectorLogicalDocument>(`/director/projects/${enc(projectId)}/logical-documents/${kind}`),
    updateDocumentPart: (projectId: string, kind: "story" | "script", path: string, content: string, hash: string) => serverRequest<DirectorLogicalDocument>(`/director/projects/${enc(projectId)}/logical-documents/${kind}/part`, { method: "PUT", headers: { "If-Match": `\"${hash}\"` }, body: JSON.stringify({ path, content }) }),
    updateDocument: (projectId: string, kind: "story" | "script", value: Pick<DirectorDocument, "revision"> & Partial<Pick<DirectorDocument, "content">>) => serverRequest<DirectorDocument>(`/director/projects/${enc(projectId)}/documents/${kind}`, { method: "PUT", body: JSON.stringify(value) }),
    screenplayBreakdown: (projectId: string) => serverRequest<DirectorScreenplayBreakdown>(`/director/projects/${enc(projectId)}/screenplay-breakdown`),
    createSequence: (projectId: string, value: Record<string, unknown>) => serverRequest<DirectorSequence>(`/director/projects/${enc(projectId)}/sequences`, { method: "POST", body: JSON.stringify(value) }),
    updateSequence: (id: string, value: Record<string, unknown>) => serverRequest<DirectorSequence>(`/director/sequences/${enc(id)}`, { method: "PUT", body: JSON.stringify(value) }),
    deleteSequence: (id: string) => serverRequest(`/director/sequences/${enc(id)}`, { method: "DELETE" }),
    createVideoSegment: (projectId: string, value: Record<string, unknown>) => serverRequest<DirectorVideoSegment>(`/director/projects/${enc(projectId)}/production-tasks`, { method: "POST", body: JSON.stringify(value) }),
    updateVideoSegment: (id: string, value: Record<string, unknown>) => serverRequest<DirectorVideoSegment>(`/director/production-tasks/${enc(id)}`, { method: "PUT", body: JSON.stringify(value) }),
    updateSegmentAssetReference: (id: string, value: { revision: number; kind: "character" | "scene" | "prop"; assetId: string; replaceAssetId?: string; variantId?: string; remove?: boolean }) => serverRequest<DirectorVideoSegment>(`/director/production-tasks/${enc(id)}/asset-reference`, { method: "PUT", body: JSON.stringify(value) }),
    videoSegmentPreflight: (id: string) => serverRequest<DirectorVideoSegmentPreflight>(`/director/production-tasks/${enc(id)}/preflight`),
    generateStoryboard: (id: string, revision: number) => serverRequest<Record<string, unknown>>(`/director/production-tasks/${enc(id)}/storyboard/generate`, { method: "POST", body: JSON.stringify({ revision }) }),
    generateVideoSegment: (id: string, revision: number, qualityPreset: H3QualityPreset, recipe?: "base" | "pdd-ref8") => serverRequest<Record<string, unknown>>(`/director/production-tasks/${enc(id)}/generate`, { method: "POST", body: JSON.stringify({ revision, qualityPreset, recipe }) }),
    deleteVideoSegment: (id: string) => serverRequest(`/director/production-tasks/${enc(id)}`, { method: "DELETE" }),
    playbackPlan: (projectId: string) => serverRequest<DirectorPlaybackPlan>(`/director/projects/${enc(projectId)}/playback-plan`),
    updateTimeline: (projectId: string, value: Pick<DirectorTimeline, "revision" | "payload">) => serverRequest<DirectorTimeline>(`/director/projects/${enc(projectId)}/timeline`, { method: "PUT", body: JSON.stringify(value) }),
    renders: (projectId: string) => serverRequest<DirectorRender[]>(`/director/projects/${enc(projectId)}/renders`),
    createRender: (projectId: string, timelineRevision: number) => serverRequest<DirectorRender>(`/director/projects/${enc(projectId)}/renders`, { method: "POST", body: JSON.stringify({ timelineRevision }) }),
    cancelRender: (id: string) => serverRequest<DirectorRender>(`/director/renders/${enc(id)}/cancel`, { method: "POST" }),
    retryRender: (id: string) => serverRequest<DirectorRender>(`/director/renders/${enc(id)}/retry`, { method: "POST" }),
    assetDetail: (id: string) => serverRequest<DirectorAssetDetail>(`/director/assets/${enc(id)}/detail`),
    previewAssetGeneration: (id: string, value: { target: "primary-visual" | "variant-visual" | "sound"; variantId?: string; expectedHash: string }) => serverRequest<CreativeAssetGenerationPreview>(`/director/assets/${enc(id)}/generation-preview`, { method: "POST", body: JSON.stringify(value) }),
    addAssetMediaInput: (id: string, value: { fileId: string; target: "primary-visual" | "variant-visual" | "sound"; variantId?: string }) => serverRequest<DirectorAssetDetail>(`/director/assets/${enc(id)}/media-inputs`, { method: "POST", body: JSON.stringify(value) }),
    removeAssetMediaInput: (id: string, inputId: string) => serverRequest<DirectorAssetDetail>(`/director/assets/${enc(id)}/media-inputs/${enc(inputId)}`, { method: "DELETE" }),
    deleteAssetVariant: (id: string, variantId: string) => serverRequest<DirectorAssetDetail>(`/director/assets/${enc(id)}/variants/${enc(variantId)}`, { method: "DELETE" }),
    generateAsset: (id: string, value: { target: "primary-visual" | "variant-visual" | "sound"; variantId?: string; expectedHash: string }) => serverRequest<ServerGeneration>(`/director/assets/${enc(id)}/generate`, { method: "POST", body: JSON.stringify(value) }),
    deleteProject: (id: string) => serverRequest(`/projects/${enc(id)}`, { method: "DELETE" }),
};
