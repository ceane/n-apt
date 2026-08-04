import * as React from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTPlaybackCanvas from "../../src/ts/components/FFTPlaybackCanvas";
import { filePlaybackDataRef } from "@n-apt/utils/filePlaybackData";

const fftAndWaterfallMock = jest.fn((_props: any) => (
  <div data-testid="fft-and-waterfall" />
));
const observedInitialFrames: unknown[] = [];
const triggerSnapshotRenderMock = jest.fn();

jest.mock("@n-apt/components", () => ({
  FFTAndWaterfall: React.forwardRef((props: any, ref: React.Ref<any>) => {
    fftAndWaterfallMock(props);
    observedInitialFrames.push(props.dataRef.current);
    React.useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => null,
      getWaterfallCanvas: () => null,
      getSpectrumOverlayCanvas: () => null,
      getWaterfallOverlayCanvas: () => null,
      triggerSnapshotRender: triggerSnapshotRenderMock,
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
    workerMetadataMap: {
      current: [
        [
          "capture.napt",
          {
            capture_sample_rate_hz: 3_200_000,
            fft_size: 65_536,
            source_device: "RTL-SDR",
            duration_s: 5,
          },
        ],
      ],
    },
    precomputedFrames: {
      current: [{ waveform: new Float32Array([-90, -40, -70]) }],
    },
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
    triggerSnapshotRenderMock.mockClear();
  });
  beforeEach(() => {
    fftAndWaterfallMock.mockClear();
    observedInitialFrames.length = 0;
    filePlaybackDataRef.current = null;
  });

  afterEach(() => {
    filePlaybackDataRef.current = null;
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

  it("does not restore a live paused snapshot into the processed file frame", async () => {
    render(
      <FFTPlaybackCanvas
        selectedFiles={[{ id: "1", name: "capture.napt" }]}
        stitchTrigger={0}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={true}
        fftSize={2048}
        displayMode="fft"
        powerScale="dB"
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
    expect(playbackProps?.pauseSnapshotEnabled).toBe(false);
  });

  it("provides the first processed frame before the visualizer mounts", () => {
    render(
      <FFTPlaybackCanvas
        selectedFiles={[{ id: "1", name: "capture.napt" }]}
        stitchTrigger={0}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={false}
        fftSize={2048}
        displayMode="fft"
        powerScale="dB"
        snapshotGridPreference
      />,
    );

    expect(observedInitialFrames[0]).toEqual({
      waveform: new Float32Array([-90, -40, -70]),
    });
    expect(filePlaybackDataRef.current).toEqual({
      waveform: new Float32Array([-90, -40, -70]),
    });
  });

  it("requests a render after the seeded first frame is mounted", async () => {
    const canvasRef = React.createRef<any>();
    render(
      <FFTPlaybackCanvas
        ref={canvasRef}
        selectedFiles={[{ id: "file-1", name: "capture.napt" }]}
        stitchTrigger={1}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={true}
        fftSize={2048}
        displayMode="fft"
        powerScale="dB"
        onStitchStatus={jest.fn()}
      />,
    );

    await waitFor(() => expect(triggerSnapshotRenderMock).toHaveBeenCalled());
  });

  it("passes file playback metadata into the FFT status row", async () => {
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

    expect(playbackProps?.canvasStatusRow).toEqual({
      sampleRateLabel: "Captured Sample Rate: 3.2MHz",
      fftSizeLabel: "FFT Size: 65,536",
      fftWindowLabel: "Device: RTL-SDR",
      timingLabel: "Duration: 5s",
    });
  });
});
