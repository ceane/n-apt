import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import { subscribeRawIqFrameArrivals } from "@n-apt/app/infrastructure/visualization/frameArrivalRuntime";
import { fileFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { subscribeFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import type {
  AudioSurveyFrameSource,
  SurveyIqFrame,
} from "@n-apt/demodulation/survey/audioSurveyRunner";
import type { AudioSurveyView } from "@n-apt/demodulation/survey/audioSurveyModel";

const latestFrame = (frame: IqRawFrame[] | IqRawFrame | null): IqRawFrame | null =>
  Array.isArray(frame) ? frame[frame.length - 1] ?? null : frame;

export const normalizeAudioSurveyFrame = (
  frame: Partial<IqRawFrame> | null | undefined,
  fallbackTimestampMs: number,
): SurveyIqFrame | null => {
  if (
    !frame ||
    frame.type !== "spectrum" ||
    frame.data_type !== "iq_raw" ||
    !(frame.iq_data instanceof Uint8Array) ||
    frame.iq_data.length < 2 ||
    !Number.isFinite(frame.sample_rate) ||
    (frame.sample_rate ?? 0) <= 0 ||
    !Number.isFinite(frame.center_frequency_hz)
  ) {
    return null;
  }

  const sourceId = frame.source_id ?? "legacy";
  const frameKey =
    frame.protocol_version === 2 &&
    typeof frame.sequence === "number" &&
    typeof frame.stream_epoch === "number"
      ? `${sourceId}:${frame.stream_epoch}:${frame.sequence}`
      : `${sourceId}:${frame.timestamp ?? fallbackTimestampMs}:${frame.center_frequency_hz}`;

  return {
    frameKey,
    timestampMs:
      typeof frame.timestamp === "number" && Number.isFinite(frame.timestamp)
        ? frame.timestamp
        : fallbackTimestampMs,
    centerFrequencyHz: frame.center_frequency_hz as number,
    sampleRateHz: frame.sample_rate as number,
    iqData: frame.iq_data,
    ...(typeof frame.source_id === "string" ? { sourceId: frame.source_id } : {}),
    ...(typeof frame.stream_epoch === "number" ? { streamEpoch: frame.stream_epoch } : {}),
    ...(typeof frame.sequence === "number" ? { sequence: frame.sequence } : {}),
    ...(typeof frame.options_revision === "number"
      ? { optionsRevision: frame.options_revision }
      : {}),
  };
};

const waitForNextFrame = ({
  read,
  subscribe,
  afterFrameKey,
  timeoutMs,
  accept,
}: {
  read: () => IqRawFrame[] | IqRawFrame | null;
  subscribe: (listener: () => void) => () => void;
  afterFrameKey: string | null;
  timeoutMs: number;
  accept?: (frame: SurveyIqFrame) => boolean;
}): Promise<SurveyIqFrame | null> =>
  new Promise((resolve) => {
    let finished = false;
    let unsubscribe = () => {};
    let pollTimer: number | null = null;
    const timeout = window.setTimeout(() => finish(null), Math.max(1, timeoutMs));

    const finish = (frame: SurveyIqFrame | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      unsubscribe();
      resolve(frame);
    };

    const check = () => {
      const normalized = normalizeAudioSurveyFrame(latestFrame(read()), Date.now());
      if (
        normalized &&
        normalized.frameKey !== afterFrameKey &&
        (!accept || accept(normalized))
      ) {
        finish(normalized);
      }
    };

    unsubscribe = subscribe(check);
    pollTimer = window.setInterval(check, 50);
    check();
  });

export const createLiveAudioSurveySource = ({
  getSourceId,
  sendFrequencyRange,
  now = Date.now,
  subscribeRawFrames = subscribeRawIqFrameArrivals,
  maxQueuedBytes = 8_000_000,
}: {
  getSourceId: () => string | null | undefined;
  sendFrequencyRange: (range: { min: number; max: number }) => void;
  now?: () => number;
  subscribeRawFrames?: (listener: (frame: unknown) => void) => () => void;
  maxQueuedBytes?: number;
}): AudioSurveyFrameSource => {
  const capacityBytes = Math.max(1, Math.floor(maxQueuedBytes));
  let activeSourceId: string | null = null;
  let activeView: AudioSurveyView | null = null;
  let tuneStartedAtMs = 0;
  let lastObserved: SurveyIqFrame | null = null;
  let queue: SurveyIqFrame[] = [];
  let queueBytes = 0;
  let overflowPending = false;
  let unsubscribe = () => {};
  const waiters = new Set<() => void>();

  const clearQueue = () => {
    queue = [];
    queueBytes = 0;
    overflowPending = false;
    lastObserved = null;
  };

  const endView = () => {
    unsubscribe();
    unsubscribe = () => {};
    activeView = null;
    activeSourceId = null;
    clearQueue();
  };

  const onRawFrame = (rawFrame: unknown) => {
    const frame = normalizeAudioSurveyFrame(
      rawFrame as Partial<IqRawFrame>,
      now(),
    );
    if (
      !frame ||
      !activeView ||
      !activeSourceId ||
      frame.sourceId !== activeSourceId ||
      frame.timestampMs < tuneStartedAtMs ||
      Math.abs(frame.centerFrequencyHz - activeView.centerHz) >
        Math.max(2_000, activeView.sampleRateHz * 0.002)
    ) {
      return;
    }

    const currentSampleCount = Math.floor(frame.iqData.length / 2);
    const previousSampleCount = lastObserved
      ? Math.floor(lastObserved.iqData.length / 2)
      : 0;
    const contiguous =
      lastObserved !== null &&
      frame.sequence !== undefined &&
      lastObserved.sequence !== undefined &&
      frame.sequence === lastObserved.sequence + 1 &&
      frame.streamEpoch === lastObserved.streamEpoch &&
      frame.optionsRevision === lastObserved.optionsRevision &&
      frame.sampleRateHz === lastObserved.sampleRateHz &&
      frame.centerFrequencyHz === lastObserved.centerFrequencyHz &&
      currentSampleCount === previousSampleCount;
    let sampleStartIndex = contiguous
      ? (lastObserved?.sampleStartIndex ?? 0) + previousSampleCount
      : 0;
    let discontinuityBefore = lastObserved !== null && !contiguous;
    if (overflowPending) {
      discontinuityBefore = true;
      sampleStartIndex = 0;
      overflowPending = false;
    }

    let acceptedFrame: SurveyIqFrame = {
      ...frame,
      sampleStartIndex,
      discontinuityBefore,
    };
    lastObserved = acceptedFrame;
    const frameBytes = acceptedFrame.iqData.byteLength;
    if (frameBytes > capacityBytes) {
      overflowPending = true;
      for (const wake of waiters) wake();
      return;
    }
    while (queue.length > 0 && queueBytes + frameBytes > capacityBytes) {
      const removed = queue.shift()!;
      queueBytes -= removed.iqData.byteLength;
      overflowPending = true;
    }
    if (overflowPending) {
      acceptedFrame = {
        ...acceptedFrame,
        sampleStartIndex: 0,
        discontinuityBefore: true,
      };
      lastObserved = acceptedFrame;
      overflowPending = false;
    }
    queue.push(acceptedFrame);
    queueBytes += frameBytes;
    for (const wake of waiters) wake();
  };

  const nextQueuedFrame = (
    afterFrameKey: string | null,
    timeoutMs: number,
  ): Promise<SurveyIqFrame | null> =>
    new Promise((resolve) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (frame: SurveyIqFrame | null) => {
        if (finished) return;
        finished = true;
        waiters.delete(drain);
        if (timer !== null) clearTimeout(timer);
        resolve(frame);
      };
      const drain = () => {
        while (queue.length > 0) {
          const frame = queue.shift()!;
          queueBytes -= frame.iqData.byteLength;
          if (frame.frameKey === afterFrameKey) continue;
          finish(frame);
          return;
        }
      };
      waiters.add(drain);
      timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
      drain();
    });

  return {
    kind: "live",
    tune(view: AudioSurveyView) {
      endView();
      const sourceId = getSourceId();
      if (!sourceId) throw new Error("Select a live SDR source before starting the survey");
      activeSourceId = sourceId;
      activeView = view;
      tuneStartedAtMs = now();
      unsubscribe = subscribeRawFrames(onRawFrame);
      sendFrequencyRange({ min: view.minHz, max: view.maxHz });
    },
    nextFrame(afterFrameKey, timeoutMs) {
      if (!activeView || !activeSourceId) return Promise.resolve(null);
      return nextQueuedFrame(afterFrameKey, timeoutMs);
    },
    endView,
  };
};

export const createReplayAudioSurveySource = (): AudioSurveyFrameSource => ({
  kind: "replay",
  nextFrame(afterFrameKey, timeoutMs) {
    return waitForNextFrame({
      read: () => fileFrameRuntime.read(),
      subscribe: (listener) => subscribeFrameRuntime(listener, 50),
      afterFrameKey,
      timeoutMs,
    });
  },
});
