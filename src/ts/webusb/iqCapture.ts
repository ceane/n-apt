import IqCaptureWorker from "./iqCapture.worker?worker&inline";
import type {
  CaptureMetadata,
  IqCaptureFrameUpdate,
  NaptCaptureChannel,
} from "./iqCaptureFormat";

export type IqCaptureFormat = ".iq" | ".napt";

export type IqCaptureOptions = {
  centerFrequencyHz: number;
  sampleRateHz: number;
  fftSize: number;
  fftWindow: string;
  gainDb: number;
  ppm: number;
};

export type IqCaptureStart = {
  format: IqCaptureFormat;
  filename: string;
  metadata: CaptureMetadata;
  channel: NaptCaptureChannel;
  options: IqCaptureOptions;
  passphrase?: string;
};

export type IqCaptureProgress = {
  bytes: number;
  frameCount: number;
};

export type IqCaptureResult = {
  data: ArrayBuffer;
  filename: string;
  bytes: number;
  frameCount: number;
};

type CaptureWorkerMessage =
  | { type: "probe" }
  | { type: "start"; capture: IqCaptureStart }
  | {
      type: "frame";
      data: ArrayBuffer;
      timestampUs: number;
      options: IqCaptureOptions;
    }
  | { type: "options"; options: IqCaptureOptions }
  | { type: "stop" }
  | { type: "abort" };

type CaptureWorkerResponse =
  | { type: "capability"; napt: boolean; error?: string }
  | { type: "started" }
  | { type: "progress"; progress: IqCaptureProgress }
  | { type: "complete"; result: IqCaptureResult }
  | { type: "error"; error: string };

export type IqCaptureRecorderCallbacks = {
  onProgress?: (progress: IqCaptureProgress) => void;
  onError?: (error: Error) => void;
};

const workerError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export class IqCaptureRecorder {
  private readonly worker: Worker;
  private recording = false;
  private stopPromise: Promise<IqCaptureResult> | null = null;
  private stopResolve: ((result: IqCaptureResult) => void) | null = null;
  private stopReject: ((error: Error) => void) | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((error: Error) => void) | null = null;
  private readonly callbacks: IqCaptureRecorderCallbacks;

  public constructor(callbacks: IqCaptureRecorderCallbacks = {}) {
    this.callbacks = callbacks;
    this.worker = new IqCaptureWorker();
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  public static supportsEncryptedNapt(): Promise<boolean> {
    return new Promise((resolve) => {
      const worker = new IqCaptureWorker();
      const cleanup = () => worker.terminate();
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, 5000);
      worker.addEventListener("message", (event: MessageEvent<CaptureWorkerResponse>) => {
        if (event.data.type !== "capability") return;
        window.clearTimeout(timeout);
        cleanup();
        resolve(event.data.napt);
      });
      worker.addEventListener("error", () => {
        window.clearTimeout(timeout);
        cleanup();
        resolve(false);
      });
      worker.postMessage({ type: "probe" } satisfies CaptureWorkerMessage);
    });
  }

  public isRecording(): boolean {
    return this.recording;
  }

  public start(capture: IqCaptureStart): Promise<void> {
    if (this.recording) {
      return Promise.reject(new Error("An I/Q capture is already recording."));
    }
    this.recording = true;
    const started = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    this.worker.postMessage({ type: "start", capture } satisfies CaptureWorkerMessage);
    return started;
  }

  public appendFrame(frame: Uint8Array, options: IqCaptureOptions): void {
    if (!this.recording) return;
    const buffer =
      frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength
        ? (frame.buffer as ArrayBuffer)
        : (frame.slice().buffer as ArrayBuffer);
    this.worker.postMessage(
      {
        type: "frame",
        data: buffer,
        timestampUs: Math.round(Date.now() * 1000),
        options,
      } satisfies CaptureWorkerMessage,
      [buffer],
    );
  }

  public updateOptions(options: IqCaptureOptions): void {
    if (!this.recording) return;
    this.worker.postMessage({ type: "options", options } satisfies CaptureWorkerMessage);
  }

  public stop(): Promise<IqCaptureResult> {
    if (!this.recording) {
      return Promise.reject(new Error("No I/Q capture is recording."));
    }
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = new Promise<IqCaptureResult>((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
    });
    this.worker.postMessage({ type: "stop" } satisfies CaptureWorkerMessage);
    return this.stopPromise;
  }

  public abort(): void {
    if (!this.recording) return;
    this.worker.postMessage({ type: "abort" } satisfies CaptureWorkerMessage);
    this.recording = false;
    this.clearPendingStop();
    this.startResolve = null;
    this.startReject = null;
  }

  public dispose(): void {
    this.abort();
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
  }

  private readonly handleMessage = (
    event: MessageEvent<CaptureWorkerResponse>,
  ): void => {
    const message = event.data;
    switch (message.type) {
      case "started":
        this.startResolve?.();
        this.startResolve = null;
        this.startReject = null;
        return;
      case "progress":
        this.callbacks.onProgress?.(message.progress);
        return;
      case "complete":
        this.recording = false;
        this.stopResolve?.(message.result);
        this.clearPendingStop();
        return;
      case "error": {
        const error = new Error(message.error);
        this.recording = false;
        this.startReject?.(error);
        this.startResolve = null;
        this.startReject = null;
        this.stopReject?.(error);
        this.clearPendingStop();
        this.callbacks.onError?.(error);
        return;
      }
      case "capability":
        return;
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const error = workerError(event.error ?? event.message);
    this.recording = false;
    this.startReject?.(error);
    this.startResolve = null;
    this.startReject = null;
    this.stopReject?.(error);
    this.clearPendingStop();
    this.callbacks.onError?.(error);
  };

  private clearPendingStop(): void {
    this.stopPromise = null;
    this.stopResolve = null;
    this.stopReject = null;
  }
}

export type { CaptureMetadata, IqCaptureFrameUpdate, NaptCaptureChannel };
