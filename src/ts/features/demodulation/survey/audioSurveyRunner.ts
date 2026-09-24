import {
  createDemodProcessor,
  type DemodProcessor,
} from "@n-apt/demodulation/utils/demodProcessors";
import {
  analyzeAudioSurveyFrame,
  createAudioSurveyChannelizer,
  type AudioSurveyCandidate,
  type ChannelizedSurveyIq,
} from "@n-apt/demodulation/survey/audioSurveyDsp";
import {
  advanceAudioSurveyCheckpoint,
  AUDIO_SURVEY_DAILY_BUDGET_MS,
  buildAudioSurveyViews,
  DEFAULT_AUDIO_SURVEY_CONFIG,
  getAudioSurveySourceOrder,
  hasAudioSurveyBudgetRemaining,
  type CandidateRecord,
  type SurveyChannelRange,
  type SurveyCheckpoint,
  type SurveyConfig,
  type SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";
import {
  audioSurveyRepository,
  estimateAudioSurveyArtifactBytes,
  type AudioSurveyArtifact,
  type AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";

export interface SurveyIqFrame {
  frameKey: string;
  timestampMs: number;
  centerFrequencyHz: number;
  sampleRateHz: number;
  iqData: Uint8Array;
}

export interface AudioSurveyFrameSource {
  kind: "live" | "replay";
  tune?: (view: ReturnType<typeof buildAudioSurveyViews>[number]) => Promise<void> | void;
  nextFrame: (
    afterFrameKey: string | null,
    timeoutMs: number,
    view: ReturnType<typeof buildAudioSurveyViews>[number],
  ) => Promise<SurveyIqFrame | null>;
}

export interface AudioSurveyRunnerOptions {
  repository?: AudioSurveyRepository;
  channels: readonly SurveyChannelRange[];
  sources: {
    live: AudioSurveyFrameSource | null;
    replay: AudioSurveyFrameSource | null;
  };
  now?: () => number;
  onJobUpdated?: (job: SurveyJobState) => void;
  onCandidateUpdated?: (candidate: CandidateRecord) => void;
  onViewCommitted?: (job: SurveyJobState) => void;
}

interface CandidateCapture {
  candidate: AudioSurveyCandidate;
  record: CandidateRecord;
  processor: DemodProcessor;
  channelizer: ReturnType<typeof createAudioSurveyChannelizer>;
  pcmChunks: Float32Array[];
  iqChunks: Uint8Array[];
  iqSampleRateHz: number;
}

const concatFloat32 = (chunks: readonly Float32Array[]): Float32Array => {
  const output = new Float32Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const concatBytes = (chunks: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const clampFrequencyRange = (
  left: { minHz: number; maxHz: number },
  right: { minHz: number; maxHz: number },
) => ({ minHz: Math.max(left.minHz, right.minHz), maxHz: Math.min(left.maxHz, right.maxHz) });

const toLocalDayKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const getModulation = (candidate: AudioSurveyCandidate): "am" | "fm" =>
  candidate.modulation === "unknown"
    ? candidate.modulationScores.fm > candidate.modulationScores.am
      ? "fm"
      : "am"
    : candidate.modulation;

const makeCandidateId = (
  jobId: string,
  source: "live" | "replay",
  channelId: string,
  centerHz: number,
) =>
  `${jobId}:${source}:${channelId}:${Math.round(centerHz / 6_250) * 6_250}`;

const cloneForPersistence = <T extends Float32Array | Uint8Array>(value: T): T =>
  value.slice() as T;

export class AudioSurveyRunner {
  private readonly repository: AudioSurveyRepository;
  private readonly now: () => number;
  private activeRun: Promise<SurveyJobState> | null = null;
  private activeJobId: string | null = null;
  private pauseRequested = false;
  private stopRequested = false;

  constructor(private readonly options: AudioSurveyRunnerOptions) {
    this.repository = options.repository ?? audioSurveyRepository;
    this.now = options.now ?? Date.now;
  }

  async createJob(
    config: SurveyConfig = { ...DEFAULT_AUDIO_SURVEY_CONFIG },
  ): Promise<SurveyJobState> {
    buildAudioSurveyViews(this.options.channels, config.sampleRateHz);
    const createdAt = this.now();
    const sourceOrder = getAudioSurveySourceOrder(config.sourceMode);
    const job: SurveyJobState = {
      id: `audio_survey_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      status: "ready",
      config: { ...config },
      checkpoint: {
        sourcePhase: sourceOrder[0],
        viewIndex: 0,
        passIndex: 0,
        lastFrameKey: null,
        lastFrameTimestamp: null,
        elapsedMsToday: 0,
        budgetDay: toLocalDayKey(createdAt),
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.repository.saveJob(job);
    this.options.onJobUpdated?.(job);
    return job;
  }

  pause() {
    this.pauseRequested = true;
  }

  pauseAtBoundary() {
    this.pauseRequested = true;
    return this.activeRun;
  }

  async stop(jobId?: string) {
    this.stopRequested = true;
    if (this.activeRun) return this.activeRun;
    if (!jobId) return undefined;
    const job = await this.repository.getJob(jobId);
    if (!job || job.status === "stopped" || job.status === "completed") return job;
    return this.saveJob({ ...job, status: "stopped" });
  }

  start(jobId: string): Promise<SurveyJobState> {
    if (this.activeRun) {
      if (this.activeJobId !== jobId) {
        return Promise.reject(new Error("Another audio survey job is already running"));
      }
      return this.activeRun;
    }
    this.pauseRequested = false;
    this.stopRequested = false;
    this.activeJobId = jobId;
    this.activeRun = this.runLoop(jobId).finally(() => {
      this.activeRun = null;
      this.activeJobId = null;
    });
    return this.activeRun;
  }

  resume(jobId: string) {
    return this.start(jobId);
  }

  private async saveJob(job: SurveyJobState): Promise<SurveyJobState> {
    const updated = { ...job, updatedAt: this.now() };
    await this.repository.saveJob(updated);
    this.options.onJobUpdated?.(updated);
    return updated;
  }

  private async runLoop(jobId: string): Promise<SurveyJobState> {
    let job = await this.repository.getJob(jobId);
    if (!job) throw new Error(`Audio survey job ${jobId} was not found`);
    if (job.status === "stopped" || job.status === "completed") return job;

    const dayKey = toLocalDayKey(this.now());
    let elapsedMsToday =
      job.checkpoint.budgetDay === dayKey ? job.checkpoint.elapsedMsToday : 0;
    const elapsedAtStart = elapsedMsToday;
    const startedAt = this.now();
    job = await this.saveJob({
      ...job,
      status: "running",
      error: undefined,
      checkpoint: {
        ...job.checkpoint,
        elapsedMsToday,
        budgetDay: dayKey,
      },
    });
    const views = buildAudioSurveyViews(
      this.options.channels,
      job.config.sampleRateHz,
    );

    while (true) {
      elapsedMsToday = elapsedAtStart + Math.max(0, this.now() - startedAt);
      if (!hasAudioSurveyBudgetRemaining(elapsedMsToday, job.config.dailyBudgetMs)) {
        return this.saveJob({
          ...job,
          status: "paused",
          checkpoint: {
            ...job.checkpoint,
            elapsedMsToday: job.config.dailyBudgetMs,
            budgetDay: dayKey,
          },
        });
      }

      const view = views[job.checkpoint.viewIndex];
      if (!view) {
        job = await this.saveJob({ ...job, status: "failed", error: "Survey checkpoint points outside the view plan" });
        return job;
      }
      const source = this.options.sources[job.checkpoint.sourcePhase];

      try {
        const result = source
          ? await this.processView(job, view, source)
          : { lastFrameKey: null, lastFrameTimestamp: null };
        const nextCheckpoint = advanceAudioSurveyCheckpoint(
          {
            ...job.checkpoint,
            lastFrameKey: result.lastFrameKey,
            lastFrameTimestamp: result.lastFrameTimestamp,
          },
          views.length,
          job.config.sourceMode,
        );
        elapsedMsToday = elapsedAtStart + Math.max(0, this.now() - startedAt);
        job = await this.saveJob({
          ...job,
          status: "running",
          checkpoint: {
            ...nextCheckpoint,
            elapsedMsToday: Math.min(elapsedMsToday, job.config.dailyBudgetMs),
            budgetDay: dayKey,
          },
        });
        this.options.onViewCommitted?.(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const storageFull = message.toLowerCase().includes("storage cap");
        return this.saveJob({
          ...job,
          status: storageFull ? "paused" : "failed",
          error: message,
          checkpoint: {
            ...job.checkpoint,
            elapsedMsToday: Math.min(
              elapsedAtStart + Math.max(0, this.now() - startedAt),
              job.config.dailyBudgetMs,
            ),
            budgetDay: dayKey,
          },
        });
      }

      if (this.stopRequested) {
        return this.saveJob({ ...job, status: "stopped" });
      }
      if (this.pauseRequested) {
        return this.saveJob({ ...job, status: "paused" });
      }
    }
  }

  private async processView(
    job: SurveyJobState,
    view: ReturnType<typeof buildAudioSurveyViews>[number],
    source: AudioSurveyFrameSource,
  ): Promise<{ lastFrameKey: string | null; lastFrameTimestamp: number | null }> {
    if (source.kind === "live") {
      if (!source.tune) throw new Error("Live survey source cannot tune RF views");
      await source.tune(view);
    }

    const channel = this.options.channels.find(
      (item) => item.id === view.channelId,
    );
    if (!channel) throw new Error(`Channel ${view.channelLabel} is unavailable`);
    const captures = new Map<string, CandidateCapture>();
    const firstFrameAt = this.now();
    const clipDurationMs = Math.max(1, job.config.clipDurationMs);
    const maxWallMs = Math.max(5_000, clipDurationMs * 3 + 2_000);
    let capturedSeconds = 0;
    let frameCount = 0;
    let frameRequests = 0;
    // RTL-SDR frames are often only a few milliseconds long at 3.2 MS/s.
    // Bound requests generously while relying on maxWallMs for the real timeout.
    const maxFrameRequests = Math.max(
      1_000,
      Math.ceil((clipDurationMs / 1_000) * 10_000),
    );
    let lastAnalyzeAt = Number.NEGATIVE_INFINITY;
    let cursor = job.checkpoint.lastFrameKey ?? null;
    let lastFrameTimestamp: number | null = job.checkpoint.lastFrameTimestamp;
    let lastFrameKey: string | null = cursor;
    let firstViewFrameKey: string | null = null;
    let firstViewFrameTimestamp: number | null = null;
    const previousCandidates = await this.repository.listCandidates(job.id);
    const previousById = new Map(previousCandidates.map((candidate) => [candidate.id, candidate]));

    while (
      capturedSeconds < clipDurationMs / 1000 &&
      this.now() - firstFrameAt < maxWallMs &&
      frameRequests < maxFrameRequests
    ) {
      const remainingMs = Math.max(100, maxWallMs - (this.now() - firstFrameAt));
      frameRequests++;
      const frame = await source.nextFrame(cursor, Math.min(1_000, remainingMs), view);
      if (!frame) {
        // A live retune or file decode can take a few seconds to publish its
        // first frame. Keep waiting within this view's wall-clock boundary.
        if (frameCount === 0) continue;
        break;
      }
      if (frame.frameKey === cursor) break;
      cursor = frame.frameKey;
      lastFrameKey = frame.frameKey;
      lastFrameTimestamp = frame.timestampMs;
      if (
        frame.iqData.byteLength < 2 ||
        !Number.isFinite(frame.sampleRateHz) ||
        frame.sampleRateHz <= 0
      ) {
        continue;
      }
      const sampleRateToleranceHz = Math.max(1, job.config.sampleRateHz * 0.005);
      if (Math.abs(frame.sampleRateHz - job.config.sampleRateHz) > sampleRateToleranceHz) {
        throw new Error(
          `Audio survey requires ${job.config.sampleRateHz} samples/s; received ${frame.sampleRateHz}`,
        );
      }
      if (firstViewFrameKey === null) {
        firstViewFrameKey = frame.frameKey;
        firstViewFrameTimestamp = frame.timestampMs;
      }
      const frameMinHz = frame.centerFrequencyHz - frame.sampleRateHz / 2;
      const frameMaxHz = frame.centerFrequencyHz + frame.sampleRateHz / 2;
      const frameRange = clampFrequencyRange(
        clampFrequencyRange(
          { minHz: channel.minHz, maxHz: channel.maxHz },
          { minHz: view.minHz, maxHz: view.maxHz },
        ),
        { minHz: frameMinHz, maxHz: frameMaxHz },
      );
      if (frameRange.maxHz <= frameRange.minHz) continue;

      const shouldAnalyze = frame.timestampMs - lastAnalyzeAt >= 1_000;
      if (shouldAnalyze) {
        lastAnalyzeAt = frame.timestampMs;
        const detected = analyzeAudioSurveyFrame({
          iqData: frame.iqData,
          sampleRateHz: frame.sampleRateHz,
          frameCenterFrequencyHz: frame.centerFrequencyHz,
          allowedRangeHz: { min: frameRange.minHz, max: frameRange.maxHz },
          targetSampleRateHz: 48_000,
        });
        for (const candidate of detected.slice(0, 3)) {
          const id = makeCandidateId(
            job.id,
            source.kind,
            view.channelId,
            candidate.centerHz,
          );
          const existing = captures.get(id);
          const prior = previousById.get(id);
          const record: CandidateRecord = {
            id,
            jobId: job.id,
            source: source.kind,
            channelId: view.channelId,
            centerHz: candidate.centerHz,
            bandwidthHz: candidate.bandwidthHz,
            modulation: candidate.modulation,
            score: Math.max(prior?.score ?? 0, candidate.score),
            snrDb: Math.max(prior?.snrDb ?? 0, candidate.snrDb),
            firstSeenAt: prior?.firstSeenAt ?? frame.timestampMs,
            lastSeenAt: frame.timestampMs,
            sampleCount: prior?.sampleCount ?? 0,
            clipArtifactIds: prior?.clipArtifactIds ?? [],
            ...(prior?.demodulationModelScore === undefined
              ? {}
              : { demodulationModelScore: prior.demodulationModelScore }),
          };
          if (existing) {
            existing.candidate = candidate;
            existing.record = record;
          } else if (captures.size < 3) {
            const modulation = getModulation(candidate);
            captures.set(id, {
              candidate,
              record,
              processor: createDemodProcessor(modulation, {
                targetSampleRate: 48_000,
                centerFrequency: candidate.centerHz,
                bandwidth: candidate.bandwidthHz,
              }),
              channelizer: createAudioSurveyChannelizer({
                centerFrequencyHz: candidate.centerHz,
                bandwidthHz: candidate.bandwidthHz,
              }),
              pcmChunks: [],
              iqChunks: [],
              iqSampleRateHz: 0,
            });
          }
        }
      }

      for (const capture of captures.values()) {
        const pcm = capture.processor.process(
          frame.iqData,
          frame.sampleRateHz,
          frame.centerFrequencyHz,
        );
        const narrowband: ChannelizedSurveyIq = capture.channelizer.process(
          frame.iqData,
          frame.sampleRateHz,
          frame.centerFrequencyHz,
        );
        if (pcm.length > 0) capture.pcmChunks.push(cloneForPersistence(pcm));
        if (narrowband.iqData.length > 0) {
          capture.iqChunks.push(cloneForPersistence(narrowband.iqData));
          capture.iqSampleRateHz = narrowband.sampleRateHz;
        }
        capture.record.sampleCount += Math.floor(frame.iqData.length / 2);
        capture.record.lastSeenAt = frame.timestampMs;
        capture.record.score = Math.max(capture.record.score, capture.candidate.score);
      }

      capturedSeconds +=
        Math.floor(frame.iqData.length / 2) / frame.sampleRateHz;
      frameCount++;
    }

    const artifactIds: string[] = [];
    for (const capture of captures.values()) {
      await this.repository.saveCandidate(capture.record);
      this.options.onCandidateUpdated?.(capture.record);
      if (capturedSeconds < clipDurationMs / 1_000 || capture.iqSampleRateHz <= 0) {
        continue;
      }
      const pcmData = concatFloat32(capture.pcmChunks);
      const iqData = concatBytes(capture.iqChunks);
      const targetPcmSamples = Math.floor((clipDurationMs / 1_000) * 48_000);
      const targetIqSamples = Math.floor(
        (clipDurationMs / 1_000) * capture.iqSampleRateHz,
      );
      if (
        pcmData.length < targetPcmSamples ||
        Math.floor(iqData.length / 2) < targetIqSamples
      ) {
        continue;
      }
      const exactPcmData = pcmData.slice(0, targetPcmSamples);
      const exactIqData = iqData.slice(0, targetIqSamples * 2);

      const artifactId = `${capture.record.id}:clip:${job.checkpoint.passIndex}:${view.viewIndex}`;
      const artifact: AudioSurveyArtifact = {
        id: artifactId,
        jobId: job.id,
        candidateId: capture.record.id,
        kind: "event-clip",
        sizeBytes: 0,
        score: capture.record.score,
        createdAt: this.now(),
        payload: {
          iqData: exactIqData,
          iqSampleRateHz: capture.iqSampleRateHz,
          pcmData: exactPcmData,
          pcmSampleRateHz: 48_000,
          centerFrequencyHz: capture.record.centerHz,
          bandwidthHz: capture.record.bandwidthHz,
          modulation: capture.record.modulation,
          source: source.kind,
          channelId: view.channelId,
          frameCount,
          capturedSeconds,
          viewIndex: view.viewIndex,
          firstFrameKey: firstViewFrameKey,
          lastFrameKey,
          firstFrameTimestampMs: firstViewFrameTimestamp,
          lastFrameTimestampMs: lastFrameTimestamp,
        },
      };
      artifact.sizeBytes = estimateAudioSurveyArtifactBytes(artifact.payload);
      await this.repository.saveArtifact(artifact, job.config.storageCapBytes);
      capture.record.clipArtifactIds = [...capture.record.clipArtifactIds, artifactId];
      await this.repository.saveCandidate(capture.record);
      artifactIds.push(artifactId);
    }

    const summary = {
      view,
      source: source.kind,
      passIndex: job.checkpoint.passIndex,
      frameCount,
      capturedSeconds,
      candidateIds: Array.from(captures.values()).map((capture) => capture.record.id),
      artifactIds,
      createdAt: this.now(),
    };
    const summaryArtifact: AudioSurveyArtifact = {
      id: `${job.id}:summary:${source.kind}:${job.checkpoint.passIndex}:${view.viewIndex}`,
      jobId: job.id,
      kind: "summary",
      sizeBytes: estimateAudioSurveyArtifactBytes(summary),
      score: 1,
      createdAt: this.now(),
      payload: summary,
    };
    await this.repository.saveArtifact(summaryArtifact, job.config.storageCapBytes);
    return { lastFrameKey, lastFrameTimestamp };
  }
}
