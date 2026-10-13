declare const __N_APT_ML_BUNDLE_READY__: boolean;

declare module "@n-apt/encrypted-modules/tmp/ts/math/napt-spike-eq" {
  const calculateX: (t: number, clump: unknown) => number;
  export default calculateX;
}

declare module "@n-apt/encrypted-modules/tmp/ts/components/math/MockNAPTMath" {
  const MockNAPTMath: React.ComponentType;
  export default MockNAPTMath;
}

declare module "@n-apt/encrypted-modules/tmp/ts/components/math/DemodMath" {
  const DemodMath: React.ComponentType;
  export default DemodMath;
}

declare module "@n-apt/encrypted-modules/tmp/ml/index" {
  export const DemodReadinessNode: React.ComponentType<any>;
  export const CoreMLNode: React.ComponentType<any>;
  export const StimulusNode: React.ComponentType<any>;
  export const StimulusNodeLibraryEntry: React.ComponentType<any>;
  export const AudioDemodWorkflowFlow: React.ComponentType<any>;
  export const VisionDemodWorkflowFlow: React.ComponentType<any>;
  export const VisionScene: React.ComponentType<any>;
  export const nativeClassifier: Record<string, any>;
  export const visionModel: Record<string, any>;
  export const visionDecoder: Record<string, any>;
  export const visionOnnx: Record<string, any>;
  export const audioSurveyModel: Record<string, any>;
  export const audioSurveyRuntime: Record<string, any>;
  export const ML_MODULE_BUNDLE_API_VERSION: 1;
}

// The source modules below are part of the encrypted ML bundle. Keep their
// public names available to the application without publishing their shapes.
declare module "@n-apt/demodulation/survey/audioSurveyModel" {
  export const AUDIO_SURVEY_STORAGE_CAP_BYTES: any;
  export const AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES: any;
  export const DEFAULT_AUDIO_SURVEY_CONFIG: any;
  export const AUDIO_SURVEY_SAMPLE_RATE_HZ: any;
  export const buildAudioSurveyViews: any;
  export const getAudioSurveySourceOrder: any;
  export const advanceAudioSurveyCheckpoint: any;
  export const hasAudioSurveyBudgetRemaining: any;
  export type CandidateRecord = any;
  export type AudioSurveyReferenceLabel = any;
  export type AudioSurveyDecoderStrategy = any;
  export type AudioSurveySourceMode = any;
  export type SurveyChannelRange = any;
  export type SurveyJobState = any;
  export type SurveyConfig = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyStorage" {
  export const audioSurveyRepository: any;
  export const estimateAudioSurveyArtifactBytes: any;
  export type AudioSurveyArtifact = any;
  export type AudioSurveyStorageUsage = any;
  export type AudioSurveyRepository = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyRunner" {
  export const AudioSurveyRunner: any;
  export type AudioSurveyRunner = any;
  export type AudioSurveyFrameSource = any;
  export type AudioSurveyRunnerOptions = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyFrameSources" {
  export const createLiveAudioSurveySource: any;
  export const createReplayAudioSurveySource: any;
}

declare module "@n-apt/demodulation/survey/audioSurveyStimulusCapture" {
  export const captureAudioSurveyStimulusPair: any;
  export type AudioSurveyStimulusReference = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyTraining" {
  export const AudioSurveyTrainer: any;
  export type AudioSurveyTrainer = any;
  export type AudioSurveyTrainingState = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyPythonArtifact" {
  export const loadAudioSurveyPythonArtifact: any;
  export type AudioSurveyPythonArtifactFiles = any;
  export type LoadedAudioSurveyPythonArtifact = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyMl" {
  export const predictTimeDomainAudio: any;
  export type TimeDomainDemodModel = any;
  export type TimeDomainPrediction = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyLiveDemod" {
  export const createAudioSurveyNeuralDemodulator: any;
  export const createAudioSurveyOnnxNeuralDemodulator: any;
  export const isAudioSurveyNeuralModelReady: any;
  export const shouldResetAudioSurveyNeuralStream: any;
  export type AudioSurveyOnnxNeuralDemodulator = any;
  export type AudioSurveyNeuralFrameIdentity = any;
  export type AudioSurveyNeuralBackend = any;
  export type AudioSurveyNeuralDemodulator = any;
}

declare module "@n-apt/demodulation/survey/audioSurveyOnnxRuntime" {
  export const TimeDomainOnnxDemodStream: any;
  export const createAudioSurveyOnnxRuntime: any;
  export type AudioSurveyOnnxExecutionProvider = any;
  export type AudioSurveyOnnxRuntime = any;
  export type AudioSurveyOnnxRuntimeOptions = any;
  export type TimeDomainOnnxDemodStreamOptions = any;
}

declare module "@n-apt/demodulation/vision/visionModel" {
  export type VisionPreset = any;
}

declare module "@n-apt/classification/native/core" {
  export type FeatureSummary = any;
  export type FrameMetadata = any;
  export type NativeFrame = any;
  export type NativeModel = any;
  export type WindowKind = any;
}

declare module "@n-apt/classification/native/NativeClassifierPanel" {
  export type NativeClassifierPanel = any;
  export type LegacyDecision = any;
  export type NativeShadowResult = any;
  export type NativeShadowResultState = any;
  export type NativeTrainingCaptureDownloadLinks = any;
}

declare module "@n-apt/webmcp/integration" {
  export function useWebMCP(route?: string): any;
  export function initializeWebMCP(): boolean;
  export function setupSpectrumToolHandlers(sidebarProps: any): void;
  export function setupDrawSignalToolHandlers(drawSignalProps: any): void;
  export function setupModel3DToolHandlers(model3DProps: any): void;
  export function setupHotspotToolHandlers(hotspotProps: any): void;
  export function setupMapEndpointsToolHandlers(mapProps: any): void;
}

declare module "express" {
  export interface Request {
    headers: { [key: string]: string | string[] | undefined };
    path: string;
  }
  export interface Response {
    setHeader(name: string, value: string): Response;
    send(body: any): Response;
  }
  export interface NextFunction {
    (): void;
  }
}
