import React from "react";
import { render, screen } from "@testing-library/react";
import FFTAndWaterfall from "@n-apt/components/FFTAndWaterfall";

const fftCanvasMock = jest.fn(() => <div data-testid="fft-canvas" />);
const visualizerSlidersMock = jest.fn(() => (
  <div data-testid="visualizer-sliders" />
));
const waterfallCanvasMock = jest.fn(() => (
  <div data-testid="fifo-waterfall-canvas" />
));

jest.mock("@n-apt/components/FFTCanvas", () => {
  const React = require("react");

  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: React.Ref<HTMLDivElement>) => {
      fftCanvasMock(props);
      return <div data-testid="fft-canvas" ref={ref} />;
    }),
  };
});

jest.mock("@n-apt/components/VisualizerSliders", () => ({
  VisualizerSliders: (props: any) => visualizerSlidersMock(props),
}));

jest.mock("@n-apt/components/FIFOWaterfallCanvas", () => ({
  __esModule: true,
  default: (props: any) => waterfallCanvasMock(props),
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
  },
}));

describe("FFTAndWaterfall", () => {
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
});
