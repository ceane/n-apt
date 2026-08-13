/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  getCenteredWaterfallZoomView,
  getBrushCurveControlPoint,
  getWaterfallNodeFrequencyRange,
  getWaterfallNodeDisplayRange,
  getWaterfallPinchZoomView,
  getWaterfallVfoDragPan,
  getWaterfallVfoDisplayFrequency,
  getWaterfallScrollPan,
  getWaterfallZoomBoxView,
  formatMiniVfoFrequency,
  normalizeSpectrumToBrushLine,
  remapBrushLineToZoomBox,
  WaterfallNode,
} from "@n-apt/demodulation/react-flow/nodes/WaterfallNode";
import { isFilePlaybackPaused } from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";
import { ThemeProvider } from "styled-components";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const mockReduxState = {
  websocket: { activeSourceId: "test-source", dataFrameCounter: 1 },
  spectrum: { fftMinDb: -120, fftMaxDb: 0 },
  settings: { mirrorIqBasebandBelowZero: false },
};

jest.mock("@n-apt/redux", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector(mockReduxState),
  useAppDispatch: () => jest.fn(),
  setAutoZoomStability: (value: boolean) => ({
    type: "test/setAutoZoomStability",
    payload: value,
  }),
  setVizZoomFloor: (value: number) => ({
    type: "test/setVizZoomFloor",
    payload: value,
  }),
  setVizZoomFloorPan: (value: number) => ({
    type: "test/setVizZoomFloorPan",
    payload: value,
  }),
}));

jest.mock("@n-apt/redux/middleware/websocketMiddleware", () => {
  const sourceListeners = new Set<() => void>();
  const liveDataRef = {
    current: {
      center_frequency_hz: 2_204_000,
      sample_rate: 4_372_000,
      iq_data: new Uint8Array([128, 128, 129, 127]),
    },
  };
  return {
    liveDataRef,
    sourceVisualizationRuntime: {
      getSourceRef: jest.fn(() => liveDataRef),
      subscribe: jest.fn((_sourceId: string, listener: () => void) => {
        sourceListeners.add(listener);
        return () => sourceListeners.delete(listener);
      }),
    },
    __emitSourceFrame: () => {
      for (const listener of sourceListeners) listener();
    },
  };
});

jest.mock("@n-apt/spectrum/hooks/useWasmSimdMath", () => {
  const processIqToDbmSpectrum = jest.fn(
    (iq: Uint8Array) => new Float32Array([Number(iq[0] ?? 0)]),
  );
  return {
    __mockProcessIqToDbmSpectrum: processIqToDbmSpectrum,
    useWasmSimdMath: () => ({ processIqToDbmSpectrum }),
  };
});

jest.mock("@n-apt/spectrum/FIFOWaterfall", () => ({
  FIFOWaterfall: (props: {
    fftMin: number;
    fftMax: number;
    historyZoom?: number;
    historyPan?: number;
    waterfallHistoryFill?: "accretive" | "immutable";
    binSubset?: { mode: "none" | "interleaved"; parity: "odd" | "even" };
    waveformFeed?: {
      getCurrent: () => Float32Array | null;
      subscribe: (listener: (waveform: Float32Array) => void) => () => void;
    };
  }) => {
    React.useEffect(
      () => props.waveformFeed?.subscribe(() => undefined),
      [props.waveformFeed],
    );
    return (
      <div
        data-testid="waterfall-canvas"
        data-fft-min={props.fftMin}
        data-fft-max={props.fftMax}
        data-history-zoom={props.historyZoom}
        data-history-pan={props.historyPan}
        data-history-fill={props.waterfallHistoryFill}
        data-bin-subset-mode={props.binSubset?.mode}
        data-bin-subset-parity={props.binSubset?.parity}
        data-has-waveform-feed={Boolean(props.waveformFeed)}
        data-feed-waveform-length={
          props.waveformFeed?.getCurrent()?.length ?? 0
        }
      />
    );
  },
}));

jest.mock("@n-apt/spectrum/VisualizerSliders", () => ({
  __esModule: true,
  default: (props: {
    compact?: boolean;
    dbMax: number;
    dbMin: number;
    zoom: number;
  }) => (
    <div
      data-testid="waterfall-analysis-sliders"
      data-compact={props.compact}
      data-db-max={props.dbMax}
      data-db-min={props.dbMin}
      data-zoom={props.zoom}
    >
      <span>Min dB</span>
      <span>Max dB</span>
      <span>Zoom</span>
      <span>1x</span>
    </div>
  ),
}));

describe("WaterfallNode", () => {
  it("keeps React Flow from consuming wheel panning over the analysis viewport", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          id="analysis"
          type="waterfallAnalysis"
          selected={false}
          dragging={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{ label: "Waterfall Analysis", analysisOptions: true }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("waterfall-analysis-viewport")).toHaveClass(
      "nowheel",
    );
  });

  it("uses the compact shared visualizer sliders for analysis controls", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          id="analysis"
          type="waterfallAnalysis"
          selected={false}
          dragging={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{ label: "Waterfall Analysis", analysisOptions: true }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("waterfall-analysis-sliders")).toHaveAttribute(
      "data-compact",
      "true",
    );
    expect(screen.getByTestId("waterfall-analysis-sliders")).toHaveAttribute(
      "data-db-min",
      "-120",
    );
    expect(screen.getByTestId("waterfall-analysis-sliders")).toHaveAttribute(
      "data-db-max",
      "0",
    );
  });

  it("exposes the analysis title as a React Flow drag handle", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          id="analysis"
          type="waterfallAnalysis"
          selected={false}
          dragging={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{ label: "Waterfall Analysis", analysisOptions: true }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Waterfall Analysis")).toHaveClass("drag-handle");
  });

  it("clamps a live hardware window to zero Hz like the regular waterfall", () => {
    expect(
      getWaterfallNodeFrequencyRange({
        frame: {
          center_frequency_hz: 372_000,
          sample_rate: 4_372_000,
        },
      }),
    ).toEqual({ min: 0, max: 4_372_000 });
  });

  it("keeps the live acquisition window positive when mirrored display is enabled", () => {
    expect(
      getWaterfallNodeFrequencyRange({
        frame: {
          center_frequency_hz: 372_000,
          sample_rate: 4_372_000,
        },
        allowNegativeFrequencies: true,
      }),
    ).toEqual({ min: 0, max: 4_372_000 });
  });

  it("keeps the analysis window aligned to the live sample-rate frame", () => {
    expect(
      getWaterfallNodeDisplayRange({
        analysisOptions: true,
        requestedRange: { min: 36_000, max: 3_200_000 },
        sourceRange: { min: 18_000, max: 3_218_000 },
      }),
    ).toEqual({ min: 18_000, max: 3_218_000 });
  });

  it("keeps an off-center zoom-box selection inside the hardware window", () => {
    expect(
      getWaterfallZoomBoxView({
        hardwareRange: { min: 0, max: 100 },
        currentZoom: 1,
        currentPanHz: 0,
        selectionStartX: 0.9,
        selectionEndX: 1,
      }),
    ).toEqual({
      zoom: 10,
      panHz: 45,
      visibleRange: { min: 90, max: 100 },
    });
  });

  it("shows the zoombox viewport center instead of the hardware center", () => {
    expect(
      getWaterfallVfoDisplayFrequency({
        hardwareCenterHz: 1_600_000,
        visibleRange: { min: 2_880_000, max: 3_200_000 },
      }),
    ).toBe(3_040_000);
  });

  it("moves back from a right-edge zoom with downward scroll", () => {
    expect(
      getWaterfallScrollPan({
        hardwareRange: { min: 0, max: 100 },
        zoom: 10,
        currentPanHz: 45,
        deltaY: 20,
      }),
    ).toBe(40);
  });

  it("can cross back through zero after entering the reflected display range", () => {
    expect(
      getWaterfallVfoDragPan({
        hardwareRange: { min: 0, max: 100 },
        zoom: 2,
        startPanHz: -25,
        dragDistancePx: 50,
        viewportWidthPx: 100,
        allowNegativeFrequencies: true,
      }),
    ).toBe(0);
  });

  it("allows negative display panning without making the source range negative", () => {
    expect(
      getWaterfallScrollPan({
        hardwareRange: { min: 0, max: 100 },
        zoom: 2,
        currentPanHz: 0,
        deltaY: 20,
        allowNegativeFrequencies: true,
      }),
    ).toBe(-25);
  });

  it("preserves the reversed drag direction for zoomed panning", () => {
    expect(
      getWaterfallVfoDragPan({
        hardwareRange: { min: 0, max: 100 },
        zoom: 2,
        startPanHz: 0,
        dragDistancePx: -20,
        viewportWidthPx: 100,
      }),
    ).toBe(-10);
  });

  it("pinches without changing the viewport center frequency", () => {
    expect(
      getWaterfallPinchZoomView({
        hardwareRange: { min: 10, max: 110 },
        startZoom: 2,
        centerFrequencyHz: 60,
        startDistancePx: 50,
        currentDistancePx: 100,
      }),
    ).toEqual({ zoom: 4, panHz: 0 });
  });

  it("handles a two-pointer pinch over the mounted analysis viewport", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          id="analysis"
          type="waterfallAnalysis"
          selected={false}
          dragging={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{ label: "Waterfall Analysis", analysisOptions: true }}
        />
      </ThemeProvider>,
    );
    const viewport = screen.getByTestId("waterfall-analysis-viewport");
    const dispatchPointer = (
      type: string,
      pointerId: number,
      clientX: number,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: pointerId },
        pointerType: { value: "touch" },
        clientX: { value: clientX },
        clientY: { value: 100 },
      });
      fireEvent(viewport, event);
    };

    dispatchPointer("pointerdown", 1, 100);
    dispatchPointer("pointerdown", 2, 200);
    dispatchPointer("pointermove", 2, 300);

    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-history-zoom",
      "2",
    );
  });

  it("treats a trackpad pinch as zoom rather than scroll panning", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          id="analysis"
          type="waterfallAnalysis"
          selected={false}
          dragging={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{ label: "Waterfall Analysis", analysisOptions: true }}
        />
      </ThemeProvider>,
    );

    fireEvent.wheel(screen.getByTestId("waterfall-analysis-viewport"), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 100,
    });

    expect(
      Number(
        screen
          .getByTestId("waterfall-canvas")
          .getAttribute("data-history-zoom"),
      ),
    ).toBeGreaterThan(1);

    const panBeforeScroll = screen
      .getByTestId("waterfall-canvas")
      .getAttribute("data-history-pan");
    fireEvent.wheel(screen.getByTestId("waterfall-analysis-viewport"), {
      deltaY: 100,
      clientX: 100,
    });
    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-history-pan",
      panBeforeScroll,
    );

    fireEvent.wheel(screen.getByTestId("waterfall-analysis-vfo"), {
      deltaY: 100,
      clientX: 100,
    });
    expect(
      screen.getByTestId("waterfall-canvas").getAttribute("data-history-pan"),
    ).not.toBe(panBeforeScroll);
  });

  it("preserves Hz-level precision in mini VFO labels", () => {
    expect(formatMiniVfoFrequency(2_204_001)).toBe("2.204001 MHz");
  });

  it("keeps the center handle on a bent quadratic curve", () => {
    const control = getBrushCurveControlPoint({
      left: { x: 0, y: 0 },
      center: { x: 0.5, y: 0.75 },
      right: { x: 1, y: 0 },
    });

    expect(control).toEqual({ x: 0.5, y: 1.5 });
  });
  it("selects a centered spectrum view without copying for waterfall zoom", () => {
    const waveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const zoomed = getCenteredWaterfallZoomView(waveform, 2);

    expect(Array.from(zoomed)).toEqual([2, 3, 4, 5]);
    expect(zoomed.buffer).toBe(waveform.buffer);
  });

  it("uses the file pause state and a new canvas session after a source switch", () => {
    expect(
      isFilePlaybackPaused({ sourceMode: "file", isStitchPaused: true }),
    ).toBe(true);
    expect(
      getSourcePresentationSessionKey({
        sourceMode: "live",
        selectedFiles: [],
        stitchTrigger: 0,
      }),
    ).not.toBe(
      getSourcePresentationSessionKey({
        sourceMode: "file",
        selectedFiles: [{ id: "capture-1", name: "capture.napt" }],
        stitchTrigger: 1,
      }),
    );
  });

  it("places the mini VFO above the waterfall canvas when requested", () => {
    render(
      <WaterfallNode
        data={{
          label: "Beat Waterfall",
          waterfallOptions: true,
          showMiniVfo: true,
          miniVfoPosition: "top",
        }}
      />,
    );

    const miniVfo = screen.getByTestId("waterfall-node-mini-vfo");
    const waterfall = screen.getByTestId("waterfall-canvas");

    expect(miniVfo).toHaveAttribute("data-position", "top");
    expect(miniVfo).toHaveAttribute("data-drawing-type", "dom");
    expect(miniVfo).toHaveAttribute("data-tick-level", "top");
    expect(
      Number.parseFloat(getComputedStyle(miniVfo).height),
    ).toBeGreaterThanOrEqual(56);
    expect(
      miniVfo.compareDocumentPosition(waterfall) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places the mini VFO below the waterfall canvas when requested", () => {
    render(
      <WaterfallNode
        data={{
          label: "Beat Waterfall",
          waterfallOptions: true,
          showMiniVfo: true,
          miniVfoPosition: "bottom",
        }}
      />,
    );

    const miniVfo = screen.getByTestId("waterfall-node-mini-vfo");
    const waterfall = screen.getByTestId("waterfall-canvas");

    expect(miniVfo).toHaveAttribute("data-position", "bottom");
    expect(miniVfo).toHaveAttribute("data-tick-level", "bottom");
    expect(
      miniVfo.compareDocumentPosition(waterfall) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("uses compact right-side sliders instead of bottom dB knobs", () => {
    render(<WaterfallNode data={{ label: "Waterfall", waterfallOptions: true }} />);

    expect(screen.getByTestId("waterfall-compact-controls")).toBeInTheDocument();
    expect(screen.queryByTestId("waterfall-db-controls")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("renders interactive VFO and brush controls for analysis mode", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          data={{
            label: "Waterfall Analysis",
            waterfallOptions: true,
            analysisOptions: true,
          }}
        />
      </ThemeProvider>,
    );

    expect(
      screen.queryByText("Center Frequency / Onscreen Canvas"),
    ).not.toBeInTheDocument();
    const zoomSelectionButton = screen.getByRole("button", {
      name: "Zoom selection",
    });
    fireEvent.click(zoomSelectionButton);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(zoomSelectionButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.doubleClick(screen.getByTestId("waterfall-analysis-vfo"));
    expect(
      screen.getByText("Center Frequency / Onscreen Canvas"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lock VFO" }));
    expect(screen.getByRole("button", { name: "Unlock VFO" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByText("Center Frequency / Onscreen Canvas"),
    ).not.toBeInTheDocument();
    const brushButton = screen.getByRole("button", {
      name: "Paint with selection",
    });
    expect(brushButton).not.toBeDisabled();
    expect(brushButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(brushButton);
    expect(brushButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("waterfall-brush-overlay")).toHaveClass(
      "nodrag",
      "nopan",
    );
    expect(
      screen.getByRole("button", { name: "Clear brush strokes" }),
    ).toBeInTheDocument();
    fireEvent.click(brushButton);
    expect(brushButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("waterfall-brush-overlay")).toHaveStyle({
      visibility: "hidden",
    });
    fireEvent.click(brushButton);
    fireEvent.click(screen.getByRole("button", { name: "Unlock VFO" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Clear brush strokes" }),
    );
    expect(screen.getByTestId("waterfall-brush-overlay")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear brush strokes" }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Lock VFO" }));
    expect(
      screen.getByRole("button", { name: "Clear brush strokes" }),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("waterfall-db-controls"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Min dB")).toBeInTheDocument();
    expect(screen.getByText("Max dB")).toBeInTheDocument();
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Waterfall theme" }),
    ).toBeInTheDocument();
    const themeRow = screen.getByTestId("waterfall-analysis-theme-row");
    expect(getComputedStyle(themeRow).borderTopWidth).toBe("0px");
    expect(getComputedStyle(themeRow).paddingTop).toBe("12px");
    const resetButton = screen.getByRole("button", { name: "Reset" });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(screen.getByRole("button", { name: "Lock VFO" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("1x")).toBeInTheDocument();
    expect(getComputedStyle(screen.getByTestId("waterfall-node")).height).toBe(
      "500px",
    );
    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-history-fill",
      "immutable",
    );
    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-history-zoom",
      "1",
    );
  });

  it("opens Bin Subset controls and passes the selected interleaved bins to the waterfall", () => {
    render(
      <ThemeProvider theme={theme}>
        <WaterfallNode
          data={{
            label: "Waterfall Analysis",
            waterfallOptions: true,
            analysisOptions: true,
          }}
        />
      </ThemeProvider>,
    );

    expect(
      screen.queryByRole("combobox", { name: "Bin Subset" }),
    ).not.toBeInTheDocument();
    const binSubsetButton = screen.getByRole("button", { name: "Bin Subset" });
    const inactiveClassName = binSubsetButton.className;
    expect(binSubsetButton).toHaveAttribute("data-state", "inactive");
    fireEvent.click(binSubsetButton);
    expect(binSubsetButton).toHaveAttribute("data-state", "active");
    expect(binSubsetButton.className).not.toBe(inactiveClassName);

    expect(
      screen.getByRole("dialog", { name: "Bin Subset" }).parentElement,
    ).toBe(document.body);
    expect(
      screen.getByRole("heading", { name: "Bin Subset" }),
    ).toBeInTheDocument();
    const subsetSelect = screen.getByRole("combobox", { name: "Bin Subset" });
    expect(subsetSelect).toHaveValue("none");
    expect(
      screen.queryByRole("combobox", { name: "Bins" }),
    ).not.toBeInTheDocument();

    fireEvent.change(subsetSelect, { target: { value: "interleaved" } });
    const binsSelect = screen.getByRole("combobox", { name: "Bins" });
    expect(binsSelect).toHaveValue("odd");

    fireEvent.change(binsSelect, { target: { value: "even" } });
    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-bin-subset-mode",
      "interleaved",
    );
    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-bin-subset-parity",
      "even",
    );
    expect(
      screen.getByTestId("waterfall-analysis-vfo-bin-subset"),
    ).toHaveTextContent("Even Bins");
    expect(screen.getByTestId("waterfall-analysis-vfo")).toHaveStyle({
      height: "56px",
    });
  });

  it("flattens a drawn U-shaped baseline relatively", () => {
    const normalized = normalizeSpectrumToBrushLine(
      new Float32Array([-50, -100, -50]),
      {
        left: { x: 0, y: 0.5 },
        center: { x: 0.5, y: 1 },
        right: { x: 1, y: 0.5 },
      },
      -100,
      0,
    );

    expect(Array.from(normalized)).toEqual([
      -66.66666412353516, -66.66666412353516, -66.66666412353516,
    ]);
  });

  it("remaps the reference line when a zoom box is applied", () => {
    const remapped = remapBrushLineToZoomBox(
      {
        left: { x: 0.25, y: 0.2 },
        center: { x: 0.5, y: 0.8 },
        right: { x: 0.75, y: 0.2 },
      },
      0.25,
      0.75,
    );

    expect(remapped).toEqual({
      left: { x: 0, y: 0.2 },
      center: { x: 0.5, y: 0.8 },
      right: { x: 1, y: 0.2 },
    });
  });

  it("pushes standalone live frames directly to the waterfall feed", () => {
    render(
      <WaterfallNode data={{ label: "Waterfall", waterfallOptions: true }} />,
    );

    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-has-waveform-feed",
      "true",
    );
  });

  it("subscribes role-bound waterfalls to the shared source spectrum", () => {
    render(
      <WaterfallNode
        data={{
          label: "Rx Waterfall",
          waterfallOptions: true,
          sourceRole: "rx",
        }}
      />,
    );

    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-has-waveform-feed",
      "true",
    );
  });

  it("processes a new row when a reused live frame receives new IQ data", () => {
    const { liveDataRef } = jest.requireMock(
      "@n-apt/redux/middleware/websocketMiddleware",
    ) as {
      liveDataRef: {
        current: {
          center_frequency_hz: number;
          sample_rate: number;
          iq_data: Uint8Array;
        };
      };
    };
    const { __mockProcessIqToDbmSpectrum: processSpectrum } = jest.requireMock(
      "@n-apt/spectrum/hooks/useWasmSimdMath",
    ) as { __mockProcessIqToDbmSpectrum: jest.Mock };
    processSpectrum.mockClear();

    render(
      <WaterfallNode
        data={{ label: "Beat Waterfall", waterfallOptions: true }}
      />,
    );
    expect(processSpectrum).toHaveBeenCalledTimes(1);
    expect(processSpectrum).toHaveBeenLastCalledWith(
      liveDataRef.current.iq_data,
      0,
      4096,
    );

    liveDataRef.current.iq_data = new Uint8Array([140, 120, 141, 119]);
    const { __emitSourceFrame: emitSourceFrame } = jest.requireMock(
      "@n-apt/redux/middleware/websocketMiddleware",
    ) as { __emitSourceFrame: () => void };
    act(() => emitSourceFrame());

    expect(processSpectrum).toHaveBeenCalledTimes(2);
  });

  it("processes a new row when the stream mutates a reused IQ buffer", () => {
    const { liveDataRef } = jest.requireMock(
      "@n-apt/redux/middleware/websocketMiddleware",
    ) as {
      liveDataRef: {
        current: {
          center_frequency_hz: number;
          sample_rate: number;
          iq_data: Uint8Array;
        };
      };
    };
    const { __mockProcessIqToDbmSpectrum: processSpectrum } = jest.requireMock(
      "@n-apt/spectrum/hooks/useWasmSimdMath",
    ) as { __mockProcessIqToDbmSpectrum: jest.Mock };
    processSpectrum.mockClear();

    render(
      <WaterfallNode
        data={{ label: "Beat Waterfall", waterfallOptions: true }}
      />,
    );
    expect(processSpectrum).toHaveBeenCalledTimes(1);

    liveDataRef.current.iq_data[0] = 150;
    const { __emitSourceFrame: emitSourceFrame } = jest.requireMock(
      "@n-apt/redux/middleware/websocketMiddleware",
    ) as { __emitSourceFrame: () => void };
    act(() => emitSourceFrame());

    expect(processSpectrum).toHaveBeenCalledTimes(2);
  });

  it("provides compact right-side min and max dB controls", () => {
    render(
      <WaterfallNode
        data={{ label: "Beat Waterfall", waterfallOptions: true }}
      />,
    );

    const controls = screen.getByTestId("waterfall-compact-controls");
    const waterfall = screen.getByTestId("waterfall-canvas");
    expect(controls).toHaveClass("nodrag", "nopan");
    expect(waterfall.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Min dB")).toBeInTheDocument();
    expect(screen.getByText("Max dB")).toBeInTheDocument();

  });
});
