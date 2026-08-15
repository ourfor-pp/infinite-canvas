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
export type H3GenerationMode = "fl2va" | "ref2va";
export type H3QualityPreset = "preview" | "final";
export type H3GenerationRecipe = { qualityPreset: H3QualityPreset; resolution: "480p" | "768p"; steps: number; sampler: string; scheduler: string; refImageSize: "match" | "max"; attention: string; turbo: boolean };
export type H3TemporalGuide = { frameId: string; fileId: string; timeSeconds: number; frameIndex: number; strength: "hard" | "semantic" };
export type H3FrameAlignment = { requestedSeconds: number; requestedFrames: number; modelFrames: number; trimFrames: number; fps: 24; stride: 17; base: 5 };
export type DirectorH3PromptSnapshot = { mode: H3GenerationMode; qualityPreset: H3QualityPreset; prompt: string; references: Array<{ fileId: string; kind?: "image" | "video" | "audio"; role?: "reference" | "first-frame" | "last-frame" | "continuation" }>; temporalGuides: H3TemporalGuide[]; storyboardRevision: number };
export type DirectorStoryboardFrame = { id: string; position: number; shotNumber: number; timeSeconds: number; kind: "shot-start" | "keyframe" | "shot-end"; description: string; action: string; cameraAngle: string; cameraMove: string; sound: string; guideEnabled?: boolean; guideStrength?: "hard" | "semantic"; croppedFileId?: string; resolvedFrameIndex?: number };
export type DirectorStoryboardSheet = { revision: number; layout: "2x2" | "3x2" | "3x3"; frames: DirectorStoryboardFrame[]; imageFileId?: string; firstFrameFileId?: string; lastFrameFileId?: string; generationId?: string; promptSnapshot?: string; referenceSnapshot?: DirectorVideoSegmentPreflight; review?: DirectorVisualReview };
export type DirectorSequence = {
    id: string;
    projectId: string;
    position: number;
    title: string;
    summary: string;
    status: DirectorEntityStatus;
    payload: { needsReview?: boolean; staleReason?: string; [key: string]: unknown };
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorVideoSegment = {
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
        storyboardSheet?: DirectorStoryboardSheet;
        storyboardFrameCount?: 4 | 6 | 9;
        firstFrameFileId?: string;
        lastFrameFileId?: string;
        actualFirstFrameFileId?: string;
        actualLastFrameFileId?: string;
        videoFileId?: string;
        videoQualityPreset?: H3QualityPreset;
        videoRecipeSnapshot?: H3GenerationRecipe;
        videoNativeResolution?: string;
        videoGenerationDurationMs?: number;
        continuationFromSegmentId?: string;
        h3Mode?: H3GenerationMode;
        h3ModeOverride?: H3GenerationMode | null;
        h3ModeReason?: string;
        h3PromptSnapshot?: DirectorH3PromptSnapshot;
        nativeAudioFileId?: string;
        nativeAudioStatus?: "ready" | "missing";
        audioCues?: Array<Record<string, unknown>>;
        needsReview?: boolean;
        videoStale?: boolean;
        [key: string]: unknown;
    };
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorVideoSegmentPreflight = { selected: Array<{ fileId: string; name: string; purpose: "主角色" | "出镜角色" | "场景" | "关键道具" | "视觉风格"; assetId?: string }>; omitted: Array<{ fileId: string; name: string; purpose: string; assetId?: string }>; videoSelected: Array<{ fileId: string; name: string; purpose: string; assetId?: string }>; videoOmitted: Array<{ fileId: string; name: string; purpose: string; assetId?: string }>; temporalGuides: H3TemporalGuide[]; blockedReasons: string[]; route: { mode: H3GenerationMode; reason: string }; capabilities: { temporalGuides: boolean; turboPreview: boolean }; recipes: { preview: H3GenerationRecipe; final: H3GenerationRecipe }; frameAlignment: H3FrameAlignment };
export type DirectorTimelineClip = { id: string; segmentId?: string; fileId?: string; start: number; duration: number; trimIn?: number; trimOut?: number; volume?: number; muted?: boolean; loop?: boolean };
export type DirectorTimeline = {
    projectId: string;
    payload: { segmentOrder?: string[]; tracks?: Array<{ id: string; kind: "dialogue" | "narration" | "ambient" | "sfx" | "music" | "model-original"; clips: DirectorTimelineClip[] }> };
    revision: number;
    createdAt: string;
    updatedAt: string;
};
export type DirectorState = { activeStyleId: string | null; workspace: DirectorWorkspace; sources: DirectorSource[]; documents: DirectorDocument[]; sequences: DirectorSequence[]; videoSegments: DirectorVideoSegment[]; timeline: DirectorTimeline };

export type DirectorRender = { id: string; projectId: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; outputFileId: string | null; error: string | null; createdAt: string; updatedAt: string };
