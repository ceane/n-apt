import { normalizeAudioSurveyFrame } from "@n-apt/demodulation/survey/audioSurveyFrameSources";

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
});
