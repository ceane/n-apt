/** @jest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import DemodFilePlaybackBridge from "@n-apt/capture/DemodFilePlaybackBridge";
import { filePlaybackDataRef } from "@n-apt/app/infrastructure/io/filePlaybackData";

var mockLiveDataRef = { current: null as any };
const mockUsePlaybackAnimation = jest.fn(() => ({}));

jest.mock("@n-apt/redux/middleware/websocketMiddleware", () => ({
  liveDataRef: {
    get current() {
      return mockLiveDataRef?.current ?? null;
    },
    set current(value: any) {
      if (mockLiveDataRef) mockLiveDataRef.current = value;
    },
  },
}));

jest.mock("@n-apt/redux", () => ({
  useAppDispatch: () => jest.fn(),
  clearActivePlaybackMetadata: () => ({ type: "clear" }),
  setStitchStatus: () => ({ type: "status" }),
  setActivePlaybackMetadata: () => ({ type: "metadata" }),
}));

jest.mock("@n-apt/spectrum/hooks/useStitchingLogic", () => ({
  useStitchingLogic: () => ({
    hasStitchedData: true,
    channelCount: 1,
    activeChannel: 0,
    hardwareSampleRateHz: 3_200_000,
    allChannelsRef: {
      current: [
        {
          iq_data: new Uint8Array([1, 2, 3, 4]),
          bins_per_frame: 2,
        },
      ],
    },
    workerFileDataCache: { current: [] },
    workerFreqMap: { current: [] },
    workerMetadataMap: { current: [] },
    precomputedFrames: {
      current: [{ waveform: new Float32Array([-90, -40, -70]) }],
    },
    setChannelCount: jest.fn(),
    setActiveChannel: jest.fn(),
    setFrequencyRange: jest.fn(),
  }),
}));

jest.mock("@n-apt/capture/hooks/usePlaybackAnimation", () => ({
  usePlaybackAnimation: () => {
    mockUsePlaybackAnimation();
    return {};
  },
}));

describe("DemodFilePlaybackBridge", () => {
  afterEach(() => {
    mockLiveDataRef.current = null;
    filePlaybackDataRef.current = null;
    mockUsePlaybackAnimation.mockClear();
  });

  it("publishes the raw first frame for React Flow nodes", () => {
    render(
      <DemodFilePlaybackBridge
        selectedFiles={[{ id: "file-1", name: "capture.napt" }]}
        stitchTrigger={1}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused
        fftSize={2048}
      />,
    );

    expect(filePlaybackDataRef.current).toEqual({
      type: "spectrum",
      center_frequency_hz: undefined,
      sample_rate: undefined,
      iq_data: new Uint8Array([1, 2, 3, 4]),
      data_type: "iq_raw",
    });
  });
});
