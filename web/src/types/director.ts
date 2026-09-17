export type ProjectKind = "canvas" | "director";
export type DirectorEntityStatus = "draft" | "confirmed" | "locked";
export type DirectorSection = "overview" | "story" | "script" | "style" | "assets" | "storyboard" | "studio" | "edit";

export type DirectorProject = {
    id: string;
    kind: "director";
    title: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorDiagnostic = { severity: "error" | "warning" | "info"; code: string; path: string; line?: number; entityId?: string; message: string };
export type DirectorValidation = { projectId: string; valid: boolean; scope?: string; diagnostics: DirectorDiagnostic[] };

export type DirectorDirectingRules = {
    positioning: string;
    intent: string;
    photography: string;
    performance: string;
    pacing: string;
    sound: string;
    prohibitions: string;
};

export type DirectorWorkspace = {
    projectId: string;
    targetDurationSeconds: number;
    aspectRatio: "16:9" | "9:16" | "1:1" | "2.39:1";
    language: string;
    stage: "source" | "story" | "script" | "style" | "assets" | "storyboard" | "shots" | "timeline" | "render";
    status: DirectorEntityStatus;
    directingRules: DirectorDirectingRules;
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
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorLogicalDocumentPart = {
    path: string;
    id: string;
    name: string;
    order: number;
    content: string;
    hash: string;
    revision: number;
    index: boolean;
};

export type DirectorLogicalDocument = {
    kind: "story" | "script";
    revision: number;
    content: string;
    parts: DirectorLogicalDocumentPart[];
};

export type DirectorScreenplayBreakdown = {
    projectId: string;
    scriptRevision: number;
    stale: boolean;
    payload: {
        estimatedDurationSeconds: number;
        review: {
            status: "not_run" | "passed" | "needs_revision";
            targetDurationSeconds: number;
            estimatedDurationSeconds: number;
            issues: Array<{
                type: "duration" | "repetition" | "causality" | "scene_function" | "coverage";
                sceneIds: string[];
                summary: string;
                suggestion: string;
            }>;
        };
        scenes: Array<{
            id: string; heading: string; title: string; location: string; timeOfDay: string;
            interiorExterior: "interior" | "exterior" | "mixed"; characterNames: string[]; propNames: string[];
            openingState: string; endingState: string; dramaticTurn: string; requiredDialogue: string[];
            beats: Array<{ id: string; summary: string; estimatedSeconds: number }>;
            estimatedSeconds: number;
        }>;
    };
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorAssetRef = { id: string; revision: number; variantId?: string };

export type DirectorAssetMedia = { id: string; fileId: string; path: string; name: string; mediaRole: string; kind: "image" | "audio" };
export type DirectorAssetVisualWorkspace = { id: string; label: string; kind: "primary" | "variant"; variantId?: string; description: string; prompt: string; promptPath: string; hash: string; inputs: DirectorAssetMedia[]; outputs: DirectorAssetMedia[] };
export type DirectorAssetSoundWorkspace = { prompt: string; promptPath: string; hash: string; sampleText: string; suggestedDurationSeconds?: number; input?: DirectorAssetMedia; output?: DirectorAssetMedia };
export type DirectorAssetUsage = { id: string; title: string; sequenceId: string; sequenceTitle: string; sequencePosition: number; segmentPosition: number; durationSeconds: number; variantId?: string; videoReady: boolean };
export type DirectorAssetDetail = { assetId: string; projectId: string; kind: "character" | "scene" | "prop"; name: string; revision: number; folderPath: string; dossier: { path: string; content: string; hash: string }; primaryVisual: DirectorAssetVisualWorkspace; variants: DirectorAssetVisualWorkspace[]; sound: DirectorAssetSoundWorkspace; usages: DirectorAssetUsage[] };
export type DirectorCastReview = {
    projectId: string;
    assetRevisions: Record<string, number>;
    status: "running" | "passed" | "needs_review" | "manual";
    stale: boolean;
    summary: string;
    characters: Array<{ assetId: string; realismIssues: string[]; identityStrengths: string[] }>;
    pairs: Array<{ assetIds: [string, string]; similarityRisk: "low" | "medium" | "high"; overlappingFeatures: string[]; suggestions: string[] }>;
    generationId: string | null;
    createdAt: string;
    updatedAt: string;
};
export type DirectorVisualReview = { status: "pending" | "passed" | "failed" | "manual"; summary: string; issues: string[]; metrics?: Record<string, boolean | number | string>; generationId?: string };
export type H3GenerationMode = "fl2va" | "ref2va";
export type H3QualityPreset = "preview" | "final";
export type H3GenerationRecipe = { qualityPreset: H3QualityPreset; resolution: "480p" | "768p"; steps: number; sampler: string; scheduler: string; refImageSize: "match" | "max"; attention: string; turbo: boolean };
export type H3FrameAlignment = { requestedSeconds: number; requestedFrames: number; modelFrames: number; trimFrames: number; fps: 24; stride: 17; base: 5 };
export type DirectorH3PromptSnapshot = { mode: H3GenerationMode; qualityPreset: H3QualityPreset; prompt: string; references: Array<{ fileId: string; kind?: "image" | "video" | "audio"; role?: "reference" | "first-frame" | "last-frame" | "continuation"; label?: string }>; previsHashes?: Record<string, string> };
export type DirectorDialogueCue = { speakerAssetId: string; speakerName: string; text: string; language: string; delivery: string; startSeconds: number; endSeconds: number; offScreen?: boolean };
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
        audioReferences?: Array<{ fileId: string; purpose: "voice" | "dialogue" | "sound" | "music"; speakerAssetId?: string; description: string }>;
        shotSize?: string;
        cameraAngle?: string;
        cameraMove?: string;
        durationSeconds?: number;
        sourceSceneId?: string;
        sourceBeatIds?: string[];
        sourceDurationSeconds?: number;
        dramaticBeat?: string;
        openingState?: string;
        endingState?: string;
        boundary?: "cut" | "continue";
        characterRefs?: DirectorAssetRef[];
        sceneRefs?: DirectorAssetRef[];
        propRefs?: DirectorAssetRef[];
        segmentId?: string;
        videoModel?: string;
        videoReferences?: Array<{ path: string; purpose: string; includeAudio: boolean }>;
        videoInputSnapshot?: DirectorH3PromptSnapshot;
        actualFirstFrameFileId?: string;
        actualLastFrameFileId?: string;
        videoFileId?: string;
        videoQualityPreset?: H3QualityPreset;
        videoRecipeSnapshot?: H3GenerationRecipe;
        videoNativeResolution?: string;
        videoDurationSeconds?: number;
        videoGenerationDurationMs?: number;
        continuationFromSegmentId?: string;
        generationIntent?: "reference" | "transition";
        transitionFromSegmentId?: string;
        transitionToSegmentId?: string;
        h3Mode?: H3GenerationMode;
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

export type DirectorVideoSegmentPreflight = { guideFraming?: { input: { width: number; height: number }; target: { width: number; height: number }; crop: { x: number; y: number; width: number; height: number } }; plan?: { capabilityVersion: string; mode: string; recipe?: string; seed: number; width?: number; height?: number; outputFrames?: number; outputSeconds?: number; overlapFrames?: number }; storyboardFileId?: string; transitionInputs?: { firstFrameFileId?: string; lastFrameFileId?: string }; selected: Array<{ fileId: string; name: string; purpose: "主角色" | "出镜角色" | "场景" | "关键道具" | "视觉风格"; assetId?: string }>; omitted: Array<{ fileId: string; name: string; purpose: string; assetId?: string }>; videoSelected: Array<{ fileId: string; name: string; purpose: string; assetId?: string }>; videoOmitted: Array<{ fileId: string; name: string; purpose: string; assetId?: string }>; assetBlockedReasons: string[]; promptValidation: { blockedReasons: string[]; warnings: string[] }; blockedReasons: string[]; warnings: string[]; route: { mode: H3GenerationMode; reason: string }; capabilities: { turboPreview: boolean; nativeState: boolean } };
export type DirectorEditClip = { id: string; taskId: string; trimIn: number; trimOut: number; linkedAudio: boolean };
export type DirectorSegmentPlan = { previsMode: "required" | "skip"; id: string; kind: "segment-design"; name: string; sequenceId: string; order: number; sourceSceneId?: string; sourceBeatIds: string[]; estimatedSeconds: number; videoModel: string; videoLimits?: { min: number; max: number }; purpose: string; staging: string; camera: string; action: string; dialogue: string; sound: string; openingState: string; endingState: string; connection: string; referenceImages: string[]; content: string; path?: string; hash: string; revision?: number };
export type DirectorTimelineClip = { id: string; taskId?: string; fadeIn?: number; fadeOut?: number; segmentId?: string; fileId?: string; start: number; duration: number; trimIn?: number; trimOut?: number; volume?: number; muted?: boolean; loop?: boolean };
export type DirectorTimeline = {
    projectId: string;
    payload: { videoClips?: DirectorEditClip[]; segmentOrder?: string[]; tracks?: Array<{ id: string; kind: "dialogue" | "narration" | "ambient" | "sfx" | "music" | "model-original"; clips: DirectorTimelineClip[] }> };
    revision: number;
    createdAt: string;
    updatedAt: string;
};
export type DirectorState = { activeStyleId: string | null; workspace: DirectorWorkspace; sources: DirectorSource[]; documents: DirectorDocument[]; screenplayBreakdown: DirectorScreenplayBreakdown; sequences: DirectorSequence[]; videoSegments: DirectorVideoSegment[]; timeline: DirectorTimeline };

export type DirectorRender = { id: string; projectId: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; outputFileId: string | null; error: string | null; createdAt: string; updatedAt: string };

export type DirectorPlaybackPlan = { warnings: string[]; timelineRevision: number; duration: number; audio: DirectorTimelineClip[]; segments: Array<{ clipId: string; taskId: string; start: number; segmentId: string; revision: number; fileId: string; trimIn: number; duration: number }> };

export type DirectorShotStoryboard = {
    id: string; title: string; image?: { path: string; fileId: string; hash: string };
    prompt: string; promptPath: string; promptHash: string;
    references: Array<{ path: string; purpose: string; name: string; fileId?: string; hash?: string; error?: string }>;
    errors: string[];
};
