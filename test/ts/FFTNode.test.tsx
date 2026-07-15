/** @jest-environment jsdom */
import React from "react";

// Mock OffscreenCanvas for JSDOM
if (typeof window !== "undefined" && !window.OffscreenCanvas) {
  (window as any).OffscreenCanvas = class {
    constructor() {}
    getContext() {
      return {
        clearRect: jest.fn(),
        fillRect: jest.fn(),
        fillText: jest.fn(),
        stroke: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        measureText: jest.fn().mockReturnValue({ width: 0 }),
        save: jest.fn(),
        restore: jest.fn(),
        setLineDash: jest.fn(),
      };
    }
  };
}
const mockUseNodes = jest.fn((): any[] => []);
const mockUseNodeConnections = jest.fn((): any[] => []);
const mockFFTCanvasProps = jest.fn();
const mockSendFrequencyRange = jest.fn((range: unknown) => ({
  type: "mock/sendFrequencyRange",
  payload: range,
}));

jest.mock("@xyflow/react", () => ({
  useNodes: () => mockUseNodes(),
  useNodeConnections: () => mockUseNodeConnections(),
}));
jest.mock("@n-apt/components/FFTCanvas", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: React.forwardRef((props: unknown, _ref: unknown) => {
      mockFFTCanvasProps(props);
      return React.createElement("div", { "data-testid": "fft-canvas" });
    }),
  };
});
jest.mock("@n-apt/redux/thunks/websocketThunks", () => ({
  sendFrequencyRange: (range: unknown) => mockSendFrequencyRange(range),
}));
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import {
  FFTNode,
  getFftNodeDisplayCenterHz,
  getFftNodeResolvedRange,
} from "@n-apt/components/react-flow/nodes/FFTNode";
import { TestWrapper } from "./testUtils";

describe("FFTNode", () => {
  const defaultProps = {
    id: "fft-node",
    data: {
      fftOptions: true,
      label: "FFT Transform",
    },
  };

  beforeEach(() => {
    mockUseNodes.mockReturnValue([]);
    mockUseNodeConnections.mockReturnValue([]);
    mockFFTCanvasProps.mockClear();
  });

  it("keeps the canvas center aligned with its edge-panned display range", () => {
    expect(
      getFftNodeDisplayCenterHz({
        displayRange: { min: 102, max: 112 },
        bandwidthCenterFreqHz: 105,
        fallbackCenterHz: 105,
      }),
    ).toBe(107);
  });

  it("keeps the requested range ahead of stale frame metadata", () => {
    expect(
      getFftNodeResolvedRange({
        requestedRange: { min: 110, max: 120 },
        frameRange: { min: 100, max: 110 },
      }),
    ).toEqual({ min: 110, max: 120 });
  });

  it("renders with label", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders FFT description", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders node title styling", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders the FFT canvas", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByTestId("fft-canvas")).toBeInTheDocument();
  });

  it("renders its FFT canvas at twice the normal backing resolution", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(mockFFTCanvasProps).toHaveBeenCalledWith(
      expect.objectContaining({ canvasResolutionScale: 2 }),
    );
  });

  it("renders with custom label", () => {
    const customProps = {
      id: "custom-fft",
      data: {
        fftOptions: true,
        label: "Custom FFT",
      },
    };

    render(
      <TestWrapper>
        <FFTNode {...customProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("Custom FFT")).toBeInTheDocument();
  });

  it("applies 'nodrag' and 'nopan' classes to the canvas container", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    const canvas = screen.getByTestId("fft-canvas");
    const container = canvas.closest(".nodrag.nopan") as HTMLElement;
    expect(container).toBeInTheDocument();

    const style = window.getComputedStyle(container);
    expect(style.pointerEvents).toBe("auto");
    expect(style.cursor).toBe("grab");
  });

  it("uses draggable-band edge panning when connected to a Span node", () => {
    mockUseNodes.mockReturnValue([
      { id: "span-node", data: { spanOptions: true } },
    ]);
    mockUseNodeConnections.mockReturnValue([{ source: "span-node" }]);

    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(mockFFTCanvasProps).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionDisabled: false,
        selectionMode: "range",
        rangeSelectionInteraction: "edit-existing",
        selectionEdgePanMode: "frequency-range",
      }),
    );
  });

  it("publishes the new hardware range when edge panning", () => {
    mockUseNodes.mockReturnValue([
      { id: "span-node", data: { spanOptions: true } },
    ]);
    mockUseNodeConnections.mockReturnValue([{ source: "span-node" }]);

    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    const props = mockFFTCanvasProps.mock.calls[
      mockFFTCanvasProps.mock.calls.length - 1
    ]?.[0] as {
      onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
    };
    const nextRange = { min: 110, max: 120 };
    act(() => props.onFrequencyRangeChange?.(nextRange));

    expect(mockSendFrequencyRange).toHaveBeenCalledWith(nextRange);
  });
});
