import {
  encodeIqCaptureV4,
  encodeNaptCaptureV4,
  type CaptureMetadata,
  type IqCaptureChunk,
  type IqCaptureFrameUpdate,
  type NaptCaptureChannel,
} from "./iqCaptureFormat";
import type {
  IqCaptureFormat,
  IqCaptureOptions,
  IqCaptureStart,
} from "./iqCapture";

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
  | { type: "progress"; progress: { bytes: number; frameCount: number } }
  | {
      type: "complete";
      result: {
        data: ArrayBuffer;
        filename: string;
        bytes: number;
        frameCount: number;
      };
    }
  | { type: "error"; error: string };

type CaptureState = {
  format: IqCaptureFormat;
  filename: string;
  metadata: CaptureMetadata;
  channel: NaptCaptureChannel;
  options: IqCaptureOptions;
  chunks: IqCaptureChunk[];
  frameUpdates: IqCaptureFrameUpdate[];
  sampleOffset: number;
  bytes: number;
  frameCount: number;
  startedAtUs: number;
  firstFrameAtUs: number | null;
  lastFrameAtUs: number | null;
  lastSignature: string | null;
  passphrase?: string;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CaptureWorkerMessage>) => void) | null;
  postMessage: (message: CaptureWorkerResponse, transfer?: Transferable[]) => void;
};

const postError = (error: unknown): void => {
  scope.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
};

const captureSignature = (options: IqCaptureOptions): string =>
  JSON.stringify([
    options.centerFrequencyHz,
    options.sampleRateHz,
    options.fftSize,
    options.fftWindow,
    options.gainDb,
    options.ppm,
  ]);

const hasNaptCrypto = async (): Promise<boolean> => {
  if (typeof crypto === "undefined" || !crypto.subtle) return false;
  try {
    await encodeNaptCaptureV4({
      metadata: {},
      channels: [
        {
          center_freq_hz: 1,
          sample_rate_hz: 1,
          bins_per_frame: 1,
          iq_length: 0,
        },
      ],
      data: new Uint8Array(),
      passphrase: "webusb-capability-probe",
    });
    return true;
  } catch {
    return false;
  }
};

const makeFinalMetadata = (state: CaptureState): CaptureMetadata => {
  const durationUs =
    state.firstFrameAtUs !== null && state.lastFrameAtUs !== null
      ? Math.max(0, state.lastFrameAtUs - state.firstFrameAtUs)
      : Math.max(0, Math.round(Date.now() * 1000) - state.startedAtUs);
  const durationSeconds = durationUs / 1_000_000;
  return {
    ...state.metadata,
    duration_s: durationSeconds,
    frame_rate:
      durationSeconds > 0 ? state.frameCount / durationSeconds : 0,
  };
};

const completeCapture = async (state: CaptureState): Promise<void> => {
  const metadata = makeFinalMetadata(state);
  let bytes: Uint8Array;
  if (state.format === ".iq") {
    bytes = encodeIqCaptureV4({
      metadata,
      frameUpdates: state.frameUpdates,
      chunks: state.chunks,
    });
  } else {
    const payload = new Uint8Array(state.bytes);
    let offset = 0;
    for (const chunk of state.chunks) {
      payload.set(chunk.data, offset);
      offset += chunk.data.byteLength;
    }
    bytes = await encodeNaptCaptureV4({
      metadata,
      channels: [
        {
          ...state.channel,
          iq_length: payload.byteLength,
        },
      ],
      data: payload,
      passphrase: state.passphrase ?? "",
    });
  }
  scope.postMessage(
    {
      type: "complete",
      result: {
        data: bytes.buffer as ArrayBuffer,
        filename: state.filename,
        bytes: bytes.byteLength,
        frameCount: state.frameCount,
      },
    },
    [bytes.buffer as ArrayBuffer],
  );
};

let state: CaptureState | null = null;

scope.onmessage = (event: MessageEvent<CaptureWorkerMessage>): void => {
  void (async () => {
    const message = event.data;
    if (message.type === "probe") {
      const napt = await hasNaptCrypto();
      scope.postMessage({ type: "capability", napt });
      return;
    }
    if (message.type === "start") {
      if (message.capture.format === ".napt" && !(await hasNaptCrypto())) {
        throw new Error("Encrypted .napt captures are unavailable in this browser.");
      }
      if (message.capture.format === ".napt" && !message.capture.passphrase?.trim()) {
        throw new Error("A passphrase is required for .napt captures.");
      }
      state = {
        ...message.capture,
        chunks: [],
        frameUpdates: [],
        sampleOffset: 0,
        bytes: 0,
        frameCount: 0,
        startedAtUs: Math.round(Date.now() * 1000),
        firstFrameAtUs: null,
        lastFrameAtUs: null,
        lastSignature: null,
      };
      scope.postMessage({ type: "started" });
      return;
    }
    if (message.type === "abort") {
      state = null;
      return;
    }
    if (!state) return;
    if (message.type === "options") {
      state.options = message.options;
      return;
    }
    if (message.type === "frame") {
      const frame = new Uint8Array(message.data);
      const signature = captureSignature(message.options);
      if (state.lastSignature !== signature) {
        state.frameUpdates.push({
          sample_offset: state.sampleOffset,
          timestamp_us: message.timestampUs,
          patch: {
            center_frequency_hz: message.options.centerFrequencyHz,
            capture_sample_rate_hz: message.options.sampleRateHz,
            fft_size: message.options.fftSize,
            fft_window: message.options.fftWindow,
            gain: message.options.gainDb,
            ppm: message.options.ppm,
          },
        });
        state.lastSignature = signature;
      }
      state.chunks.push({
        sample_offset: state.sampleOffset,
        channel: 0,
        data: frame,
      });
      state.sampleOffset += Math.floor(frame.byteLength / 2);
      state.bytes += frame.byteLength;
      state.frameCount += 1;
      state.firstFrameAtUs ??= message.timestampUs;
      state.lastFrameAtUs = message.timestampUs;
      if (state.frameCount === 1 || state.frameCount % 10 === 0) {
        scope.postMessage({
          type: "progress",
          progress: { bytes: state.bytes, frameCount: state.frameCount },
        });
      }
      return;
    }
    if (message.type === "stop") {
      const finished = state;
      state = null;
      await completeCapture(finished);
    }
  })().catch(postError);
};
