export type ProjectKind = "canvas" | "director";
export type DirectorEntityStatus = "draft" | "confirmed" | "locked";
export type DirectorSection = "overview" | "story" | "script" | "assets" | "storyboard" | "studio";

export type DirectorProject = {
    id: string;
    kind: "director";
    title: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorWorkspace = {
    projectId: string;
    targetDurationSeconds: number;
    aspectRatio: "16:9" | "9:16" | "1:1" | "2.39:1";
    language: string;
    stage: "source" | "story" | "script" | "style" | "assets" | "storyboard" | "shots" | "timeline" | "render";
    status: DirectorEntityStatus;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorSource = {
    id: string;
    projectId: string;
    fileId: string;
    name: string;
    mimeType: string;
    status: "processing" | "ready" | "failed";
    error: string | null;
    charCount: number;
    chapterCount: number;
    summary: string;
    outline: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorDocument = {
    projectId: string;
    kind: "story" | "script";
    content: string;
    status: DirectorEntityStatus;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorAssetRef = { id: string; revision: number };
export type DirectorVisualReview = { status: "pending" | "passed" | "failed" | "manual"; summary: string; issues: string[]; metrics?: Record<string, boolean | number | string>; generationId?: string };
export type DirectorStoryboardPanel = {
    id: string; position: number; title?: string; purpose?: string; description?: string; action?: string; dialogue?: string; narration?: string;
    imageFileId?: string; generationId?: string; promptSnapshot?: string; shotSize?: string; cameraAngle?: string; cameraMove?: string; durationSeconds?: number;
    characterRefs?: DirectorAssetRef[]; sceneRefs?: DirectorAssetRef[]; propRefs?: DirectorAssetRef[]; review?: DirectorVisualReview;
};
export type DirectorSequence = {
    id: string;
    projectId: string;
    position: number;
    title: string;
    summary: string;
    status: DirectorEntityStatus;
    payload: { storyboard?: DirectorStoryboardPanel[]; needsReview?: boolean; staleReason?: string; [key: string]: unknown };
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorShot = {
    id: string;
    projectId: string;
    sequenceId: string;
    position: number;
    title: string;
    status: DirectorEntityStatus;
    payload: {
        description?: string;
        action?: string;
        dialogue?: string;
        narration?: string;
        shotSize?: string;
        cameraAngle?: string;
        cameraMove?: string;
        durationSeconds?: number;
        boundary?: "cut" | "continue";
        characterRefs?: DirectorAssetRef[];
        sceneRefs?: DirectorAssetRef[];
        propRefs?: DirectorAssetRef[];
        firstFrameFileId?: string;
        lastFrameFileId?: string;
        actualFirstFrameFileId?: string;
        actualLastFrameFileId?: string;
        videoFileId?: string;
        continuationFromShotId?: string;
        audioCues?: Array<Record<string, unknown>>;
        needsReview?: boolean;
        videoStale?: boolean;
        [key: string]: unknown;
    };
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorTimelineClip = { id: string; shotId?: string; fileId?: string; start: number; duration: number; trimIn?: number; trimOut?: number; volume?: number; muted?: boolean; loop?: boolean };
export type DirectorTimeline = {
    projectId: string;
    payload: { shotOrder?: string[]; tracks?: Array<{ id: string; kind: "dialogue" | "narration" | "ambient" | "sfx" | "music"; clips: DirectorTimelineClip[] }> };
    revision: number;
    createdAt: string;
    updatedAt: string;
};
export type DirectorState = { activeStyleId: string | null; workspace: DirectorWorkspace; sources: DirectorSource[]; documents: DirectorDocument[]; sequences: DirectorSequence[]; shots: DirectorShot[]; timeline: DirectorTimeline };

export type DirectorRender = { id: string; projectId: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; outputFileId: string | null; error: string | null; createdAt: string; updatedAt: string };
