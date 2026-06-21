import React from "react";
import { act, render, screen } from "@testing-library/react";
import FFTAndWaterfall from "@n-apt/components/FFTAndWaterfall";

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

jest.mock("@n-apt/components/FFTCanvas", () => {
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

jest.mock("@n-apt/components/VisualizerSliders", () => ({
  VisualizerSliders: (props: any) => visualizerSlidersMock(props),
}));

jest.mock("@n-apt/components/FIFOWaterfallCanvas", () => ({
  __esModule: true,
  default: (_props: any) => waterfallCanvasMock(_props),
}));

jest.mock("@n-apt/redux", () => ({
  useAppSelector: (selector: any) =>
    selector({
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
    }),
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

  it("clears waterfall loading as soon as FFT reports a rendered frame", () => {
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
    });

    const nextWaterfallProps =
      waterfallCanvasMock.mock.calls[
        waterfallCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(nextWaterfallProps?.awaitingDeviceData).toBe(false);
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

  it("does not surface a server-down placeholder for the mock apt source", () => {
    mockedSpectrumState = {
      deviceKind: "mock_apt",
      showTxSlider: true,
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
        onFftDbLimitsChange={onFftDbLimitsChange}
      />,
    );

    const sliderCalls = visualizerSlidersMock.mock.calls;
    const sliderProps = sliderCalls[sliderCalls.length - 1]?.[0];
    expect(sliderProps).toBeTruthy();

    sliderProps.onResetZoomDb();

    expect(onVizPanChange).toHaveBeenCalledWith(0);
    expect(onVizZoomChange).toHaveBeenCalledWith(1);
    expect(onVizZoomFloorChange).toHaveBeenCalledWith(1);
    expect(onFftDbLimitsChange).toHaveBeenCalledWith(-120, 0);
  });
});
