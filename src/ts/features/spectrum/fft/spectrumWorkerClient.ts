import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

export type SpectrumWorkerConfig = {
  fftSize: number;
  offsetDb: number;
  windowType?: string;
  ppm: number;
  applyPpmCorrection: boolean;
};
export type SpectrumWorkerRequest = SpectrumWorkerConfig & {
  id: number;
  iq: Uint8Array;
  centerFrequencyHz: number;
  sampleRateHz: number;
};
export type SpectrumWorkerResponse = {
  id: number;
  stage?: "preview" | "complete";
  spectrum?: Float32Array;
  computeDurationMs?: number;
  backend?: "webgpu" | "wasm" | "scalar";
  error?: string;
};
export type SpectrumWorkerResult = {
  frame: LiveFrameData;
  spectrum: Float32Array;
  isPreview: boolean;
  backend: "webgpu" | "wasm" | "scalar";
};
type Job = {
  id: number;
  frame: LiveFrameData;
  scope: string;
  signature: string;
  config: SpectrumWorkerConfig;
};

/** One FFT in flight and one replaceable pending frame. The original IQ stays
 * with its owner; only a copy of the selected FFT window crosses the worker. */
export class SpectrumWorkerClient {
  private sequence = 0;
  private inFlight: Job | null = null;
  private pending: Job | null = null;
  private completed: (Job & {
    spectrum: Float32Array;
    isPreview: boolean;
    backend: "webgpu" | "wasm" | "scalar";
  }) | null = null;
  private hasUnreadComplete = false;
  private failed = false;
  private disposed = false;

  constructor(
    private readonly worker: Worker,
    private readonly onResult?: (result: SpectrumWorkerResult) => void,
    private readonly onFailure?: () => void,
  ) {
    worker.onmessage = ({ data }: MessageEvent<SpectrumWorkerResponse>) => {
      const job = this.inFlight;
      if (this.disposed) return;
      if (!job || data.id !== job.id) {
        return;
      }
      if (data.error || !data.spectrum) { this.fail(); return; }
      const backend = data.backend ?? "wasm";
      const isPreview = data.stage === "preview";
      if (!isPreview) {
        this.inFlight = null;
      }
      const completed = { ...job, spectrum: data.spectrum, isPreview, backend };
      const pending = this.pending;
      // Publish every frame that can still be displayed in the active scope.
      // A newer same-scope frame may be pending, but waiting for it freezes the
      // spectrum on slower workers. Different-scope results are already stale.
      if (
        (!pending || pending.scope === completed.scope) &&
        !(isPreview && this.hasUnreadComplete &&
          this.completed?.scope === completed.scope)
      ) {
        // A following preview can arrive before RAF consumes the full FFT.
        // Preserve that completion so waterfall/history ingestion cannot starve.
        this.completed = completed;
        this.hasUnreadComplete = !isPreview;
        this.onResult?.({
          frame: completed.frame,
          spectrum: completed.spectrum,
          isPreview,
          backend,
        });
      }
      if (!isPreview) {
        this.pending = null;
        if (pending) this.start(pending);
      }
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
    this.inFlight = job;
    const bytes = job.frame.iq_data;
    const iq = bytes.slice(Math.max(0, bytes.length - job.config.fftSize * 2));
    try {
      this.worker.postMessage({
        ...job.config,
        id: job.id,
        iq,
        centerFrequencyHz: job.frame.center_frequency_hz ?? 0,
        sampleRateHz: job.frame.sample_rate ?? 0,
      } satisfies SpectrumWorkerRequest, [iq.buffer]);
    } catch { this.fail(); }
  }

  /** Submit on frame arrival; a newer pending frame replaces the older one. */
  submit(frame: LiveFrameData, config: SpectrumWorkerConfig): void {
    if (this.failed || this.disposed) return;
    const scope = JSON.stringify([frame.source_id, frame.stream_epoch, frame.options_revision,
      frame.center_frequency_hz, frame.sample_rate, config.fftSize, config.offsetDb,
      config.windowType, config.ppm, config.applyPpmCorrection]);
    const signature = `${scope}:${frame.sequence}:${frame.timestamp}`;
    const matches = (job: Job | null) => job?.signature === signature && job.frame.iq_data === frame.iq_data;
    if (matches(this.inFlight) || matches(this.pending) || matches(this.completed)) return;
    const job = {
      id: ++this.sequence,
      frame,
      config,
      scope,
      signature,
    };
    if (this.inFlight) {
      this.pending = job;
    } else {
      this.start(job);
    }
  }

  /** undefined selects the caller's synchronous fallback after a worker failure. */
  read(frame: LiveFrameData, config: SpectrumWorkerConfig): SpectrumWorkerResult | null | undefined {
    if (this.failed || this.disposed) return undefined;
    const scope = JSON.stringify([frame.source_id, frame.stream_epoch, frame.options_revision,
      frame.center_frequency_hz, frame.sample_rate, config.fftSize, config.offsetDb,
      config.windowType, config.ppm, config.applyPpmCorrection]);
    // The canvas should show the newest completed result from this source and
    // configuration while newer FFT work is pending. The result carries its
    // own frame so frequency axes remain aligned to the processed IQ data.
    if (this.completed?.scope === scope && !this.completed.isPreview) {
      this.hasUnreadComplete = false;
    }
    return this.completed?.scope === scope
      ? {
          frame: this.completed.frame,
          spectrum: this.completed.spectrum,
          isPreview: this.completed.isPreview,
          backend: this.completed.backend,
        }
      : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.inFlight = this.pending = this.completed = null;
  }
}
