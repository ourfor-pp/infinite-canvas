import { serverRequest, uploadServerFile } from "./server";
import type { DirectorDocument, DirectorProject, DirectorRender, DirectorSequence, DirectorSource, DirectorState, DirectorTimeline, DirectorVideoSegment, DirectorVideoSegmentPreflight, DirectorWorkspace, H3QualityPreset } from "@/types/director";

const enc = encodeURIComponent;
export const directorApi = {
    projects: () => serverRequest<DirectorProject[]>("/projects?kind=director"),
    createProject: (title: string, id: string) => serverRequest<DirectorProject>("/projects", { method: "POST", body: JSON.stringify({ id, kind: "director", title }) }),
    project: (id: string) => serverRequest<DirectorProject>(`/projects/${enc(id)}`),
    state: (id: string) => serverRequest<DirectorState>(`/director/projects/${enc(id)}`),
    updateWorkspace: (id: string, value: Partial<DirectorWorkspace> & { revision: number }) => serverRequest<DirectorWorkspace>(`/director/projects/${enc(id)}/workspace`, { method: "PUT", body: JSON.stringify(value) }),
    addSource: async (projectId: string, file: File) => {
        const uploaded = await uploadServerFile(file, file.name);
        return serverRequest<DirectorSource>(`/director/projects/${enc(projectId)}/sources`, { method: "POST", body: JSON.stringify({ fileId: uploaded.fileId }) });
    },
    retrySource: (id: string) => serverRequest<DirectorSource>(`/director/sources/${enc(id)}/retry`, { method: "POST" }),
    chunks: (id: string, q = "", offset = 0, limit = 50) => serverRequest<Array<{ id: string; ordinal: number; heading: string; content: string; summary: string }>>(`/director/sources/${enc(id)}/chunks?q=${enc(q)}&offset=${offset}&limit=${limit}`),
    updateDocument: (projectId: string, kind: "story" | "script", value: Pick<DirectorDocument, "revision"> & Partial<Pick<DirectorDocument, "content">>) => serverRequest<DirectorDocument>(`/director/projects/${enc(projectId)}/documents/${kind}`, { method: "PUT", body: JSON.stringify(value) }),
    createSequence: (projectId: string, value: Record<string, unknown>) => serverRequest<DirectorSequence>(`/director/projects/${enc(projectId)}/sequences`, { method: "POST", body: JSON.stringify(value) }),
    updateSequence: (id: string, value: Record<string, unknown>) => serverRequest<DirectorSequence>(`/director/sequences/${enc(id)}`, { method: "PUT", body: JSON.stringify(value) }),
    deleteSequence: (id: string) => serverRequest(`/director/sequences/${enc(id)}`, { method: "DELETE" }),
    createVideoSegment: (projectId: string, value: Record<string, unknown>) => serverRequest<DirectorVideoSegment>(`/director/projects/${enc(projectId)}/video-segments`, { method: "POST", body: JSON.stringify(value) }),
    updateVideoSegment: (id: string, value: Record<string, unknown>) => serverRequest<DirectorVideoSegment>(`/director/video-segments/${enc(id)}`, { method: "PUT", body: JSON.stringify(value) }),
    videoSegmentPreflight: (id: string) => serverRequest<DirectorVideoSegmentPreflight>(`/director/video-segments/${enc(id)}/preflight`),
    generateStoryboard: (id: string, revision: number) => serverRequest<Record<string, unknown>>(`/director/video-segments/${enc(id)}/storyboard/generate`, { method: "POST", body: JSON.stringify({ revision }) }),
    generateVideoSegment: (id: string, revision: number, qualityPreset: H3QualityPreset) => serverRequest<Record<string, unknown>>(`/director/video-segments/${enc(id)}/generate`, { method: "POST", body: JSON.stringify({ revision, qualityPreset }) }),
    deleteVideoSegment: (id: string) => serverRequest(`/director/video-segments/${enc(id)}`, { method: "DELETE" }),
    updateTimeline: (projectId: string, value: Pick<DirectorTimeline, "revision" | "payload">) => serverRequest<DirectorTimeline>(`/director/projects/${enc(projectId)}/timeline`, { method: "PUT", body: JSON.stringify(value) }),
    renders: (projectId: string) => serverRequest<DirectorRender[]>(`/director/projects/${enc(projectId)}/renders`),
    createRender: (projectId: string, timelineRevision: number) => serverRequest<DirectorRender>(`/director/projects/${enc(projectId)}/renders`, { method: "POST", body: JSON.stringify({ timelineRevision }) }),
    cancelRender: (id: string) => serverRequest<DirectorRender>(`/director/renders/${enc(id)}/cancel`, { method: "POST" }),
    retryRender: (id: string) => serverRequest<DirectorRender>(`/director/renders/${enc(id)}/retry`, { method: "POST" }),
    deleteProject: (id: string) => serverRequest(`/projects/${enc(id)}`, { method: "DELETE" }),
};
