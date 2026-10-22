import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

export type SpectrumWorkerConfig = { fftSize: number; offsetDb: number; windowType?: string };
export type SpectrumWorkerRequest = SpectrumWorkerConfig & { id: number; iq: Uint8Array };
export type SpectrumWorkerResponse = { id: number; spectrum?: Float32Array; error?: string };
type Job = { id: number; frame: LiveFrameData; scope: string; signature: string; config: SpectrumWorkerConfig };

/** One FFT in flight and one replaceable pending frame. The original IQ stays
 * with its owner; only a copy of the selected FFT window crosses the worker. */
export class SpectrumWorkerClient {
  private sequence = 0;
  private inFlight: Job | null = null;
  private pending: Job | null = null;
  private completed: (Job & { spectrum: Float32Array }) | null = null;
  private failed = false;
  private disposed = false;

  constructor(private readonly worker: Worker) {
    worker.onmessage = ({ data }: MessageEvent<SpectrumWorkerResponse>) => {
      const job = this.inFlight;
      if (this.disposed || !job || data.id !== job.id) return;
      this.inFlight = null;
      if (data.error || !data.spectrum) { this.fail(); return; }
      this.completed = { ...job, spectrum: data.spectrum };
      const pending = this.pending;
      this.pending = null;
      if (pending) this.start(pending);
    };
    worker.onerror = () => this.fail();
    worker.onmessageerror = () => this.fail();
  }

  private fail() {
    this.failed = true;
    this.inFlight = this.pending = this.completed = null;
    this.worker.terminate();
  }

  private start(job: Job) {
    this.inFlight = job;
    const bytes = job.frame.iq_data;
    const iq = bytes.slice(Math.max(0, bytes.length - job.config.fftSize * 2));
    try {
      this.worker.postMessage({ ...job.config, id: job.id, iq } satisfies SpectrumWorkerRequest, [iq.buffer]);
    } catch { this.fail(); }
  }

  /** undefined selects the caller's synchronous fallback after a worker failure. */
  read(frame: LiveFrameData, config: SpectrumWorkerConfig): { frame: LiveFrameData; spectrum: Float32Array } | null | undefined {
    if (this.failed || this.disposed) return undefined;
    const scope = JSON.stringify([frame.source_id, frame.stream_epoch, frame.options_revision,
      frame.center_frequency_hz, frame.sample_rate, config.fftSize, config.offsetDb, config.windowType]);
    const signature = `${scope}:${frame.sequence}:${frame.timestamp}`;
    const matches = (job: Job | null) => job?.signature === signature && job.frame.iq_data === frame.iq_data;
    if (!matches(this.inFlight) && !matches(this.pending) && !matches(this.completed)) {
      const job = { id: ++this.sequence, frame, config, scope, signature };
      if (this.inFlight) this.pending = job;
      else this.start(job);
    }
    return this.completed?.scope === scope ? this.completed : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.inFlight = this.pending = this.completed = null;
  }
}
