import React from "react";
import { render, screen } from "@testing-library/react";
import FFTAndWaterfall from "@n-apt/components/FFTAndWaterfall";

const fftCanvasMock = jest.fn((_props?: any) => <div data-testid="fft-canvas" />);
const fftCanvasMountSpy = jest.fn();
const fftCanvasUnmountSpy = jest.fn();
const visualizerSlidersMock = jest.fn((_props: any) => (
  <div data-testid="visualizer-sliders" />
));
const waterfallCanvasMock = jest.fn(() => (
  <div data-testid="fifo-waterfall-canvas" />
));

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
  default: (_props: any) => waterfallCanvasMock(),
}));

jest.mock("@n-apt/redux", () => ({
  useAppSelector: (selector: any) =>
    selector({
      spectrum: {
        fftAvgEnabled: false,
        fftSmoothEnabled: false,
        wfSmoothEnabled: false,
      },
      theme: {
        fftColor: "#00d4ff",
        waterfallTheme: "classic",
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
      }),
    );
    expect(screen.getByTestId("fifo-waterfall-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("visualizer-sliders")).toBeInTheDocument();
  });

  it("remounts the live FFT canvas when fftSize changes", () => {
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

    expect(fftCanvasMountSpy).toHaveBeenCalledTimes(2);
    expect(fftCanvasUnmountSpy).toHaveBeenCalledTimes(1);
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
