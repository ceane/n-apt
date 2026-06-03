import * as React from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTPlaybackCanvas from "../../src/ts/components/FFTPlaybackCanvas";

const fftAndWaterfallMock = jest.fn((_props: any) => (
  <div data-testid="fft-and-waterfall" />
));

jest.mock("@n-apt/components", () => ({
  FFTAndWaterfall: React.forwardRef((props: any, ref: React.Ref<any>) => {
    fftAndWaterfallMock(props);
    React.useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => null,
      getWaterfallCanvas: () => null,
      getSpectrumOverlayCanvas: () => null,
      getWaterfallOverlayCanvas: () => null,
      triggerSnapshotRender: jest.fn(),
      getSnapshotData: () => null,
      getCompositeSnapshot: () => null,
    }));
    return <div data-testid="fft-and-waterfall" />;
  }),
}));

jest.mock("@n-apt/hooks/useStitchingLogic", () => ({
  useStitchingLogic: () => ({
    hasStitchedData: true,
    frequencyRange: { min: 137_000_000, max: 138_000_000 },
    channelCount: 1,
    activeChannel: 0,
    hardwareSampleRateHz: 3_200_000,
    allChannelsRef: {
      current: [
        {
          label: "Channel 1",
          frame_rate: 30,
          frequency_range: [137_000_000, 138_000_000],
          center_freq_hz: 137_500_000,
          sample_rate_hz: 3_200_000,
        },
      ],
    },
    workerFileDataCache: { current: [] },
    workerFreqMap: { current: [] },
    workerMetadataMap: { current: [] },
    precomputedFrames: { current: [] },
    setChannelCount: jest.fn(),
    setActiveChannel: jest.fn(),
    setFrequencyRange: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/usePlaybackAnimation", () => ({
  usePlaybackAnimation: () => ({
    animateFrame: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useChannelManagement", () => ({
  useChannelManagement: () => ({
    switchChannel: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useSnapshot", () => ({
  useSnapshot: () => ({
    handleSnapshot: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    state: { activeSignalArea: "A" },
    toggleVisualizerPause: jest.fn(),
  }),
}));

jest.mock("@n-apt/redux", () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (selector: any) =>
    selector({
      waterfall: { stitchStatus: "Ready" },
      spectrum: { activeSignalArea: "A" },
    }),
  setActivePlaybackMetadata: jest.fn(),
  setPlaybackChannels: jest.fn(),
  clearActivePlaybackMetadata: jest.fn(),
  setActiveSignalArea: jest.fn(),
  bumpSnapshotSectionPulse: jest.fn(),
}));

describe("FFTPlaybackCanvas file mode", () => {
  beforeEach(() => {
    fftAndWaterfallMock.mockClear();
  });

  it("never marks stitched file playback as awaiting device data", async () => {
    render(
      <FFTPlaybackCanvas
        selectedFiles={[{ id: "1", name: "capture.napt" }]}
        stitchTrigger={0}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={false}
        fftSize={2048}
        displayMode="fft"
        powerScale="dB"
        onStitchStatus={jest.fn()}
        onStitchProgress={jest.fn()}
        onFrequencyRangeChange={jest.fn()}
        onFftDbLimitsChange={jest.fn()}
        snapshotGridPreference
      />,
    );

    await waitFor(() => {
      expect(fftAndWaterfallMock).toHaveBeenCalled();
    });

    const playbackProps =
      fftAndWaterfallMock.mock.calls[
        fftAndWaterfallMock.mock.calls.length - 1
      ]?.[0];
    expect(playbackProps?.awaitingDeviceData).toBe(false);
  });
});
