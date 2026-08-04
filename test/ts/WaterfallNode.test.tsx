/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  getCenteredWaterfallZoomView,
  getBrushCurveControlPoint,
  getWaterfallNodeFrequencyRange,
  getWaterfallPinchZoomView,
  getWaterfallVfoDragPan,
  getWaterfallVfoDisplayFrequency,
  getWaterfallScrollPan,
  getWaterfallZoomBoxView,
  formatMiniVfoFrequency,
  normalizeSpectrumToBrushLine,
  remapBrushLineToZoomBox,
  WaterfallNode,
} from "@n-apt/components/react-flow/nodes/WaterfallNode";
import { isFilePlaybackPaused } from "@n-apt/hooks/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/utils/liveSourcePresentation";
import { ThemeProvider } from "styled-components";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
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

jest.mock("@n-apt/hooks/useWasmSimdMath", () => {
  const processIqToDbmSpectrum = jest.fn(
    (iq: Uint8Array) => new Float32Array([Number(iq[0] ?? 0)]),
  );
  return {
    __mockProcessIqToDbmSpectrum: processIqToDbmSpectrum,
    useWasmSimdMath: () => ({ processIqToDbmSpectrum }),
  };
});

jest.mock("@n-apt/components/FIFOWaterfall", () => ({
  FIFOWaterfall: (props: {
    fftMin: number;
    fftMax: number;
    historyZoom?: number;
    historyPan?: number;
    waterfallHistoryFill?: "accretive" | "immutable";
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
        data-has-waveform-feed={Boolean(props.waveformFeed)}
        data-feed-waveform-length={props.waveformFeed?.getCurrent()?.length ?? 0}
      />
    );
  },
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
      screen
        .getByTestId("waterfall-canvas")
        .getAttribute("data-history-pan"),
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
    expect(
      Number.parseFloat(getComputedStyle(miniVfo).height),
    ).toBeGreaterThanOrEqual(56);
    expect(
      miniVfo.compareDocumentPosition(waterfall) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

    expect(screen.queryByText("Center Frequency / Onscreen Canvas")).not.toBeInTheDocument();
    const zoomSelectionButton = screen.getByRole("button", {
      name: "Zoom selection",
    });
    fireEvent.click(zoomSelectionButton);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(zoomSelectionButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.doubleClick(screen.getByTestId("waterfall-analysis-vfo"));
    expect(screen.getByText("Center Frequency / Onscreen Canvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lock VFO" }));
    expect(screen.getByRole("button", { name: "Unlock VFO" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("Center Frequency / Onscreen Canvas")).not.toBeInTheDocument();
    const brushButton = screen.getByRole("button", { name: "Paint with selection" });
    expect(brushButton).not.toBeDisabled();
    expect(brushButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(brushButton);
    expect(brushButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("waterfall-brush-overlay")).toHaveClass("nodrag", "nopan");
    expect(screen.getByRole("button", { name: "Clear brush strokes" })).toBeInTheDocument();
    fireEvent.click(brushButton);
    expect(brushButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("waterfall-brush-overlay")).toHaveStyle({
      visibility: "hidden",
    });
    fireEvent.click(brushButton);
    fireEvent.click(screen.getByRole("button", { name: "Unlock VFO" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear brush strokes" }));
    expect(screen.getByTestId("waterfall-brush-overlay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear brush strokes" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Lock VFO" }));
    expect(screen.getByRole("button", { name: "Clear brush strokes" })).toBeDisabled();
    expect(screen.queryByTestId("waterfall-db-controls")).not.toBeInTheDocument();
    expect(screen.getByText("Min dB")).toBeInTheDocument();
    expect(screen.getByText("Max dB")).toBeInTheDocument();
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Waterfall theme" })).toBeInTheDocument();
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

    expect(Array.from(normalized)).toEqual([-66.66666412353516, -66.66666412353516, -66.66666412353516]);
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
      <WaterfallNode
        data={{ label: "Waterfall", waterfallOptions: true }}
      />,
    );

    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-has-waveform-feed",
      "true",
    );
  });

  it("subscribes role-bound waterfalls to the shared source spectrum", () => {
    render(
      <WaterfallNode
        data={{ label: "Rx Waterfall", waterfallOptions: true, sourceRole: "rx" }}
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
      "@n-apt/hooks/useWasmSimdMath",
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
      "@n-apt/hooks/useWasmSimdMath",
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

  it("provides horizontal node-local min and max dB controls", () => {
    render(
      <WaterfallNode
        data={{ label: "Beat Waterfall", waterfallOptions: true }}
      />,
    );

    const controls = screen.getByTestId("waterfall-db-controls");
    const waterfall = screen.getByTestId("waterfall-canvas");
    expect(controls).toHaveClass("nodrag", "nopan");
    expect(
      waterfall.compareDocumentPosition(controls) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Min dB")).toBeInTheDocument();
    expect(screen.getByText("Max dB")).toBeInTheDocument();

    const maxLabel = screen.getByText("Max dB");
    const maxTrack = maxLabel.parentElement?.querySelector(
      "[aria-disabled='false']",
    ) as HTMLDivElement;
    jest.spyOn(maxTrack, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 40,
      width: 100,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(maxTrack, { clientX: 50, clientY: 20 });

    expect(screen.getByTestId("waterfall-canvas")).toHaveAttribute(
      "data-fft-max",
      "-35",
    );
  });
});
