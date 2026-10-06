import {
  AudioSurveyTrainer,
  bestAlignedWaveformRmse,
  getContiguousAudioSurveySplitRanges,
  getAudioSurveyEvaluationRanges,
  type AudioSurveyTrainingState,
} from "@n-apt/demodulation/survey/audioSurveyTraining";
import type {
  AudioSurveyArtifact,
  AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import type {
  CandidateRecord,
  SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";
import { TIME_DOMAIN_MODEL_VERSION } from "@n-apt/demodulation/survey/audioSurveyMl";

class MemoryRepository implements AudioSurveyRepository {
  jobs = new Map<string, SurveyJobState>();
  candidates = new Map<string, CandidateRecord>();
  artifacts = new Map<string, AudioSurveyArtifact>();
  async saveJob(job: SurveyJobState) {
    this.jobs.set(job.id, job);
  }
  async getJob(id: string) {
    return this.jobs.get(id);
  }
  async listJobs() {
    return [...this.jobs.values()];
  }
  async saveCandidate(candidate: CandidateRecord) {
    this.candidates.set(candidate.id, candidate);
  }
  async listCandidates(jobId: string) {
    return [...this.candidates.values()].filter((item) => item.jobId === jobId);
  }
  async saveArtifact(artifact: AudioSurveyArtifact) {
    this.artifacts.set(artifact.id, artifact);
    return [];
  }
  async getArtifact(id: string) {
    return this.artifacts.get(id);
  }
  async listArtifacts(jobId?: string) {
    return [...this.artifacts.values()].filter(
      (artifact) => jobId === undefined || artifact.jobId === jobId,
    );
  }
  async getStorageUsage(capBytes: number) {
    const artifacts = [...this.artifacts.values()];
    return {
      usedBytes: artifacts.reduce(
        (sum, artifact) => sum + artifact.sizeBytes,
        0,
      ),
      capBytes,
      artifactCount: artifacts.length,
    };
  }
}

const makePair = (id: string, createdAt: number): AudioSurveyArtifact => {
  const pcmData = new Float32Array(240_000);
  const iqData = new Uint8Array(pcmData.length * 2);
  for (let index = 0; index < pcmData.length; index++) {
    const audio = 0.5 * Math.sin((2 * Math.PI * index) / 32);
    const envelope = 0.55 + audio * 0.3;
    const phase = (2 * Math.PI * 11 * index) / 128;
    iqData[index * 2] = 128 + Math.round(120 * envelope * Math.cos(phase));
    iqData[index * 2 + 1] = 128 + Math.round(120 * envelope * Math.sin(phase));
    pcmData[index] = audio;
  }
  return {
    id,
    jobId: "job",
    kind: "reference-pair",
    sizeBytes: 512,
    score: 1,
    createdAt,
    payload: {
      aligned: true,
      iqData,
      iqSampleRateHz: 48_000,
      bandwidthHz: 25_000,
      pcmData,
      pcmSampleRateHz: 48_000,
      baselinePcmData: new Float32Array(pcmData.length),
      baselinePcmSampleRateHz: 48_000,
    },
  };
};

describe("resumable local audio model training", () => {
  it("builds guarded contiguous 70/15/15 training, validation, and test blocks", () => {
    const splits = getContiguousAudioSurveySplitRanges(10_000, 1_000, 100);

    expect(splits).toEqual({
      training: { startSample: 0, endSample: 6_900 },
      validation: { startSample: 7_100, endSample: 8_400 },
      test: { startSample: 8_600, endSample: 10_000 },
      guardSamples: 100,
    });
    expect(splits!.training.endSample).toBeLessThan(
      splits!.validation.startSample,
    );
    expect(splits!.validation.endSample).toBeLessThan(splits!.test.startSample);
    expect(getContiguousAudioSurveySplitRanges(128_000, 48_000)).toBeNull();
  });

  it("reports waveform error when a zero prediction misses an audio waveform", () => {
    const target = Float32Array.from(
      { length: 256 },
      (_, index) => 0.5 * Math.sin((2 * Math.PI * 440 * index) / 48_000),
    );

    expect(
      bestAlignedWaveformRmse(new Float32Array(target.length), target),
    ).toBeGreaterThan(0.3);
  });

  it("bounds held-out evaluation while sampling the start, middle, and end", () => {
    expect(getAudioSurveyEvaluationRanges(5_000)).toEqual([
      { startSample: 0, endSample: 5_000 },
    ]);
    expect(getAudioSurveyEvaluationRanges(240_000)).toEqual([
      { startSample: 0, endSample: 2_000 },
      { startSample: 119_000, endSample: 121_000 },
      { startSample: 238_000, endSample: 240_000 },
    ]);
  });

  it("pauses at an epoch boundary and resumes from the persisted checkpoint", async () => {
    const repository = new MemoryRepository();
    for (let index = 0; index < 4; index++) {
      const pair = makePair(`pair-${index}`, index);
      repository.artifacts.set(pair.id, pair);
    }
    let trainer: AudioSurveyTrainer;
    let pauseAfterEpoch: AudioSurveyTrainingState | undefined;
    trainer = new AudioSurveyTrainer({
      repository,
      totalEpochs: 3,
      maxTrainingSamples: 64,
      onStateUpdated: (state) => {
        if (state.epoch === 1 && state.status === "running") {
          pauseAfterEpoch = state;
          trainer.pause();
        }
      },
    });

    const paused = await trainer.start("job");
    expect(paused.status).toBe("paused");
    expect(paused.epoch).toBe(1);
    expect(pauseAfterEpoch?.epoch).toBe(1);

    const resumed = await new AudioSurveyTrainer({
      repository,
      totalEpochs: 3,
      maxTrainingSamples: 64,
    }).resume("job");
    expect(resumed.status).toBe("completed");
    expect(resumed.epoch).toBe(3);
    expect(resumed.modelPreferred).toBe(true);
    expect(resumed.validationPairCount).toBe(4);
    expect(resumed.testPairCount).toBe(4);
    expect(resumed.validationRmse).toEqual(expect.any(Number));
    expect(resumed.dspRmse).toBeDefined();
    const trainedArtifact = repository.artifacts.get(
      "job:audio-demod-training",
    );
    expect(trainedArtifact?.payload).toEqual(
      expect.objectContaining({
        onnxModelData: expect.any(Uint8Array),
        model: expect.objectContaining({
          version: TIME_DOMAIN_MODEL_VERSION,
          inputSampleRateHz: 48_000,
          channelBandwidthHz: 25_000,
        }),
      }),
    );
  });

  it("requires enough aligned waveform for guarded training and held-out blocks", async () => {
    const repository = new MemoryRepository();
    const shortPair = makePair("pair-short", 0);
    (shortPair.payload as { pcmData: Float32Array }).pcmData = new Float32Array(
      128_000,
    );
    (shortPair.payload as { iqData: Uint8Array }).iqData = new Uint8Array(
      256_000,
    );
    repository.artifacts.set(shortPair.id, shortPair);

    const state = await new AudioSurveyTrainer({ repository }).start("job");
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/long enough for guarded 70\/15\/15/);
  });
});
