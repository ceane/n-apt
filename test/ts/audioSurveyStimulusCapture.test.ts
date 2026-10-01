import { captureAudioSurveyStimulusPair } from "@n-apt/demodulation/survey/audioSurveyStimulusCapture";
import type {
  AudioSurveyFrameSource,
  SurveyIqFrame,
} from "@n-apt/demodulation/survey/audioSurveyRunner";
import type {
  AudioSurveyArtifact,
  AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import type {
  CandidateRecord,
  SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";

const channels = [
  { id: "a", label: "A", minHz: 18_000, maxHz: 4_390_000 },
  { id: "b", label: "B", minHz: 24_100_000, maxHz: 30_370_000 },
];

const makeFrame = (key: string, timestampMs: number): SurveyIqFrame => {
  const sampleRateHz = 3_200_000;
  const iqData = new Uint8Array(sampleRateHz * 0.004 * 2);
  for (let index = 0; index < iqData.length / 2; index++) {
    const time = index / sampleRateHz;
    const envelope = 0.55 + 0.3 * Math.sin(2 * Math.PI * 1_000 * time);
    const phase = 2 * Math.PI * 12_000 * time;
    iqData[index * 2] = 128 + Math.round(120 * envelope * Math.cos(phase));
    iqData[index * 2 + 1] = 128 + Math.round(120 * envelope * Math.sin(phase));
  }
  return {
    frameKey: key,
    timestampMs,
    centerFrequencyHz: 1_618_000,
    sampleRateHz,
    iqData,
  };
};

const makeRepository = (
  artifacts: Map<string, AudioSurveyArtifact>,
): AudioSurveyRepository => ({
  async saveJob(_job: SurveyJobState) {},
  async getJob(_id: string) {
    return undefined;
  },
  async listJobs() {
    return [];
  },
  async saveCandidate(_candidate: CandidateRecord) {},
  async listCandidates(_jobId: string) {
    return [];
  },
  async saveArtifact(artifact: AudioSurveyArtifact) {
    artifacts.set(artifact.id, artifact);
    return [];
  },
  async getArtifact(id: string) {
    return artifacts.get(id);
  },
  async listArtifacts(jobId?: string) {
    return [...artifacts.values()].filter(
      (item) => jobId === undefined || item.jobId === jobId,
    );
  },
  async getStorageUsage(capBytes: number) {
    return { usedBytes: 0, capBytes, artifactCount: artifacts.size };
  },
});

describe("stimulus reference I/Q capture", () => {
  it("stores a narrowband IQ and PCM pair cropped to their shared frame timestamps", async () => {
    const frames = Array.from({ length: 26 }, (_, index) =>
      makeFrame(`frame-${index}`, 996 + index * 4),
    );
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async tune() {},
      async nextFrame(afterKey) {
        const index =
          afterKey === null
            ? 0
            : frames.findIndex((frame) => frame.frameKey === afterKey) + 1;
        return frames[index] ?? null;
      },
    };
    const artifacts = new Map<string, AudioSurveyArtifact>();
    const referencePcm = new Float32Array(4_800);
    for (let index = 0; index < referencePcm.length; index++) {
      referencePcm[index] = Math.sin((2 * Math.PI * index) / 48);
    }

    const artifact = await captureAudioSurveyStimulusPair(
      {
        jobId: "job",
        captureId: "capture-1",
        pcmData: referencePcm,
        pcmSampleRateHz: 48_000,
        startedAtMs: 1_000,
        centerFrequencyHz: 1_618_000,
        bandwidthHz: 25_000,
        channelId: "a",
        baselineAlgorithm: "am",
        audioSignalLabel: "coherent",
        storageCapBytes: 1_000_000,
      },
      {
        source,
        channels,
        repository: makeRepository(artifacts),
        now: () => 1_100,
      },
    );

    expect(artifact?.kind).toBe("reference-pair");
    const payload = artifact?.payload as {
      aligned: boolean;
      alignmentMethod: string;
      iqData: Uint8Array;
      iqSampleRateHz: number;
      pcmData: Float32Array;
      referenceStartedAtMs: number;
      audioSignalLabel: string;
    };
    expect(payload.aligned).toBe(true);
    expect(payload.alignmentMethod).toBe("shared-wall-clock-frame-timestamps");
    expect(payload.iqSampleRateHz).toBeGreaterThan(0);
    expect(payload.pcmData.length).toBe(referencePcm.length);
    expect(payload.iqData.length).toBeGreaterThan(0);
    expect(payload.referenceStartedAtMs).toBe(1_000);
    expect(payload.audioSignalLabel).toBe("coherent");
  });

  it("does not save a pair when less than 80 percent of the stimulus is covered", async () => {
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async nextFrame() {
        return makeFrame("one", 1_000);
      },
    };
    const artifacts = new Map<string, AudioSurveyArtifact>();
    const artifact = await captureAudioSurveyStimulusPair(
      {
        jobId: "job",
        captureId: "short",
        pcmData: new Float32Array(9_600),
        pcmSampleRateHz: 48_000,
        startedAtMs: 1_000,
        centerFrequencyHz: 1_618_000,
        bandwidthHz: 25_000,
        channelId: "a",
        baselineAlgorithm: "am",
        storageCapBytes: 1_000_000,
      },
      {
        source,
        channels,
        repository: makeRepository(artifacts),
        now: () => 1_100,
      },
    );

    expect(artifact).toBeNull();
    expect(artifacts.size).toBe(0);
  });

  it("rejects a reference pair instead of concatenating across an explicit I/Q gap", async () => {
    const frames = [
      makeFrame("rtl-1:4:10", 1_000),
      { ...makeFrame("rtl-1:4:12", 1_004), discontinuityBefore: true },
    ];
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async nextFrame(afterKey) {
        return frames[afterKey === null ? 0 : 1] ?? null;
      },
    };
    const artifacts = new Map<string, AudioSurveyArtifact>();

    await expect(
      captureAudioSurveyStimulusPair(
        {
          jobId: "job",
          captureId: "gapped",
          pcmData: new Float32Array(384),
          pcmSampleRateHz: 48_000,
          startedAtMs: 1_000,
          centerFrequencyHz: 1_618_000,
          bandwidthHz: 25_000,
          channelId: "a",
          baselineAlgorithm: "am",
          storageCapBytes: 1_000_000,
        },
        {
          source,
          channels,
          repository: makeRepository(artifacts),
          now: () => 1_100,
        },
      ),
    ).rejects.toThrow(/I\/Q timeline contains a gap/);

    expect(artifacts.size).toBe(0);
  });

  it("starts media playback after the RF view is tuned and stores only the selected baseline", async () => {
    let tuned = false;
    const frames = [
      {
        ...makeFrame("rtl-1:4:10", 1_000),
        sourceId: "rtl-1",
        streamEpoch: 4,
        sequence: 10,
      },
      {
        ...makeFrame("rtl-1:4:11", 1_004),
        sourceId: "rtl-1",
        streamEpoch: 4,
        sequence: 11,
        sampleStartIndex: 12_800,
      },
      {
        ...makeFrame("rtl-1:4:12", 1_008),
        sourceId: "rtl-1",
        streamEpoch: 4,
        sequence: 12,
        sampleStartIndex: 25_600,
      },
    ];
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async tune() {
        tuned = true;
      },
      async nextFrame(afterKey) {
        const index =
          afterKey === null
            ? 0
            : frames.findIndex((frame) => frame.frameKey === afterKey) + 1;
        return frames[index] ?? null;
      },
    };
    const artifacts = new Map<string, AudioSurveyArtifact>();
    const artifact = await captureAudioSurveyStimulusPair(
      {
        jobId: "job",
        captureId: "media",
        pcmData: new Float32Array(384),
        pcmSampleRateHz: 48_000,
        centerFrequencyHz: 1_618_000,
        bandwidthHz: 25_000,
        channelId: "a",
        baselineAlgorithm: "am",
        storageCapBytes: 1_000_000,
      },
      {
        source,
        channels,
        repository: makeRepository(artifacts),
        now: () => 1_100,
        startPlayback: async () => {
          expect(tuned).toBe(true);
          return 1_004;
        },
      },
    );

    expect(artifact?.kind).toBe("reference-pair");
    expect(
      (artifact?.payload as { referenceStartedAtMs: number })
        .referenceStartedAtMs,
    ).toBe(1_004);
    expect(
      Object.keys(
        (artifact?.payload as { baselinePcmDataByAlgorithm: object })
          .baselinePcmDataByAlgorithm,
      ),
    ).toEqual(["am"]);
    expect(artifact?.payload).not.toHaveProperty("audioSignalLabel");
  });

  it("checks the local storage budget before tuning or collecting a long reference", async () => {
    let tuned = false;
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async tune() {
        tuned = true;
      },
      async nextFrame() {
        return null;
      },
    };
    const artifacts = new Map<string, AudioSurveyArtifact>();
    const repository = {
      ...makeRepository(artifacts),
      async getStorageUsage(capBytes: number) {
        return { usedBytes: capBytes, capBytes, artifactCount: artifacts.size };
      },
    };

    await expect(
      captureAudioSurveyStimulusPair(
        {
          jobId: "job",
          captureId: "no-space",
          pcmData: new Float32Array(4_800),
          pcmSampleRateHz: 48_000,
          startedAtMs: 1_000,
          centerFrequencyHz: 1_618_000,
          bandwidthHz: 25_000,
          channelId: "a",
          baselineAlgorithm: "am",
          storageCapBytes: 1_000_000,
        },
        { source, channels, repository, now: () => 1_100 },
      ),
    ).rejects.toThrow(/remain under the local storage cap/);

    expect(tuned).toBe(false);
    expect(artifacts.size).toBe(0);
  });

  it("keeps the selected-frequency APT amplitude stream as its own baseline", async () => {
    const frames = [
      makeFrame("apt-0", 1_000),
      makeFrame("apt-1", 1_004),
      makeFrame("apt-2", 1_008),
    ];
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async nextFrame(afterKey) {
        const index =
          afterKey === null
            ? 0
            : frames.findIndex((frame) => frame.frameKey === afterKey) + 1;
        return frames[index] ?? null;
      },
    };
    const artifacts = new Map<string, AudioSurveyArtifact>();

    const artifact = await captureAudioSurveyStimulusPair(
      {
        jobId: "job",
        captureId: "apt-reference",
        pcmData: new Float32Array(384),
        pcmSampleRateHz: 48_000,
        startedAtMs: 1_000,
        centerFrequencyHz: 1_618_000,
        bandwidthHz: 200_000,
        channelId: "a",
        baselineAlgorithm: "apt",
        storageCapBytes: 1_000_000,
      },
      {
        source,
        channels,
        repository: makeRepository(artifacts),
        now: () => 1_100,
      },
    );

    const payload = artifact?.payload as {
      baselineAlgorithm: string;
      baselinePcmDataByAlgorithm: Record<string, Float32Array>;
      baselinePcmData: Float32Array;
    };
    expect(payload.baselineAlgorithm).toBe("apt");
    expect(Object.keys(payload.baselinePcmDataByAlgorithm)).toEqual(["apt"]);
    expect(payload.baselinePcmDataByAlgorithm.apt).toBe(
      payload.baselinePcmData,
    );
  });
});
