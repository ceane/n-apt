/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WaterfallNode } from "@n-apt/components/react-flow/nodes/WaterfallNode";
import { isFilePlaybackPaused } from "@n-apt/hooks/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/utils/liveSourcePresentation";

const mockReduxState = {
  websocket: { activeSourceId: "test-source", dataFrameCounter: 1 },
  spectrum: { fftMinDb: -120, fftMaxDb: 0 },
};

jest.mock("@n-apt/redux", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector(mockReduxState),
}));

jest.mock("@n-apt/redux/middleware/websocketMiddleware", () => {
  const liveDataRef = {
    current: {
      center_frequency_hz: 2_204_000,
      sample_rate: 4_372_000,
      iq_data: new Uint8Array([128, 128, 129, 127]),
    },
  };
  return { liveDataRef };
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
  FIFOWaterfall: (props: { fftMin: number; fftMax: number }) => (
    <div
      data-testid="waterfall-canvas"
      data-fft-min={props.fftMin}
      data-fft-max={props.fftMax}
    />
  ),
}));

describe("WaterfallNode", () => {
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

  it("processes a new row when a reused live frame receives new IQ data", () => {
    jest.useFakeTimers();
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
    act(() => jest.advanceTimersByTime(125));

    expect(processSpectrum).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
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

    const view = render(
      <WaterfallNode
        data={{ label: "Beat Waterfall", waterfallOptions: true }}
      />,
    );
    expect(processSpectrum).toHaveBeenCalledTimes(1);

    liveDataRef.current.iq_data[0] = 150;
    mockReduxState.websocket.dataFrameCounter += 1;
    view.rerender(
      <WaterfallNode
        data={{ label: "Beat Waterfall", waterfallOptions: true }}
      />,
    );

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
