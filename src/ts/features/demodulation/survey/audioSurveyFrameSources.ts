import type { IqRawFrame } from "@n-apt/consts/schemas/websocket";
import { getLiveFrameRefForSource } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { subscribeFrameArrivals } from "@n-apt/app/infrastructure/visualization/frameArrivalRuntime";
import { fileFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
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
}: {
  getSourceId: () => string | null | undefined;
  sendFrequencyRange: (range: { min: number; max: number }) => void;
}): AudioSurveyFrameSource => ({
  kind: "live",
  tune(view: AudioSurveyView) {
    if (!getSourceId()) throw new Error("Select a live SDR source before starting the survey");
    sendFrequencyRange({ min: view.minHz, max: view.maxHz });
  },
  async nextFrame(afterFrameKey, timeoutMs, view) {
    const sourceId = getSourceId();
    if (!sourceId) return null;
    const frameRef = getLiveFrameRefForSource(sourceId, "rx");
    const toleranceHz = Math.max(2_000, view.sampleRateHz * 0.002);
    return waitForNextFrame({
      read: () => frameRef.current,
      subscribe: subscribeFrameArrivals,
      afterFrameKey,
      timeoutMs,
      accept: (frame) =>
        Math.abs(frame.centerFrequencyHz - view.centerHz) <= toleranceHz,
    });
  },
});

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
