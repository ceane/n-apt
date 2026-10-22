import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { browserPipelineMetrics } from "@n-apt/app/infrastructure/performance/pipelineMetrics";

export type SpectrumWorkerConfig = { fftSize: number; offsetDb: number; windowType?: string };
export type SpectrumWorkerRequest = SpectrumWorkerConfig & { id: number; iq: Uint8Array };
export type SpectrumWorkerResponse = { id: number; spectrum?: Float32Array; computeDurationMs?: number; error?: string };
export type SpectrumWorkerResult = { frame: LiveFrameData; spectrum: Float32Array };
type Job = {
  id: number;
  frame: LiveFrameData;
  scope: string;
  signature: string;
  config: SpectrumWorkerConfig;
  queuedAt: number | null;
  startedAt: number | null;
};

/** One FFT in flight and one replaceable pending frame. The original IQ stays
 * with its owner; only a copy of the selected FFT window crosses the worker. */
export class SpectrumWorkerClient {
  private sequence = 0;
  private inFlight: Job | null = null;
  private pending: Job | null = null;
  private completed: (Job & { spectrum: Float32Array }) | null = null;
  private failed = false;
  private disposed = false;

  constructor(
    private readonly worker: Worker,
    private readonly onResult?: (result: SpectrumWorkerResult) => void,
    private readonly onFailure?: () => void,
  ) {
    worker.onmessage = ({ data }: MessageEvent<SpectrumWorkerResponse>) => {
      const job = this.inFlight;
      if (this.disposed || !job || data.id !== job.id) return;
      this.inFlight = null;
      browserPipelineMetrics.finishTiming("workerRoundTrip", job.startedAt);
      if (typeof data.computeDurationMs === "number") {
        browserPipelineMetrics.recordTiming("workerCompute", data.computeDurationMs);
      }
      if (data.error || !data.spectrum) { this.fail(); return; }
      const completed = { ...job, spectrum: data.spectrum };
      this.completed = completed;
      const pending = this.pending;
      this.pending = null;
      if (pending) this.start(pending);
      else this.onResult?.({ frame: completed.frame, spectrum: completed.spectrum });
    };
    worker.onerror = () => this.fail();
    worker.onmessageerror = () => this.fail();
  }

  private fail() {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.inFlight = this.pending = this.completed = null;
    this.worker.terminate();
    this.onFailure?.();
  }

  private start(job: Job) {
    job.startedAt = browserPipelineMetrics.startTiming();
    browserPipelineMetrics.finishTiming("workerQueueWait", job.queuedAt);
    this.inFlight = job;
    const bytes = job.frame.iq_data;
    const iq = bytes.slice(Math.max(0, bytes.length - job.config.fftSize * 2));
    try {
      this.worker.postMessage({ ...job.config, id: job.id, iq } satisfies SpectrumWorkerRequest, [iq.buffer]);
    } catch { this.fail(); }
  }

  /** Submit on frame arrival; a newer pending frame replaces the older one. */
  submit(frame: LiveFrameData, config: SpectrumWorkerConfig): void {
    if (this.failed || this.disposed) return;
    const scope = JSON.stringify([frame.source_id, frame.stream_epoch, frame.options_revision,
      frame.center_frequency_hz, frame.sample_rate, config.fftSize, config.offsetDb, config.windowType]);
    const signature = `${scope}:${frame.sequence}:${frame.timestamp}`;
    const matches = (job: Job | null) => job?.signature === signature && job.frame.iq_data === frame.iq_data;
    if (matches(this.inFlight) || matches(this.pending) || matches(this.completed)) return;
    const job = {
      id: ++this.sequence,
      frame,
      config,
      scope,
      signature,
      queuedAt: browserPipelineMetrics.startTiming(),
      startedAt: null,
    };
    if (this.inFlight) this.pending = job;
    else this.start(job);
  }

  /** undefined selects the caller's synchronous fallback after a worker failure. */
  read(frame: LiveFrameData, config: SpectrumWorkerConfig): SpectrumWorkerResult | null | undefined {
    if (this.failed || this.disposed) return undefined;
    const scope = JSON.stringify([frame.source_id, frame.stream_epoch, frame.options_revision,
      frame.center_frequency_hz, frame.sample_rate, config.fftSize, config.offsetDb, config.windowType]);
    const signature = `${scope}:${frame.sequence}:${frame.timestamp}`;
    return this.completed?.signature === signature && this.completed.frame.iq_data === frame.iq_data
      ? this.completed
      : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.inFlight = this.pending = this.completed = null;
  }
}
