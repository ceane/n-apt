import {
  createLiveAudioSurveySource,
  normalizeAudioSurveyFrame,
} from "@n-apt/demodulation/survey/audioSurveyFrameSources";
import type { AudioSurveyView } from "@n-apt/demodulation/survey/audioSurveyModel";

describe("audio survey frame source normalization", () => {
  it("keeps sample rate, center frequency, and the multiplexed sequence identity", () => {
    const normalized = normalizeAudioSurveyFrame(
      {
        type: "spectrum",
        protocol_version: 2,
        source_id: "rtl-1",
        stream_epoch: 4,
        sequence: 21,
        timestamp: 1234,
        data_type: "iq_raw",
        center_frequency_hz: 1_618_000,
        sample_rate: 3_200_000,
        iq_data: new Uint8Array([128, 128]),
      },
      999,
    );

    expect(normalized).toEqual({
      frameKey: "rtl-1:4:21",
      timestampMs: 1234,
      centerFrequencyHz: 1_618_000,
      sampleRateHz: 3_200_000,
      iqData: new Uint8Array([128, 128]),
      sourceId: "rtl-1",
      streamEpoch: 4,
      sequence: 21,
    });
  });

  it("rejects spectrum frames that do not carry raw I/Q metadata", () => {
    expect(
      normalizeAudioSurveyFrame(
        {
          type: "spectrum",
          data_type: "iq_raw",
          iq_data: new Uint8Array([128]),
        },
        100,
      ),
    ).toBeNull();
  });

  it("delivers every ordered live frame with a sample index instead of polling only the latest frame", async () => {
    const listeners = new Set<(frame: unknown) => void>();
    const source = createLiveAudioSurveySource({
      getSourceId: () => "rtl-1",
      sendFrequencyRange: () => undefined,
      now: () => 1_000,
      subscribeRawFrames: (listener: (frame: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as any);
    const view: AudioSurveyView = {
      channelId: "a",
      channelLabel: "A",
      viewIndex: 0,
      minHz: 18_000,
      maxHz: 3_218_000,
      centerHz: 1_618_000,
      sampleRateHz: 3_200_000,
    };
    source.tune?.(view);
    const rawFrame = (sequence: number) => ({
      type: "spectrum",
      protocol_version: 2,
      source_id: "rtl-1",
      stream_epoch: 4,
      sequence,
      options_revision: 9,
      timestamp: 1_000 + (sequence - 1) * 1.28,
      data_type: "iq_raw",
      center_frequency_hz: view.centerHz,
      sample_rate: view.sampleRateHz,
      iq_data: new Uint8Array(8_192).fill(128),
    });
    listeners.forEach((listener) => listener(rawFrame(1)));
    listeners.forEach((listener) => listener(rawFrame(2)));

    const first = await source.nextFrame(null, 5, view);
    const second = await source.nextFrame(first?.frameKey ?? null, 5, view);

    expect(first?.sequence).toBe(1);
    expect(first?.sampleStartIndex).toBe(0);
    expect(second?.sequence).toBe(2);
    expect(second?.sampleStartIndex).toBe(4_096);
    expect(second?.discontinuityBefore).toBe(false);
    source.endView?.();
  });

  it("marks a sequence gap as a new sample timeline segment", async () => {
    const listeners = new Set<(frame: unknown) => void>();
    const source = createLiveAudioSurveySource({
      getSourceId: () => "rtl-1",
      sendFrequencyRange: () => undefined,
      now: () => 1_000,
      subscribeRawFrames: (listener: (frame: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as any);
    const view: AudioSurveyView = {
      channelId: "a",
      channelLabel: "A",
      viewIndex: 0,
      minHz: 18_000,
      maxHz: 3_218_000,
      centerHz: 1_618_000,
      sampleRateHz: 3_200_000,
    };
    source.tune?.(view);
    const emit = (sequence: number) =>
      listeners.forEach((listener) =>
        listener({
          type: "spectrum",
          protocol_version: 2,
          source_id: "rtl-1",
          stream_epoch: 4,
          sequence,
          timestamp: 1_000 + (sequence - 1) * 1.28,
          data_type: "iq_raw",
          center_frequency_hz: view.centerHz,
          sample_rate: view.sampleRateHz,
          iq_data: new Uint8Array(8_192).fill(128),
        }),
      );
    emit(1);
    emit(3);

    const first = await source.nextFrame(null, 5, view);
    const afterGap = await source.nextFrame(first?.frameKey ?? null, 5, view);

    expect(afterGap?.sequence).toBe(3);
    expect(afterGap?.discontinuityBefore).toBe(true);
    expect(afterGap?.sampleStartIndex).toBe(0);
    source.endView?.();
  });
});
