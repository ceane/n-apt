import {
  AudioSurveyTrainer,
  type AudioSurveyTrainingState,
} from "@n-apt/demodulation/survey/audioSurveyTraining";
import type { AudioSurveyArtifact, AudioSurveyRepository } from "@n-apt/demodulation/survey/audioSurveyStorage";
import type { CandidateRecord, SurveyJobState } from "@n-apt/demodulation/survey/audioSurveyModel";

class MemoryRepository implements AudioSurveyRepository {
  jobs = new Map<string, SurveyJobState>();
  candidates = new Map<string, CandidateRecord>();
  artifacts = new Map<string, AudioSurveyArtifact>();
  async saveJob(job: SurveyJobState) { this.jobs.set(job.id, job); }
  async getJob(id: string) { return this.jobs.get(id); }
  async listJobs() { return [...this.jobs.values()]; }
  async saveCandidate(candidate: CandidateRecord) { this.candidates.set(candidate.id, candidate); }
  async listCandidates(jobId: string) { return [...this.candidates.values()].filter((item) => item.jobId === jobId); }
  async saveArtifact(artifact: AudioSurveyArtifact) { this.artifacts.set(artifact.id, artifact); return []; }
  async getArtifact(id: string) { return this.artifacts.get(id); }
  async listArtifacts(jobId?: string) {
    return [...this.artifacts.values()].filter((artifact) => jobId === undefined || artifact.jobId === jobId);
  }
  async getStorageUsage(capBytes: number) {
    const artifacts = [...this.artifacts.values()];
    return { usedBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0), capBytes, artifactCount: artifacts.length };
  }
}

const makePair = (id: string, createdAt: number): AudioSurveyArtifact => {
  const iqData = new Uint8Array(256);
  const pcmData = new Float32Array(128);
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
      pcmData,
      pcmSampleRateHz: 48_000,
      baselinePcmData: pcmData.slice(),
      baselinePcmSampleRateHz: 48_000,
    },
  };
};

describe("resumable local audio model training", () => {
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
    expect(resumed.dspRmse).toBeDefined();
  });

  it("requires separate aligned pairs for training and held-out evaluation", async () => {
    const repository = new MemoryRepository();
    repository.artifacts.set("pair-0", makePair("pair-0", 0));
    repository.artifacts.set("pair-1", makePair("pair-1", 1));

    const state = await new AudioSurveyTrainer({ repository }).start("job");
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/three timestamp-aligned reference pairs/);
  });
});
