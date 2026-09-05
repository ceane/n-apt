import React from "react";
import { act, render, screen } from "@testing-library/react";
import FFTAndWaterfall from "@n-apt/spectrum/FFTAndWaterfall";
import { isControlPlaneUnavailable } from "@n-apt/spectrum/public/liveSourceLifecycle";

const fftCanvasMock = jest.fn((_props?: any) => (
  <div data-testid="fft-canvas" />
));
const fftCanvasMountSpy = jest.fn();
const fftCanvasUnmountSpy = jest.fn();
const visualizerSlidersMock = jest.fn((_props: any) => (
  <div data-testid="visualizer-sliders" />
));
const waterfallCanvasMock = jest.fn((_props?: any) => (
  <div data-testid="fifo-waterfall-canvas" />
));
let mockedSourceMode: "live" | "file" = "live";
let mockedSpectrumState: Record<string, unknown> = {};
let mockedWebsocketState: Record<string, unknown> = {};

jest.mock("@n-apt/spectrum/FFTCanvas", () => {
  const React = require("react");

  return {
    __esModule: true,
    default: React.forwardRef((_props: any, ref: React.Ref<HTMLDivElement>) => {
      fftCanvasMock(_props);
      React.useEffect(() => {
        fftCanvasMountSpy();
        return () => {
          fftCanvasUnmountSpy();
        };
      }, []);
      return <div data-testid="fft-canvas" ref={ref} />;
    }),
  };
});

jest.mock("@n-apt/spectrum/VisualizerSliders", () => ({
  VisualizerSliders: (props: any) => visualizerSlidersMock(props),
}));

jest.mock("@n-apt/spectrum/FIFOWaterfallCanvas", () => ({
  __esModule: true,
  default: (_props: any) => waterfallCanvasMock(_props),
}));

jest.mock("@n-apt/redux", () => ({
  useAppSelector: (selector: any) => {
    const result = selector({
      spectrum: {
        fftAvgEnabled: false,
        fftSmoothEnabled: false,
        wfSmoothEnabled: false,
        showTxSlider: true,
        txSignal: "apt",
        txCenterFrequencyHz: 2_186_000,
        txSampleRateHz: 1_000_000,
        txPowerDbm: -18,
        deviceKind: null,
        ...mockedSpectrumState,
      },
      theme: {
        fftColor: "#00d4ff",
        waterfallTheme: "classic",
      },
      waterfall: {
        sourceMode: mockedSourceMode,
      },
      websocket: {
        isConnected: true,
        deviceState: "connected",
        deviceLoadingReason: null,
        error: null,
        cryptoCorrupted: false,
        activeSourceId: null,
        sources: [],
        ...mockedWebsocketState,
      },
    });
    return result;
  },
  useAppDispatch: () => jest.fn(),
  spectrumActions: {
    setFftAvgEnabled: jest.fn(),
    setFftSmoothEnabled: jest.fn(),
    setWfSmoothEnabled: jest.fn(),
    setAutoZoomStability: jest.fn(),
    setVizZoomFloorPan: jest.fn(),
  },
}));

describe("FFTAndWaterfall", () => {
  beforeEach(() => {
    mockedSourceMode = "live";
    mockedSpectrumState = {};
    mockedWebsocketState = {};
    fftCanvasMock.mockClear();
    fftCanvasMountSpy.mockClear();
    fftCanvasUnmountSpy.mockClear();
    visualizerSlidersMock.mockClear();
    waterfallCanvasMock.mockClear();
  });

  it("reports server down only after a connected session is lost", () => {
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "connecting",
        hasConnectedOnce: false,
      }),
    ).toBe(false);
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "disconnected",
        hasConnectedOnce: false,
      }),
    ).toBe(false);
    expect(
      isControlPlaneUnavailable({
        isConnected: false,
        connectionStatus: "disconnected",
        hasConnectedOnce: true,
        sourceHandoffPending: true,
        transportPhase: "warming",
      }),
    ).toBe(true);
    expect(
      isControlPlaneUnavailable({
        isConnected: true,
        connectionStatus: "connected",
        hasConnectedOnce: true,
      }),
    ).toBe(false);
  });

  it("renders FFTCanvas plus dedicated waterfall and sliders chrome", () => {
    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    expect(fftCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({
        waterfallCanvasBindings: expect.any(Object),
        interactionDisabled: true,
      }),
    );
    expect(screen.getByTestId("fifo-waterfall-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("visualizer-sliders")).toBeInTheDocument();

    const sliderCalls = visualizerSlidersMock.mock.calls;
    const sliderProps = sliderCalls[sliderCalls.length - 1]?.[0];
    expect(sliderProps?.disabled).toBe(true);

    const waterfallCalls = waterfallCanvasMock.mock.calls;
    const waterfallProps = waterfallCalls[waterfallCalls.length - 1]?.[0];
    expect(waterfallProps?.awaitingDeviceData).toBe(true);
    expect(waterfallProps?.placeholderState).toMatchObject({
      kind: "loading",
      paneLabel: "Waterfall",
    });
  });

  it("uses the selected Tx presentation source when RX remains globally active", () => {
    mockedWebsocketState = {
      activeSourceId: "mock-apt",
      sources: [
        {
          id: "mock-apt",
          kind: "mock_apt",
          capability: "mock",
          status: "receiving",
          capabilities: { can_receive: true, can_transmit: false },
          iq_format: "u8",
        },
        {
          id: "mock-tx",
          kind: "mock_tx",
          capability: "tx",
          status: "transmitting",
          capabilities: { can_receive: false, can_transmit: true },
          iq_format: "u8",
        },
      ],
      sourceStatuses: {
        "mock-apt": "receiving",
        "mock-tx": "transmitting",
      },
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        expectedSourceId="mock-tx"
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    expect(screen.getByTestId("fft-waterfall")).toHaveAttribute(
      "data-stream-mode",
      "tx",
    );
  });

  it("keeps both panes loading until a cached target frame paints", () => {
    render(
      <FFTAndWaterfall
        dataRef={{
          current: {
            source_id: "mock-apt",
            data_type: "iq_raw",
            iq_data: new Uint8Array([1, 2, 3, 4]),
          },
        }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        presentationPolicy={{
          suppressStaleFrames: true,
          clearStalePresentation: true,
          preserveMatchingPresentation: false,
        }}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.interactionDisabled).toBe(true);
    expect(fftProps?.awaitingDeviceData).toBe(true);
    expect(fftProps?.placeholderState).toBeNull();

    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(waterfallProps?.awaitingDeviceData).toBe(true);
  });

  it("keeps the Tx slider available for half-duplex Tx standby", () => {
    mockedWebsocketState = {
      activeSourceId: "hackrf-1",
      sources: [
        {
          id: "hackrf-1",
          kind: "hackrf",
          capability: "tx_rx",
          status: "standby",
        },
      ],
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 24_100_000, max: 30_370_000 }}
        centerFrequencyHz={27_235_000}
        activeSignalArea="A"
        isPaused={true}
        snapshotGridPreference={true}
        txSlider={{ visible: true } as any}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.txSlider).toMatchObject({ visible: true });
    expect(fftProps?.txSliderAllowed).toBe(true);
  });

  it("keeps a route-authorized Tx slider visible while active transport catches up", () => {
    mockedWebsocketState = {
      activeSourceId: "rtl-1",
      sources: [
        {
          id: "rtl-1",
          kind: "rtl_sdr",
          capability: "rx_only",
          status: "receiving",
        },
      ],
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 24_100_000, max: 30_370_000 }}
        centerFrequencyHz={27_235_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        txSlider={{ visible: true } as any}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.txSlider).toMatchObject({ visible: true });
    expect(fftProps?.txSliderAllowed).toBe(true);
  });

  it("does not require a live frame before rendering file playback", () => {
    mockedSourceMode = "file";

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];

    expect(fftProps?.awaitingDeviceData).toBe(false);
    expect(waterfallProps?.awaitingDeviceData).toBe(false);
  });

  it("never mounts the Tx slider control in file processing mode", () => {
    mockedSourceMode = "file";
    mockedWebsocketState = {
      activeSourceId: "mock-tx",
      sources: [{ id: "mock-tx", capability: "tx", kind: "mock_tx" }],
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={true}
        snapshotGridPreference={true}
      />,
    );

    const sliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];

    expect(sliderProps?.canShowTxSlider).toBe(false);
  });

  it("clears waterfall loading as soon as FFT reports a rendered frame", () => {
    const onRenderableFrameChange = jest.fn();
    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        onRenderableFrameChange={onRenderableFrameChange}
      />,
    );

    const initialSliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];
    const initialWaterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(initialSliderProps?.disabled).toBe(true);
    expect(initialWaterfallProps?.awaitingDeviceData).toBe(true);

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    act(() => {
      fftProps.onRenderableFrameChange(true);
      fftProps.onCanvasLoadingChange(false);
    });
    expect(onRenderableFrameChange).toHaveBeenCalledWith(true);

    const nextWaterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(nextWaterfallProps?.awaitingDeviceData).toBe(false);
  });

  it("forwards renderability changes only when the state changes", () => {
    const onRenderableFrameChange = jest.fn();
    render(
      <FFTAndWaterfall
        dataRef={{ current: { waveform: new Float32Array([1, 2, 3]) } }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        onRenderableFrameChange={onRenderableFrameChange}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    act(() => {
      fftProps.onRenderableFrameChange(true);
      fftProps.onRenderableFrameChange(true);
      fftProps.onRenderableFrameChange(false);
      fftProps.onRenderableFrameChange(false);
    });

    expect(onRenderableFrameChange.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the rendered frame and controls available when pausing", () => {
    const dataRef = { current: { waveform: new Float32Array([1, 2, 3]) } };
    const { rerender } = render(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    act(() => {
      fftProps.onRenderableFrameChange(true);
    });

    rerender(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={true}
        snapshotGridPreference={true}
      />,
    );

    const pausedTransitionFftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    act(() => {
      pausedTransitionFftProps.onRenderableFrameChange(false);
    });

    const pausedFftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const pausedSliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];
    expect(pausedFftProps?.interactionDisabled).toBe(false);
    expect(pausedFftProps?.awaitingDeviceData).toBe(false);
    expect(pausedFftProps?.placeholderState).toBeFalsy();
    expect(pausedSliderProps?.disabled).toBe(false);
  });

  it("does not re-enter loading when a rendered canvas pauses", () => {
    const dataRef = { current: { waveform: new Float32Array([1, 2, 3]) } };
    const { rerender } = render(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const runningFftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    act(() => {
      runningFftProps.onRenderableFrameChange(true);
      runningFftProps.onCanvasLoadingChange(false);
    });
    expect(runningFftProps.onCanvasLoadingChange).toEqual(expect.any(Function));

    rerender(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={true}
        snapshotGridPreference={true}
      />,
    );

    const pausedFftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(pausedFftProps?.interactionDisabled).toBe(false);
    expect(pausedFftProps?.awaitingDeviceData).toBe(false);
  });

  it("keeps FFT and waterfall loading together until the frame is rendered", () => {
    render(
      <FFTAndWaterfall
        dataRef={{
          current: {
            source_id: "rtl-sdr-1",
            iq_data: new Uint8Array([128, 128]),
          },
        }}
        expectedSourceId="rtl-sdr-1"
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];

    expect(fftProps?.awaitingDeviceData).toBe(true);
    expect(waterfallProps?.awaitingDeviceData).toBe(true);
  });

  it("labels an explicit loading placeholder for each pane", () => {
    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        placeholderState={{
          kind: "loading",
          sourceLabel: "RTL-SDR v4",
          paneLabel: "FFT",
        }}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];

    expect(fftProps?.placeholderState).toMatchObject({ paneLabel: "FFT" });
    expect(waterfallProps?.placeholderState).toMatchObject({
      paneLabel: "Waterfall",
    });
  });

  it("keeps the waterfall placeholder while FFT is the first pane to report a frame", () => {
    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        placeholderState={{
          kind: "loading",
          sourceLabel: "HackRF One",
          paneLabel: "FFT",
        }}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    act(() => {
      fftProps.onRenderableFrameChange(true);
    });

    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(waterfallProps?.placeholderState).toMatchObject({
      kind: "loading",
      paneLabel: "Waterfall",
    });
  });

  it("keeps standby top bars while a live frame is present", () => {
    render(
      <FFTAndWaterfall
        dataRef={{
          current: {
            source_id: "mock-tx",
            iq_data: new Uint8Array([128, 129]),
            frame_status: "standby",
            is_tx_preview: true,
          },
        }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        isStandby={true}
        snapshotGridPreference={true}
        presentationPolicy={{
          suppressStaleFrames: false,
          clearStalePresentation: false,
          preserveMatchingPresentation: true,
        }}
        placeholderState={{
          kind: "top-bar",
          title: "Start Tx to transmit",
          sourceLabel: "Mock Tx SDR",
        }}
      />,
    );

    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];

    expect(waterfallProps?.placeholderState).toMatchObject({
      kind: "top-bar",
      title: "Start Tx to transmit",
    });
    expect(waterfallProps?.awaitingDeviceData).toBe(false);
    expect(fftProps?.interactionDisabled).toBe(false);
  });

  it("keeps a retained Tx standby presentation uncovered after a remount", () => {
    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        isStandby={true}
        snapshotGridPreference={true}
        presentationPolicy={{
          suppressStaleFrames: false,
          clearStalePresentation: false,
          preserveMatchingPresentation: true,
        }}
        placeholderState={{
          kind: "loading",
          sourceLabel: "Mock Tx SDR",
          paneLabel: "FFT",
        }}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];

    expect(fftProps?.placeholderState).toBeUndefined();
    expect(fftProps?.awaitingDeviceData).toBe(false);
    expect(fftProps?.interactionDisabled).toBe(false);
    expect(waterfallProps?.placeholderState).toBeUndefined();
    expect(waterfallProps?.awaitingDeviceData).toBe(false);
  });

  it("keeps the last frame available while a live FFT setting is applied", () => {
    jest.useFakeTimers();
    const dataRef = {
      current: {
        source_id: "hackrf-one",
        iq_data: new Uint8Array([128, 129]),
      },
    };

    const { rerender } = render(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );
    rerender(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        placeholderState={{
          kind: "loading",
          sourceLabel: "HackRF One",
          paneLabel: "FFT",
        }}
      />,
    );

    jest.advanceTimersByTime(200);
    expect(dataRef.current).not.toBeNull();
    jest.useRealTimers();
  });

  it("uses an extended loading grace for instant mock-source handoffs", () => {
    jest.useFakeTimers();
    const dataRef = { current: null };
    const { rerender } = render(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        loadingPlaceholderDelayMs={1_000}
      />,
    );
    act(() => {
      const initialProps =
        fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
      initialProps?.onRenderableFrameChange?.(true);
      initialProps?.onCanvasLoadingChange?.(false);
    });

    rerender(
      <FFTAndWaterfall
        dataRef={dataRef}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        loadingPlaceholderDelayMs={1_000}
        placeholderState={{
          kind: "loading",
          paneLabel: "FFT",
          sourceLabel: "Mock APT SDR",
        }}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(999);
    });
    let fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.placeholderState).toBeUndefined();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.placeholderState).toMatchObject({ kind: "loading" });
    jest.useRealTimers();
  });

  it("passes Tx slider props on the first render when Redux says Tx is visible", () => {
    mockedSpectrumState = {
      showTxSlider: true,
    };
    mockedWebsocketState = {
      activeSourceId: "mock-tx",
      sources: [{ id: "mock-tx", capability: "tx", kind: "mock_tx" }],
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const sliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];

    expect(sliderProps).toMatchObject({
      showTxSlider: true,
      canShowTxSlider: true,
    });
    expect(fftProps?.txSlider).toMatchObject({
      visible: true,
      signalLabel: "APT",
      powerDbm: -18,
      visibleMinHz: 0,
      visibleMaxHz: 4_372_000,
      txCenterHz: 2_186_000,
      txSampleRateHz: 1_000_000,
    });
  });

  it("defaults to true if Redux persist restores an undefined showTxSlider state", () => {
    mockedSpectrumState = {
      showTxSlider: undefined,
    };
    mockedWebsocketState = {
      activeSourceId: "mock-tx",
      sources: [{ id: "mock-tx", capability: "tx", kind: "mock_tx" }],
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const sliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];

    expect(sliderProps).toMatchObject({
      showTxSlider: true,
      canShowTxSlider: true,
    });
    expect(fftProps?.txSlider).toMatchObject({
      visible: true,
    });
  });

  it("hides Tx slider props on the first render when Redux says device is mock (RX only)", () => {
    mockedSpectrumState = {
      showTxSlider: true,
    };
    mockedWebsocketState = {
      activeSourceId: "mock-apt",
      sources: [{ id: "mock-apt", capability: "mock", kind: "mock_apt" }],
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    const sliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];

    expect(sliderProps).toMatchObject({
      showTxSlider: true,
      canShowTxSlider: false,
    });
    expect(fftProps?.txSlider).toBeUndefined();
  });

  it("renders a lifecycle-owned Server Down placeholder without inventing one", () => {
    mockedSpectrumState = {
      deviceKind: "mock_apt",
      showTxSlider: true,
    };
    mockedWebsocketState = {
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      activeSourceId: "mock-apt",
      sources: [
        {
          id: "mock-apt",
          kind: "mock_apt",
          capability: "mock",
        },
      ],
    };

    const lifecycleServerDown = {
      kind: "error" as const,
      reason: "Server down",
      message:
        "The server was disconnected due to being manually exited or an error.",
      sourceLabel: "mock-apt",
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        isStandby={true}
        snapshotGridPreference={true}
        presentationPolicy={{
          suppressStaleFrames: false,
          clearStalePresentation: false,
          preserveMatchingPresentation: false,
        }}
        placeholderState={lifecycleServerDown}
        placeholderErrorReason="Server down"
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.placeholderErrorReason).toBe("Server down");
    expect(fftProps?.placeholderState).toMatchObject(lifecycleServerDown);
    const waterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(waterfallProps?.placeholderErrorReason).toBe("Server down");
    expect(waterfallProps?.placeholderState).toMatchObject(lifecycleServerDown);
  });

  it("does not invent Server Down when lifecycle owns placeholders during handoff", () => {
    mockedWebsocketState = {
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      activeSourceId: "mock-apt",
      sources: [
        {
          id: "mock-apt",
          kind: "mock_apt",
          capability: "mock",
          status: "receiving",
        },
      ],
      sourceStatuses: { "mock-apt": "receiving" },
      sourceTransport: { sourceId: "mock-apt", phase: "warming", error: null },
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        presentationPolicy={{
          suppressStaleFrames: true,
          clearStalePresentation: true,
          preserveMatchingPresentation: false,
        }}
        placeholderState={{
          kind: "loading",
          paneLabel: "FFT",
          sourceLabel: "Mock APT SDR",
          message: "Waiting for the first frame to arrive.",
        }}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.placeholderErrorReason).toBeNull();
    expect(fftProps?.placeholderState).toMatchObject({ kind: "loading" });
  });

  it("does not synthesize Server Down when lifecycle presentation is absent", () => {
    mockedWebsocketState = {
      isConnected: false,
      connectionStatus: "disconnected",
      hasConnectedOnce: true,
      activeSourceId: "mock-apt",
      sources: [
        {
          id: "mock-apt",
          kind: "mock_apt",
          capability: "mock",
          status: "receiving",
        },
      ],
      sourceStatuses: { "mock-apt": "receiving" },
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.placeholderErrorReason).toBeNull();
  });

  it("does not flash Server Down while the first websocket connect is in flight", () => {
    mockedWebsocketState = {
      isConnected: false,
      connectionStatus: "connecting",
      hasConnectedOnce: false,
      activeSourceId: null,
      sources: [],
      sourceStatuses: {},
    };

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 0, max: 4_372_000 }}
        centerFrequencyHz={2_186_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
      />,
    );

    const fftProps =
      fftCanvasMock.mock.calls[fftCanvasMock.mock.calls.length - 1]?.[0];
    expect(fftProps?.placeholderErrorReason).toBeNull();
  });

  it("keeps the live FFT canvas mounted when fftSize changes", () => {
    const { rerender } = render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        fftSize={1024}
      />,
    );

    expect(fftCanvasMountSpy).toHaveBeenCalledTimes(1);
    expect(fftCanvasUnmountSpy).toHaveBeenCalledTimes(0);

    rerender(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        fftSize={4096}
      />,
    );

    expect(fftCanvasMountSpy).toHaveBeenCalledTimes(1);
    expect(fftCanvasUnmountSpy).toHaveBeenCalledTimes(0);
  });

  it("retunes the hardware window when zooming out would otherwise clamp pan", () => {
    const onVizZoomChange = jest.fn();
    const onVizPanChange = jest.fn();
    const onFrequencyRangeChange = jest.fn();

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 200 }}
        centerFrequencyHz={150_000_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        vizZoom={8}
        vizZoomFloor={1}
        vizPanOffset={44}
        onVizZoomChange={onVizZoomChange}
        onVizPanChange={onVizPanChange}
        onFrequencyRangeChange={onFrequencyRangeChange}
      />,
    );

    const sliderCalls = visualizerSlidersMock.mock.calls;
    const sliderProps = sliderCalls[sliderCalls.length - 1]?.[0];
    expect(sliderProps).toBeTruthy();

    sliderProps.onZoomChange(2);

    expect(onFrequencyRangeChange).toHaveBeenCalledWith({
      min: 119,
      max: 219,
    });
    expect(onVizPanChange).toHaveBeenCalledWith(25);
    expect(onVizZoomChange).toHaveBeenCalledWith(2);
  });

  it("recenters to pan 0 when reset is requested", () => {
    const onVizZoomChange = jest.fn();
    const onVizZoomFloorChange = jest.fn();
    const onVizPanChange = jest.fn();
    const onFrequencyRangeChange = jest.fn();
    const onFftDbLimitsChange = jest.fn();

    render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 101 }}
        centerFrequencyHz={100_500_000}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        vizZoom={4}
        vizZoomFloor={3}
        vizPanOffset={12}
        onVizZoomChange={onVizZoomChange}
        onVizZoomFloorChange={onVizZoomFloorChange}
        onVizPanChange={onVizPanChange}
        onFrequencyRangeChange={onFrequencyRangeChange}
        onFftDbLimitsChange={onFftDbLimitsChange}
      />,
    );

    const sliderCalls = visualizerSlidersMock.mock.calls;
    const sliderProps = sliderCalls[sliderCalls.length - 1]?.[0];
    expect(sliderProps).toBeTruthy();

    sliderProps.onResetZoomDb();

    expect(onVizPanChange).toHaveBeenCalledWith(0);
    expect(onFrequencyRangeChange).toHaveBeenCalledWith({ min: 100, max: 101 });
    expect(onVizZoomChange).toHaveBeenCalledWith(1);
    expect(onVizZoomFloorChange).toHaveBeenCalledWith(1);
    expect(onFftDbLimitsChange).toHaveBeenCalledWith(-120, 0);
  });

  it("resets to the frequency range last seen before zooming", () => {
    const onFrequencyRangeChange = jest.fn();
    const { rerender } = render(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 100, max: 200 }}
        centerFrequencyHz={150}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        vizZoom={1}
        onFrequencyRangeChange={onFrequencyRangeChange}
      />,
    );

    rerender(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 120, max: 220 }}
        centerFrequencyHz={170}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        vizZoom={1}
        onFrequencyRangeChange={onFrequencyRangeChange}
      />,
    );
    rerender(
      <FFTAndWaterfall
        dataRef={{ current: null }}
        frequencyRange={{ min: 120, max: 220 }}
        centerFrequencyHz={170}
        activeSignalArea="A"
        isPaused={false}
        snapshotGridPreference={true}
        vizZoom={2}
        onFrequencyRangeChange={onFrequencyRangeChange}
      />,
    );

    const sliderProps =
      visualizerSlidersMock.mock.calls[
        visualizerSlidersMock.mock.calls.length - 1
      ]?.[0];
    sliderProps.onResetZoomDb();

    expect(onFrequencyRangeChange).toHaveBeenCalledWith({ min: 120, max: 220 });
  });
});
