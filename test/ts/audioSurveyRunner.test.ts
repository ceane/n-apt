import {
  DEFAULT_AUDIO_SURVEY_CONFIG,
  type CandidateRecord,
  type SurveyChannelRange,
  type SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";
import {
  AudioSurveyRunner,
  type AudioSurveyFrameSource,
  type SurveyIqFrame,
} from "@n-apt/demodulation/survey/audioSurveyRunner";
import type {
  AudioSurveyArtifact,
  AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";

const channels: SurveyChannelRange[] = [
  { id: "a", label: "A", minHz: 18_000, maxHz: 4_390_000 },
  { id: "b", label: "B", minHz: 24_100_000, maxHz: 30_370_000 },
];

class MemorySurveyRepository implements AudioSurveyRepository {
  jobs = new Map<string, SurveyJobState>();
  candidates = new Map<string, CandidateRecord>();
  artifacts = new Map<string, AudioSurveyArtifact>();

  async saveJob(job: SurveyJobState) {
    this.jobs.set(job.id, job);
  }
  async getJob(jobId: string) {
    return this.jobs.get(jobId);
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
  async getArtifact(artifactId: string) {
    return this.artifacts.get(artifactId);
  }
  async listArtifacts(jobId?: string) {
    return [...this.artifacts.values()].filter(
      (artifact) => jobId === undefined || artifact.jobId === jobId,
    );
  }
  async getStorageUsage(capBytes: number) {
    const artifacts = [...this.artifacts.values()];
    return {
      usedBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
      capBytes,
      artifactCount: artifacts.length,
    };
  }
}

const makeFrame = (frameKey: string, timestampMs: number): SurveyIqFrame => ({
  frameKey,
  timestampMs,
  centerFrequencyHz: 1_618_000,
  sampleRateHz: 3_200_000,
  iqData: new Uint8Array(4096 * 2).fill(128),
});

describe("resumable audio survey runner", () => {
  it("commits a view before pausing and resumes from the next view", async () => {
    const repository = new MemorySurveyRepository();
    let frameNumber = 0;
    const tunedCenters: number[] = [];
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async tune(view) {
        tunedCenters.push(view.centerHz);
      },
      async nextFrame() {
        frameNumber++;
        return makeFrame(`live-${frameNumber}`, frameNumber * 2);
      },
    };
    let commitCount = 0;
    let runner: AudioSurveyRunner;
    runner = new AudioSurveyRunner({
      repository,
      channels,
      sources: { live: source, replay: null },
      now: () => 1_000 + frameNumber * 10,
      onViewCommitted: () => {
        commitCount++;
        runner.pause();
      },
    });
    const job = await runner.createJob({
      ...DEFAULT_AUDIO_SURVEY_CONFIG,
      sourceMode: "live",
      clipDurationMs: 1,
      dailyBudgetMs: 60_000,
    });

    const firstRun = await runner.start(job.id);
    expect(firstRun.status).toBe("paused");
    expect(firstRun.checkpoint.viewIndex).toBe(1);
    expect(repository.artifacts.size).toBe(1);

    const secondRun = await runner.start(job.id);
    expect(secondRun.status).toBe("paused");
    expect(secondRun.checkpoint.viewIndex).toBe(2);
    expect(tunedCenters).toEqual([1_618_000, 2_790_000]);
    expect(commitCount).toBe(2);
  });

  it("advances from replay to live before beginning the next pass", async () => {
    const repository = new MemorySurveyRepository();
    const replaySource: AudioSurveyFrameSource = {
      kind: "replay",
      async nextFrame(_afterFrameKey, _timeoutMs, view) {
        return makeFrame(`replay-${view.viewIndex}`, 10);
      },
    };
    const liveSource: AudioSurveyFrameSource = {
      kind: "live",
      async tune() {},
      async nextFrame(_afterFrameKey, _timeoutMs, view) {
        return makeFrame(`live-${view.viewIndex}`, 20);
      },
    };
    let commitCount = 0;
    let runner: AudioSurveyRunner;
    runner = new AudioSurveyRunner({
      repository,
      channels,
      sources: { live: liveSource, replay: replaySource },
      now: () => 1_000 + commitCount * 10,
      onViewCommitted: () => {
        commitCount++;
        if (commitCount === 4) runner.pause();
      },
    });
    const job = await runner.createJob({
      ...DEFAULT_AUDIO_SURVEY_CONFIG,
      sourceMode: "combined",
      clipDurationMs: 1,
      dailyBudgetMs: 60_000,
    });

    const paused = await runner.start(job.id);
    expect(paused.checkpoint).toMatchObject({
      sourcePhase: "live",
      viewIndex: 0,
      passIndex: 0,
    });
    expect(commitCount).toBe(4);
  });

  it("fails clearly instead of silently surveying a reduced sample-rate window", async () => {
    const repository = new MemorySurveyRepository();
    const source: AudioSurveyFrameSource = {
      kind: "live",
      async tune() {},
      async nextFrame(_afterFrameKey, _timeoutMs, view) {
        return {
          ...makeFrame("wrong-rate", 1),
          centerFrequencyHz: view.centerHz,
          sampleRateHz: 2_400_000,
        };
      },
    };
    const runner = new AudioSurveyRunner({
      repository,
      channels,
      sources: { live: source, replay: null },
      now: () => 1,
    });
    const job = await runner.createJob({
      ...DEFAULT_AUDIO_SURVEY_CONFIG,
      sourceMode: "live",
      clipDurationMs: 1,
      dailyBudgetMs: 60_000,
    });

    const result = await runner.start(job.id);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/requires 3200000 samples\/s; received 2400000/);
  });
});
