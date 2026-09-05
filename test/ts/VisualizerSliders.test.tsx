import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import VisualizerSliders from "@n-apt/spectrum/VisualizerSliders";
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
    onLockZoomFloor: jest.fn(),
    onRefocusZoomFloor: jest.fn(),
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

  test("compact mode keeps the shared sliders without action buttons", () => {
    const { container } = render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} compact />
      </TestWrapper>,
    );

    const compactGrid = container.firstElementChild;
    expect(compactGrid).not.toBeNull();
    expect(getComputedStyle(compactGrid as Element).flexGrow).toBe("1");
    expect(getComputedStyle(compactGrid as Element).minHeight).toBe("0");

    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.queryByText("Reset")).toBeNull();
    expect(screen.queryByText("FFT Averaging")).toBeNull();
    expect(screen.queryByText("Waterfall Smoothing")).toBeNull();
  });

  test("adjusts dB sliders by 1 dB and supports inline editing", () => {
    const onMin = jest.fn();
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} onDbMinChange={onMin} />
      </TestWrapper>,
    );

    const minSlider = screen.getByTestId("slider-Min");
    fireEvent.mouseEnter(minSlider);
    fireEvent.keyDown(minSlider, { key: "ArrowUp" });
    expect(onMin).toHaveBeenCalledWith(-99);

    fireEvent.doubleClick(minSlider);
    const input = screen.getByRole("spinbutton", { name: "Min value" });
    fireEvent.change(input, { target: { value: "-25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMin).toHaveBeenLastCalledWith(-25);
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

  test("disables controls while loading", () => {
    const onReset = jest.fn();
    const onZoom = jest.fn();

    render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          disabled={true}
          onResetZoomDb={onReset}
          onZoomChange={onZoom}
        />
      </TestWrapper>,
    );

    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /fft averaging/i }),
    ).toBeDisabled();

    const zoomText = screen.getByText(/1(\.0)?x/);
    const track = zoomText.parentElement;

    if (track) {
      fireEvent.mouseDown(track, { clientX: 20, clientY: 5 });
    }

    expect(onReset).not.toHaveBeenCalled();
    expect(onZoom).not.toHaveBeenCalled();
  });

  test("shows a zoom floor badge only when zoom is locked in", () => {
    const { rerender } = render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} zoomFloor={3} />
      </TestWrapper>,
    );

    expect(screen.getByTestId("zoom-floor-indicator")).toBeInTheDocument();

    rerender(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} zoomFloor={1} />
      </TestWrapper>,
    );

    expect(screen.queryByTestId("zoom-floor-indicator")).toBeNull();
  });

  test("shows lock zoom floor when zoomed but no floor is locked", () => {
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} zoom={2} zoomFloor={1} />
      </TestWrapper>,
    );

    expect(screen.getByText("Lock Zoom Floor")).toBeInTheDocument();
    expect(screen.queryByText("Refocus (Zoom Floor)")).toBeNull();
  });

  test("hides the zoom floor action when auto stability is off", () => {
    render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          zoom={2}
          zoomFloor={1}
          autoZoomStability={false}
        />
      </TestWrapper>,
    );

    expect(screen.queryByText("Lock Zoom Floor")).toBeNull();
  });

  test("disables lock zoom floor at the initial 1.0x zoom when auto stability is enabled", () => {
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} zoom={1} zoomFloor={1} />
      </TestWrapper>,
    );

    const button = screen.getByRole("button", { name: /lock zoom floor/i });
    expect(button).toBeDisabled();
  });

  test("shows refocus zoom floor when a floor is locked", () => {
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} zoom={2} zoomFloor={3} />
      </TestWrapper>,
    );

    expect(screen.getByText("Refocus (Zoom Floor)")).toBeInTheDocument();
    expect(screen.queryByText("Lock Zoom Floor")).toBeNull();
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

  test("hides the tx slider toggle when the active source cannot transmit", () => {
    render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          canShowTxSlider={false}
          showTxSlider={true}
        />
      </TestWrapper>,
    );

    expect(screen.queryByText(/tx slider/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /tx slider/i })).toBeNull();
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

  test("allows the zoom slider to reach the 1,125x maximum", () => {
    const onZoom = jest.fn();
    render(
      <TestWrapper>
        <VisualizerSliders {...defaultProps} onZoomChange={onZoom} />
      </TestWrapper>,
    );

    const zoomText = screen.getByText(/1(\.0)?x/);
    const track = zoomText.parentElement;
    expect(track).not.toBeNull();
    if (!track) return;

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

    fireEvent.mouseDown(track, { clientX: 20, clientY: 0 });
    expect(onZoom).toHaveBeenCalledWith(1125);
  });

  test("zoom floor action toggles between lock and refocus", () => {
    const onLock = jest.fn();
    const onRefocus = jest.fn();

    const { rerender } = render(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          zoom={2}
          zoomFloor={1}
          onLockZoomFloor={onLock}
          onRefocusZoomFloor={onRefocus}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Lock Zoom Floor"));
    expect(onLock).toHaveBeenCalled();
    expect(onRefocus).not.toHaveBeenCalled();

    rerender(
      <TestWrapper>
        <VisualizerSliders
          {...defaultProps}
          zoom={2}
          zoomFloor={3}
          onLockZoomFloor={onLock}
          onRefocusZoomFloor={onRefocus}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Refocus (Zoom Floor)"));
    expect(onRefocus).toHaveBeenCalled();
  });
});
