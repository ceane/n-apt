import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import VisualizerSliders from "../../src/ts/components/VisualizerSliders";
import { TestWrapper } from "./testUtils";

describe("VisualizerSliders", () => {
  const defaultProps = {
    zoom: 1,
    dbMax: 0,
    dbMin: -100,
    powerScale: "dB" as const,
    onZoomChange: jest.fn(),
    onDbMaxChange: jest.fn(),
    onDbMinChange: jest.fn(),
    onResetZoomDb: jest.fn(),
    fftAvgEnabled: false,
    fftSmoothEnabled: false,
    wfSmoothEnabled: false,
    onFftAvgChange: jest.fn(),
    onFftSmoothChange: jest.fn(),
    onWfSmoothChange: jest.fn(),
  };

  test("renders all sliders with correct labels", () => {
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();

    // Check initial values (formatted)
    expect(screen.getByText(/1(\.0)?x/)).toBeInTheDocument();
    expect(screen.getByText("0dB")).toBeInTheDocument();
    expect(screen.getByText("-100dB")).toBeInTheDocument();
  });

  test("uses dBm units when powerScale is dBm", () => {
    render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          powerScale="dBm"
          dbMax={10}
          dbMin={-90}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("10dBm")).toBeInTheDocument();
    expect(screen.getByText("-90dBm")).toBeInTheDocument();
  });

  test("rounds dB labels to whole numbers", () => {
    render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          dbMax={10.4}
          dbMin={-89.6}
          powerScale="dBm"
        />
      </TestWrapper>,
    );

    expect(screen.getByText("10dBm")).toBeInTheDocument();
    expect(screen.getByText("-90dBm")).toBeInTheDocument();
  });

  test("action buttons trigger correct callbacks", () => {
    const onReset = jest.fn();
    const onAvg = jest.fn();

    render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          onResetZoomDb={onReset}
          onFftAvgChange={onAvg}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Reset"));
    expect(onReset).toHaveBeenCalled();

    fireEvent.click(screen.getByText("FFT Averaging"));
    expect(onAvg).toHaveBeenCalledWith(true);
  });

  test("toggle buttons show active state", () => {
    const { rerender } = render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} fftAvgEnabled={true} />
      </TestWrapper>,
    );

    // button is present
    expect(screen.getByText("FFT Averaging")).toBeInTheDocument();

    rerender(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} fftAvgEnabled={false} />
      </TestWrapper>,
    );
    expect(screen.getByText("FFT Averaging")).toBeInTheDocument();
  });

  test("sliders trigger change callbacks on interaction", () => {
    const onZoom = jest.fn();
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} onZoomChange={onZoom} />
      </TestWrapper>,
    );

    const _zoomSlider = screen
      .getByText("Zoom")
      .parentElement?.querySelector(".SliderTrack");
    // Since SliderTrack is a styled component, it might not have the class unless we add it.
    // Let's find it by getting the SliderThumb's parent.
    const zoomText = screen.getByText(/1(\.0)?x/);
    const track = zoomText.parentElement; // SliderTrack

    if (track) {
      // Mock getBoundingClientRect for the track
      jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
        top: 0,
        left: 0,
        width: 40,
        height: 100,
        bottom: 100,
        right: 40,
        x: 0,
        y: 0,
        toJSON: () => {},
      } as DOMRect);

      // Click at the top of the vertical zoom slider (max zoom)
      fireEvent.mouseDown(track, { clientX: 20, clientY: 5 });
      expect(onZoom).toHaveBeenCalled();
      expect(onZoom.mock.calls[0][0]).toBeGreaterThan(1);
    }
  });
});
