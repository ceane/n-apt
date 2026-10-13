import type {
  AudioSurveyDecoderStrategy,
  AudioSurveySourceMode,
  CandidateRecord,
  SurveyConfig,
  SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";
import type {
  AudioSurveyArtifact,
  AudioSurveyRepository,
  AudioSurveyStorageUsage,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import type {
  AudioSurveyFrameSource,
  AudioSurveyRunnerOptions,
} from "@n-apt/demodulation/survey/audioSurveyRunner";
import type {
  AudioSurveyTrainingState,
} from "@n-apt/demodulation/survey/audioSurveyTraining";
import type {
  AudioSurveyPythonArtifactFiles,
  LoadedAudioSurveyPythonArtifact,
} from "@n-apt/demodulation/survey/audioSurveyPythonArtifact";
import type {
  AudioSurveyNeuralDemodulator,
  AudioSurveyNeuralFrameIdentity,
  AudioSurveyOnnxNeuralDemodulator,
} from "@n-apt/demodulation/survey/audioSurveyLiveDemod";
import type {
  AudioSurveyOnnxExecutionProvider,
  AudioSurveyOnnxRuntime,
  AudioSurveyOnnxRuntimeOptions,
  TimeDomainOnnxDemodStreamOptions,
} from "@n-apt/demodulation/survey/audioSurveyOnnxRuntime";
import type {
  TimeDomainDemodModel,
  TimeDomainPrediction,
} from "@n-apt/demodulation/survey/audioSurveyMl";
import type { AudioSurveyReferenceLabel, SurveyChannelRange } from "@n-apt/demodulation/survey/audioSurveyModel";
import type { AudioSurveyStimulusReference } from "@n-apt/demodulation/survey/audioSurveyStimulusCapture";

const unavailableMessage = "Encrypted ML modules are unavailable.";

export const AUDIO_SURVEY_SAMPLE_RATE_HZ = 3_200_000;
export const AUDIO_SURVEY_STORAGE_CAP_BYTES = 256_000_000;
export const AUDIO_SURVEY_STORAGE_HARD_CAP_BYTES = 1_000_000_000;
export const AUDIO_SURVEY_DAILY_BUDGET_MS = 0;
export const DEFAULT_AUDIO_SURVEY_CONFIG: Readonly<SurveyConfig> = Object.freeze({
  sourceMode: "combined",
  decoderStrategy: null,
  sampleRateHz: AUDIO_SURVEY_SAMPLE_RATE_HZ,
  dailyBudgetMs: AUDIO_SURVEY_DAILY_BUDGET_MS,
  storageCapBytes: AUDIO_SURVEY_STORAGE_CAP_BYTES,
  clipDurationMs: 5_000,
});

const emptyUsage = (capBytes: number): AudioSurveyStorageUsage => ({
  usedBytes: 0,
  capBytes,
  artifactCount: 0,
});

export const estimateAudioSurveyArtifactBytes = (_payload: unknown): number => 0;

export const audioSurveyRepository: AudioSurveyRepository = {
  async saveJob(_job: any) {},
  async getJob(_jobId: any) {
    return undefined;
  },
  async listJobs() {
    return [];
  },
  async saveCandidate(_candidate: any) {},
  async listCandidates(_jobId: any) {
    return [];
  },
  async saveArtifact(_artifact: any, _capBytes: any) {
    return [];
  },
  async getArtifact(_artifactId: any) {
    return undefined;
  },
  async listArtifacts(_jobId: any) {
    return [];
  },
  async getStorageUsage(capBytes: any) {
    return emptyUsage(capBytes);
  },
};

export class AudioSurveyRunner {
  constructor(_options: AudioSurveyRunnerOptions) {}

  async createJob(_config?: SurveyConfig): Promise<SurveyJobState> {
    throw new Error(unavailableMessage);
  }

  pause() {}

  pauseAtBoundary(): Promise<SurveyJobState> | null {
    return null;
  }

  async stop(_jobId?: string): Promise<SurveyJobState | undefined> {
    return undefined;
  }

  async start(_jobId: string): Promise<SurveyJobState> {
    throw new Error(unavailableMessage);
  }

  async resume(_jobId: string): Promise<SurveyJobState> {
    throw new Error(unavailableMessage);
  }
}

const noFrameSource = (kind: "live" | "replay"): AudioSurveyFrameSource => ({
  kind,
  async nextFrame() {
    return null;
  },
  endView() {},
});

export const createLiveAudioSurveySource = (_options: {
  getSourceId: () => string | null | undefined;
  sendFrequencyRange: (range: { min: number; max: number }) => void;
}): AudioSurveyFrameSource => noFrameSource("live");

export const createReplayAudioSurveySource = (): AudioSurveyFrameSource =>
  noFrameSource("replay");

export const captureAudioSurveyStimulusPair = async (
  _input: AudioSurveyStimulusReference,
  _options: unknown,
): Promise<AudioSurveyArtifact | null> => null;

export class AudioSurveyTrainer {
  constructor(_options?: unknown) {}

  pause() {}

  stop() {}

  async start(jobId: string): Promise<AudioSurveyTrainingState> {
    return {
      jobId,
      status: "failed",
      epoch: 0,
      totalEpochs: 0,
      trainingPairCount: 0,
      holdoutPairCount: 0,
      error: unavailableMessage,
    };
  }

  async resume(jobId: string): Promise<AudioSurveyTrainingState> {
    return this.start(jobId);
  }
}

export const loadAudioSurveyPythonArtifact = async (
  _files: AudioSurveyPythonArtifactFiles,
  _jobId: string,
): Promise<LoadedAudioSurveyPythonArtifact> => {
  throw new Error(unavailableMessage);
};

export const predictTimeDomainAudio = (
  _model: TimeDomainDemodModel,
  input: {
    iqData: Uint8Array;
    sampleRateHz: number;
    pcmSampleRateHz?: number;
    outputSampleCount?: number;
  },
): TimeDomainPrediction => ({
  samples: new Float32Array(0),
  sampleRateHz: input.pcmSampleRateHz ?? input.sampleRateHz,
});

export const isAudioSurveyNeuralModelReady = (
  _model: TimeDomainDemodModel | null | undefined,
  _training: Pick<AudioSurveyTrainingState, "status" | "modelPreferred"> | null,
  _profile?: { inputSampleRateHz: number; channelBandwidthHz: number },
): _model is TimeDomainDemodModel => false;

export const shouldResetAudioSurveyNeuralStream = (
  _previous: AudioSurveyNeuralFrameIdentity | null,
  _next: AudioSurveyNeuralFrameIdentity,
): boolean => true;

export const createAudioSurveyNeuralDemodulator = (_options: {
  model: TimeDomainDemodModel;
  centerFrequencyHz: number;
  bandwidthHz: number;
}): AudioSurveyNeuralDemodulator => ({
  process: () => new Float32Array(0),
  reset() {},
});

export const createAudioSurveyOnnxNeuralDemodulator = async (_options: {
  model: TimeDomainDemodModel;
  onnxModelData: Uint8Array;
  centerFrequencyHz: number;
  bandwidthHz: number;
  executionProvider?: AudioSurveyOnnxExecutionProvider;
}): Promise<AudioSurveyOnnxNeuralDemodulator> => {
  throw new Error(unavailableMessage);
};

export const createAudioSurveyOnnxRuntime = async (
  _modelData: Uint8Array,
  _options?: AudioSurveyOnnxRuntimeOptions,
): Promise<AudioSurveyOnnxRuntime> => {
  throw new Error(unavailableMessage);
};

export class TimeDomainOnnxDemodStream {
  constructor(
    _runtime: AudioSurveyOnnxRuntime,
    _options: TimeDomainOnnxDemodStreamOptions,
  ) {}

  async processIqChunk(_iqData: Uint8Array): Promise<Float32Array> {
    return new Float32Array(0);
  }

  reset() {}
}

export const AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ = 48_000;
export const resampleDecodedAudioToMonoPcm = (
  buffer: {
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    getChannelData(channel: number): Float32Array;
  },
  targetSampleRateHz = AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ,
): Float32Array => {
  if (buffer.length === 0 || buffer.numberOfChannels === 0) {
    return new Float32Array(0);
  }
  const outputLength = Math.max(
    1,
    Math.round((buffer.length * targetSampleRateHz) / buffer.sampleRate),
  );
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      mono[index] += samples[index] / buffer.numberOfChannels;
    }
  }
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = (index * buffer.sampleRate) / targetSampleRateHz;
    const left = Math.floor(sourcePosition);
    const right = Math.min(buffer.length - 1, left + 1);
    const mix = sourcePosition - left;
    output[index] = mono[left] * (1 - mix) + mono[right] * mix;
  }
  return output;
};

export const VISION_PRESETS = Object.freeze({
  S: Object.freeze([102, 51, 255]),
  M: Object.freeze([0, 255, 0]),
  L: Object.freeze([191, 255, 0]),
  Red: Object.freeze([255, 0, 0]),
});

export const isMockVisionTestSource = (_source: unknown): boolean => false;
export const getVisionReceiverLabel = (_source: unknown): null => null;

export const getVisionDisplayOptions = async (browserWindow: Window) => ({
  supported: false,
  displays: [
    {
      id: "current-display",
      label: `Current display · ${browserWindow.screen.width}×${browserWindow.screen.height}`,
      screen: null,
    },
  ],
});

export const requestVisionFullscreen = async (
  element: HTMLElement,
  _selectedScreen: unknown,
  _browserWindow: Window,
): Promise<void> => {
  if (typeof element.requestFullscreen !== "function") {
    throw new Error("Fullscreen presentation is unavailable in this browser");
  }
  await element.requestFullscreen();
};

export type { AudioSurveyDecoderStrategy, AudioSurveyReferenceLabel, AudioSurveySourceMode };
export type { SurveyChannelRange };
