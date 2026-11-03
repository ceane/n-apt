import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTPlaybackCanvas from "@n-apt/spectrum/FFTPlaybackCanvas";
import { filePlaybackDataRef } from "@n-apt/app/infrastructure/io/filePlaybackData";
import { composeWaterfallCanvasWithDbAxis } from "@n-apt/layout/rendering/waterfallDbAxis";

const fftAndWaterfallMock = jest.fn((_props: any) => (
  <div data-testid="fft-and-waterfall">
    {_props.waterfallHeaderActionContent}
  </div>
));
const observedInitialFrames: unknown[] = [];
const triggerSnapshotRenderMock = jest.fn();
let mockWaterfallCanvas: HTMLCanvasElement | null = null;
let mockFastSnapshotCanvas: HTMLCanvasElement | null = null;
let mockSnapshotData: unknown = null;
const mockHandleSnapshot = jest.fn();
const mockGetFastSnapshotCanvas = jest.fn(() => mockFastSnapshotCanvas);
let suspendVisualizer = false;
const pendingVisualizer = new Promise(() => {});

jest.mock("@n-apt/spectrum", () => ({
  FFTAndWaterfall: React.forwardRef((props: any, ref: React.Ref<any>) => {
    fftAndWaterfallMock(props);
    if (suspendVisualizer) throw pendingVisualizer;
    React.useEffect(() => {
      observedInitialFrames.push(props.dataRef.current);
    }, []);
    React.useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => null,
      getWaterfallCanvas: () => mockWaterfallCanvas,
      getFastSnapshotCanvas: mockGetFastSnapshotCanvas,
      getSpectrumOverlayCanvas: () => null,
      getWaterfallOverlayCanvas: () => null,
      triggerSnapshotRender: triggerSnapshotRenderMock,
      getSnapshotData: () => mockSnapshotData,
      getCompositeSnapshot: () => null,
    }));
    return (
      <div data-testid="fft-and-waterfall">
        {props.waterfallHeaderActionContent}
      </div>
    );
  }),
}));

jest.mock("@n-apt/spectrum/hooks/useStitchingLogic", () => ({
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

jest.mock("@n-apt/capture/public/usePlaybackAnimation", () => ({
  usePlaybackAnimation: () => ({
    animateFrame: jest.fn(),
  }),
}));

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ fidoVaultKey: null }),
}));

jest.mock("@n-apt/spectrum/hooks/useChannelManagement", () => ({
  useChannelManagement: () => ({
    switchChannel: jest.fn(),
  }),
}));

jest.mock("@n-apt/capture/public/useSnapshot", () => ({
  useSnapshot: () => ({
    handleSnapshot: mockHandleSnapshot,
  }),
}));

jest.mock("@n-apt/layout/rendering/waterfallDbAxis", () => ({
  composeWaterfallCanvasWithDbAxis: jest.fn(
    ({ waterfallCanvas }: { waterfallCanvas: HTMLCanvasElement }) =>
      waterfallCanvas,
  ),
}));

jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
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
    mockHandleSnapshot.mockClear();
    jest.mocked(composeWaterfallCanvasWithDbAxis).mockClear();
    observedInitialFrames.length = 0;
    filePlaybackDataRef.current = null;
    mockWaterfallCanvas = null;
    mockFastSnapshotCanvas = null;
    mockSnapshotData = null;
    mockGetFastSnapshotCanvas.mockClear();
  });

  afterEach(() => {
    filePlaybackDataRef.current = null;
  });

  it("does not replace the shared playback frame when rendering is suspended before commit", () => {
    const existingFrame = { waveform: new Float32Array([-12]) };
    filePlaybackDataRef.current = existingFrame as any;
    suspendVisualizer = true;
    try {
      render(
        <React.Suspense fallback={<div>Loading</div>}>
          <FFTPlaybackCanvas
            selectedFiles={[{ id: "1", name: "capture.napt" }]}
            stitchTrigger={0}
            stitchSourceSettings={{ gain: 0, ppm: 0 }}
            isPaused
            fftSize={2048}
            displayMode="fft"
          />
        </React.Suspense>,
      );
      expect(filePlaybackDataRef.current).toBe(existingFrame);
      expect(triggerSnapshotRenderMock).not.toHaveBeenCalled();
    } finally {
      suspendVisualizer = false;
    }
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

  it("marks file playback as a non-hardware source for the pattern overlay", async () => {
    render(
      <FFTPlaybackCanvas
        selectedFiles={[{ id: "1", name: "capture.napt" }]}
        stitchTrigger={0}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={false}
        fftSize={2048}
        displayMode="fft"
      />,
    );

    await waitFor(() => {
      expect(fftAndWaterfallMock).toHaveBeenCalled();
    });

    const playbackProps =
      fftAndWaterfallMock.mock.calls[
        fftAndWaterfallMock.mock.calls.length - 1
      ]?.[0];
    expect(playbackProps?.isNonHardwareSource).toBe(true);
  });

  it("uses overlay-composited canvases for file playback fast snapshots", async () => {
    const rawWaterfallCanvas = document.createElement("canvas");
    const fastWaterfallCanvas = document.createElement("canvas");
    rawWaterfallCanvas.width = 640;
    rawWaterfallCanvas.height = 360;
    fastWaterfallCanvas.width = 640;
    fastWaterfallCanvas.height = 360;
    mockWaterfallCanvas = rawWaterfallCanvas;
    mockFastSnapshotCanvas = fastWaterfallCanvas;
    const canvasRef = React.createRef<any>();

    render(
      <FFTPlaybackCanvas
        ref={canvasRef}
        selectedFiles={[{ id: "1", name: "capture.napt" }]}
        stitchTrigger={0}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={false}
        fftSize={2048}
        displayMode="fft"
      />,
    );

    expect(canvasRef.current?.getFastSnapshotCanvas).toBe(
      mockGetFastSnapshotCanvas,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fast Snapshot" }));

    await waitFor(() => expect(mockHandleSnapshot).toHaveBeenCalled());

    const options = mockHandleSnapshot.mock.calls[0]?.[0];
    expect(options.canvasOnly.getCanvas()).toBe(fastWaterfallCanvas);
    expect(mockGetFastSnapshotCanvas).toHaveBeenCalledWith("waterfall");
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

  it("adds dB scale to the file-playback waterfall fast snapshot", async () => {
    mockWaterfallCanvas = document.createElement("canvas");
    mockSnapshotData = {
      dbMin: -75,
      dbMax: -15,
      powerScale: "dBm",
    };
    const canvasRef = React.createRef<any>();

    render(
      <FFTPlaybackCanvas
        ref={canvasRef}
        selectedFiles={[{ id: "1", name: "capture.napt" }]}
        stitchTrigger={0}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isPaused={false}
        fftSize={2048}
        displayMode="fft"
        fftMin={-90}
        fftMax={0}
        powerScale="dB"
      />,
    );

    const waterfallButton = await screen.findByRole("button", {
      name: "Fast Snapshot",
    });
    fireEvent.click(waterfallButton);

    const snapshotOptions = mockHandleSnapshot.mock.calls[0]?.[0];
    expect(snapshotOptions?.canvasOnly?.filenamePrefix).toBe(
      "fast-waterfall-snapshot",
    );
    snapshotOptions?.canvasOnly?.getCanvas();

    expect(composeWaterfallCanvasWithDbAxis).toHaveBeenCalledWith(
      expect.objectContaining({
        waterfallCanvas: mockWaterfallCanvas,
        dbMin: -75,
        dbMax: -15,
        unit: "dBm",
        plotInsets: { left: 0, right: 0, top: 0, bottom: 0 },
      }),
    );
  });
});
